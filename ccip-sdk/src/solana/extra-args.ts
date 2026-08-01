import { concat } from 'ethers'

import { CCIPExtraArgsEncodingUnsupportedError } from '../errors/index.ts'
import { type ExtraArgs, EVMExtraArgsV2Tag } from '../extra-args.ts'
import { ChainFamily } from '../networks.ts'
import { toLeArray } from '../utils.ts'

/**
 * Pure Solana extra-args encoder, extracted from `SolanaChain.encodeExtraArgs`
 * so that `solana/send.ts` can call it without importing the `SolanaChain` class
 * (which would create a runtime cycle: `solana/index.ts` ↔ `solana/send.ts`).
 *
 * `SolanaChain.encodeExtraArgs` remains as a thin static wrapper for the
 * `supportedChains`-based dispatch in `extra-args.ts` and for external callers.
 *
 * @throws {@link CCIPExtraArgsEncodingUnsupportedError} if SVMExtraArgsV1 encoding is attempted
 */
export function encodeSolanaExtraArgs(args: ExtraArgs): string {
  if ('computeUnits' in args)
    throw new CCIPExtraArgsEncodingUnsupportedError(ChainFamily.Solana, 'EVMExtraArgsV2 format')
  const gasLimitUint128Le = toLeArray(args.gasLimit ?? 0n, 16)
  return concat([
    EVMExtraArgsV2Tag,
    gasLimitUint128Le,
    'allowOutOfOrderExecution' in args && args.allowOutOfOrderExecution ? '0x01' : '0x00',
  ])
}
