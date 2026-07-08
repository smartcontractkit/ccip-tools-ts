import { SolanaChain } from '../../solana/index.ts'
import { CCTParamsInvalidError } from '../errors.ts'

/** Asserts `value` is a valid Solana public key string. */
export function validatePublicKey(operation: string, param: string, value: unknown): void {
  if (typeof value !== 'string') {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `must be a valid Solana public key, got ${String(value)}`,
    )
  }

  try {
    SolanaChain.getAddress(value)
  } catch (error) {
    throw new CCTParamsInvalidError(
      operation,
      param,
      `must be a valid Solana public key, got ${String(value)}`,
      { cause: error instanceof Error ? error : undefined },
    )
  }
}
