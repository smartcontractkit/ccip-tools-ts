import type { CantonConfig } from '../chain.ts'

/**
 * SDK fallbacks when neither {@link CantonConfig} nor per-message `extraArgs` specify a value.
 * Prefer `canton-config.json` for environment defaults and CLI / `extraArgs` for per-send overrides.
 */

/** V3 executor sentinel for EVM → Canton (no auto-execute). Go CLI `profiles.NoExecutionTag`. */
export const DEFAULT_CANTON_NO_EXECUTION_EXECUTOR =
  '0xEBa517d200000000000000000000000000000000' as const

/** Default gas for Canton → destination sends when `extraArgs.gasLimit` is omitted. */
export const DEFAULT_CANTON_SEND_GAS_LIMIT = 50_000n

/** Transfer-factory preview amount for fee payments. */
export const DEFAULT_CANTON_FEE_TRANSFER_FACTORY_AMOUNT = '1.0'

/** CCIPSender `instanceId` when creating a missing sender contract. */
export const DEFAULT_CANTON_SENDER_INSTANCE_ID = 'ccipsender'

/** Canton operational defaults overridable via {@link CantonConfig}. */
export type CantonOperationalDefaults = Pick<
  CantonConfig,
  'defaultSendGasLimit' | 'feeTransferFactoryAmount' | 'senderInstanceId'
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

/**
 * Resolve transfer-factory preview amount from config or SDK default.
 */
export function resolveFeeTransferFactoryAmount(
  config?: Partial<CantonOperationalDefaults>,
): string {
  return config?.feeTransferFactoryAmount ?? DEFAULT_CANTON_FEE_TRANSFER_FACTORY_AMOUNT
}

/**
 * Resolve CCIPSender instance id from config or SDK default.
 */
export function resolveSenderInstanceId(config?: Partial<CantonOperationalDefaults>): string {
  const fromConfig = config?.senderInstanceId?.trim()
  return fromConfig || DEFAULT_CANTON_SENDER_INSTANCE_ID
}
