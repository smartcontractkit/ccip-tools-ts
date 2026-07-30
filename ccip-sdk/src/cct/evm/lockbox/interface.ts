/**
 * Deploy artifacts for `ERC20LockBox`: the cached {@link Interface} (constructor + calldata
 * encoding) and the creation {@link LOCKBOX_BYTECODE}, built/loaded once from the vendored
 * `artifacts/`. Only one lockbox version is deployable, so there is no version framework here —
 * ops import these directly.
 *
 * @packageDocumentation
 */

import { Interface } from 'ethers'

import ERC20_LOCKBOX_V2_0_0_ABI from '../artifacts/abi/V2_0_0/erc20-lockbox.ts'
import ERC20_LOCKBOX_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/erc20-lockbox.ts'

/** Shared, cached `ERC20LockBox` interface for constructor and calldata encoding. */
export const LOCKBOX_INTERFACE = new Interface(ERC20_LOCKBOX_V2_0_0_ABI)

/** `ERC20LockBox` creation bytecode for `deployLockbox`. */
export const LOCKBOX_BYTECODE = ERC20_LOCKBOX_V2_0_0_BYTECODE
