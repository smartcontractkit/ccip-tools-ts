/**
 * Aptos TokenPool `applyChainUpdates` operation.
 *
 * (Re)configures remote chains on a token pool. Auto-discovers the pool module
 * from the pool address, then builds up to **two** transactions:
 * 1. `apply_chain_updates` — adds/removes remote chain configs.
 * 2. `set_chain_rate_limiter_configs` — configures rate limiters for the added
 *    chains (Aptos `apply_chain_updates` does not carry rate-limiter args).
 *
 * Because it may emit multiple transactions that must be submitted with
 * consecutive account sequence numbers, this op overrides {@link execute} to
 * submit each transaction in order and return the last hash.
 *
 * @packageDocumentation
 */

import { AccountAddress } from '@aptos-labs/ts-sdk'

import type { AptosChain } from '../../../../aptos/index.ts'
import { type UnsignedAptosTx, isAptosAccount } from '../../../../aptos/types.ts'
import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import {
  encodeRemoteAddressBytes,
  encodeRemotePoolAddressBytes,
} from '../../../../token-admin/apply-chain-updates-utils.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import { discoverPoolModule, ensurePoolInitialized } from '../../common.ts'
import {
  type AptosExecuteParams,
  type AptosGenerateParams,
  AptosOperation,
} from '../../operation.ts'
import { submit } from '../../submit.ts'

/** Rate limiter bucket configuration (bigints encoded as strings to avoid precision loss). */
export type RateLimiterConfig = {
  /** Whether the rate limiter is enabled. */
  isEnabled: boolean
  /** Maximum token capacity (bigint as string). */
  capacity: string
  /** Token refill rate per second (bigint as string). */
  rate: string
}

/** Configuration for a single remote chain to add. Addresses are in native format. */
export type RemoteChainConfig = {
  /** Remote chain selector. */
  remoteChainSelector: bigint
  /** Remote pool address(es) in native format. At least one required. */
  remotePoolAddresses: string[]
  /** Remote token address in native format. */
  remoteTokenAddress: string
  /** Outbound rate limiter (local → remote). */
  outboundRateLimiterConfig: RateLimiterConfig
  /** Inbound rate limiter (remote → local). */
  inboundRateLimiterConfig: RateLimiterConfig
}

/** Parameters shared by Aptos TokenPool `applyChainUpdates` generation and execution. */
type ApplyChainUpdatesParams = {
  /** Local pool object address (Aptos hex). */
  poolAddress: string
  /** Remote chain selectors to remove (can be empty). */
  remoteChainSelectorsToRemove: bigint[]
  /** Remote chain configurations to add (can be empty). */
  chainsToAdd: RemoteChainConfig[]
}

/** Parameters for unsigned Aptos TokenPool `applyChainUpdates` generation. */
export type GenerateApplyChainUpdatesParams = AptosGenerateParams<ApplyChainUpdatesParams>

/** Unsigned Aptos TokenPool `applyChainUpdates` result (one or two transactions). */
export type GenerateApplyChainUpdatesResult = UnsignedAptosTx

/** Parameters for executing Aptos TokenPool `applyChainUpdates`. */
export type ExecuteApplyChainUpdatesParams = AptosExecuteParams<ApplyChainUpdatesParams>

/** Result of executing Aptos TokenPool `applyChainUpdates`. */
export type ExecuteApplyChainUpdatesResult = TransactionHash

/** Aptos TokenPool `applyChainUpdates` operation (may emit multiple transactions). */
export class ApplyChainUpdates extends AptosOperation<ApplyChainUpdatesParams> {
  readonly name = 'applyChainUpdates'

