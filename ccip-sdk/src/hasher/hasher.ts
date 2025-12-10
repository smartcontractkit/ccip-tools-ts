import { supportedChains } from '../supported-chains.ts'
import type { CCIPVersion, Lane, WithLogger } from '../types.ts'
import { networkInfo } from '../utils.ts'
import type { LeafHasher } from './common.ts'

/**
 * Factory function that returns the right encoder based on the version of the lane.
 * @param lane - Lane configuration.
 * @param ctx - Context object containing logger.
 * @returns Leaf hasher function for the destination chain.
 */
export function getLeafHasher<V extends CCIPVersion = CCIPVersion>(
  lane: Lane<V>,
  ctx?: WithLogger,
): LeafHasher<V> {
  const destFamily = networkInfo(lane.destChainSelector).family
  const chain = supportedChains[destFamily]
  if (!chain) throw new Error(`Unsupported chain family: ${destFamily}`)
  return chain.getDestLeafHasher(lane, ctx) as LeafHasher<V>
}
