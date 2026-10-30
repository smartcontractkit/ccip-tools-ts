import type { CantonConfig } from '../chain.ts'

/**
 * SDK fallbacks when neither {@link CantonConfig} nor per-message `extraArgs` specify a value.
 * Prefer `canton-config.json` for environment defaults and CLI / `extraArgs` for per-send overrides.
 */

/** Default gas for Canton → destination sends when `extraArgs.gasLimit` is omitted. */
export const DEFAULT_CANTON_SEND_GAS_LIMIT = 50_000n

/** Transfer-factory preview amount for fee payments. */
export const DEFAULT_CANTON_FEE_TRANSFER_FACTORY_AMOUNT = '1.0'

/** CCIP-owned LINK instrument id on Canton (`link-token@ccipParty`). */
export const DEFAULT_CANTON_LINK_INSTRUMENT_ID = 'link-token'

/** CLI `profiles` fee-token names returned by {@link CantonChain.getFeeTokens}. */
export const CANTON_FEE_TOKEN_CLI_SYMBOLS = {
  native: 'native',
  link: 'LINK',
} as const

/** Full Canton fee-token string for CCIP LINK (`link-token@ccipParty`). */
export function formatCantonLinkFeeToken(ccipParty: string): string {
  return `${DEFAULT_CANTON_LINK_INSTRUMENT_ID}@${ccipParty}`
}

/** Canton operational defaults overridable via {@link CantonConfig}. */
export type CantonOperationalDefaults = Pick<
  CantonConfig,
  'defaultSendGasLimit' | 'feeTransferFactoryAmount'
>

/** Resolve send gas limit: explicit extraArgs → config → SDK default (0 for token-only, no payload). */
export function resolveCantonSendGasLimit(
  explicit: bigint | undefined,
  tokenOnly: boolean,
  config?: Partial<CantonOperationalDefaults>,
): bigint {
  if (explicit != null) return explicit
  if (tokenOnly) return 0n
  const fromConfig = config?.defaultSendGasLimit
  if (fromConfig != null) return BigInt(fromConfig)
  return DEFAULT_CANTON_SEND_GAS_LIMIT
}
