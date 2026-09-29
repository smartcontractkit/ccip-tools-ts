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
  | typeof ChainFamily.EVM
  | typeof ChainFamily.TON
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

/** A selector-table entry. */
type SelectorEntry = (typeof SELECTORS)[string]

// SELECTORS is mutable: chains missing from it (local devnets, forks, networks newer than this
// release) are added at runtime by writing entries into it, so nothing below may cache a resolution
// across such writes. Each cache is validated against the live table on every hit, and rebuilt when
// a lookup misses.

/** Resolved NetworkInfo per entry object: stable references for unchanged entries. */
const infos = new WeakMap<SelectorEntry, NetworkInfo>()

/** Reverse indexes, first match wins (the order a scan of the table would find). */
let bySelector = new Map<bigint, string>()
let byName = new Map<string, string>()

function reindex(): void {
  bySelector = new Map()
  byName = new Map()
  for (const id in SELECTORS) {
    const { selector, name } = SELECTORS[id]!
    if (!bySelector.has(selector)) bySelector.set(selector, id)
    if (name && !byName.has(name)) byName.set(name, id)
  }
}

/** Own entry for a chain id; `Object.prototype` keys (`constructor`, …) are not chain ids. */
function entryOf(chainId: string | number): SelectorEntry | undefined {
  return Object.hasOwn(SELECTORS, chainId) ? SELECTORS[chainId] : undefined
}

function chainIdBySelector(selector: bigint): string | undefined {
  const id = bySelector.get(selector)
  if (id != null && entryOf(id)?.selector === selector) return id
  reindex()
  return bySelector.get(selector)
}

function chainIdByName(name: string): string | undefined {
  const id = byName.get(name)
  if (id != null && entryOf(id)?.name === name) return id
  reindex()
  return byName.get(name)
}

/**
 * Converts a chain ID to complete NetworkInfo.
 * Returns the same object reference for a given chainId while its table entry is unchanged.
 */
function networkInfoFromChainId(chainId: NetworkInfo['chainId']): NetworkInfo {
  const sel = entryOf(chainId)
  if (!sel?.name) throw new CCIPChainNotFoundError(chainId)
  const id = isNaN(+chainId) ? chainId : +chainId
  let info = infos.get(sel)
  if (
    info?.chainId !== id ||
    info.chainSelector !== sel.selector ||
    info.name !== sel.name ||
    info.family !== sel.family ||
    info.networkType !== sel.network_type
  ) {
    info = {
      chainId: id,
      chainSelector: sel.selector,
      name: sel.name,
      family: sel.family,
      networkType: sel.network_type,
    } as NetworkInfo
    infos.set(sel, info)
  }
  return info
}

/**
 * Converts a chain selector, chain ID, or chain name to complete network information
 *
 * Resolves against the live {@link SELECTORS} table, so chains added to it at runtime (e.g. a local
 * devnet) resolve like bundled ones.
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
export function networkInfo(selectorOrIdOrName: bigint | number | string): NetworkInfo {
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
    if (entryOf(selectorOrIdOrName.toString())) {
      chainId = Number(selectorOrIdOrName)
    } else {
      chainId = chainIdBySelector(selectorOrIdOrName)
      if (chainId == null) throw new CCIPChainNotFoundError(selectorOrIdOrName)
    }
  } else if (typeof selectorOrIdOrName === 'string') {
    // a non-numeric chain id (genesis hash, `aptos:1`, `canton:TestNet`), else a chain name
    chainId = entryOf(selectorOrIdOrName)
      ? selectorOrIdOrName
      : (chainIdByName(selectorOrIdOrName) ?? selectorOrIdOrName)
  }
  return networkInfoFromChainId(chainId as string | number)
}
