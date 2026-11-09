/**
 * deployToken — deploys a `CrossChainToken` (v2.0.0) via raw init-code. The tx has no
 * `to`; `execute` returns the deployed contract address.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress } from 'ethers'

import { type DeployArtifact, EVMDeployOperation } from '../../operation.ts'
import { validateAddress, validateBaseERC20Params } from '../../validate.ts'
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
      // preMintRecipient is set iff preMint > 0 (enforced in prepare); zero address otherwise.
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
  protected override prepare(params: DeployTokenParams): DeployTokenParams {
    validateBaseERC20Params(this.name, params)
    validateAddress(this.name, 'owner', params.owner)
    if (params.burnMintRoleAdmin !== undefined)
      validateAddress(this.name, 'burnMintRoleAdmin', params.burnMintRoleAdmin)
    return params
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
