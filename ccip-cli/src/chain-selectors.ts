import { existsSync, readFileSync } from 'node:fs'

import {
  type NetworkInfo,
  CCIPArgumentInvalidError,
  ChainFamily,
  NetworkType,
  SELECTORS,
  jsonParse,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'

/** One chain parsed from `--chain-selectors`, not yet validated against the selector table. */
export type ChainSelectorEntry = {
  /** Chain id the chain's RPC reports, in its family's format (`2337`, `aptos:4`, genesis hash). */
  readonly chainId: string
  /** The chain's selector. One that a known chain already owns makes this a fork of that chain. */
  readonly selector?: bigint
  /** The forked chain, by name, selector, or non-numeric chain id. */
  readonly forkOf?: bigint | string
  /** Human-readable name; defaults to the forked chain's name, or `custom-<chainId>`. */
  readonly name?: string
  /** Chain family; inferred from the chain id's format when omitted. */
  readonly family?: string
  /** `MAINNET` or `TESTNET`; defaults to `TESTNET` for a new chain. */
  readonly networkType?: string
}

type SelectorEntry = (typeof SELECTORS)[string]

const ARG = 'chain-selectors'
/** `<chainId>=<selector|chain name>`, e.g. `2337=12922642891491394802`, `73571=ethereum-testnet-sepolia`. */
const PAIR = /^([^=\s,]+)=([^=\s,]+)$/
const UINT = /^\d+$/
const MAX_SELECTOR = 2n ** 64n - 1n

/**
 * Chain id format of each family a chain can be registered for; also the order in which a family
 * is inferred from a chain id (a plain integer is EVM, a negative one TON).
 */
const CHAIN_ID_FORMATS = {
  [ChainFamily.EVM]: /^\d+$/,
  [ChainFamily.TON]: /^-\d+$/,
  [ChainFamily.Aptos]: /^aptos:\d+$/,
  [ChainFamily.Sui]: /^sui:\d+$/,
  [ChainFamily.Canton]: /^canton:\S+$/,
  [ChainFamily.Solana]: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
} as const satisfies Partial<Record<ChainFamily, RegExp>>
type RegisterableFamily = keyof typeof CHAIN_ID_FORMATS

function invalid(reason: string, cause?: unknown): CCIPArgumentInvalidError {
  return new CCIPArgumentInvalidError(ARG, reason, cause instanceof Error ? { cause } : undefined)
}

function own(chainId: string): SelectorEntry | undefined {
  return Object.hasOwn(SELECTORS, chainId) ? SELECTORS[chainId] : undefined
}

function chainIdOwningSelector(selector: bigint): string | undefined {
  for (const id in SELECTORS) if (SELECTORS[id]!.selector === selector) return id
}

// ---- parsing ----

type RawEntry = {
  chainId?: unknown
  chain_id?: unknown
  chainSelector?: unknown
  selector?: unknown
  forkOf?: unknown
  fork_of?: unknown
  name?: unknown
  family?: unknown
  networkType?: unknown
  network_type?: unknown
}

function asString(chainId: string, field: string, value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString()
  throw invalid(`chain ${chainId}: ${field} must be a string or number`)
}

function asSelector(chainId: string, value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  if (typeof value === 'string' && UINT.test(value.trim())) return BigInt(value.trim())
  throw invalid(`chain ${chainId}: selector must be an unsigned integer, got ${String(value)}`)
}

function toEntry(key: string | undefined, raw: unknown): ChainSelectorEntry {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw))
    throw invalid(`entry ${key ?? String(raw)} must be an object`)
  const r = raw as RawEntry
  const rawId = key ?? r.chainId ?? r.chain_id
  if (rawId == null) throw invalid('an entry is missing its chainId')
  const chainId = asString('?', 'chainId', rawId)
  const selector = r.chainSelector ?? r.selector
  const forkOf = r.forkOf ?? r.fork_of
  if ((selector == null) === (forkOf == null))
    throw invalid(`chain ${chainId}: give exactly one of selector or forkOf`)
  const entry: { -readonly [K in keyof ChainSelectorEntry]: ChainSelectorEntry[K] } = { chainId }
  if (selector != null) entry.selector = asSelector(chainId, selector)
  else entry.forkOf = typeof forkOf === 'bigint' ? forkOf : asString(chainId, 'forkOf', forkOf)
  if (r.name != null) entry.name = asString(chainId, 'name', r.name)
  if (r.family != null) entry.family = asString(chainId, 'family', r.family)
  const networkType = r.networkType ?? r.network_type
  if (networkType != null) entry.networkType = asString(chainId, 'networkType', networkType)
  return entry
}

