import { readFileSync } from 'node:fs'

import {
  type ChainRegistration,
  type NetworkInfo,
  type NewChainRegistration,
  CCIPArgumentInvalidError,
  CCIPChainRegistrationError,
  jsonParse,
  registerChains,
} from '@chainlink/ccip-sdk/src/index.ts'

/** Shorthand form: `<chainId>=<selector>`, e.g. `2337=12922642891491394802`. */
const SHORTHAND = /^([^=\s]+)=(\d+)$/
/** Fork form: `<chainId>=fork:<chainId|selector|name>`, e.g. `73571=fork:11155111`. */
const FORK_SHORTHAND = /^([^=\s]+)=fork:(.+)$/

type RawEntry = {
  chainId?: unknown
  chain_id?: unknown
  forkOf?: unknown
  fork_of?: unknown
  chainSelector?: unknown
  selector?: unknown
  name?: unknown
  family?: unknown
  networkType?: unknown
  network_type?: unknown
}

function asString(field: string, value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString()
  throw new CCIPArgumentInvalidError('chain-selectors', `${field} must be a string or number`)
}

function toRegistration(chainId: unknown, raw: RawEntry): ChainRegistration {
  const id = chainId ?? raw.chainId ?? raw.chain_id
  const forkOf = raw.forkOf ?? raw.fork_of
  if (forkOf != null) {
    const fork: { chainId: ChainRegistration['chainId']; forkOf: string; name?: string } = {
      chainId: (typeof id === 'number'
        ? id
        : asString('chainId', id)) as ChainRegistration['chainId'],
      forkOf: asString('forkOf', forkOf),
    }
    if (raw.name != null) fork.name = asString('name', raw.name)
    return fork
  }
  const family = raw.family
  const networkType = raw.networkType ?? raw.network_type
  const registration: {
    -readonly [K in keyof NewChainRegistration]: NewChainRegistration[K]
  } = {
    chainId: (typeof id === 'number'
      ? id
      : asString('chainId', id)) as NewChainRegistration['chainId'],
    chainSelector: (raw.chainSelector ?? raw.selector) as NewChainRegistration['chainSelector'],
  }
  if (raw.name != null) registration.name = asString('name', raw.name)
  if (family != null) {
    const fam = asString('family', family).toUpperCase()
    // accept the common alias: Solana's chain family is 'SVM'
    registration.family = fam === 'SOLANA' ? 'SVM' : fam
  }
  if (networkType != null)
    registration.networkType = asString('networkType', networkType).toUpperCase()
  return registration
}

/**
 * Parses one `--chain-selectors` argument into chain registrations.
 *
 * Accepts, in order: the `<chainId>=<selector>` shorthand, inline JSON, or a path to a JSON/YAML
 * file. Documents may be an array of entries, a `chainId -> entry` map, or the
 * `smartcontractkit/chain-selectors` `selectors:`-wrapped shape (so `test_selectors.yml` loads
 * as-is).
 */
export function parseChainSelectorsArg(arg: string): ChainRegistration[] {
  const value = arg.trim()
  const fork = FORK_SHORTHAND.exec(value)
  if (fork) return [{ chainId: fork[1]!, forkOf: fork[2]!.trim() }]
  const shorthand = SHORTHAND.exec(value)
  if (shorthand) return [{ chainId: shorthand[1]!, chainSelector: BigInt(shorthand[2]!) }]

  const inline = value.startsWith('{') || value.startsWith('[')
  let text
  try {
    text = inline ? value : readFileSync(value, 'utf8')
  } catch (err) {
    throw new CCIPArgumentInvalidError('chain-selectors', `cannot read file "${value}"`, {
      cause: err instanceof Error ? err : undefined,
    })
  }
  let doc
  try {
    doc = jsonParse<unknown>(text)
  } catch (err) {
    throw new CCIPArgumentInvalidError(
      'chain-selectors',
      `${inline ? 'inline value' : `file "${value}"`} is not valid JSON/YAML`,
      { cause: err instanceof Error ? err : undefined },
    )
  }
  if (doc && typeof doc === 'object' && 'selectors' in doc) doc = doc.selectors
  if (Array.isArray(doc)) return doc.map((entry) => toRegistration(undefined, entry as RawEntry))
  if (doc && typeof doc === 'object')
    return Object.entries(doc as Record<string, RawEntry | null>).map(([id, entry]) =>
      toRegistration(id, entry ?? {}),
    )
  throw new CCIPArgumentInvalidError(
    'chain-selectors',
    `expected an array or a chainId->entry object, got: ${String(doc)}`,
  )
}

/**
 * yargs `coerce` for `--chain-selectors` / `CCIP_CHAIN_SELECTORS`: parses each value syntactically
 * (shorthand, inline JSON or file) with no side effects, so a malformed value fails as an attributed
 * option error at parse time. The actual registration happens later, in middleware.
 */
export function coerceChainSelectors(values: unknown[]): ChainRegistration[] {
  return values.flatMap((value) => {
    if (typeof value !== 'string')
      throw new CCIPArgumentInvalidError(
        'chain-selectors',
        `expects string values, got ${typeof value}`,
      )
    return parseChainSelectorsArg(value)
  })
}

/**
 * Registers the chains parsed from `--chain-selectors`, so local devnets and chains missing from the
 * bundled selector table resolve like any bundled chain. Registration failures are re-attributed to
 * the `--chain-selectors` flag the user passed, rather than surfacing the SDK's generic argument name.
 */
export function registerParsedChains(
  chains: readonly ChainRegistration[] | undefined,
): NetworkInfo[] {
  if (!chains?.length) return []
  try {
    return registerChains(chains)
  } catch (err) {
    if (err instanceof CCIPChainRegistrationError)
      throw new CCIPArgumentInvalidError('chain-selectors', err.message, { cause: err })
    throw err
  }
}
