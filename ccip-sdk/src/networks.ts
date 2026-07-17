import { memoize } from 'micro-memoize'

import { CCIPChainNotFoundError } from './errors/pure.ts'
import SELECTORS from './selectors.ts'

/**
 * Enumeration of supported blockchain families.
 */
export const ChainFamily = {
  EVM: 'EVM',
  Solana: 'SVM',
  Aptos: 'APTOS',
  Sui: 'SUI',
  TON: 'TON',
  Canton: 'CANTON',
  Unknown: 'UNKNOWN',
} as const
/** Type representing one of the supported chain families. */
export type ChainFamily = (typeof ChainFamily)[keyof typeof ChainFamily]

/**
 * Enumeration of network types (mainnet vs testnet).
 */
export const NetworkType = {
  Mainnet: 'MAINNET',
  Testnet: 'TESTNET',
} as const
/** Type representing the network environment type. */
export type NetworkType = (typeof NetworkType)[keyof typeof NetworkType]

/** Helper type that maps chain family to its chain ID format. */
type ChainFamilyWithId<F extends ChainFamily> = F extends
  typeof ChainFamily.EVM | typeof ChainFamily.TON
  ? { readonly family: F; readonly chainId: number }
  : F extends typeof ChainFamily.Solana | typeof ChainFamily.Canton
    ? { readonly family: F; readonly chainId: string }
    : F extends typeof ChainFamily.Aptos | typeof ChainFamily.Sui
      ? { readonly family: F; readonly chainId: `${Lowercase<F>}:${number}` }
      : never

/**
 * Network information including chain selector and metadata.
 *
 * @example
 * ```typescript
 * const info: NetworkInfo = {
 *   chainSelector: 16015286601757825753n,
 *   name: 'ethereum-testnet-sepolia',
 *   networkType: 'TESTNET',
 *   family: 'EVM',
 *   chainId: 11155111,
 * }
 * ```
 */
export type NetworkInfo<F extends ChainFamily = ChainFamily> = {
  /** Unique chain selector used by CCIP. */
  readonly chainSelector: bigint
  /** Human-readable network name. */
  readonly name: string
  /** Network environment type. */
  readonly networkType: NetworkType
} & ChainFamilyWithId<F>

/**
 * Converts a chain ID to complete NetworkInfo.
 * Memoized to return the same object reference for a given chainId.
 */
const networkInfoFromChainId = memoize((chainId: NetworkInfo['chainId']): NetworkInfo => {
  const sel = SELECTORS[chainId]
  if (!sel?.name) throw new CCIPChainNotFoundError(chainId)
  return {
    chainId: isNaN(+chainId) ? chainId : +chainId,
    chainSelector: sel.selector,
    name: sel.name,
    family: sel.family,
    networkType: sel.network_type,
  } as NetworkInfo
})

/**
 * Converts a chain selector, chain ID, or chain name to complete network information
 *
 * @param selectorOrIdOrName - Can be:
 *   - Chain selector as bigint or numeric string
 *   - Chain ID as number, bigint or string (EVM: "1", Aptos: "aptos:1", Solana: genesisHash)
 *   - Chain name as string ("ethereum-mainnet")
 * @returns Complete NetworkInfo object
 * @throws {@link CCIPChainNotFoundError} if chain is not found
 *
 * @example
 * ```typescript
 * import { networkInfo } from '@chainlink/ccip-sdk'
 *
 * // By chain name
 * const sepolia = networkInfo('ethereum-testnet-sepolia')
 * console.log('Selector:', sepolia.chainSelector)
 *
 * // By chain selector
 * const fuji = networkInfo(14767482510784806043n)
 * console.log('Name:', fuji.name) // 'avalanche-testnet-fuji'
 *
 * // By chain ID
 * const mainnet = networkInfo(1)
 * console.log('Family:', mainnet.family) // 'EVM'
 * ```
 */
export const networkInfo = memoize(function networkInfo_(
  selectorOrIdOrName: bigint | number | string,
): NetworkInfo {
  let chainId, match
  if (typeof selectorOrIdOrName === 'number') {
    chainId = selectorOrIdOrName
  } else if (
    typeof selectorOrIdOrName === 'string' &&
    (match = selectorOrIdOrName.match(/^(-?\d+)n?$/))
  ) {
    selectorOrIdOrName = BigInt(match[1]!)
  }
  if (typeof selectorOrIdOrName === 'bigint') {
    // maybe we got a chainId deserialized as bigint
    if (selectorOrIdOrName.toString() in SELECTORS) {
      chainId = Number(selectorOrIdOrName)
    } else {
      for (const id in SELECTORS) {
        if (SELECTORS[id]!.selector === selectorOrIdOrName) {
          chainId = id
          break
        }
      }
      if (!chainId) throw new CCIPChainNotFoundError(selectorOrIdOrName)
    }
  } else if (typeof selectorOrIdOrName === 'string') {
    if (selectorOrIdOrName.includes('-', 1)) {
      for (const id in SELECTORS) {
        if (SELECTORS[id]!.name === selectorOrIdOrName) {
          chainId = id
          break
        }
      }
    }
    chainId ??= selectorOrIdOrName
  }
  return networkInfoFromChainId(chainId as string | number)
})
