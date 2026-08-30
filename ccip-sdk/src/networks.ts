import { memoize } from 'micro-memoize'

import { CCIPError } from './errors/CCIPError.ts'
import { CCIPChainNotFoundError, CCIPChainRegistrationError } from './errors/pure.ts'
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

/**
 * A chain to register at runtime, for networks missing from the bundled selector table —
 * e.g. a local devnet started with an arbitrary chain id.
 *
 * @see {@link registerChains}
 */
export type ChainRegistration = NewChainRegistration | ForkChainRegistration

/**
 * A chain that does not exist in the bundled table — a from-scratch devnet, or a network newer than
 * the installed SDK. It gets its own selector.
 */
export type NewChainRegistration = {
  /** Chain id, in the format of its family (EVM: `2337`, Aptos: `"aptos:1"`, Solana: genesisHash). */
  readonly chainId: NetworkInfo['chainId']
  /** CCIP chain selector; bigint, or a decimal number/string. */
  readonly chainSelector: bigint | number | string
  /** Human-readable name; defaults to `custom-<chainId>`. */
  readonly name?: string
  /** Chain family; defaults to {@link ChainFamily.EVM}. */
  readonly family?: ChainFamily
  /** Network type; defaults to {@link NetworkType.Testnet}. */
  readonly networkType?: NetworkType
}

/**
 * A fork of a known chain, served under a different chain id (e.g. a Tenderly Virtual Environment,
 * or `anvil --fork --chain-id`). The fork is not a new chain: its contracts hold the original
 * chain's state and emit the original chain's selector, so it inherits that identity and is
 * re-keyed to the fork's chain id. The original chain id stops resolving — a fork and the chain it
 * forked cannot both be addressed in one process.
 */
export type ForkChainRegistration = {
  /** Chain id the fork's RPC reports from `eth_chainId`. */
  readonly chainId: NetworkInfo['chainId']
  /** The forked chain, by chain id, selector or name. */
  readonly forkOf: bigint | number | string
  /** Human-readable name; defaults to the forked chain's own name. */
  readonly name?: string
}

const FAMILIES = new Set<string>(Object.values(ChainFamily))
const NETWORK_TYPES = new Set<string>(Object.values(NetworkType))

/**
 * Re-keys a known chain to the chain id its fork serves. The fork keeps the original chain's
 * selector, name and family — the forked contracts emit that selector on-chain — so this MOVES the
 * entry rather than adding one: a selector identifies exactly one chain.
 */
function registerFork(chain: ForkChainRegistration): string {
  const { chainId, forkOf, name } = chain
  if (typeof chainId !== 'string' && typeof chainId !== 'number')
    throw new CCIPChainRegistrationError(chainId, 'chainId must be a string or number')
  const id = String(chainId)
  if (!id.trim()) throw new CCIPChainRegistrationError(chainId, 'chainId must not be empty')
  if (name != null && (typeof name !== 'string' || !name.trim()))
    throw new CCIPChainRegistrationError(id, 'name must be a non-empty string')

  let original
  try {
    original = networkInfo(forkOf as bigint | number | string)
  } catch (cause) {
    throw new CCIPChainRegistrationError(id, `forkOf: unknown chain ${String(forkOf)}`, {
      cause: cause instanceof CCIPError ? cause : undefined,
    })
  }
  const originalId = String(original.chainId)
  // a fork legitimately takes over a local/dev chain id that is already bundled (Hardhat's
  // `hardhat node --fork` keeps 31337 = anvil-devnet), but must never assume a mainnet identity:
  // that would point mainnet RPCs and wallets at the forked chain's lanes
  const existing = SELECTORS[id]
  if (
    existing &&
    id !== originalId &&
    existing.selector !== original.chainSelector &&
    existing.network_type === NetworkType.Mainnet
  )
    throw new CCIPChainRegistrationError(
      id,
      `chainId is already registered to the mainnet chain "${existing.name ?? 'unknown'}" ` +
        `(selector ${existing.selector}); refusing to overwrite it with a fork of "${original.name}"`,
    )

  delete SELECTORS[originalId] // a selector identifies one chain: the fork replaces it
  SELECTORS[id] = {
    selector: original.chainSelector,
    name: name ?? original.name,
    family: original.family,
    network_type: original.networkType,
  }
  return id
}

