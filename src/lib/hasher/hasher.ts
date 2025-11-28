import { supportedChains } from '../supported-chains.ts'
import type { CCIPVersion, Lane } from '../types.ts'
import { networkInfo } from '../utils.ts'
import type { LeafHasher } from './common.ts'

// Factory function that returns the right encoder based on the version of the lane
export function getLeafHasher<V extends CCIPVersion = CCIPVersion>(lane: Lane<V>): LeafHasher<V> {
  const destFamily = networkInfo(lane.destChainSelector).family
  const chain = supportedChains[destFamily]
  if (!chain) throw new Error(`Unsupported chain family: ${destFamily}`)
  return chain.getDestLeafHasher(lane) as LeafHasher<V>
}
