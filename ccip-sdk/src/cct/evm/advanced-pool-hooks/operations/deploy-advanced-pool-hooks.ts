/**
 * deployAdvancedPoolHooks — deploys an `AdvancedPoolHooks` (v2.0.0) via raw init-code. The tx has
 * no `to`; `execute` returns the deployed contract address. A v2.0.0 `TokenPool` carries no
 * sender allowlist and no CCV configuration of its own — both live here — so deploy this, then
 * bind it to a pool with `updateAdvancedPoolHooks` (or pass it as the pool constructor's
 * `advancedPoolHooks`). Mirrors `lockbox/operations/deploy-lockbox.ts`.
 *
 * @packageDocumentation
 */

import { type Interface, ZeroAddress, getAddress } from 'ethers'

import { CCTParamsInvalidError } from '../../../errors.ts'
import { type DeployArtifact, EVMDeployOperation } from '../../operation.ts'
import {
  validateAddress,
  validateArray,
  validateNonZeroAddress,
  validateUint256,
} from '../../validate.ts'
import { getAdvancedPoolHooksArtifact } from '../contracts.ts'

/** Parameters for {@link DeployAdvancedPoolHooks} — deploys `AdvancedPoolHooks` (v2.0.0). */
export type DeployAdvancedPoolHooksParams = {
  /**
   * Senders permitted to `lockOrBurn` through pools bound to these hooks; defaults to `[]`.
   * @remarks **Permanent:** `i_allowlistEnabled` is `immutable`, set to `allowlist.length > 0`.
   * Deploy with `[]` and the contract can never gain an allowlist; deploy with entries and it
   * can be edited but never switched off.
   */
  allowlist?: string[]
  /**
   * Amount at or above which the threshold CCVs also apply; `0n` (the default) disables the
   * threshold.
   */
  thresholdAmount?: bigint
  /**
   * Policy engine run on every pre/postflight check; the zero address (the default) disables
   * policy checks.
   */
  policyEngine?: string
  /**
   * Pools permitted to call `preflightCheck` / `postflightCheck` on these hooks; defaults to `[]`.
   * @remarks Binding a pool with `updateAdvancedPoolHooks` does *not* authorize it here; a pool
   * missing from this set reverts `UnauthorizedCaller` on every transfer.
   */
  authorizedCallers?: string[]
  /** Deployer address; sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/**
 * A dense array of valid, non-zero, distinct addresses. Duplicates are rejected because the
 * on-chain `EnumerableSet` silently drops them; compared checksummed, as it would.
 * @throws {@link CCTParamsInvalidError} on a non-array, a bad or zero entry (`param[i]`), or a
 * duplicate
 */
function validateAddressList(operation: string, param: string, value: unknown): void {
  validateArray(operation, param, value)
  const normalized = value.map((entry, i) => {
    validateNonZeroAddress(operation, `${param}[${i}]`, entry)
    return getAddress(entry as string)
  })
  if (new Set(normalized).size !== normalized.length)
    throw new CCTParamsInvalidError(operation, param, 'must not contain duplicate addresses')
}

/**
 * Deploys an `AdvancedPoolHooks`; `execute` resolves to `{ hash, contractAddress, verification }`,
 * where `verification.encodedConstructorArgs` is the ABI-encoded ctor tuple a block explorer
 * needs to verify the source.
 */
export class DeployAdvancedPoolHooks extends EVMDeployOperation<DeployAdvancedPoolHooksParams> {
  readonly name = 'deployAdvancedPoolHooks'

  /**
   * Validates the constructor params before building init-code. Not `parse`: a normalizing
   * deploy op would publish `verification` args that differ from the deployed ones, because
   * `EVMDeployOperation.execute` re-derives them from the raw params.
   * @remarks A zero in `allowlist` is the nastier of the two zero cases — the constructor skips
   * it but still counts it, permanently enabling an allowlist containing nobody.
   */
  protected override validate(params: DeployAdvancedPoolHooksParams): void {
    validateAddressList(this.name, 'allowlist', params.allowlist ?? [])
    validateUint256(this.name, 'thresholdAmount', params.thresholdAmount ?? 0n)
    validateAddress(this.name, 'policyEngine', params.policyEngine ?? ZeroAddress)
    validateAddressList(this.name, 'authorizedCallers', params.authorizedCallers ?? [])
  }

  /** Deploy artifact for `AdvancedPoolHooks` (v2.0.0). */
  protected artifact(): DeployArtifact {
    return getAdvancedPoolHooksArtifact()
  }

  /** ABI-encodes the `AdvancedPoolHooks` (v2.0.0) constructor args; omitted params encode as off. */
  protected encode(iface: Interface, p: DeployAdvancedPoolHooksParams): string {
    return iface.encodeDeploy([
      p.allowlist ?? [],
      p.thresholdAmount ?? 0n,
      p.policyEngine ?? ZeroAddress,
      p.authorizedCallers ?? [],
    ])
  }
}