/**
 * Registers additional chains for selector/chainId/name resolution, at runtime.
 *
 * The bundled {@link SELECTORS} table is generated from the public `chain-selectors` registry, so
 * local devnets (and chains newer than the installed SDK) can't be resolved by {@link networkInfo}.
 * Registering them makes every SDK and CLI path that resolves chains — `send`, message decoding,
 * `show`, manual-exec — work on those lanes.
 *
 * Registrations take effect immediately: they are added to the shared selector table and the
 * memoized resolution caches are invalidated. Registering a `chainId` that is already known
 * overrides it; registering a selector that another chain already owns is rejected — a selector
 * identifies exactly one chain.
 *
 * A fork of a known chain is registered with `forkOf` instead of `chainSelector`: it inherits the
 * forked chain's selector (its contracts emit that selector on-chain) and is re-keyed to the fork's
 * chain id, so the original chain id stops resolving.
 *
 * @param chains - Chains to register
 * @returns The resolved {@link NetworkInfo} of each registered chain
 * @throws {@link CCIPChainRegistrationError} if an entry is invalid or conflicts
 *
 * @example
 * ```typescript
 * import { networkInfo, registerChains } from '@chainlink/ccip-sdk'
 *
 * registerChains([{ chainId: 2337, chainSelector: 12922642891491394802n, name: 'local-anvil-dst' }])
 * networkInfo(12922642891491394802n).chainId // 2337
 *
 * // a Sepolia fork served under a custom chain id (Tenderly Virtual Environment, anvil --fork)
 * registerChains([{ chainId: 73571, forkOf: 'ethereum-testnet-sepolia' }])
 * networkInfo(73571).chainSelector // 16015286601757825753n
 * ```
 */
/**
 * Invalidates the memoized chain-resolution caches. Called by {@link registerChains}; exported for
 * callers that mutate the shared {@link SELECTORS} table directly (tests).
 * @internal
 */
export function clearNetworkInfoCaches(): void {
  networkInfo.cache.clear()
  networkInfoFromChainId.cache.clear()
}

export function registerChains(chains: Iterable<ChainRegistration>): NetworkInfo[] {
  const ids: string[] = []
  for (const chain of chains) {
    if ('forkOf' in chain) {
      ids.push(registerFork(chain))
      continue
    }
    const { chainId, chainSelector, name, family = ChainFamily.EVM, networkType } = chain
    if (typeof chainId !== 'string' && typeof chainId !== 'number')
      throw new CCIPChainRegistrationError(chainId, 'chainId must be a string or number')
    const id = String(chainId)
    if (!id.trim()) throw new CCIPChainRegistrationError(chainId, 'chainId must not be empty')
    let selector
    try {
      selector = BigInt(chainSelector as string)
    } catch {
      throw new CCIPChainRegistrationError(
        id,
        `chainSelector is not an integer: ${String(chainSelector)}`,
      )
    }
    if (selector <= 0n)
      throw new CCIPChainRegistrationError(id, `chainSelector must be positive: ${selector}`)
    if (name != null && (typeof name !== 'string' || !name.trim()))
      throw new CCIPChainRegistrationError(id, 'name must be a non-empty string')
    if (!FAMILIES.has(family))
      throw new CCIPChainRegistrationError(id, `unknown family: ${String(family)}`)
    const network_type = networkType ?? NetworkType.Testnet
    if (!NETWORK_TYPES.has(network_type))
      throw new CCIPChainRegistrationError(id, `unknown networkType: ${String(networkType)}`)
    // a selector uniquely identifies a chain: refuse to shadow a different chainId's selector
    for (const other in SELECTORS) {
      if (other !== id && SELECTORS[other]!.selector === selector)
        throw new CCIPChainRegistrationError(
          id,
          `chainSelector ${selector} is already registered for chain "${other}"`,
        )
    }
    SELECTORS[id] = { selector, name: name ?? `custom-${id}`, family, network_type }
    ids.push(id)
  }
  // both resolvers are memoized: a lookup that missed before registration would stay a miss
  if (ids.length) clearNetworkInfoCaches()
  return ids.map((id) => networkInfoFromChainId(id))
}
