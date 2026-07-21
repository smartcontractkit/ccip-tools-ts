/**
 * deployToken — deploys a `CrossChainToken` (v2.0.0) via raw init-code. The tx has no
 * `to`; `execute` returns the deployed contract address.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import {
  type DeployResult,
  type EVMExecuteParams,
  EVMOperation,
  deploymentTx,
} from '../../operation.ts'
import { submit } from '../../submit.ts'
import {
  validateAddress,
  validateNonEmptyString,
  validateUint256,
  validateUint8,
} from '../../validate.ts'
import { TokenVersion, tokenArtifact } from '../version.ts'

/** Parameters for {@link DeployToken} — deploys `CrossChainToken` (v2.0.0). */
export interface DeployTokenParams {
  name: string
  symbol: string
  decimals: number
  /** Max supply cap; `0n` means unlimited. */
  maxSupply: bigint
  /** Amount minted at deploy; defaults to `0n`. Must be `<= maxSupply` when capped. */
  preMint?: bigint
  /** Receives ownership; a valid address. */
  owner: string
  /** Recipient of `preMint`; required when `preMint > 0`, must be unset otherwise. */
  preMintRecipient?: string
  /** CCIP admin (`getCCIPAdmin`); defaults to `owner`. */
  ccipAdmin?: string
  /** Admin of the burn/mint roles; defaults to `owner`. */
  burnMintRoleAdmin?: string
  sender?: string
}

/** Encodes the `CrossChainToken` (v2.0.0) constructor args; admins default to `owner`. */
function encodeCrossChainToken(iface: Interface, p: DeployTokenParams): string {
  return iface.encodeDeploy([
    [
      p.name,
      p.symbol,
      p.maxSupply,
      p.preMint ?? 0n,
      // preMintRecipient is set iff preMint > 0 (enforced in validate); zero address otherwise.
      p.preMintRecipient ?? ZeroAddress,
      p.decimals,
      p.ccipAdmin ?? p.owner,
    ],
    p.burnMintRoleAdmin ?? p.owner,
    p.owner,
  ])
}

/** Deploys a `CrossChainToken`; `execute` resolves to `{ hash, contractAddress }`. */
export class DeployToken extends EVMOperation<DeployTokenParams> {
  readonly name = 'deployToken'

  /** Validates the constructor params before building init-code. */
  protected validate(params: DeployTokenParams): void {
    validateNonEmptyString(this.name, 'name', params.name)
    validateNonEmptyString(this.name, 'symbol', params.symbol)
    validateUint8(this.name, 'decimals', params.decimals)
    validateUint256(this.name, 'maxSupply', params.maxSupply)
    const preMint = params.preMint ?? 0n
    validateUint256(this.name, 'preMint', preMint)
    validateAddress(this.name, 'owner', params.owner)
    if (params.maxSupply !== 0n && preMint > params.maxSupply)
      throw new CCTParamsInvalidError(
        this.name,
        'preMint',
        `must be <= maxSupply (${params.maxSupply}), got ${preMint}`,
      )
    // Mirror CrossChainToken's ctor: preMintRecipient is set (and non-zero) iff preMint > 0.
    if (preMint > 0n) {
      if (params.preMintRecipient === undefined)
        throw new CCTParamsInvalidError(
          this.name,
          'preMintRecipient',
          'must be set when preMint > 0',
        )
      validateAddress(this.name, 'preMintRecipient', params.preMintRecipient)
      if (params.preMintRecipient === ZeroAddress)
        throw new CCTParamsInvalidError(
          this.name,
          'preMintRecipient',
          'must be non-zero when preMint > 0',
        )
    } else if (params.preMintRecipient !== undefined) {
      throw new CCTParamsInvalidError(
        this.name,
        'preMintRecipient',
        'must be unset when preMint is 0',
      )
    }
    if (params.ccipAdmin !== undefined) validateAddress(this.name, 'ccipAdmin', params.ccipAdmin)
    if (params.burnMintRoleAdmin !== undefined)
      validateAddress(this.name, 'burnMintRoleAdmin', params.burnMintRoleAdmin)
  }

  /** Builds a deployment tx (no `to`): creation bytecode + ABI-encoded constructor args. */
  protected buildUnsigned(_chain: EVMChain, params: DeployTokenParams): UnsignedEVMTx {
    // hardcoded to deploy CrossChainToken 2.0.0
    const { iface, bytecode } = tokenArtifact(TokenVersion.V2_0_0)
    return deploymentTx(bytecode, encodeCrossChainToken(iface, params))
  }

  /**
   * {@link generate}, then sign and submit; resolves to the tx hash and the newly
   * deployed contract address (read from the mined receipt).
   * @throws {@link CCTTxFailedError} if the tx mined without producing a contract address
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<DeployTokenParams>,
  ): Promise<DeployResult> {
    const { response, receipt } = await submit(
      chain,
      params.wallet,
      await this.generate(chain, params),
      this.name,
    )
    if (!receipt.contractAddress)
      throw new CCTTxFailedError(this.name, 'deployment produced no contract address', {
        context: { txHash: response.hash },
      })
    return { hash: response.hash, contractAddress: receipt.contractAddress }
  }
}
