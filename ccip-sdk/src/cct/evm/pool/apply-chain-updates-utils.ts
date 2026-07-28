/**
 * Shared helpers for the EVM TokenPool `applyChainUpdates` family of ops
 * (`applyChainUpdates` and its removal-only wrapper `deleteChainConfig`).
 *
 * Holds the version → ABI/interface resolution and the remote-address encoding
 * (32-byte left-padded, matching the on-chain `bytes` layout) shared by both ops.
 *
 * @packageDocumentation
 */

import { type Interface, hexlify, zeroPadValue } from 'ethers'

import { interfaces } from '../../../evm/const.ts'
import { CCIPVersion } from '../../../types.ts'
import { getAddressBytes } from '../../../utils.ts'

/** Rate limiter config; `capacity`/`rate` are decimal strings to avoid JS precision loss. */
export type RateLimiterConfig = {
  /** Whether the rate limiter is enabled. */
  isEnabled: boolean
  /** Maximum token capacity (bigint as string). */
  capacity: string
  /** Token refill rate per second (bigint as string). */
  rate: string
}

/**
 * Resolves the cached TokenPool {@link Interface} for a pool version, mirroring the
 * monolith's `getPoolVersionAndABI`:
 * - `<= v1.5` → v1.5 (legacy `applyChainUpdates(ChainUpdate[])`)
 * - `< v2.0`  → v1.6 (`applyChainUpdates(uint64[], ChainUpdate[])`)
 * - else      → v2.0
 * @param version - Pool version string from `typeAndVersion` (e.g. `'1.6.0'`).
 * @returns The matching cached ethers {@link Interface}.
 */
export function resolvePoolInterface(version: string): Interface {
  if (version <= CCIPVersion.V1_5) return interfaces.TokenPool_v1_5
  if (version < CCIPVersion.V2_0) return interfaces.TokenPool_v1_6
  return interfaces.TokenPool_v2_0
}

/**
 * Whether a pool version uses the legacy single-address `applyChainUpdates(ChainUpdate[])`
 * encoding (with the `allowed` flag) rather than the `(uint64[] removes, ChainUpdate[] adds)`
 * form. Only pre-v1.5 pools use the legacy encoding.
 * @param version - Pool version string from `typeAndVersion`.
 * @returns `true` for the legacy encoding.
 */
export function isLegacyPoolVersion(version: string): boolean {
  return version < CCIPVersion.V1_5
}

/**
 * Encodes a remote address to a 32-byte left-padded hex string.
 * Accepts any chain family's native format via {@link getAddressBytes} and matches
 * `common.LeftPadBytes(addr.Bytes(), 32)`.
 * @param address - Remote address in native format (hex, base58, base64).
 * @returns 32-byte left-padded, `0x`-prefixed hex string.
 */
export function encodeRemoteAddress(address: string): string {
  return zeroPadValue(hexlify(getAddressBytes(address)), 32)
}
