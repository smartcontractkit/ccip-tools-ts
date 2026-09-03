/**
 * Resolves RPC endpoint env vars for the networked test suites.
 *
 * Each network has exactly one env var named after it (see the table in
 * CONTRIBUTING.md), holding one or more COMMA-SEPARATED endpoint URLs:
 *
 *   RPC_SEPOLIA=https://rpc.sepolia.ethpandaops.io,https://0xrpc.io/sep
 *
 * Suites that race several endpoints per chain (the CLI e2e suites) consume
 * the whole list; suites that construct a single chain take the first entry.
 * An unset or empty variable resolves to the suite-provided fallback, so CI
 * secrets only need to be set where a keyed or faster endpoint is wanted.
 */

/** Trims and drops empty entries from a comma-separated endpoint list. */
function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * All endpoints configured for `envName`, as a list.
 * Falls back to `fallback` (itself a comma-separated list) when unset/empty.
 */
export function rpcEndpoints(envName: string, fallback: string): string[] {
  const fromEnv = parseList(process.env[envName] ?? '')
  const list = fromEnv.length > 0 ? fromEnv : parseList(fallback)
  if (list.length === 0) throw new Error(`no RPC endpoints configured for ${envName}`)
  return list
}

/**
 * The first endpoint configured for `envName` — for suites that construct a
 * single chain and cannot race several.
 */
export function rpcEndpoint(envName: string, fallback: string): string {
  return rpcEndpoints(envName, fallback)[0]!
}
