/**
 * Parameters and parsing shared by the CCIP 2.0 `init_chain_config_v2` and `edit_chain_config_v2`
 * token pool operations, which write a lane's whole `ChainConfigV2`: its allowed finality, token
 * transfer fees, and CCVs.
 *
 * @packageDocumentation
 */

import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import type { TokenTransferFeeConfig } from '../../../../chain.ts'
import type { FinalityAllowed } from '../../../../extra-args.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { SolanaGenerateParams } from '../../operation.ts'
import type { PoolProgramRef } from '../../programs/token-pool.ts'
import {
  U64_MAX,
  parseOptionalPublicKey,
  parsePublicKey,
  validateBigInt,
  validateInteger,
  validateUniquePublicKeys,
} from '../../validate.ts'

/** Highest token transfer BPS fee a 2.0 Solana pool accepts: 100%. */
const MAX_TOKEN_TRANSFER_FEE_BPS = 10_000
/** Lowest `destBytesOverhead` a 2.0 Solana pool accepts in an enabled fee config. */
const MIN_TOKEN_TRANSFER_DEST_BYTES_OVERHEAD = 32
const U16_MAX = 0xffff
const U32_MAX = 0xffff_ffff

/**
 * CCVs a CCIP 2.0 token pool requires on a lane, on top of those the lane itself requires.
 *
 * @remarks Each list is a complete replacement, and defaults to empty: the pool requires no CCVs
 * of its own in that direction. CCV addresses must be non-default and unique across a direction's
 * base and threshold lists.
 */
export type TokenPoolCCVConfig = {
  /** CCVs required on every transfer to the remote chain. */
  outboundCCVs?: string[]
  /**
   * CCVs additionally required on transfers to the remote chain of at least `thresholdAmount`.
   * Requires a non-empty `outboundCCVs`.
   */
  thresholdOutboundCCVs?: string[]
  /** CCVs required on every transfer from the remote chain. */
  inboundCCVs?: string[]
  /**
   * CCVs additionally required on transfers from the remote chain of at least `thresholdAmount`.
   * Requires a non-empty `inboundCCVs`.
   */
  thresholdInboundCCVs?: string[]
  /**
   * Amount from which the threshold CCVs apply (`u64`, in the local mint's base units; outbound
   * transfers count the amount after the pool's BPS fee). Defaults to `0n`, which disables the
   * threshold CCVs, so it must be positive when any are set.
   */
  thresholdAmount?: bigint
}

/** Parameters shared by `initChainConfigV2` and `editChainConfigV2`. */
export type ChainConfigV2Params = PoolProgramRef & {
  /** Token mint address managed by the local pool. */
  tokenAddress: string
  /** CCIP selector of the remote chain (`u64`). */
  remoteChainSelector: bigint
  /**
   * Finality that transfers to the remote chain may request below full finality: `finalityDepth`
   * is the lowest block depth allowed (`0` allows none) and `finalitySafe` allows the `safe` head.
   * Defaults to `{ finalityDepth: 0 }`, full finality only.
   */
  allowedFinality?: FinalityAllowed
  /**
   * Fees the pool charges on transfers to the remote chain. Defaults to disabled (all zero). An
   * enabled config takes BPS fees up to `10000` (100%) and a `destBytesOverhead` of at least 32.
   */
  tokenTransferFeeConfig?: TokenTransferFeeConfig
  /** CCVs the pool requires on the lane. Defaults to none. */
  ccvConfig?: TokenPoolCCVConfig
  /**
   * Pool owner, who also pays the config account's rent. Defaults to `payer` for single-signer
   * transactions.
   */
  authority?: string
}

