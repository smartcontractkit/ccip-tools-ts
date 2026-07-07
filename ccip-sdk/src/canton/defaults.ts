import type { CantonConfig } from '../chain.ts'
import { parseCantonDecimalAmountUnits } from './amount.ts'

/**
 * SDK fallbacks when neither {@link CantonConfig} nor per-message `extraArgs` specify a value.
 * Prefer `canton-config.json` for environment defaults and CLI / `extraArgs` for per-send overrides.
 */

/** Default gas for Canton → destination sends when `extraArgs.gasLimit` is omitted. */
export const DEFAULT_CANTON_SEND_GAS_LIMIT = 50_000n

/** Transfer-factory preview amount for fee payments. */
export const DEFAULT_CANTON_FEE_TRANSFER_FACTORY_AMOUNT = '1.0'

/** CCIPSender `instanceId` when creating a missing sender contract. */
export const DEFAULT_CANTON_SENDER_INSTANCE_ID = 'ccipsender'

/** CCIP-owned LINK instrument id on Canton (`ccipParty::link-token`). */
export const DEFAULT_CANTON_LINK_INSTRUMENT_ID = 'link-token'

/** CLI / Go `profiles` fee-token names returned by {@link CantonChain.getFeeTokens}. */
export const CANTON_FEE_TOKEN_CLI_SYMBOLS = {
  native: 'native',
  link: 'LINK',
} as const

/** Full Canton fee-token string for CCIP LINK (`ccipParty::link-token`). */
export function formatCantonLinkFeeToken(ccipParty: string): string {
  return `${ccipParty}::${DEFAULT_CANTON_LINK_INSTRUMENT_ID}`
}

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

/** Minimal holding fields for fee input selection. */
export type CantonHoldingRef = { contractId: string; amount: string }

/**
 * Select fee-token holding CIDs for transfer-factory preview: prefer one UTXO ≥ minAmount,
 * otherwise greedily add largest holdings until the combined amount reaches minAmount.
 */
export function selectFeeTokenHoldingCids(
  holdings: readonly CantonHoldingRef[],
  minAmount: string,
  excludeContractIds: readonly string[] = [],
): string[] {
  const exclude = new Set(excludeContractIds)
  const minUnits = parseCantonDecimalAmountUnits(minAmount)
  const eligible = holdings
    .filter((holding) => !exclude.has(holding.contractId))
    .map((holding) => ({
      contractId: holding.contractId,
      units: parseCantonDecimalAmountUnits(holding.amount),
    }))
    .filter((holding) => holding.units > 0n)
    .sort((a, b) => (a.units === b.units ? 0 : a.units < b.units ? 1 : -1))

  const single = eligible.find((holding) => holding.units >= minUnits)
  if (single) return [single.contractId]

  const selected: string[] = []
  let sum = 0n
  for (const holding of eligible) {
    selected.push(holding.contractId)
    sum += holding.units
    if (sum >= minUnits) return selected
  }
  return selected
}

/**
 * When fee and bridged token share an instrument, reserve the smallest UTXO that covers
 * the token transfer so fee selection does not consume it.
 */
export function excludeHoldingCidForTokenTransfer(
  holdings: readonly CantonHoldingRef[],
  requiredAmount: string,
  excludeContractIds: readonly string[] = [],
): string | undefined {
  const exclude = new Set(excludeContractIds)
  const minUnits = parseCantonDecimalAmountUnits(requiredAmount)
  const eligible = holdings
    .filter((holding) => !exclude.has(holding.contractId))
    .map((holding) => ({
      contractId: holding.contractId,
      units: parseCantonDecimalAmountUnits(holding.amount),
    }))
    .filter((holding) => holding.units >= minUnits)
    .sort((a, b) => (a.units === b.units ? 0 : a.units < b.units ? -1 : 1))

  return eligible[0]?.contractId
}

/**
 * Sum amounts for the given holding contract IDs.
 */
export function sumCantonHoldingAmounts(
  holdings: readonly CantonHoldingRef[],
  contractIds: readonly string[],
): bigint {
  const byCid = new Map(holdings.map((holding) => [holding.contractId, holding]))
  return contractIds.reduce((total, contractId) => {
    const holding = byCid.get(contractId)
    return total + (holding ? parseCantonDecimalAmountUnits(holding.amount) : 0n)
  }, 0n)
}

/**
 * Resolve CCIPSender instance id from config or SDK default.
 */
export function resolveSenderInstanceId(config?: Partial<CantonOperationalDefaults>): string {
  const fromConfig = config?.senderInstanceId?.trim()
  return fromConfig || DEFAULT_CANTON_SENDER_INSTANCE_ID
}