function parseDocument(text: string, source: string): ChainSelectorEntry[] {
  let doc
  try {
    doc = jsonParse<unknown>(text)
  } catch (err) {
    throw invalid(`${source} is not valid JSON/YAML`, err)
  }
  // the smartcontractkit/chain-selectors registry shape, e.g. its test_selectors.yml, loads as-is
  if (doc && typeof doc === 'object' && !Array.isArray(doc) && 'selectors' in doc)
    doc = doc.selectors
  if (Array.isArray(doc)) return doc.map((entry) => toEntry(undefined, entry))
  if (doc && typeof doc === 'object')
    return Object.entries(doc).map(([id, entry]) => toEntry(id, entry ?? {}))
  throw invalid(`${source}: expected an array or a chainId->entry object, got: ${String(doc)}`)
}

function parseFile(path: string): ChainSelectorEntry[] {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    throw invalid(`cannot read file "${path}"`, err)
  }
  return parseDocument(text, `file "${path}"`)
}

/**
 * Parses one `--chain-selectors` value into chain entries, without touching the selector table.
 *
 * Accepts inline JSON, a path to a JSON/YAML file, or a comma/whitespace-separated list of
 * `<chainId>=<selector|chain name>` pairs and file paths (so one `CCIP_CHAIN_SELECTORS` env var can
 * hold several). A number on the right of `=` is always a selector; a name is a forked chain.
 * Documents may be an array of entries, a `chainId -> entry` map, or the chain-selectors registry's
 * `selectors:`-wrapped shape.
 */
export function parseChainSelectorsArg(arg: string): ChainSelectorEntry[] {
  const value = arg.trim()
  if (value.startsWith('{') || value.startsWith('[')) return parseDocument(value, 'inline value')
  if (value && existsSync(value)) return parseFile(value)
  return value
    .split(/[\s,]+/)
    .filter(Boolean)
    .flatMap((token) => {
      const pair = PAIR.exec(token)
      if (pair) {
        const chainId = pair[1]!,
          rhs = pair[2]!
        return [UINT.test(rhs) ? { chainId, selector: BigInt(rhs) } : { chainId, forkOf: rhs }]
      }
      if (existsSync(token)) return parseFile(token)
      throw invalid(
        `"${token}" is neither a <chainId>=<selector|chain name> pair nor a readable file`,
      )
    })
}

/**
 * yargs `coerce` for `--chain-selectors` / `CCIP_CHAIN_SELECTORS`: parses each value with no side
 * effects, so a malformed one fails as an attributed option error at parse time. The table is only
 * written later, by {@link registerChainSelectors} in middleware.
 */
export function coerceChainSelectors(values: unknown[]): ChainSelectorEntry[] {
  return values.flatMap((value) => {
    if (typeof value !== 'string') throw invalid(`expects string values, got ${typeof value}`)
    return parseChainSelectorsArg(value)
  })
}

// ---- registration ----

/** Normalizes the chain id to its family's format, inferring the family when it isn't given. */
function resolveFamily(
  entry: ChainSelectorEntry,
  known: SelectorEntry | undefined,
): { chainId: string; family: RegisterableFamily } {
  let chainId = entry.chainId
  // `eth_chainId` reports hex
  if (/^0x[\da-f]+$/i.test(chainId)) chainId = BigInt(chainId).toString()
  let family: string | undefined = known?.family
  if (entry.family != null) {
    const given = entry.family.toUpperCase()
    const explicit = given === 'SOLANA' ? ChainFamily.Solana : given
    if (!(explicit in CHAIN_ID_FORMATS))
      throw invalid(
        `chain ${chainId}: unknown family "${entry.family}" (one of ${Object.keys(CHAIN_ID_FORMATS).join(', ')})`,
      )
    if (known && known.family !== explicit)
      throw invalid(
        `chain ${chainId}: family ${explicit} conflicts with ${known.name ?? 'the chain'} ` +
          `(${known.family}), whose selector it takes`,
      )
    family = explicit
  }
  if (family == null) {
    family = Object.keys(CHAIN_ID_FORMATS).find((f) =>
      CHAIN_ID_FORMATS[f as RegisterableFamily].test(chainId),
    )
    if (family == null)
      throw invalid(`chain ${chainId}: cannot infer the family from this chain id; set family`)
  }
  if (!(family in CHAIN_ID_FORMATS))
    throw invalid(`chain ${chainId}: chains of family ${family} cannot be registered`)
  // prefix the bare ids chain-selectors' per-family registry files use (`1` -> `aptos:1`)
  if ((family === ChainFamily.Aptos || family === ChainFamily.Sui) && UINT.test(chainId))
    chainId = `${family.toLowerCase()}:${chainId}`
  else if (family === ChainFamily.Canton && !chainId.startsWith('canton:'))
    chainId = `canton:${chainId}`
  if (!CHAIN_ID_FORMATS[family as RegisterableFamily].test(chainId))
    throw invalid(`chain ${entry.chainId}: not a valid ${family} chain id`)
  return { chainId, family: family as RegisterableFamily }
}