/** Parsed {@link ChainConfigV2Params}. */
export type ParsedChainConfigV2Params = {
  tokenAddress: PublicKey
  poolProgramAddress?: PublicKey
  payer: PublicKey
  authority: PublicKey
  remoteChainSelector: bigint
  allowedFinalityConfig: { flags: number; blockDepth: number }
  tokenTransferFeeConfig: {
    destGasOverhead: number
    destBytesOverhead: number
    finalityFee: number
    fastFinalityFee: number
    finalityBpsFee: number
    fastFinalityBpsFee: number
    isEnabled: boolean
  }
  ccvConfig: {
    thresholdAmount: bigint
    outboundCCVs: PublicKey[]
    thresholdOutboundCCVs: PublicKey[]
    inboundCCVs: PublicKey[]
    thresholdInboundCCVs: PublicKey[]
  }
}

function parseRecord(operation: string, param: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new CCTParamsInvalidError(operation, param, 'must be an object')
  return value as Record<string, unknown>
}

function parseAllowedFinality(
  operation: string,
  value: unknown,
): ParsedChainConfigV2Params['allowedFinalityConfig'] {
  if (value === undefined) return { flags: 0, blockDepth: 0 }
  const { finalityDepth, finalitySafe } = parseRecord(operation, 'allowedFinality', value)
  validateInteger(operation, 'allowedFinality.finalityDepth', finalityDepth, 0, U16_MAX)
  if (finalitySafe !== undefined && typeof finalitySafe !== 'boolean')
    throw new CCTParamsInvalidError(operation, 'allowedFinality.finalitySafe', 'must be a boolean')
  // `FinalityConfig` bit 0 of `flags` allows the safe head, as EVM's FinalityCodec
  return { flags: finalitySafe ? 1 : 0, blockDepth: finalityDepth as number }
}

function parseTokenTransferFeeConfig(
  operation: string,
  value: unknown,
): ParsedChainConfigV2Params['tokenTransferFeeConfig'] {
  if (value === undefined)
    return {
      destGasOverhead: 0,
      destBytesOverhead: 0,
      finalityFee: 0,
      fastFinalityFee: 0,
      finalityBpsFee: 0,
      fastFinalityBpsFee: 0,
      isEnabled: false,
    }
  const param = 'tokenTransferFeeConfig'
  const config = parseRecord(operation, param, value)
  for (const field of [
    'destGasOverhead',
    'destBytesOverhead',
    'finalityFeeUSDCents',
    'fastFinalityFeeUSDCents',
  ])
    validateInteger(operation, `${param}.${field}`, config[field], 0, U32_MAX)
  for (const field of ['finalityTransferFeeBps', 'fastFinalityTransferFeeBps'])
    validateInteger(operation, `${param}.${field}`, config[field], 0, MAX_TOKEN_TRANSFER_FEE_BPS)
  if (typeof config.isEnabled !== 'boolean')
    throw new CCTParamsInvalidError(operation, `${param}.isEnabled`, 'must be a boolean')

  const parsed = {
    destGasOverhead: config.destGasOverhead as number,
    destBytesOverhead: config.destBytesOverhead as number,
    finalityFee: config.finalityFeeUSDCents as number,
    fastFinalityFee: config.fastFinalityFeeUSDCents as number,
    finalityBpsFee: config.finalityTransferFeeBps as number,
    fastFinalityBpsFee: config.fastFinalityTransferFeeBps as number,
    isEnabled: config.isEnabled,
  }
  // the program checks the overhead of any config but the all-zero default
  const isDefault = !parsed.isEnabled && Object.values(parsed).every((field) => !field)
  if (!isDefault && parsed.destBytesOverhead < MIN_TOKEN_TRANSFER_DEST_BYTES_OVERHEAD)
    throw new CCTParamsInvalidError(
      operation,
      `${param}.destBytesOverhead`,
      `must be at least ${MIN_TOKEN_TRANSFER_DEST_BYTES_OVERHEAD} unless the config is all zero`,
    )
  return parsed
}

function parseCCVs(operation: string, param: string, value: unknown): PublicKey[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new CCTParamsInvalidError(operation, param, 'must be an array')
  return value.map((address, i) => {
    const ccv = parsePublicKey(operation, `${param}[${i}]`, address)
    if (ccv.equals(PublicKey.default))
      throw new CCTParamsInvalidError(
        operation,
        `${param}[${i}]`,
        'must not be the default address',
      )
    return ccv
  })
}

