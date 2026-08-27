import type { VerifierEndpoint } from './aggregator.ts'

/** Endpoints for one CCV in preference order, plus the fallback applied to unmapped CCVs. */
export type VerifierEndpointMap = {
  /** Lower-cased CCV address to its endpoints, in the order the user supplied them. */
  byCcv: ReadonlyMap<string, VerifierEndpoint[]>
  /** Endpoints given without an address, applied to any required CCV with no explicit mapping. */
  fallback: VerifierEndpoint[]
}

const SCHEMES: Record<string, { type: 'aggregator'; tls: boolean }> = {
  grpc: { type: 'aggregator', tls: true },
  grpcs: { type: 'aggregator', tls: true },
  'grpc+plaintext': { type: 'aggregator', tls: false },
}

/** Human-readable list of accepted schemes, for error messages. */
const SCHEME_HELP =
  'grpc:// (aggregator over TLS), grpcs:// (alias), grpc+plaintext:// (aggregator, no TLS)'

/**
 * Parse one `--verifier` entry into an endpoint, with an optional CCV address prefix.
 *
 * Grammar: `[<ccvAddress>=]<scheme>://<host>[:port]`. The scheme is mandatory and selects the
 * transport and TLS: a bare `host:port` cannot express whether to use TLS, and sniffing the port
 * is a guess that breaks when an operator runs TLS on a non-443 port.
 *
 * @param entry - One raw `--verifier` value
 * @returns The CCV address it maps to (or null for the fallback) and the parsed endpoint
 * @throws Error with actionable text when the entry is malformed
 */
export function parseVerifierEntry(entry: string): {
  ccvAddress: string | null
  endpoint: VerifierEndpoint
} {
  const trimmed = entry.trim()
  if (!trimmed) throw new Error('--verifier entry is empty')

  // Split on the FIRST '=' only: a URL may legally contain '=' in a query string.
  const eq = trimmed.indexOf('=')
  const hasAddress = eq !== -1 && !trimmed.slice(0, eq).includes('://')
  const ccvAddress = hasAddress ? trimmed.slice(0, eq).trim() : null
  const urlPart = hasAddress ? trimmed.slice(eq + 1).trim() : trimmed

  const sep = urlPart.indexOf('://')
  if (sep === -1) {
    throw new Error(
      `--verifier entry is missing a scheme: "${entry}". A bare host:port cannot say whether to ` +
        `use TLS. Prefix it: ${SCHEME_HELP}`,
    )
  }
  const scheme = urlPart.slice(0, sep).toLowerCase()
  const target = urlPart.slice(sep + 3).replace(/\/+$/, '')
  const known = SCHEMES[scheme]
  if (!known) {
    throw new Error(`--verifier entry has an unsupported scheme "${scheme}://": ${SCHEME_HELP}`)
  }
  if (!target) throw new Error(`--verifier entry has no host: "${entry}"`)

  if (ccvAddress !== null && !/^0x[0-9a-fA-F]{40}$/.test(ccvAddress)) {
    throw new Error(
      `--verifier entry has an invalid CCV address "${ccvAddress}". Use the address reported by ` +
        `\`ccip-cli show <messageId>\`, or omit it to apply one endpoint to every required CCV.`,
    )
  }

  return {
    ccvAddress,
    endpoint: { type: known.type, target, tls: known.tls, raw: urlPart },
  }
}

/**
 * Build the endpoint map from all `--verifier` values.
 *
 * A repeated CCV address accumulates into a list rather than overwriting, because the order is the
 * failover order: primary first, backup second. Entries may also be comma-separated.
 *
 * @param entries - Raw `--verifier` values as supplied on the command line
 * @returns Endpoints grouped by CCV address, plus the address-less fallback list
 */
export function parseVerifierEndpoints(entries: readonly string[]): VerifierEndpointMap {
  const byCcv = new Map<string, VerifierEndpoint[]>()
  const fallback: VerifierEndpoint[] = []
  // Split on commas here rather than only in the CLI's coerce, so a direct call behaves the same
  // way. Otherwise a comma ends up inside a host and yields a bogus endpoint.
  const flattened = entries.flatMap((e) => e.split(',')).map((e) => e.trim())
  for (const entry of flattened) {
    if (!entry) continue
    const { ccvAddress, endpoint } = parseVerifierEntry(entry)
    if (ccvAddress === null) {
      fallback.push(endpoint)
      continue
    }
    const key = ccvAddress.toLowerCase()
    const existing = byCcv.get(key)
    if (existing) existing.push(endpoint)
    else byCcv.set(key, [endpoint])
  }
  return { byCcv, fallback }
}

/**
 * Resolve the endpoints to try for one required CCV.
 *
 * @param map - The parsed endpoint map
 * @param ccvAddress - The CCV address the destination requires
 * @returns Its explicit endpoints if mapped, otherwise the address-less fallback
 */
export function endpointsFor(
  map: VerifierEndpointMap,
  ccvAddress: string,
): readonly VerifierEndpoint[] {
  return map.byCcv.get(ccvAddress.toLowerCase()) ?? map.fallback
}

/** A caller-supplied attestation: `<ccvAddress>=<0x-hex>`. */
export type SuppliedCcvData = { ccvAddress: string; ccvData: string }

/**
 * Parse `--ccv-data <ccvAddress>=<0x-hex>` entries.
 *
 * The bottom of the source ladder: bytes obtained out of band, used when the API, the indexer and
 * the verifier's own endpoint are all unavailable. The CCV's `verifyMessage` decides validity
 * onchain, so wrong bytes can only waste the sender's gas, never make a bad message execute.
 *
 * @param entries - Raw `--ccv-data` values; comma-separated entries are split
 * @returns One record per entry, in the order supplied
 * @throws Error with actionable text when an entry is malformed
 */
export function parseCcvData(entries: readonly string[]): SuppliedCcvData[] {
  const out: SuppliedCcvData[] = []
  for (const raw of entries.flatMap((e) => e.split(',')).map((e) => e.trim())) {
    if (!raw) continue
    const eq = raw.indexOf('=')
    if (eq === -1) {
      throw new Error(
        `--ccv-data entry must be <ccv-address>=<0x-hex>: "${raw}". The address says which CCV the ` +
          `bytes belong to; without it the OffRamp cannot be told which verifier to query.`,
      )
    }
    const ccvAddress = raw.slice(0, eq).trim()
    const ccvData = raw.slice(eq + 1).trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(ccvAddress)) {
      throw new Error(`--ccv-data entry has an invalid CCV address "${ccvAddress}"`)
    }
    if (!/^0x([0-9a-fA-F]{2})*$/.test(ccvData) || ccvData === '0x') {
      throw new Error(
        `--ccv-data for ${ccvAddress} must be non-empty 0x-prefixed hex with an even digit count`,
      )
    }
    out.push({ ccvAddress, ccvData })
  }
  return out
}
