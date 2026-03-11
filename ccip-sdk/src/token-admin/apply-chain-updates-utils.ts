/**
 * Shared utilities for applyChainUpdates across all chain families.
 *
 * Contains validation and address encoding logic used by EVM, Solana, and Aptos
 * implementations to avoid code duplication.
 *
 * @packageDocumentation
 */

import { hexlify, zeroPadValue } from 'ethers'

import {
  CCIPAppendRemotePoolAddressesParamsInvalidError,
  CCIPApplyChainUpdatesParamsInvalidError,
  CCIPDeleteChainConfigParamsInvalidError,
  CCIPRemoveRemotePoolAddressesParamsInvalidError,
} from '../errors/index.ts'
import { getAddressBytes } from '../utils.ts'
import type {
  AppendRemotePoolAddressesParams,
  ApplyChainUpdatesParams,
  DeleteChainConfigParams,
  RemoveRemotePoolAddressesParams,
} from './types.ts'

/**
 * Validates applyChainUpdates parameters.
 *
 * Checks that poolAddress is non-empty and each chain config has valid fields:
 * - `remoteChainSelector` must be non-empty
 * - `remotePoolAddresses` must have at least one address
 * - `remoteTokenAddress` must be non-empty
 *
 * @param params - Apply chain updates parameters to validate
 * @throws {@link CCIPApplyChainUpdatesParamsInvalidError} on invalid params
 */
export function validateApplyChainUpdatesParams(params: ApplyChainUpdatesParams): void {
  if (!params.poolAddress || params.poolAddress.trim().length === 0) {
    throw new CCIPApplyChainUpdatesParamsInvalidError('poolAddress', 'must be non-empty')
  }
  for (let i = 0; i < params.chainsToAdd.length; i++) {
    const chain = params.chainsToAdd[i]!
    if (chain.remoteChainSelector == null || chain.remoteChainSelector === 0n) {
      throw new CCIPApplyChainUpdatesParamsInvalidError(
        `chainsToAdd[${i}].remoteChainSelector`,
        'must be non-zero',
      )
    }
    if (chain.remotePoolAddresses.length === 0) {
      throw new CCIPApplyChainUpdatesParamsInvalidError(
        `chainsToAdd[${i}].remotePoolAddresses`,
        'must have at least one address',
      )
    }
    if (!chain.remoteTokenAddress || chain.remoteTokenAddress.trim().length === 0) {
      throw new CCIPApplyChainUpdatesParamsInvalidError(
        `chainsToAdd[${i}].remoteTokenAddress`,
        'must be non-empty',
      )
    }
  }
}

/**
 * Encodes a remote address to 32-byte left-padded hex string.
 *
 * Handles all chain families: hex (EVM/Aptos), base58 (Solana), base64 (Sui/TON).
 * Uses `getAddressBytes()` for universal address decoding + `zeroPadValue()` for 32-byte padding.
 * Matches chainlink-deployments' `common.LeftPadBytes(addr.Bytes(), 32)`.
 *
 * @param address - Address in native format (hex, base58, base64)
 * @returns 32-byte left-padded hex string (0x-prefixed)
 */
export function encodeRemoteAddress(address: string): string {
  const bytes = getAddressBytes(address)
  return zeroPadValue(hexlify(bytes), 32)
}

/**
 * Encodes a remote address to 32-byte left-padded Uint8Array.
 *
 * Same as {@link encodeRemoteAddress} but returns raw bytes instead of hex string.
 * Used by Solana for Borsh encoding.
 *
 * @param address - Address in native format (hex, base58, base64)
 * @returns 32-byte left-padded Uint8Array
 */
export function encodeRemoteAddressBytes(address: string): Uint8Array {
  const bytes = getAddressBytes(address)
  const hex = zeroPadValue(hexlify(bytes), 32)
  return Uint8Array.from(Buffer.from(hex.slice(2), 'hex'))
}

/**
 * Encodes a remote pool address to raw bytes (no padding).
 *
 * Unlike token addresses which are always left-padded to 32 bytes, pool addresses
 * preserve their original byte length (e.g. 20 bytes for EVM, 32 bytes for Solana).
 * This matches the on-chain Solana program's expectation for pool address comparison
 * during ReleaseOrMintTokens.
 *
 * @param address - Address in native format (hex, base58, base64)
 * @returns Raw bytes Uint8Array (original length, no padding)
 */
