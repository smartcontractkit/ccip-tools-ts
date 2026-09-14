/**
 * deployToken — deploys a `CrossChainToken` (v2.0.0) via raw init-code. The tx has no
 * `to`; `execute` returns the deployed contract address.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress } from 'ethers'

import { CCTParamsInvalidError } from '../../../errors.ts'
import { type DeployArtifact, EVMDeployOperation } from '../../operation.ts'
import {
  validateAddress,
  validateNonEmptyString,
  validateUint256,
  validateUint8,
} from '../../validate.ts'
import { TokenVersion, getTokenArtifact } from '../contracts.ts'

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

/** Deploys a `CrossChainToken`; `execute` resolves to `{ hash, contractAddress, verification }`. */
export class DeployToken extends EVMDeployOperation<DeployTokenParams> {
  readonly name = 'deployToken'

  /** Validates the constructor params before building init-code. */
  protected override validate(params: DeployTokenParams): void {
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

  /** Deploy artifact for `CrossChainToken` (v2.0.0). */
  protected artifact(): DeployArtifact {
    return getTokenArtifact(TokenVersion.V2_0_0)
  }

  /** ABI-encodes the `CrossChainToken` (v2.0.0) constructor args. */
  protected encode(iface: Interface, params: DeployTokenParams): string {
    return encodeCrossChainToken(iface, params)
  }
}
