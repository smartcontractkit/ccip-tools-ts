import { existsSync, readFileSync } from 'node:fs'

import type { CantonAuthConfig, CantonConfig, Logger } from '@chainlink/ccip-sdk/src/index.ts'

/**
 * A Canton config as loaded from the CLI's JSON file, before the `auth` block
 * is resolved into a `jwt` (string or getter).
 *
 * The file may carry either a static `jwt` string or an `auth` block (OIDC:
 * `static` / `clientCredentials` / `authorizationCode`). The CLI resolves
 * `auth` upfront (see {@link resolveCantonTokenGetter}) and hands the SDK a
 * config with only `jwt` — the SDK never sees `auth`.
 */
export type CantonCliConfig = CantonConfig & { auth?: CantonAuthConfig }

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
  const required = hasAuth
    ? (['party', 'ccipParty', 'edsUrl', 'transferInstructionUrl'] as const)
    : (['party', 'ccipParty', 'jwt', 'edsUrl', 'transferInstructionUrl'] as const)
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

  logger?.debug('Loaded Canton config from', configPath, 'for party', parsed['party'])
  return parsed as unknown as CantonCliConfig
}

/**
 * CCIP v2 indexer URLs for verification lookups.
 * CLI `--indexer` wins when provided; otherwise uses canton-config `indexerUrl`
 * only when the lane involves Canton (EVM-only lanes keep default indexer behavior).
 * Prefer {@link resolveIndexer} from `./index.ts` in CLI commands.
 */
export function resolveCliIndexer(
  cliIndexer: readonly string[] | undefined,
  cantonConfig: Partial<CantonConfig> | undefined,
  laneInvolvesCanton: boolean,
): readonly string[] | undefined {
  if (cliIndexer?.length) return cliIndexer
  if (!laneInvolvesCanton) return undefined
  const url = cantonConfig?.indexerUrl?.trim()
  return url ? [url] : undefined
}

/**
 * Router / sender instance id for `ccip-cli send -r`.
 * On Canton source lanes this is the CCIPSender instance id (e.g. `prod-ccipsender`);
 * on EVM it must be the router contract address. CLI `-r` wins when set.
 * Prefer {@link resolveRouter} from `./index.ts` in CLI commands.
 */
export function resolveCliRouter(
  cliRouter: string | undefined,
  cantonConfig: Partial<CantonConfig> | undefined,
  sourceIsCanton: boolean,
): string | undefined {
  if (cliRouter?.trim()) return cliRouter.trim()
  if (sourceIsCanton) {
    const fromConfig = cantonConfig?.senderInstanceId?.trim()
    if (fromConfig) return fromConfig
  }
  return cliRouter
}
