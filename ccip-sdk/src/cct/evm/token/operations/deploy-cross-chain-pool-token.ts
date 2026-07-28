/**
 * deployCrossChainPoolToken — deploys a `CrossChainPoolToken` (v2.0.0) via contract
 * creation. The contract is simultaneously an ERC20 token and its own CCIP token pool,
 * so the single deployed address is both the token and the pool.
 *
 * Constructor args: ConstructorParams tokenParams, address advancedPoolHooks,
 * address rmnProxy, address router. `rmnProxy` is derived from the router via
 * `Router.getArmProxy()`; `advancedPoolHooks` defaults to the zero address.
 *
 * The signed `execute` path auto-fills `ccipAdmin` from the wallet and returns the deployed
 * address (from the mined receipt). The unsigned `generate` path requires `ccipAdmin`
 * explicitly (no signer to derive it from).
 *
 * @packageDocumentation
 */

import { type TransactionReceipt, AbiCoder, Contract, ZeroAddress, concat } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { interfaces } from '../../../../evm/const.ts'
import { type EVMChain, isSigner } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import { type DeployVerification, buildDeployVerification } from '../../deploy-verification.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'
import { CROSS_CHAIN_POOL_TOKEN_BYTECODE } from '../bytecodes/CrossChainPoolToken.ts'

/** Canonical CCT v2.0 constructor tuple for BaseERC20/CrossChainToken: `ConstructorParams`. */
const CROSS_CHAIN_TOKEN_PARAMS_TUPLE =
  'tuple(string name, string symbol, uint256 maxSupply, uint256 preMint, address preMintRecipient, uint8 decimals, address ccipAdmin)'

/** Parameters for `deployCrossChainPoolToken`. */
export type DeployCrossChainPoolTokenParams = {
  name: string
  symbol: string
  decimals: number
  maxSupply?: bigint
  /** Amount pre-minted at deploy. `undefined`/`0n` = none. */
  initialSupply?: bigint
  /** CCIP Router address (used to derive `rmnProxy` via `getArmProxy()`). */
  routerAddress: string
  /** Advanced pool hooks contract. Defaults to the zero address (no hooks). */
  advancedPoolHooks?: string
  /**
   * CCIP admin (`getCCIPAdmin()`). Required on the unsigned path; auto-filled from the
   * signer on the signed path. Defaults `preMintRecipient`.
   */
  ccipAdmin?: string
  /** Recipient of the pre-mint. Defaults to `ccipAdmin`; ignored when `initialSupply` is `0n`. */
  preMintRecipient?: string
  sender?: string
}

/**
 * Result of a signed `deployCrossChainPoolToken`: the tx hash plus the deployed address.
 * The single contract is both the token and its pool, so `tokenAddress` and `poolAddress`
 * are equal to `address`.
 */
export type DeployCrossChainPoolTokenResult = TransactionHash & {
  /** Deployed contract address (token == pool). */
  address: string
  /** Same as `address` (the contract is its own token). */
  tokenAddress: string
  /** Same as `address` (the contract is its own pool). */
  poolAddress: string
  /** Block-explorer verification handle (contract key + ABI-encoded constructor args). */
  verification: DeployVerification
}

/** Deploys a `CrossChainPoolToken` (combined token + pool) via contract creation. */
export class DeployCrossChainPoolToken extends EVMOperation<
  DeployCrossChainPoolTokenParams,
  DeployCrossChainPoolTokenResult
