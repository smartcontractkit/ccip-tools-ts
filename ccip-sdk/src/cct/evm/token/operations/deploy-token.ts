/**
 * deployToken — deploys a CrossChainToken (v2.0.0) via contract creation.
 *
 * The signed `execute` path auto-fills `ownerAddress` from the wallet and returns
 * the deployed `tokenAddress` (from the mined receipt). The unsigned `generate`
 * path requires `ownerAddress` explicitly (no signer to derive it from).
 *
 * @packageDocumentation
 */

import { type TransactionReceipt, AbiCoder, ZeroAddress, concat } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { type EVMChain, isSigner } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import { type DeployVerification, buildDeployVerification } from '../../deploy-verification.ts'
import { EVMOperation } from '../../operation.ts'
import { CROSS_CHAIN_TOKEN_BYTECODE } from '../bytecodes/CrossChainToken.ts'

const CROSS_CHAIN_TOKEN_PARAMS_TUPLE =
  'tuple(string name, string symbol, uint256 maxSupply, uint256 preMint, address preMintRecipient, uint8 decimals, address ccipAdmin)'

/** Parameters for `deployToken`. */
export type DeployTokenParams = {
  name: string
  symbol: string
  decimals: number
  maxSupply?: bigint
  /** Amount pre-minted at deploy. `undefined`/`0n` = none. */
  initialSupply?: bigint
  /**
   * Owner (2-step AccessControl admin). Required on the unsigned path; auto-filled
   * from the signer on the signed path. Defaults the other address fields.
   */
  ownerAddress?: string
  /** CCIP admin (`getCCIPAdmin()`). Defaults to `ownerAddress`. */
  ccipAdmin?: string
  /** Admin that may grant/revoke MINTER/BURNER roles. Defaults to `ownerAddress`. */
  burnMintRoleAdmin?: string
  /** Recipient of the pre-mint. Defaults to `ownerAddress`; ignored when `initialSupply` is `0n`. */
  preMintRecipient?: string
  sender?: string
}

/** Result of a signed `deployToken`: the tx hash plus the deployed token address. */
export type DeployTokenResult = TransactionHash & {
  tokenAddress: string
  /** Block-explorer verification handle (contract key + ABI-encoded constructor args). */
  verification: DeployVerification
}

/** Deploys a CrossChainToken via contract creation. */
export class DeployToken extends EVMOperation<DeployTokenParams, DeployTokenResult> {
  readonly name = 'deployToken'

  /** Validates token params (owner required only on the unsigned path). */
  protected validate(p: DeployTokenParams): void {
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
    if (!p.ownerAddress || p.ownerAddress.trim().length === 0)
      throw new CCTParamsInvalidError(
        this.name,
        'ownerAddress',
        'required (the signed deployToken path auto-fills it from the signer)',
      )
  }

  /** Builds the CrossChainToken contract-creation tx (constructor args + bytecode). */
  protected buildUnsigned(_chain: EVMChain, p: DeployTokenParams): UnsignedEVMTx {
    const owner = p.ownerAddress!
    const maxSupply = p.maxSupply ?? 0n
    const preMint = p.initialSupply ?? 0n
    const ccipAdmin = p.ccipAdmin ?? owner
    const burnMintRoleAdmin = p.burnMintRoleAdmin ?? owner
    // CrossChainToken reverts unless preMintRecipient is zero exactly when preMint is zero.
    const preMintRecipient = preMint > 0n ? (p.preMintRecipient ?? owner) : ZeroAddress

    const encodedArgs = AbiCoder.defaultAbiCoder().encode(
      [CROSS_CHAIN_TOKEN_PARAMS_TUPLE, 'address', 'address'],
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
        burnMintRoleAdmin,
        owner,
      ],
    )
    const data = concat([CROSS_CHAIN_TOKEN_BYTECODE, encodedArgs])
    return { family: ChainFamily.EVM, transactions: [{ to: null, data }] }
  }

  /** Signed deploy: auto-fills `ownerAddress` from the wallet, then deploys. */
  override async execute(
    chain: EVMChain,
    params: DeployTokenParams & { wallet: unknown },
  ): Promise<DeployTokenResult> {
    if (!isSigner(params.wallet)) throw new CCIPWalletInvalidError(params.wallet)
    const ownerAddress = params.ownerAddress ?? (await params.wallet.getAddress())
    return super.execute(chain, { ...params, ownerAddress })
  }

  /**
   * Extracts the deployed token address from the creation receipt and rebuilds the
   * block-explorer verification handle from the submitted creation calldata.
   */
  protected override resultFromReceipt(
    hash: TransactionHash,
    receipt: TransactionReceipt,
    unsigned: UnsignedEVMTx,
  ): DeployTokenResult {
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
      tokenAddress: receipt.contractAddress,
      verification: buildDeployVerification('CrossChainToken', data, CROSS_CHAIN_TOKEN_BYTECODE),
    }
  }
}
