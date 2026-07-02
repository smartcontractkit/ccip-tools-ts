import type { CantonConfig } from '../chain.ts'
import type { AnyMessage } from '../types.ts'

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

/** @deprecated Use {@link DEFAULT_CANTON_NO_EXECUTION_EXECUTOR} */
export const CANTON_NO_EXECUTION_EXECUTOR = DEFAULT_CANTON_NO_EXECUTION_EXECUTOR
/** @deprecated Use {@link DEFAULT_CANTON_SEND_GAS_LIMIT} */
export const CANTON_DEFAULT_SEND_GAS_LIMIT = DEFAULT_CANTON_SEND_GAS_LIMIT
/** @deprecated Use {@link DEFAULT_CANTON_FEE_TRANSFER_FACTORY_AMOUNT} */
export const CANTON_FEE_TRANSFER_FACTORY_AMOUNT = DEFAULT_CANTON_FEE_TRANSFER_FACTORY_AMOUNT
/** @deprecated Use {@link DEFAULT_CANTON_SENDER_INSTANCE_ID} */
export const CANTON_DEFAULT_SENDER_INSTANCE_ID = DEFAULT_CANTON_SENDER_INSTANCE_ID

/** Canton operational defaults overridable via {@link CantonConfig}. */
export type CantonOperationalDefaults = Pick<
  CantonConfig,
  'defaultSendGasLimit' | 'feeTransferFactoryAmount' | 'noExecutionExecutor' | 'senderInstanceId'
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
 * Resolve V3 no-execution executor sentinel from config or SDK default.
 */
export function resolveNoExecutionExecutor(config?: Partial<CantonOperationalDefaults>): string {
  const fromConfig = config?.noExecutionExecutor?.trim()
  return fromConfig || DEFAULT_CANTON_NO_EXECUTION_EXECUTOR
}

/**
 * Resolve CCIPSender instance id from config or SDK default.
 */
export function resolveSenderInstanceId(config?: Partial<CantonOperationalDefaults>): string {
  const fromConfig = config?.senderInstanceId?.trim()
  return fromConfig || DEFAULT_CANTON_SENDER_INSTANCE_ID
}

/**
 * Apply EVM → Canton V3 executor default when `extraArgs.executor` is unset.
 * Used from the EVM send path only (`populateMessageForDest` in `evm/index.ts`).
 */
export function applyCantonDestExecutorDefault(
  message: AnyMessage,
  config?: Partial<CantonOperationalDefaults>,
): AnyMessage {
  const { extraArgs } = message
  if (!('ccvs' in extraArgs)) return message

  const executor =
    'executor' in extraArgs && typeof extraArgs.executor === 'string'
      ? extraArgs.executor.trim()
      : ''
  if (executor) return message

  return {
    ...message,
    extraArgs: {
      ...extraArgs,
      executor: resolveNoExecutionExecutor(config),
    },
  }
}
