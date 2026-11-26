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
 * An unset or empty variable resolves to the network's entry in
 * {@link DEFAULT_RPC_ENDPOINTS} below — the central registry of default
 * keyless public endpoints — so CI secrets only need to be set where a keyed
 * or faster endpoint is wanted.
 */
import { logTestTiming } from './test-timing.ts'

/**
 * Env var names for per-network RPC endpoint configuration. The single source
 * of truth for those names: suites reference them through this object (so a
 * renamed network fails to compile), and the load-time check below guarantees
 * every one of them has a default entry.
 */
export const RPC_ENV = {
  // EVM testnets
  SEPOLIA: 'RPC_SEPOLIA',
  BASE_SEPOLIA: 'RPC_BASE_SEPOLIA',
  ARBITRUM_SEPOLIA: 'RPC_ARBITRUM_SEPOLIA',
  OPTIMISM_SEPOLIA: 'RPC_OPTIMISM_SEPOLIA',
  FUJI: 'RPC_FUJI',
  BSC_TESTNET: 'RPC_BSC_TESTNET',
  // non-EVM testnets
  APTOS_TESTNET: 'RPC_APTOS_TESTNET',
  SOLANA_DEVNET: 'RPC_SOLANA_DEVNET',
  TON_TESTNET: 'RPC_TON_TESTNET',
  SUI_TESTNET: 'RPC_SUI_TESTNET',
  HEDERA_TESTNET: 'RPC_HEDERA_TESTNET',
  // EVM mainnets
  ETHEREUM_MAINNET: 'RPC_ETHEREUM_MAINNET',
  BASE_MAINNET: 'RPC_BASE_MAINNET',
  POLYGON_MAINNET: 'RPC_POLYGON_MAINNET',
  ARBITRUM_MAINNET: 'RPC_ARBITRUM_MAINNET',
  MONAD_MAINNET: 'RPC_MONAD_MAINNET',
  GNOSIS_MAINNET: 'RPC_GNOSIS_MAINNET',
  ROBINHOOD_TESTNET: 'RPC_ROBINHOOD_TESTNET',
} as const

/** Env var names accepted by {@link rpcEndpoints} / {@link rpcEndpoint}. */
export type RpcEnvName = (typeof RPC_ENV)[keyof typeof RPC_ENV]

/**
 * Default keyless public endpoints per network env var (comma-separated
 * lists). First entry wins for single-chain suites, so order by reliability.
 * The Record type makes a missing entry a compile error for any {@link RPC_ENV}
 * key; the load-time check below catches it at runtime too.
 */