export function encodeRemotePoolAddressBytes(address: string): Uint8Array {
  return getAddressBytes(address)
}

/**
 * Validates appendRemotePoolAddresses parameters.
 *
 * Checks that:
 * - `poolAddress` is non-empty
 * - `remoteChainSelector` is non-empty
 * - `remotePoolAddresses` has at least one entry, each non-empty
 *
 * @param params - Append remote pool addresses parameters to validate
 * @throws {@link CCIPAppendRemotePoolAddressesParamsInvalidError} on invalid params
 */
export function validateAppendRemotePoolAddressesParams(
  params: AppendRemotePoolAddressesParams,
): void {
  if (!params.poolAddress || params.poolAddress.trim().length === 0) {
    throw new CCIPAppendRemotePoolAddressesParamsInvalidError('poolAddress', 'must be non-empty')
  }
  if (params.remoteChainSelector == null || params.remoteChainSelector === 0n) {
    throw new CCIPAppendRemotePoolAddressesParamsInvalidError(
      'remoteChainSelector',
      'must be non-zero',
    )
  }
  if (params.remotePoolAddresses.length === 0) {
    throw new CCIPAppendRemotePoolAddressesParamsInvalidError(
      'remotePoolAddresses',
      'must have at least one address',
    )
  }
  for (let i = 0; i < params.remotePoolAddresses.length; i++) {
    const addr = params.remotePoolAddresses[i]!
    if (!addr || addr.trim().length === 0) {
      throw new CCIPAppendRemotePoolAddressesParamsInvalidError(
        `remotePoolAddresses[${i}]`,
        'must be non-empty',
      )
    }
  }
}

/**
 * Validates deleteChainConfig parameters.
 *
 * Checks that:
 * - `poolAddress` is non-empty
 * - `remoteChainSelector` is non-empty
 *
 * @param params - Delete chain config parameters to validate
 * @throws {@link CCIPDeleteChainConfigParamsInvalidError} on invalid params
 */
export function validateDeleteChainConfigParams(params: DeleteChainConfigParams): void {
  if (!params.poolAddress || params.poolAddress.trim().length === 0) {
    throw new CCIPDeleteChainConfigParamsInvalidError('poolAddress', 'must be non-empty')
  }
  if (params.remoteChainSelector == null || params.remoteChainSelector === 0n) {
    throw new CCIPDeleteChainConfigParamsInvalidError('remoteChainSelector', 'must be non-zero')
  }
}

/**
 * Validates removeRemotePoolAddresses parameters.
 *
 * Checks that:
 * - `poolAddress` is non-empty
 * - `remoteChainSelector` is non-empty
 * - `remotePoolAddresses` has at least one entry, each non-empty
 *
 * @param params - Remove remote pool addresses parameters to validate
 * @throws {@link CCIPRemoveRemotePoolAddressesParamsInvalidError} on invalid params
 */
export function validateRemoveRemotePoolAddressesParams(
  params: RemoveRemotePoolAddressesParams,
): void {
  if (!params.poolAddress || params.poolAddress.trim().length === 0) {
    throw new CCIPRemoveRemotePoolAddressesParamsInvalidError('poolAddress', 'must be non-empty')
  }
  if (params.remoteChainSelector == null || params.remoteChainSelector === 0n) {
    throw new CCIPRemoveRemotePoolAddressesParamsInvalidError(
      'remoteChainSelector',
      'must be non-zero',
    )
  }
  if (params.remotePoolAddresses.length === 0) {
    throw new CCIPRemoveRemotePoolAddressesParamsInvalidError(
      'remotePoolAddresses',
      'must have at least one address',
    )
  }
  for (let i = 0; i < params.remotePoolAddresses.length; i++) {
    const addr = params.remotePoolAddresses[i]!
    if (!addr || addr.trim().length === 0) {
      throw new CCIPRemoveRemotePoolAddressesParamsInvalidError(
        `remotePoolAddresses[${i}]`,
        'must be non-empty',
      )
    }
  }
}
