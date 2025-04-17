import { type Lane, CCIPVersion, ChainFamily } from '../types.ts'
import { networkInfo } from '../utils.ts'
import { getV16AptosLeafHasher } from './aptos.ts'
import type { LeafHasher } from './common.ts'
import { getV12LeafHasher, getV16LeafHasher } from './evm.ts'
import { getV16SolanaLeafHasher } from './solana.ts'

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
      if (networkInfo(destChainSelector).family === ChainFamily.Aptos) {
        return getV16AptosLeafHasher(
          sourceChainSelector,
          destChainSelector,
          onRamp,
        ) as LeafHasher<V>
      } else if (networkInfo(destChainSelector).family === ChainFamily.Solana) {
        return getV16SolanaLeafHasher(
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