export const DEFAULT_RPC_ENDPOINTS: Record<RpcEnvName, string> = {
  RPC_SEPOLIA:
    // Tenderly and 0xRPC lead: both serve the execution fixtures' historical logs.
    // PublicNode prunes that history. EthPandaOps timed out on later fork storage reads.
    // Keep those two only as later fallbacks. Do NOT add drpc: it wins the chainId
    // race, then fails batched eth_call with empty revert data.
    'https://gateway.tenderly.co/public/sepolia,https://0xrpc.io/sep,https://ethereum-sepolia-rpc.publicnode.com,https://rpc.sepolia.ethpandaops.io',
  RPC_BASE_SEPOLIA: 'https://gateway.tenderly.co/public/base-sepolia,https://sepolia.base.org',
  RPC_ARBITRUM_SEPOLIA: 'https://sepolia-rollup.arbitrum.io/rpc',
  RPC_OPTIMISM_SEPOLIA:
    // tenderly leads (original); OP Labs' official keyless endpoint trails so the raced
    // suites keep a candidate when the tenderly gateway is unreachable — some
    // residential security filters answer it with a plaintext block page on :443
    // (CUJO AI on Charter, observed 2026-10): every TLS client sees EPROTO
    // "wrong version number". Locally, override via RPC_OPTIMISM_SEPOLIA.
    'https://gateway.tenderly.co/public/optimism-sepolia,https://sepolia.optimism.io',
  // Forks issue many storage reads; the official gateway can ban those bursts (Cloudflare 1015).
  RPC_FUJI:
    'https://avalanche-fuji-c-chain-rpc.publicnode.com,https://api.avax-test.network/ext/bc/C/rpc',
  RPC_BSC_TESTNET: [
    // NodeReal's public demo endpoint is the only one found that serves a full
    // ~10k-block eth_getLogs here; BNB Chain's own data seeds answer
    // `-32005 limit exceeded` for any getLogs at all (even 1 block) and so
    // trail as call-only fallbacks. drpc's bsc-testnet endpoint is deliberately
    // absent: it wins the chainId race and then fails half of every batched
    // eth_call with "Temporary internal error", surfacing as a bogus
    // empty-revert.
    'https://bsc-testnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3',
    'https://data-seed-prebsc-2-s1.bnbchain.org:8545',
    'https://bsc-testnet-dataseed.bnbchain.org',
  ].join(','),
  RPC_APTOS_TESTNET:
    // Aptos testnet fullnodes prune older txs/events; the archival endpoint
    // retains them, so it is the single default (kept alone on purpose: the
    // per-family race would otherwise let a pruned fullnode win the chain).
    'https://archive.testnet.aptoslabs.com/v1',
  RPC_SOLANA_DEVNET: [
    // raced via raceRpcEndpoint (the suites probe a fixture tx): first endpoint to
    // answer wins, so a throttled one doesn't stall the suite. Retention varies over
    // time (api.devnet.solana.com prunes older txs, devnet.rpcpool.com holds at least
    // ~1 week; both 429 under bursts) — keep fixtures fresher than the shortest
    // observed retention horizon.
    // Only keyless endpoints belong here: onfinality (added as a fallback when it
    // still answered) now rejects keyless callers outright — "-32029 Too Many
    // Requests, Please apply an OnFinality API key" — and an endpoint that never
    // resolves a chain still keeps a CLI race (and the child process running it)
    // alive through its retries, which is exactly the stall `raceRpcEndpoint`
    // exists to avoid.
    'https://devnet.rpcpool.com',
    'https://api.devnet.solana.com',
  ].join(','),
  RPC_TON_TESTNET: 'https://testnet.toncenter.com/api/v2',
  // Public fullnodes serve gRPC-Web, not JSON-RPC; SuiChain.fromUrl detects
  // the transport, so JSON-RPC gateways also work through RPC_SUI_TESTNET.
  RPC_SUI_TESTNET: 'https://fullnode.testnet.sui.io:443',
  RPC_HEDERA_TESTNET: [
    // Official HashIO JSON-RPC relay (Hedera testnet EVM), and the official
    // CCIP Router 1.2.0 from the CCIP Directory
    // (https://docs.chain.link/ccip/directory/testnet).
    // HashIO answers Cloudflare 502 bursts for minute-scale windows, so
    // thirdweb's public Hedera testnet RPC trails as a fallback.
    'https://testnet.hashio.io/api',
    'https://296.rpc.thirdweb.com',
  ].join(','),
  RPC_ETHEREUM_MAINNET: [
    'https://eth-mainnet.public.blastapi.io',
    'https://gateway.tenderly.co/public/mainnet',
  ].join(','),
  RPC_BASE_MAINNET: 'https://mainnet.base.org',
  RPC_POLYGON_MAINNET: [
    'https://gateway.tenderly.co/public/polygon',
    'https://polygon.rpc.thirdweb.com',
  ].join(','),
  RPC_ARBITRUM_MAINNET:
    // tenderly leads (original); Arbitrum's official keyless RPC trails for the raced
    // suites as a fallback when the gateway is unreachable (see RPC_OPTIMISM_SEPOLIA
    // on local filter blocking).
    'https://gateway.tenderly.co/public/arbitrum,https://arb1.arbitrum.io/rpc',
  RPC_MONAD_MAINNET:
    // Monad has no wide-eth_getLogs public endpoint (tenderly 500 blocks,
    // rpc.monad.xyz 100); suites issuing eth_getLogs against it must scope
    // themselves accordingly. rpc.monad.xyz (50 req/s cap) trails for the raced
    // suites as a fallback when the gateway is unreachable (see
    // RPC_OPTIMISM_SEPOLIA on local filter blocking).
    'https://gateway.tenderly.co/public/monad,https://rpc.monad.xyz',
  RPC_GNOSIS_MAINNET: 'https://rpc.gnosischain.com',
  RPC_ROBINHOOD_TESTNET: 'https://rpc.testnet.chain.robinhood.com',
}

