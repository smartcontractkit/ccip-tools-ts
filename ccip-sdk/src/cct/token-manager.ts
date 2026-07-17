/**
 * Cross-family CCT manager base, the CCT analogue of core's {@link Chain}.
 * Family-specific subclasses hold the chain and expose admin operations.
 *
 * @packageDocumentation
 */

import type { Chain } from '../chain.ts'
import type { ChainFamily } from '../networks.ts'

/**
 * Abstract entry point for CCT admin writes on a chain family. Subclasses hold
 * the concrete {@link Chain} and delegate to {@link Operation} instances.
 */
export abstract class TokenManager<F extends ChainFamily = ChainFamily> {
  /** Chain this manager builds and submits through. */
  abstract readonly chain: Chain<F>
}
