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
    'https://rpc.sepolia.ethpandaops.io,https://0xrpc.io/sep,https://gateway.tenderly.co/public/sepolia',
  RPC_BASE_SEPOLIA: 'https://gateway.tenderly.co/public/base-sepolia,https://sepolia.base.org',
  RPC_ARBITRUM_SEPOLIA: 'https://sepolia-rollup.arbitrum.io/rpc',
  RPC_OPTIMISM_SEPOLIA: 'https://gateway.tenderly.co/public/optimism-sepolia',
  RPC_FUJI: 'https://api.avax-test.network/ext/bc/C/rpc',
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
    // raced: first endpoint to resolve wins, so a throttled one doesn't stall
    // the suite; retention varies over time (as of 2026-08: onfinality prunes
    // signature history around ~1 month, api.devnet.solana.com/devnet.rpcpool.com
    // retain longer but 429 harder from cold starts) — keep fixtures fresher
    // than the shortest observed retention horizon. devnet.rpcpool.com leads:
    // public, holds at least ~1 week of txs and doesn't 429 as aggressively as
    // onfinality's free tier.
    'https://devnet.rpcpool.com',
    'https://solana-devnet.api.onfinality.io/public',
    'https://api.devnet.solana.com',
  ].join(','),
  RPC_TON_TESTNET: 'https://testnet.toncenter.com/api/v2',
  RPC_SUI_TESTNET: 'https://sui-testnet-endpoint.blockvision.org',
  RPC_HEDERA_TESTNET:
    // Official HashIO JSON-RPC relay (Hedera testnet EVM), and the official
    // CCIP Router 1.2.0 from the CCIP Directory
    // (https://docs.chain.link/ccip/directory/testnet).
    'https://testnet.hashio.io/api',
  RPC_ETHEREUM_MAINNET: 'https://gateway.tenderly.co/public/mainnet',
  RPC_BASE_MAINNET: 'https://mainnet.base.org',
  RPC_POLYGON_MAINNET: 'https://gateway.tenderly.co/public/polygon',
  RPC_ARBITRUM_MAINNET: 'https://gateway.tenderly.co/public/arbitrum',
  RPC_MONAD_MAINNET:
    // Monad has no wide-eth_getLogs public endpoint (tenderly 500 blocks,
    // rpc.monad.xyz 100); suites issuing eth_getLogs against it must scope
    // themselves accordingly.
    'https://gateway.tenderly.co/public/monad',
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