// Load-time presence check: every RPC_* env var in the enum must have at least
// a default entry, so adding a network to the enum without defaults fails the
// suite run immediately instead of erroring deep inside a networked suite.
for (const envName of Object.values(RPC_ENV)) {
  if (!DEFAULT_RPC_ENDPOINTS[envName]) throw new Error(`no default RPC endpoints for ${envName}`)
}

/** Trims and drops empty entries from a comma-separated endpoint list. */
function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * All endpoints configured for `envName`, as a list.
 * Falls back to the network's {@link DEFAULT_RPC_ENDPOINTS} entry when
 * unset/empty.
 */
export function rpcEndpoints(envName: RpcEnvName): string[] {
  const fromEnv = parseList(process.env[envName] ?? '')
  const list = fromEnv.length > 0 ? fromEnv : parseList(DEFAULT_RPC_ENDPOINTS[envName])
  if (list.length === 0)
    throw new Error(
      `no RPC endpoints for ${envName}: set the env var, or add a default to ` +
        'DEFAULT_RPC_ENDPOINTS in scripts/test-endpoints.ts',
    )
  return list
}

/**
 * The first endpoint configured for `envName` — for suites that construct a
 * single chain and cannot race several.
 */
export function rpcEndpoint(envName: RpcEnvName): string {
  return rpcEndpoints(envName)[0]!
}

/** Configured endpoints followed by public defaults, with duplicates removed. */
export function rpcCandidates(envName: RpcEnvName): string[] {
  return [...new Set([...rpcEndpoints(envName), ...parseList(DEFAULT_RPC_ENDPOINTS[envName])])]
}

/**
 * One JSON-RPC call's result, or `undefined` on a transport error, a non-2xx answer
 * or a JSON-RPC `error`. Probes use it to check an endpoint without repeating the
 * request shape. The caller's signal bounds each request and cancels a timed-out probe.
 */
async function probeRpcResult(
  url: string,
  method: string,
  params: unknown[],
  signal: AbortSignal,
): Promise<unknown> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal,
    })
    if (!res.ok) {
      await res.body?.cancel()
      return undefined
    }
    const json = (await res.json()) as { result?: unknown; error?: unknown } | null
    return json?.error == null ? json?.result : undefined
  } catch {
    return undefined
  }
}

/** JSON-RPC hex quantity, returned as a string by conforming EVM endpoints. */
function isHexQuantity(value: unknown): value is string {
  return typeof value === 'string' && /^0x[\da-f]+$/i.test(value)
}

/** Probe: `eth_chainId` returns a chain id (not an HTTP error, RPC error or block page). */
export async function evmChainIdProbe(
  url: string,
  signal = AbortSignal.timeout(10_000),
): Promise<boolean> {
  return isHexQuantity(await probeRpcResult(url, 'eth_chainId', [], signal))
}

/**
 * Probe: the endpoint answers a head block read. The scan-heavy e2e lanes page
 * `eth_getBlockByNumber` over the destination chain, and a gateway can answer the
 * cheap `eth_chainId` probe and then failsafe-timeout on block reads — it must not
 * win their endpoint race on that alone.
 */
export async function evmHeadBlockProbe(
  url: string,
  signal = AbortSignal.timeout(10_000),
): Promise<boolean> {
  const head = await probeRpcResult(url, 'eth_blockNumber', [], signal)
  if (!isHexQuantity(head)) return false
  const block = await probeRpcResult(url, 'eth_getBlockByNumber', [head, false], signal)
  if (block == null || typeof block !== 'object') return false
  const number = (block as { number?: unknown }).number
  return isHexQuantity(number) && BigInt(number) === BigInt(head)
}

