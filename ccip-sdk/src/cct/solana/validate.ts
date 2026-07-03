import { PublicKey } from '@solana/web3.js'

import { CCIPCctParamsInvalidError } from '../../errors/index.ts'

/** Asserts `value` is a valid Solana public key. */
export function validatePublicKey(operation: string, param: string, value: unknown): void {
  if (typeof value !== 'string') {
    throw new CCIPCctParamsInvalidError(
      operation,
      param,
      `must be a valid Solana public key, got ${String(value)}`,
    )
  }

  try {
    new PublicKey(value)
  } catch {
    throw new CCIPCctParamsInvalidError(
      operation,
      param,
      `must be a valid Solana public key, got ${String(value)}`,
    )
  }
}
