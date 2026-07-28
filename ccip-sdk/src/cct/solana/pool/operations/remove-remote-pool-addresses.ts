import { PublicKey } from '@solana/web3.js'

import type { RateLimiterState } from '../../../../chain.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../../../solana/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  SolanaOperation,
} from '../../operation.ts'
import { validatePublicKey } from '../../validate.ts'
import {
  type RateLimiterConfig,
  buildApplyChainUpdatesInstructions,
  encodeRemoteAddress,
  validateSelectorWithAddresses,
} from './common.ts'

/** Parameters shared by token-pool `removeRemotePoolAddresses` generation and execution. */
type RemoveRemotePoolAddressesParams = {
  /** Local pool state (config PDA) address. */
  poolAddress: string
  /** Remote chain selector; must already be configured via applyChainUpdates. */
  remoteChainSelector: bigint
  /** Remote pool addresses in native format to remove. At least one required. */
  remotePoolAddresses: string[]
  /** Pool authority. Defaults to `payer`; pass a vault/multisig authority explicitly. */
  authority?: string
}

/** Parameters for unsigned token-pool `removeRemotePoolAddresses` generation. */
export type GenerateRemoveRemotePoolAddressesParams =
  SolanaGenerateParams<RemoveRemotePoolAddressesParams>

/** Unsigned token-pool `removeRemotePoolAddresses` result. */
export type GenerateRemoveRemotePoolAddressesResult = UnsignedSolanaTx

/** Parameters for executing token-pool `removeRemotePoolAddresses`. */
export type ExecuteRemoveRemotePoolAddressesParams =
  SolanaExecuteParams<RemoveRemotePoolAddressesParams>

/** Result of executing token-pool `removeRemotePoolAddresses`. */
export type ExecuteRemoveRemotePoolAddressesResult = TransactionHash

/** Converts an on-chain rate limiter state to an applyChainUpdates rate limiter config. */
function toRateLimiterConfig(state: RateLimiterState): RateLimiterConfig {
  if (!state || (state.capacity === 0n && state.rate === 0n)) {
    return { isEnabled: false, capacity: '0', rate: '0' }
  }
  return { isEnabled: true, capacity: state.capacity.toString(), rate: state.rate.toString() }
}

/**
 * Removes specific remote pool addresses from an existing chain config.
 *
 * Solana has no on-chain `removeRemotePool` instruction, so this reads the current
 * config, then re-applies the chain (delete + re-init with the remaining pools) via
 * the same instruction set as {@link ApplyChainUpdates}.
 */
export class RemoveRemotePoolAddresses extends SolanaOperation<RemoveRemotePoolAddressesParams> {
  readonly name = 'removeRemotePoolAddresses'

  /** Validates addresses and selector before any RPC. */
  protected validate(params: GenerateRemoveRemotePoolAddressesParams): void {
    validatePublicKey(this.name, 'poolAddress', params.poolAddress)
    validatePublicKey(this.name, 'payer', params.payer)
    if (params.authority) validatePublicKey(this.name, 'authority', params.authority)
    validateSelectorWithAddresses(
      this.name,
      params.poolAddress,
      params.remoteChainSelector,
      params.remotePoolAddresses,
    )
  }

  /** Reads the current config and builds the delete + re-apply instruction set. */
  protected async buildUnsigned(
    chain: SolanaChain,
    opts: GenerateRemoveRemotePoolAddressesParams,
  ): Promise<UnsignedSolanaTx> {
    const authority = new PublicKey(opts.authority ?? opts.payer)

    const remotes = await chain.getTokenPoolRemotes(opts.poolAddress, opts.remoteChainSelector)
    const remoteConfig = Object.values(remotes)[0]
    if (!remoteConfig) {
      throw new CCTParamsInvalidError(
        this.name,
        'remoteChainSelector',
        `no chain config found for remote chain selector ${opts.remoteChainSelector}`,
      )
    }

    const addressesToRemove = new Set(
      opts.remotePoolAddresses.map((a) => encodeRemoteAddress(a).toLowerCase()),
    )
    const remainingPools = remoteConfig.remotePools.filter(
      (pool) => !addressesToRemove.has(encodeRemoteAddress(pool).toLowerCase()),
    )

    if (remainingPools.length === remoteConfig.remotePools.length) {
      throw new CCTParamsInvalidError(
        this.name,
        'remotePoolAddresses',
        'none of the specified pool addresses were found in the current chain config',
      )
    }
    if (remainingPools.length === 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'remotePoolAddresses',
        'cannot remove all pool addresses — use deleteChainConfig instead to remove the entire chain config',
      )
    }

    const { instructions, poolProgramId } = await buildApplyChainUpdatesInstructions(chain, {
      operation: this.name,
      poolAddress: opts.poolAddress,
      authority,
      remoteChainSelectorsToRemove: [opts.remoteChainSelector],
      chainsToAdd: [
        {
          remoteChainSelector: opts.remoteChainSelector,
          remotePoolAddresses: remainingPools,
          remoteTokenAddress: remoteConfig.remoteToken,
          outboundRateLimiterConfig: toRateLimiterConfig(remoteConfig.outboundRateLimiterState),
          inboundRateLimiterConfig: toRateLimiterConfig(remoteConfig.inboundRateLimiterState),
        },
      ],
    })

    chain.logger.debug(
      `${this.name}: pool = ${opts.poolAddress}, remaining = ${remainingPools.length}, poolProgram = ${poolProgramId.toBase58()}`,
    )
    return { family: ChainFamily.Solana, instructions, mainIndex: 0 }
  }
}
