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

/**
 * Thrown when a runtime chain registration is invalid (bad selector, family, or a selector
 * already taken by another chain).
 *
 * @example
 * ```typescript
 * import { registerChains } from '@chainlink/ccip-sdk'
 *
 * try {
 *   registerChains([{ chainId: 2337, chainSelector: 'not-a-number' }])
 * } catch (error) {
 *   if (error instanceof CCIPChainRegistrationError) {
 *     console.log(error.context.reason)
 *   }
 * }
 * ```
 */
export class CCIPChainRegistrationError extends CCIPError {
  override readonly name = 'CCIPChainRegistrationError'
  /** Creates a chain registration error. */
  constructor(chainId: unknown, reason: string, options?: CCIPErrorOptions) {
    super(
      CCIPErrorCode.ARGUMENT_INVALID,
      `Invalid chain registration for "${String(chainId)}": ${reason}`,
      {
        ...options,
        isTransient: false,
        context: { ...options?.context, argument: 'chains', chainId: String(chainId), reason },
      },
    )
  }
}
