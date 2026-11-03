import { existsSync, readFileSync } from 'node:fs'

import type { CantonRpcProvider } from '@chainlink/ccip-sdk/src/canton/types.ts'
import type { CantonAuthConfig, CantonConfig, Logger } from '@chainlink/ccip-sdk/src/index.ts'

/**
 * A Canton config as loaded from the CLI's JSON file.
 *
 * Two groups of fields:
 *
 * - **CLI-only** — consumed by the CLI to build its `JsonRpcProvider` and
 *   resolve authentication: `apiUrl`, `apiType`, `chainId`, `party`, and
 *   `jwt`/`auth`. The file may carry either a static `jwt` string or an `auth`
 *   block (OIDC: `static` / `clientCredentials` / `authorizationCode`); the CLI
 *   resolves `auth` upfront (see {@link resolveCantonTokenGetter}) and hands
 *   the provider the resulting token — the SDK never sees `auth`.
 * - **SDK passthrough** — every {@link CantonConfig} field except `provider`
 *   (which is constructed by the CLI, not user-configurable), forwarded to the
 *   SDK via {@link toSdkCantonConfig}.
 */
export type CantonCliConfig = {
  // --- CLI-only: connectivity & auth ---
  /** Provider type; only `json` (or empty) is supported. */
  apiType: string
  /** Canton Ledger JSON API URL. */
  apiUrl: string
  /** CAIP-2 chain ID, e.g. `canton:testnet` — handed to the CLI's provider. */
  chainId: string
  /** User ledger party for actAs, ACS queries, and transaction visibility. */
  party: string
  /** Static, pre-obtained JWT. Shorthand for `auth: { type: "static", jwt }`. */
  jwt?: string
  /** OIDC auth config (`static` / `clientCredentials` / `authorizationCode`), resolved upfront by the CLI. */
  auth?: CantonAuthConfig

  // --- SDK passthrough (CantonConfig minus provider) ---
  /** CCIP operator party; overrides the network's default CCIP owner party. */
  ccipParty?: string
  /** Throw instead of automatically creating missing contracts. Default: `false`. */
  disableAutomaticContractCreation?: boolean
  /** Owner party → EDS base URL overrides, merged over the SDK's per-network defaults. */
  externalEdsUrlsByOwner?: Record<string, string>
  /** Instrument admin party → Token Standard API base URL overrides, merged over the SDK's per-network defaults. */
  externalTokenStandardUrlsByOwner?: Record<string, string>
  /** Default CCV indexer base URL; CLI `--indexer` wins when provided. */
  indexerUrl?: string
  /** Default gas for Canton → destination sends when `extraArgs.gasLimit` is omitted. */
  defaultSendGasLimit?: number
  /** Default Canton CCV instance addresses for execute / send. */
  ccvs?: string[]
}

/**
 * Build the SDK's {@link CantonConfig} from a loaded CLI config and the
 * {@link CantonRpcProvider} the CLI constructed from its own fields.
 *
 * Forwards every SDK-relevant field from the CLI config; the CLI-only fields
 * (`apiUrl`, `apiType`, `chainId`, `party`, `jwt`, `auth`) are deliberately
 * dropped — the SDK never sees them.
 */
export function toSdkCantonConfig(cli: CantonCliConfig, provider: CantonRpcProvider): CantonConfig {
  return {
    provider,
    ccipParty: cli.ccipParty,
    disableAutomaticContractCreation: cli.disableAutomaticContractCreation,
    externalEdsUrlsByOwner: cli.externalEdsUrlsByOwner,
    externalTokenStandardUrlsByOwner: cli.externalTokenStandardUrlsByOwner,
    indexerUrl: cli.indexerUrl,
    defaultSendGasLimit: cli.defaultSendGasLimit,
    ccvs: cli.ccvs,
  }
}

/**
 * Load and validate a Canton config JSON file.
 *
 * The config may carry either:
 * - a static `jwt` string, or
 * - an `auth` block (OIDC: `static` / `clientCredentials` / `authorizationCode`),
 *   which the CLI resolves upfront into a `jwt` (string or getter) before handing
 *   the config to the SDK.
 *
 * `jwt` (or `auth`) is required: one of them must be present.
 *
 * @param configPath - Path to JSON file, or undefined if not provided.
 * @param logger - Logger for debug output.
 * @returns Parsed {@link CantonCliConfig} (with `auth` preserved) or undefined.
 */
export function loadCantonConfig(
  configPath: string | undefined,
  logger?: Logger,
): CantonCliConfig | undefined {
  if (!configPath) return undefined
  if (!existsSync(configPath)) {
    throw new Error(`Canton config file not found: ${configPath}`)
  }
  const raw = readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>

  // `jwt` is required unless `auth` is present (OAuth2 provider resolves JWT on demand).
  const hasAuth = typeof parsed['auth'] === 'object' && parsed['auth'] !== null
  const required = hasAuth ? ([] as const) : (['jwt'] as const)
  for (const field of required) {
    if (typeof parsed[field] !== 'string' || !parsed[field].length) {
      throw new Error(`Canton config: "${field}" is required and must be a non-empty string`)
    }
  }

  if (parsed['chainId'] != null) {
    if (typeof parsed['chainId'] !== 'string' || !parsed['chainId'].length) {
      throw new Error('Canton config: "chainId" must be a non-empty string if provided')
    }
  }

  logger?.debug('Loaded Canton config from', configPath)
  return parsed as unknown as CantonCliConfig
}

/**
 * CCIP v2 indexer URLs for verification lookups.
 * CLI `--indexer` wins when provided; otherwise uses canton-config `indexerUrl`
 * only when the lane involves Canton (EVM-only lanes keep default indexer behavior).
 * Prefer {@link resolveIndexer} from `../index.ts` in CLI commands.
 */
export function resolveCliIndexer(
  cliIndexer: readonly string[] | undefined,
  cantonConfig: Partial<CantonCliConfig> | undefined,
  laneInvolvesCanton: boolean,
): readonly string[] | undefined {
  if (cliIndexer?.length) return cliIndexer
  if (!laneInvolvesCanton) return undefined
  const url = cantonConfig?.indexerUrl?.trim()
  return url ? [url] : undefined
}
