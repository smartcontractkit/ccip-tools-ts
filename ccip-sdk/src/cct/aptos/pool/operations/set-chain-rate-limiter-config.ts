/**
 * Aptos TokenPool `setChainRateLimiterConfig` operation.
 *
 * Updates per-remote-chain rate limiter buckets on a token pool via a single
 * `set_chain_rate_limiter_configs` call. Auto-discovers the pool module from the
 * pool address. Deep rate-config validation is delegated to the shared
 * {@link validateSetChainRateLimiterConfigParams} utility.
 *
 * @packageDocumentation
 */

import { AccountAddress } from '@aptos-labs/ts-sdk'

import type { RateLimiterConfig } from './apply-chain-updates.ts'
import type { AptosChain } from '../../../../aptos/index.ts'
import type { UnsignedAptosTx } from '../../../../aptos/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { validateSetChainRateLimiterConfigParams } from '../../../../token-admin/set-rate-limiter-config-utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import { discoverPoolModule, ensurePoolInitialized } from '../../common.ts'
import {
  type AptosExecuteParams,
  type AptosGenerateParams,
  AptosOperation,
} from '../../operation.ts'

/** Rate limiter configuration for a single already-configured remote chain. */
export type ChainRateLimiterConfig = {
  /** Remote chain selector (must already be configured via applyChainUpdates). */
  remoteChainSelector: bigint
  /** Outbound rate limiter (local → remote). */
  outboundRateLimiterConfig: RateLimiterConfig
  /** Inbound rate limiter (remote → local). */
  inboundRateLimiterConfig: RateLimiterConfig
}

/** Parameters shared by Aptos TokenPool `setChainRateLimiterConfig` generation and execution. */
type SetChainRateLimiterConfigParams = {
  /** Local pool object address (Aptos hex) whose rate limits are being updated. */
  poolAddress: string
  /** Rate limiter configurations, one per already-configured remote chain. */
  chainConfigs: ChainRateLimiterConfig[]
}

/** Parameters for unsigned Aptos TokenPool `setChainRateLimiterConfig` generation. */
export type GenerateSetChainRateLimiterConfigParams =
  AptosGenerateParams<SetChainRateLimiterConfigParams>

/** Unsigned Aptos TokenPool `setChainRateLimiterConfig` result. */
export type GenerateSetChainRateLimiterConfigResult = UnsignedAptosTx

/** Parameters for executing Aptos TokenPool `setChainRateLimiterConfig`. */
export type ExecuteSetChainRateLimiterConfigParams =
  AptosExecuteParams<SetChainRateLimiterConfigParams>

/** Result of executing Aptos TokenPool `setChainRateLimiterConfig`. */
export type ExecuteSetChainRateLimiterConfigResult = TransactionHash

/** Aptos TokenPool `setChainRateLimiterConfig` operation. */
export class SetChainRateLimiterConfig extends AptosOperation<SetChainRateLimiterConfigParams> {
  readonly name = 'setChainRateLimiterConfig'

  /** Validates the pool address and rate limiter configs before any RPC. */
  protected validate(params: GenerateSetChainRateLimiterConfigParams): void {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'poolAddress', 'must be non-empty')
    }
    if (params.chainConfigs.length === 0) {
      throw new CCTParamsInvalidError(this.name, 'chainConfigs', 'must have at least one entry')
    }
    // Shared deep validation of selectors and rate limiter amounts.
    validateSetChainRateLimiterConfigParams(params)
  }

  /** Discovers the pool module and builds a single `set_chain_rate_limiter_configs` transaction. */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateSetChainRateLimiterConfigParams,
  ): Promise<UnsignedAptosTx> {
    const poolModule = await discoverPoolModule(chain, params.poolAddress)
    await ensurePoolInitialized(chain, params.poolAddress, poolModule)

    const rateLimiterTx = await chain.provider.transaction.build.simple({
      sender: AccountAddress.from(params.sender),
      data: {
        function: `${params.poolAddress}::${poolModule}::set_chain_rate_limiter_configs`,
        functionArguments: [
          params.chainConfigs.map((c) => c.remoteChainSelector),
          params.chainConfigs.map((c) => c.outboundRateLimiterConfig.isEnabled),
          params.chainConfigs.map((c) => BigInt(c.outboundRateLimiterConfig.capacity)),
          params.chainConfigs.map((c) => BigInt(c.outboundRateLimiterConfig.rate)),
          params.chainConfigs.map((c) => c.inboundRateLimiterConfig.isEnabled),
          params.chainConfigs.map((c) => BigInt(c.inboundRateLimiterConfig.capacity)),
          params.chainConfigs.map((c) => BigInt(c.inboundRateLimiterConfig.rate)),
        ],
      },
    })

    chain.logger.debug(
      `${this.name}: pool = ${params.poolAddress}, module = ${poolModule}, configs = ${params.chainConfigs.length}`,
    )
    return { family: ChainFamily.Aptos, transactions: [rateLimiterTx.bcsToBytes()] }
  }
}