function parseCCVConfig(operation: string, value: unknown): ParsedChainConfigV2Params['ccvConfig'] {
  const config = value === undefined ? {} : parseRecord(operation, 'ccvConfig', value)
  const thresholdAmount = config.thresholdAmount ?? 0n
  validateBigInt(operation, 'ccvConfig.thresholdAmount', thresholdAmount, 0n, U64_MAX)
  const parsed = { thresholdAmount } as ParsedChainConfigV2Params['ccvConfig']

  for (const direction of ['outbound', 'inbound'] as const) {
    const baseParam = `${direction}CCVs` as const
    const thresholdParam =
      `threshold${direction === 'outbound' ? 'Outbound' : 'Inbound'}CCVs` as const
    const base = parseCCVs(operation, `ccvConfig.${baseParam}`, config[baseParam])
    const threshold = parseCCVs(operation, `ccvConfig.${thresholdParam}`, config[thresholdParam])
    if (threshold.length && !base.length)
      throw new CCTParamsInvalidError(
        operation,
        `ccvConfig.${baseParam}`,
        `must not be empty when ccvConfig.${thresholdParam} is set`,
      )
    if (threshold.length && !thresholdAmount)
      throw new CCTParamsInvalidError(
        operation,
        'ccvConfig.thresholdAmount',
        `must be positive when ccvConfig.${thresholdParam} is set`,
      )
    validateUniquePublicKeys(operation, `ccvConfig.${baseParam} + ${thresholdParam}`, [
      ...base,
      ...threshold,
    ])
    parsed[baseParam] = base
    parsed[thresholdParam] = threshold
  }
  return parsed
}

/**
 * Parses and validates {@link ChainConfigV2Params} as the pool program does, before any RPC.
 * @throws {@link CCTParamsInvalidError} if a parameter is malformed or the program would reject it.
 */
export function parseChainConfigV2Params(
  operation: string,
  params: SolanaGenerateParams<ChainConfigV2Params>,
): ParsedChainConfigV2Params {
  validateBigInt(operation, 'remoteChainSelector', params.remoteChainSelector, 0n, U64_MAX)
  const payer = parsePublicKey(operation, 'payer', params.payer)
  return {
    tokenAddress: parsePublicKey(operation, 'tokenAddress', params.tokenAddress),
    poolProgramAddress: parseOptionalPublicKey(
      operation,
      'poolProgramAddress',
      params.poolProgramAddress,
    ),
    payer,
    authority:
      params.authority === undefined
        ? payer
        : parsePublicKey(operation, 'authority', params.authority),
    remoteChainSelector: params.remoteChainSelector,
    allowedFinalityConfig: parseAllowedFinality(operation, params.allowedFinality),
    tokenTransferFeeConfig: parseTokenTransferFeeConfig(operation, params.tokenTransferFeeConfig),
    ccvConfig: parseCCVConfig(operation, params.ccvConfig),
  }
}

/** Encodes parsed params as the program's `SetChainConfigV2Params` instruction argument. */
export function toSetChainConfigV2Args(opts: ParsedChainConfigV2Params) {
  return {
    mint: opts.tokenAddress,
    remoteChainSelector: new BN(opts.remoteChainSelector.toString()),
    allowedFinalityConfig: opts.allowedFinalityConfig,
    tokenTransferFeeConfig: opts.tokenTransferFeeConfig,
    ccvConfig: {
      thresholdAmount: new BN(opts.ccvConfig.thresholdAmount.toString()),
      outboundCcvs: opts.ccvConfig.outboundCCVs,
      thresholdOutboundCcvs: opts.ccvConfig.thresholdOutboundCCVs,
      inboundCcvs: opts.ccvConfig.inboundCCVs,
      thresholdInboundCcvs: opts.ccvConfig.thresholdInboundCCVs,
    },
  }
}
