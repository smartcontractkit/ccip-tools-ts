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

export function getDestExecDataParser(sourceChainSelector: bigint) {
  const { family } = networkInfo(sourceChainSelector)

  switch (family) {
    case ChainFamily.EVM:
    case ChainFamily.Solana: // TODO: Solana might have a different way to parse destExecData
      return (destExecData: string) => getUint(hexlify(getDataBytes(destExecData)))
    case ChainFamily.Aptos:
      return (destExecData: string) => {
        const bytes = Hex.fromHexString(destExecData).toUint8Array()
        const deserializer = new Deserializer(bytes)
        return deserializer.deserializeU32()
      }
    default:
      return (destExecData: string) => getUint(hexlify(getDataBytes(destExecData)))
  }
}