/**
 * Probe: the endpoint answers the block and state reads an anvil fork relays from
 * its upstream, on the network named by `chainId`. A cheap `eth_chainId` answer says
 * nothing about those reads, so the fork suites must not bind an upstream on it: a
 * gateway that stalls a storage read makes every fork request wait out its timeout.
 */
export function evmForkProbe(
  chainId: number,
): (url: string, signal?: AbortSignal) => Promise<boolean> {
  return async (url, signal = AbortSignal.timeout(20_000)) => {
    const id = await probeRpcResult(url, 'eth_chainId', [], signal)
    if (!isHexQuantity(id) || BigInt(id) !== BigInt(chainId)) return false
    if (!(await evmHeadBlockProbe(url, signal))) return false
    // an EOA slot is fine: this checks that state reads answer, not their value
    const slot = await probeRpcResult(
      url,
      'eth_getStorageAt',
      ['0x0000000000000000000000000000000000000000', '0x0', 'latest'],
      signal,
    )
    return typeof slot === 'string' && /^0x[\da-f]*$/i.test(slot)
  }
}

/**
 * The first EVM endpoint for `envName` that answers {@link evmChainIdProbe}, tried in
 * configured order (the preferred, archive-capable entry wins when it is reachable).
 */
export function reachableRpcEndpoint(envName: RpcEnvName): Promise<string> {
  return raceRpcEndpoint(envName, evmChainIdProbe, { ordered: true, timeoutMs: 5_000, attempts: 1 })
}

/**
 * The first EVM endpoint for `envName` that answers {@link evmForkProbe} for
 * `chainId`, in configured order — for suites that start an anvil fork on it. The
 * archive-capable preferred entry still wins when it answers the fork reads; two
 * attempts absorb a gateway that rejects the first burst.
 */
export function reachableEvmForkEndpoint(envName: RpcEnvName, chainId: number): Promise<string> {
  return raceRpcEndpoint(envName, evmForkProbe(chainId), {
    ordered: true,
    attempts: 2,
    timeoutMs: 20_000,
  })
}

/**
 * Every endpoint configured for `envName` that answers {@link evmHeadBlockProbe}, in
 * configured order — for suites that hand their whole list to a child process, which
 * races endpoints and would otherwise bind one that answers `eth_chainId` and then
 * stalls on the block reads the suite scans. When no configured endpoint passes, the
 * network's public defaults are probed next (the same fallback {@link raceRpcEndpoint}
 * uses). If every probe fails, all configured and public candidates are returned:
 * a transient probe failure must not discard the suite's remaining fallbacks.
 */
export async function healthyEvmRpcEndpoints(envName: RpcEnvName): Promise<string[]> {
  const healthyOnly = async (urls: string[]) => {
    const results = await Promise.all(
      urls.map(async (url) => {
        // One signal bounds both attempts. The retry absorbs a first-request quota refusal.
        const signal = AbortSignal.timeout(20_000)
        if (await evmHeadBlockProbe(url, signal)) return true
        if (signal.aborted) return false
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        return evmHeadBlockProbe(url, signal)
      }),
    )
    return urls.filter((_, index) => results[index])
  }

  const configured = rpcEndpoints(envName)
  const healthy = await healthyOnly(configured)
  if (healthy.length > 0) return healthy

  // A dead keyed endpoint must not hide the keyless defaults this module ships.
  const candidates = rpcCandidates(envName)
  const defaults = candidates.filter((url) => !configured.includes(url))
  const healthyDefaults = await healthyOnly(defaults)
  return healthyDefaults.length > 0 ? healthyDefaults : candidates
}

