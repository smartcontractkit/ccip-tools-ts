/**
 * A file to hold error classes to be used in contexts where no deeper imports (e.g. crypto, buffer)
 * are desired. Namely, it enables the files in `../networks.ts` to be used in these contexts
 */
import { type CCIPErrorOptions, CCIPError } from './CCIPError.ts'
import { CCIPErrorCode } from './codes.ts'

/**
 * Thrown when chain not found by chainId, selector, or name.
 *
 * @example
 * ```typescript
 * import { networkInfo } from '@chainlink/ccip-sdk'
 *
 * try {
 *   const info = networkInfo(999999) // Unknown chain
 * } catch (error) {
 *   if (error instanceof CCIPChainNotFoundError) {
 *     console.log(`Chain not found: ${error.context.chainIdOrSelector}`)
 *     console.log(`Recovery: ${error.recovery}`)
 *   }
 * }
 * ```
 */
export class CCIPChainNotFoundError extends CCIPError {
  override readonly name = 'CCIPChainNotFoundError'
  /** Creates a chain not found error. */
  constructor(chainIdOrSelector: string | number | bigint, options?: CCIPErrorOptions) {
    super(CCIPErrorCode.CHAIN_NOT_FOUND, `Chain not found: ${chainIdOrSelector}`, {
      ...options,
      isTransient: false,
      context: { ...options?.context, chainIdOrSelector },
    })
  }
}