function resolveNetworkType(entry: ChainSelectorEntry): NetworkType | undefined {
  if (entry.networkType == null) return
  const type = entry.networkType.toUpperCase()
  if (type !== NetworkType.Mainnet && type !== NetworkType.Testnet)
    throw invalid(`chain ${entry.chainId}: unknown networkType "${entry.networkType}"`)
  return type
}

/** Rejects a number that is a known chain id, not a selector: `2337=11155111` meant a fork. */
function rejectChainIdAsSelector(chainId: string, value: bigint): void {
  const entry = own(value.toString())
  if (!entry) return
  const fix = entry.name ? ` To fork it, give its name: ${chainId}=${entry.name}` : ''
  throw invalid(
    `chain ${chainId}: ${value} is the chain id of ${entry.name ?? 'a known chain'}, ` +
      `not a selector.${fix}`,
  )
}

/** Chain id of the forked chain: numbers are selectors, anything else a name or chain id. */
function resolveForkOf(chainId: string, forkOf: bigint | string): string {
  if (typeof forkOf === 'bigint' || UINT.test(forkOf)) {
    const selector = BigInt(forkOf)
    const owner = chainIdOwningSelector(selector)
    if (owner != null) return owner
    rejectChainIdAsSelector(chainId, selector)
    throw invalid(`chain ${chainId}: no known chain has selector ${selector} to fork`)
  }
  try {
    return String(networkInfo(forkOf).chainId)
  } catch (err) {
    throw invalid(`chain ${chainId}: unknown chain "${forkOf}" to fork`, err)
  }
}

function validateName(chainId: string, name: string, replaces: readonly string[]): void {
  if (!name) throw invalid(`chain ${chainId}: name must not be empty`)
  // networkInfo reads these as chain ids or selectors, never as names
  if (/^-?\d+n?$/.test(name) || (own(name) && !replaces.includes(name)))
    throw invalid(`chain ${chainId}: name "${name}" would resolve as a chain id or selector`)
  for (const id in SELECTORS)
    if (SELECTORS[id]!.name === name && !replaces.includes(id))
      throw invalid(`chain ${chainId}: name "${name}" is already used by chain ${id}`)
}

function register(entry: ChainSelectorEntry): string {
  if (entry.selector != null && (entry.selector <= 0n || entry.selector > MAX_SELECTOR))
    throw invalid(`chain ${entry.chainId}: selector must be a uint64 > 0, got ${entry.selector}`)

  // the chain whose selector this entry takes: a fork re-keys it, a same-id entry updates it
  let ownerId =
    entry.forkOf != null
      ? resolveForkOf(entry.chainId, entry.forkOf)
      : chainIdOwningSelector(entry.selector!)
  if (ownerId == null) rejectChainIdAsSelector(entry.chainId, entry.selector!)
  const owner = ownerId != null ? SELECTORS[ownerId] : undefined
  const { chainId, family } = resolveFamily(entry, owner)
  const networkType = resolveNetworkType(entry)
  if (ownerId === chainId) ownerId = undefined // re-registering the same chain: an update
  if (ownerId != null && networkType != null && networkType !== owner!.network_type)
    throw invalid(
      `chain ${chainId}: networkType ${networkType} conflicts with ${owner!.name ?? 'the chain'} ` +
        `(${owner!.network_type}), whose selector it takes`,
    )

  const current = own(chainId)
  const next: SelectorEntry = {
    ...(ownerId != null ? owner : current?.selector === entry.selector ? current : undefined),
    selector: owner?.selector ?? entry.selector!,
    name: entry.name ?? owner?.name ?? `custom-${chainId}`,
    family,
    network_type: networkType ?? owner?.network_type ?? NetworkType.Testnet,
  }
  validateName(chainId, next.name!, ownerId != null ? [chainId, ownerId] : [chainId])
  // a devnet may take over a local/dev chain id that is bundled (hardhat node --fork keeps 31337),
  // never a mainnet one: that would point mainnet RPCs and wallets at another chain's lanes
  if (current?.network_type === NetworkType.Mainnet && current.selector !== next.selector)
    throw invalid(
      `chain ${chainId} is the mainnet chain ${current.name ?? ''} (selector ${current.selector}); refusing to replace it`,
    )

  // a selector identifies exactly one chain: a fork moves the entry off the forked chain id
  if (ownerId != null) delete SELECTORS[ownerId]
  SELECTORS[chainId] = next
  return chainId
}

/**
 * Writes the chains parsed from `--chain-selectors` into the SDK's selector table, so they resolve
 * like bundled chains everywhere. A new chain gets its own selector; an entry whose selector (or
 * `forkOf`) names a known chain is a fork of it, and takes over that chain's entry under the fork's
 * chain id.
 *
 * @returns the resolved {@link NetworkInfo} of each registered chain
 * @throws {@link CCIPArgumentInvalidError} if an entry is invalid or conflicts with the table
 */
export function registerChainSelectors(
  entries: readonly ChainSelectorEntry[] | undefined,
): NetworkInfo[] {
  return (entries ?? []).map((entry) => networkInfo(register(entry)))
}
