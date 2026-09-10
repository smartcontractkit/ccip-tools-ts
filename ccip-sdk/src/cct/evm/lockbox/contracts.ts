/**
 * EVM lockbox contract layer for CCT: the cached `ERC20LockBox` {@link Interface}
 * ({@link LOCKBOX_INTERFACE}) for calldata encoding, and its deploy artifact
 * ({@link getLockboxArtifact}). Only one lockbox version is deployable, so there is no version
 * framework here. Mirrors `token/contracts.ts`.
 *
 * @packageDocumentation
 */

import { Interface } from 'ethers'

import ERC20_LOCKBOX_V2_0_0_ABI from '../artifacts/abi/V2_0_0/erc20-lockbox.ts'
import ERC20_LOCKBOX_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/erc20-lockbox.ts'
import type { DeployArtifact } from '../operation.ts'

/** Shared, cached `ERC20LockBox` interface for constructor and calldata encoding. */
export const LOCKBOX_INTERFACE = new Interface(ERC20_LOCKBOX_V2_0_0_ABI)

/** `ERC20LockBox` creation bytecode for `deployLockbox`. */
export const LOCKBOX_BYTECODE = ERC20_LOCKBOX_V2_0_0_BYTECODE

/** `ERC20LockBox` deploy artifact: contract name + ctor {@link Interface} + creation bytecode. */
export function getLockboxArtifact(): DeployArtifact {
  return {
    contract: 'ERC20LockBox',
    iface: LOCKBOX_INTERFACE,
    bytecode: LOCKBOX_BYTECODE,
  }
}