> {
  readonly name = 'deployCrossChainPoolToken'

  /** Validates token params (ccipAdmin required only on the unsigned path). */
  protected validate(p: DeployCrossChainPoolTokenParams): void {
    if (!p.name || p.name.trim().length === 0)
      throw new CCTParamsInvalidError(this.name, 'name', 'must be non-empty')
    if (!p.symbol || p.symbol.trim().length === 0)
      throw new CCTParamsInvalidError(this.name, 'symbol', 'must be non-empty')
    if (p.maxSupply !== undefined && p.maxSupply < 0n)
      throw new CCTParamsInvalidError(this.name, 'maxSupply', 'must be non-negative')
    if (p.initialSupply !== undefined && p.initialSupply < 0n)
      throw new CCTParamsInvalidError(this.name, 'initialSupply', 'must be non-negative')
    if (
      p.maxSupply !== undefined &&
      p.maxSupply > 0n &&
      p.initialSupply !== undefined &&
      p.initialSupply > p.maxSupply
    )
      throw new CCTParamsInvalidError(this.name, 'initialSupply', 'exceeds maxSupply')
    validateAddress(this.name, 'routerAddress', p.routerAddress)
    if (!p.ccipAdmin || p.ccipAdmin.trim().length === 0)
      throw new CCTParamsInvalidError(
        this.name,
        'ccipAdmin',
        'required (the signed deployCrossChainPoolToken path auto-fills it from the signer)',
      )
  }

  /** Builds the CrossChainPoolToken contract-creation tx (constructor args + bytecode). */
  protected async buildUnsigned(
    chain: EVMChain,
    p: DeployCrossChainPoolTokenParams,
  ): Promise<UnsignedEVMTx> {
    const ccipAdmin = p.ccipAdmin!
    const maxSupply = p.maxSupply ?? 0n
    const preMint = p.initialSupply ?? 0n
    const advancedPoolHooks = p.advancedPoolHooks ?? ZeroAddress
    // CrossChainPoolToken reverts unless preMintRecipient is zero exactly when preMint is zero.
    const preMintRecipient = preMint > 0n ? (p.preMintRecipient ?? ccipAdmin) : ZeroAddress
    const rmnProxy = await this.deriveRmnProxy(chain, p.routerAddress)

    // CrossChainPoolToken constructor: (ConstructorParams tokenParams, advancedPoolHooks, rmnProxy, router)
    const encodedArgs = AbiCoder.defaultAbiCoder().encode(
      [CROSS_CHAIN_TOKEN_PARAMS_TUPLE, 'address', 'address', 'address'],
      [
        {
          name: p.name,
          symbol: p.symbol,
          maxSupply,
          preMint,
          preMintRecipient,
          decimals: p.decimals,
          ccipAdmin,
        },
        advancedPoolHooks,
        rmnProxy,
        p.routerAddress,
      ],
    )
    const data = concat([CROSS_CHAIN_POOL_TOKEN_BYTECODE, encodedArgs])
    return { family: ChainFamily.EVM, transactions: [{ to: null, data }] }
  }

  /** Derives the RMN proxy address from a CCIP Router via `Router.getArmProxy()`. */
  private async deriveRmnProxy(chain: EVMChain, routerAddress: string): Promise<string> {
    const router = new Contract(routerAddress, interfaces.Router, chain.provider)
    try {
      return (await router.getFunction('getArmProxy')()) as string
    } catch (error) {
      throw new CCTTxFailedError(
        this.name,
        `failed to derive rmnProxy from router ${routerAddress}`,
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  /** Signed deploy: auto-fills `ccipAdmin` from the wallet, then deploys. */
  override async execute(
    chain: EVMChain,
    params: DeployCrossChainPoolTokenParams & { wallet: unknown },
  ): Promise<DeployCrossChainPoolTokenResult> {
    if (!isSigner(params.wallet)) throw new CCIPWalletInvalidError(params.wallet)
    const ccipAdmin = params.ccipAdmin ?? (await params.wallet.getAddress())
    return super.execute(chain, { ...params, ccipAdmin })
  }

  /**
   * Extracts the deployed address from the creation receipt (token == pool == address) and
   * rebuilds the block-explorer verification handle from the submitted creation calldata.
   */
  protected override resultFromReceipt(
    hash: TransactionHash,
    receipt: TransactionReceipt,
    unsigned: UnsignedEVMTx,
  ): DeployCrossChainPoolTokenResult {
    if (!receipt.contractAddress)
      throw new CCTTxFailedError(this.name, 'no contract address in deploy receipt', {
        context: { txHash: hash.hash },
      })
    const data = unsigned.transactions[0]?.data
    if (!data)
      throw new CCTTxFailedError(this.name, 'missing deploy calldata for verification', {
        context: { txHash: hash.hash },
      })
    return {
      ...hash,
      address: receipt.contractAddress,
      tokenAddress: receipt.contractAddress,
      poolAddress: receipt.contractAddress,
      verification: buildDeployVerification(
        'CrossChainPoolToken',
        data,
        CROSS_CHAIN_POOL_TOKEN_BYTECODE,
      ),
    }
  }
}
