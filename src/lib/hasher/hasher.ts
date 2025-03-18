import { isAptosChain } from '../selectors.js'
import { type Lane, CCIPVersion } from '../types.js'
import { getV16AptosLeafHasher } from './aptos.js'
import { type LeafHasher } from './common.js'
import { getV12LeafHasher, getV16LeafHasher } from './evm.js'

// Factory function that returns the right encoder based on the version of the lane
export function getLeafHasher<V extends CCIPVersion = CCIPVersion>({
  sourceChainSelector,
  destChainSelector,
  onRamp,
  version,
}: Lane<V>): LeafHasher<V> {
  switch (version) {
    case CCIPVersion.V1_2:
    case CCIPVersion.V1_5:
      return getV12LeafHasher(sourceChainSelector, destChainSelector, onRamp) as LeafHasher<V>
    case CCIPVersion.V1_6:
      if (isAptosChain(destChainSelector)) {
        return getV16AptosLeafHasher(
          sourceChainSelector,
          destChainSelector,
          onRamp,
        ) as LeafHasher<V>
      }
      return getV16LeafHasher(sourceChainSelector, destChainSelector, onRamp) as LeafHasher<V>
    default:
      throw new Error(`Unsupported CCIP version: ${version}`)
  }
}
