/**
 * Cross-family CCT base — the CCT analogue of core's abstract `Chain<F>`.
 *
 * @packageDocumentation
 */

import type { Chain } from '../chain.ts'
import type { ChainFamily } from '../networks.ts'

/** Result of any single-transaction CCT write. */
export interface CctTxResult {
  txHash: string
}

/** Base for a chain-family CCT manager; subclasses hold the concrete `chain`. */
export abstract class TokenManager<F extends ChainFamily = ChainFamily> {
  abstract readonly chain: Chain<F>
}
