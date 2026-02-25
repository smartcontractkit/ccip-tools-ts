import type { OffchainTokenData } from '../types.ts'
import { defaultAbiCoder } from './const.ts'

/**
 * Encodes offchain token data for EVM execution.
 * @param data - Offchain token data to encode.
 * @returns ABI-encoded data or empty hex string.
 */
export function encodeEVMOffchainTokenData(data: OffchainTokenData): string {
  if (data?._tag === 'usdc') {
    return defaultAbiCoder.encode(['tuple(bytes message, bytes attestation)'], [data])
  } else if (data?._tag === 'lbtc') {
    return data.attestation as string
  }
  return '0x'
}
