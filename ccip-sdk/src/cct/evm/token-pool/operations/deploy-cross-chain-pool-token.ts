/**
 * deployCrossChainPoolToken: deploys a `CrossChainPoolToken` (v2.0.0), an ERC20 that is its own
 * token pool, via raw init-code. The tx has no `to`; `execute` returns the deployed contract
 * address, which is both the token and the pool.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress } from 'ethers'

import { type DeployArtifact, EVMDeployOperation } from '../../operation.ts'
import { validateAddress, validateBaseERC20Params, validateNonZeroAddress } from '../../validate.ts'
import { getCrossChainPoolTokenArtifact } from '../contracts.ts'

/**
 * Parameters for {@link DeployCrossChainPoolToken}: deploys `CrossChainPoolToken` (v2.0.0).
 *
 * @remarks No `owner`: the deployer owns the contract (hand off with `transferPoolOwnership`).
 */
export type DeployCrossChainPoolTokenParams = {
  name: string
  symbol: string
  /** The token's own `decimals` (uint8), also the pool's local token decimals. */
  decimals: number
  /** Max supply cap; `0n` means unlimited. */
  maxSupply: bigint
  /** Amount minted at deploy; defaults to `0n`. Must be `<= maxSupply` when capped. */
  preMint?: bigint
  /** Recipient of `preMint`; required when `preMint > 0`, must be unset otherwise. */
  preMintRecipient?: string
  /**
   * CCIP admin (`getCCIPAdmin`); defaults to the zero address, which the contract replaces with
   * the deployer.
   */
  ccipAdmin?: string
  /** Non-zero RMN proxy address. */
  rmnProxy: string
  /** Non-zero CCIP router address. */
  router: string
  /**
   * `AdvancedPoolHooks` contract to bind at construction, as returned by
   * `deployAdvancedPoolHooks`. Defaults to the zero address, which leaves the pool enforcing no
   * sender allowlist and no CCV requirements.
   * @remarks Re-pointable after deploy with `updateAdvancedPoolHooks`.
   */
  advancedPoolHooks?: string
  /** Deployer address; sets `tx.from` for offline / multisig signing. Becomes the owner. */
  sender?: string
}

/**
 * Deploys a `CrossChainPoolToken`; `execute` resolves to
 * `{ hash, contractAddress, verification }`.
 */
export class DeployCrossChainPoolToken extends EVMDeployOperation<DeployCrossChainPoolTokenParams> {
  readonly name = 'deployCrossChainPoolToken'

  /** Validates the constructor params before building init-code. */
  protected override prepare(
    params: DeployCrossChainPoolTokenParams,
  ): DeployCrossChainPoolTokenParams {
    validateBaseERC20Params(this.name, params)
    validateNonZeroAddress(this.name, 'rmnProxy', params.rmnProxy)
    validateNonZeroAddress(this.name, 'router', params.router)
    if (params.advancedPoolHooks !== undefined)
      validateAddress(this.name, 'advancedPoolHooks', params.advancedPoolHooks)
    return params
  }

  /** Deploy artifact for `CrossChainPoolToken` (v2.0.0). */
  protected artifact(): DeployArtifact {
    return getCrossChainPoolTokenArtifact()
  }

  /** ABI-encodes the `CrossChainPoolToken` (v2.0.0) constructor args; omitted ones encode as 0. */
  protected encode(iface: Interface, p: DeployCrossChainPoolTokenParams): string {
    return iface.encodeDeploy([
      [
        p.name,
        p.symbol,
        p.maxSupply,
        p.preMint ?? 0n,
        // preMintRecipient is set iff preMint > 0 (enforced in prepare); zero address otherwise.
        p.preMintRecipient ?? ZeroAddress,
        p.decimals,
        p.ccipAdmin ?? ZeroAddress,
      ],
      p.advancedPoolHooks ?? ZeroAddress,
      p.rmnProxy,
      p.router,
    ])
  }
}