/**
 * Races every endpoint configured for `envName` with a probe and returns the
 * first one that passes — for suites that construct a single chain, which
 * would otherwise bind to the first entry and stall when that endpoint is
 * throttled (CI's shared egress IP trips public endpoints' keyless quotas
 * run-to-run; see the Solana devnet v2 suite's 300s CI timeout).
 *
 * The probe should be cheap but REPRESENTATIVE of what the suite needs: for
 * retention-sensitive scans, probe the fixture data itself (e.g. a
 * `getTransaction` on a fixture tx) — a fast-but-pruned endpoint that wins the
 * race stalls the suite just the same. Each probe is bounded by `timeoutMs`;
 * when every probe fails or times out, falls back to {@link rpcEndpoint} (the
 * previous first-entry behavior) so the suite still runs as it used to.
 *
 * The network's public {@link DEFAULT_RPC_ENDPOINTS} always join the candidate
 * list behind the configured entries, so an endpoint that has gone dead (rotated
 * key, exhausted quota — a recurring state for the keyed CI secrets) costs the
 * race nothing: all candidates are probed at once and the first to answer is
 * bound, which is normally a healthy configured one. The cost is one probe per
 * default per race, paid only by the raced (single-chain) suites.
 *
 * A candidate is only declared unhealthy once `attempts` probes have failed,
 * spaced with backoff: public gateways throttle *bursts*, so the first probe of
 * a session is regularly rejected by a gateway that is otherwise fine
 * (BlockVision answers its quota error to request #1). Declaring it dead on a
 * single refusal would bind the suite to whichever endpoint happens to be first
 * — the behavior this exists to avoid.
 *
 * With `ordered`, candidates are probed one at a time in configured order instead
 * of raced, so the first healthy entry wins even when a later one answers faster.
 */
export async function raceRpcEndpoint(
  envName: RpcEnvName,
  probe: (url: string, signal: AbortSignal) => Promise<boolean>,
  {
    timeoutMs = 20_000,
    attempts = 3,
    ordered = false,
  }: { timeoutMs?: number; attempts?: number; ordered?: boolean } = {},
): Promise<string> {
  const startedAt = performance.now()
  const candidates = rpcCandidates(envName)
  const publicDefaults = new Set(parseList(DEFAULT_RPC_ENDPOINTS[envName]))
  // Never include an arbitrary URL or a probe error in timing output. Private endpoints can
  // contain credentials in the host, path or query string.
  const label = (url: string) =>
    publicDefaults.has(url) ? new URL(url).hostname : `configured-${candidates.indexOf(url) + 1}`
  let finished = false
  const inFlight = new Set<AbortController>()
  const tryCandidate = async (url: string) => {
    for (let attempt = 0; attempt < attempts && !finished; attempt++) {
      const attemptStartedAt = performance.now()
      let timer: ReturnType<typeof setTimeout> | undefined
      let outcome: boolean | 'timeout'
      const controller = new AbortController()
      inFlight.add(controller)
      try {
        outcome = await Promise.race([
          Promise.resolve()
            .then(() => probe(url, controller.signal))
            .catch(() => false),
          new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => {
              controller.abort()
              resolve('timeout')
            }, timeoutMs)
          }),
        ])
      } finally {
        clearTimeout(timer)
        inFlight.delete(controller)
      }
      const result = outcome === true ? 'ok' : outcome === false ? 'unhealthy' : outcome
      logTestTiming(
        `rpc-probe network=${envName} endpoint=${label(url)} attempt=${attempt + 1} result=${result}`,
        attemptStartedAt,
      )
      if (outcome === true) return url
      // plain timer: AbortSignal-based sleeps are unref'd and would not hold the run open
      if (attempt + 1 < attempts) await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt))
    }
    throw new Error(`probe failed for ${url}`)
  }
  let selected: string | undefined
  try {
    if (ordered) {
      for (const url of candidates) {
        selected = await tryCandidate(url).catch(() => undefined)
        if (selected) break
      }
    } else {
      selected = await Promise.any(candidates.map(tryCandidate)).catch(() => undefined)
    }
  } finally {
    finished = true
    // A non-ordered race can settle while its losing probes still run.
    for (const controller of inFlight) controller.abort()
  }
  const endpoint = selected ?? candidates[0]!
  logTestTiming(
    `rpc-select network=${envName} endpoint=${label(endpoint)} result=${selected ? 'selected' : 'fallback'}`,
    startedAt,
  )
  return endpoint
}
