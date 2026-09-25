/**
 * EVM `AdvancedPoolHooks` contract layer for CCT: the cached {@link Interface}
 * ({@link ADVANCED_POOL_HOOKS_INTERFACE}), the deploy artifact
 * ({@link getAdvancedPoolHooksArtifact}), and the bind-target guard
 * ({@link assertAdvancedPoolHooksContract}). Only one version is deployable, so there is no
 * version framework here. Mirrors `lockbox/contracts.ts`.
 *
 * @remarks A v2.0.0 `TokenPool` has no allowlist or CCV configuration of its own: both live on an
 * optional `AdvancedPoolHooks`, consulted only when bound — an unbound pool enforces neither.
 *
 * @packageDocumentation
 */

import { Interface, getAddress } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import { resultToObject } from '../../../evm/types.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../../errors.ts'
import ADVANCED_POOL_HOOKS_V2_0_0_ABI from '../artifacts/abi/V2_0_0/advanced-pool-hooks.ts'
import ADVANCED_POOL_HOOKS_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/advanced-pool-hooks.ts'
import type { DeployArtifact } from '../operation.ts'
import { getTypedContract } from '../query.ts'

/** The `typeAndVersion` contract type an `AdvancedPoolHooks` reports (`"AdvancedPoolHooks 2.0.0"`). */
export const ADVANCED_POOL_HOOKS_TYPE = 'AdvancedPoolHooks'

/** Shared, cached `AdvancedPoolHooks` interface for constructor and calldata encoding. */
export const ADVANCED_POOL_HOOKS_INTERFACE = new Interface(ADVANCED_POOL_HOOKS_V2_0_0_ABI)

/** `AdvancedPoolHooks` creation bytecode for `deployAdvancedPoolHooks`. */
export const ADVANCED_POOL_HOOKS_BYTECODE = ADVANCED_POOL_HOOKS_V2_0_0_BYTECODE

/**
 * The four CCV lists for one remote chain. Base lists apply to every transfer; threshold lists add
 * requirements at or above the hooks contract's configured threshold. `address(0)` selects the
 * default CCV. A threshold list requires its corresponding base list, and no address may repeat
 * within or across a direction's base/threshold pair.
 */
export type CCVConfig = {
  /** CCVs required for every outbound transfer. */
  outboundCCVs: string[]
  /** Additional outbound CCVs required at or above the threshold. */
  thresholdOutboundCCVs: string[]
  /** CCVs required for every inbound transfer. */
  inboundCCVs: string[]
  /** Additional inbound CCVs required at or above the threshold. */
  thresholdInboundCCVs: string[]
}

/** A remote CCIP chain selector (`uint64`) plus its complete CCV configuration. */
export type CCVConfigUpdate = CCVConfig & { remoteChainSelector: bigint }

/** Reads an `AdvancedPoolHooks` owner's address in one `eth_call`. */
export async function readAdvancedPoolHooksOwner(
  chain: EVMChain,
  advancedPoolHooks: string,
): Promise<string> {
  const hooks = getTypedContract(chain, advancedPoolHooks, ADVANCED_POOL_HOOKS_V2_0_0_ABI)
  return getAddress(resultToObject(await hooks.owner()))
}

/** Rejects a known sender that is not the `AdvancedPoolHooks` owner. */
export async function assertAdvancedPoolHooksOwner(
  operation: string,
  chain: EVMChain,
  advancedPoolHooks: string,
  sender: string,
): Promise<void> {
  const owner = await readAdvancedPoolHooksOwner(chain, advancedPoolHooks)
  if (getAddress(sender) === owner) return
  throw new CCTParamsInvalidError(
    operation,
    'sender',
    `must be the current AdvancedPoolHooks owner (${owner})`,
  )
}

/**
 * `AdvancedPoolHooks` deploy artifact: contract name + ctor {@link Interface} + creation bytecode.
 */
export function getAdvancedPoolHooksArtifact(): DeployArtifact {
  return {
    contract: 'AdvancedPoolHooks',
    iface: ADVANCED_POOL_HOOKS_INTERFACE,
    bytecode: ADVANCED_POOL_HOOKS_BYTECODE,
  }
}

/**
 * Pre-flights an address a pool is about to be bound to, confirming it really is an
 * `AdvancedPoolHooks`, in one `eth_call`.
 *
 * @remarks The pool accepts any address unchecked, so a mis-pasted one succeeds and only *then*
 * does every transfer start reverting, far from the cause. Exact match on the type (so a bespoke
 * `IAdvancedPoolHooks` is rejected); the version is not checked, so `2.1.0` still binds.
 * @param chain - Chain to probe the address on.
 * @param address - Candidate hooks contract; must be non-zero (callers skip this for a detach).
 * @throws {@link CCTContractTypeInvalidError} if the address reports no `typeAndVersion` (an EOA
 * or a non-CCIP contract) or reports a type other than `AdvancedPoolHooks`
 */
export async function assertAdvancedPoolHooksContract(
  chain: EVMChain,
  address: string,
): Promise<void> {
  let contractType: string
  try {
    ;[contractType] = await chain.typeAndVersion(address)
  } catch (cause) {
    throw new CCTContractTypeInvalidError(
      address,
      ADVANCED_POOL_HOOKS_TYPE,
      'unknown',
      'the address reports no typeAndVersion — it has no code, or is not a CCIP contract',
      { cause: cause instanceof Error ? cause : undefined },
    )
  }
  if (contractType !== ADVANCED_POOL_HOOKS_TYPE)
    throw new CCTContractTypeInvalidError(address, ADVANCED_POOL_HOOKS_TYPE, contractType)
}