  /** Validates the pool address and each remote-chain config before any RPC. */
  protected validate(params: GenerateApplyChainUpdatesParams): void {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'poolAddress', 'must be non-empty')
    }
    for (const [i, chain] of params.chainsToAdd.entries()) {
      if (chain.remoteChainSelector === 0n) {
        throw new CCTParamsInvalidError(
          this.name,
          `chainsToAdd[${i}].remoteChainSelector`,
          'must be non-zero',
        )
      }
      if (chain.remotePoolAddresses.length === 0) {
        throw new CCTParamsInvalidError(
          this.name,
          `chainsToAdd[${i}].remotePoolAddresses`,
          'must have at least one address',
        )
      }
      if (!chain.remoteTokenAddress || chain.remoteTokenAddress.trim().length === 0) {
        throw new CCTParamsInvalidError(
          this.name,
          `chainsToAdd[${i}].remoteTokenAddress`,
          'must be non-empty',
        )
      }
    }
  }

  /**
   * Discovers the pool module, then builds `apply_chain_updates` and, when there
   * are chains to add, a follow-up `set_chain_rate_limiter_configs` transaction
   * with a consecutive account sequence number.
   */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateApplyChainUpdatesParams,
  ): Promise<UnsignedAptosTx> {
    const poolModule = await discoverPoolModule(chain, params.poolAddress)
    await ensurePoolInitialized(chain, params.poolAddress, poolModule)

    const remoteChainSelectorsToRemove = params.remoteChainSelectorsToRemove
    const remoteChainSelectorsToAdd = params.chainsToAdd.map((c) => c.remoteChainSelector)

    // Pool addresses: raw bytes (not padded) — matches chainlink-deployments.
    const remotePoolAddressesToAdd = params.chainsToAdd.map((c) =>
      c.remotePoolAddresses.map((addr) => Array.from(encodeRemotePoolAddressBytes(addr))),
    )

    // Token addresses: 32-byte left-padded — matches chainlink-deployments.
    const remoteTokenAddressesToAdd = params.chainsToAdd.map((c) =>
      Array.from(encodeRemoteAddressBytes(c.remoteTokenAddress)),
    )

    const senderAddr = AccountAddress.from(params.sender)

    // Fetch current sequence number so multi-tx batches get consecutive nonces.
    const { sequence_number } = await chain.provider.getAccountInfo({ accountAddress: senderAddr })
    let nextSeq = BigInt(sequence_number)

    // Transaction 1: apply_chain_updates — adds/removes remote chains.
    const applyTx = await chain.provider.transaction.build.simple({
      sender: senderAddr,
      data: {
        function: `${params.poolAddress}::${poolModule}::apply_chain_updates`,
        functionArguments: [
          remoteChainSelectorsToRemove,
          remoteChainSelectorsToAdd,
          remotePoolAddressesToAdd,
          remoteTokenAddressesToAdd,
        ],
      },
      options: { accountSequenceNumber: nextSeq++ },
    })

    const transactions: [Uint8Array, ...Uint8Array[]] = [applyTx.bcsToBytes()]

    // Transaction 2: set_chain_rate_limiter_configs — only when chains are added.
    if (params.chainsToAdd.length > 0) {
      const rateLimiterTx = await chain.provider.transaction.build.simple({
        sender: senderAddr,
        data: {
          function: `${params.poolAddress}::${poolModule}::set_chain_rate_limiter_configs`,
          functionArguments: [
            remoteChainSelectorsToAdd,
            params.chainsToAdd.map((c) => c.outboundRateLimiterConfig.isEnabled),
            params.chainsToAdd.map((c) => BigInt(c.outboundRateLimiterConfig.capacity)),
            params.chainsToAdd.map((c) => BigInt(c.outboundRateLimiterConfig.rate)),
            params.chainsToAdd.map((c) => c.inboundRateLimiterConfig.isEnabled),
            params.chainsToAdd.map((c) => BigInt(c.inboundRateLimiterConfig.capacity)),
            params.chainsToAdd.map((c) => BigInt(c.inboundRateLimiterConfig.rate)),
          ],
        },
        options: { accountSequenceNumber: nextSeq },
      })
      transactions.push(rateLimiterTx.bcsToBytes())
    }

    chain.logger.debug(
      `${this.name}: pool = ${params.poolAddress}, module = ${poolModule}, adds = ${params.chainsToAdd.length}, removes = ${params.remoteChainSelectorsToRemove.length}, txs = ${transactions.length}`,
    )
    return { family: ChainFamily.Aptos, transactions }
  }

  /**
   * Signs and submits every generated transaction sequentially (tx2 depends on
   * tx1), returning the last confirmed hash.
   */
  override async execute(
    chain: AptosChain,
    params: ExecuteApplyChainUpdatesParams,
  ): Promise<TransactionHash> {
    const { wallet } = params
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const { wallet: _wallet, ...rest } = params
    const sender = wallet.accountAddress.toString()
    const { transactions } = await this.generate(chain, { ...rest, sender })

    let last: TransactionHash | undefined
    for (const txn of transactions) {
      last = await submit(chain, wallet, [txn], this.name)
    }
    if (!last) throw new CCTTxFailedError(this.name, 'no transactions to submit')
    return last
  }
}
