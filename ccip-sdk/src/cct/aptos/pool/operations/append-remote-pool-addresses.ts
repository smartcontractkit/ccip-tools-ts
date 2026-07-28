/**
 * Aptos TokenPool `appendRemotePoolAddresses` operation.
 *
 * Appends remote pool addresses to an existing chain config. Auto-discovers the
 * pool module and builds **one `add_remote_pool` transaction per address**, each
 * with a consecutive account sequence number. Overrides {@link execute} to submit
 * every transaction in order and return the last hash.
 *
 * @packageDocumentation
 */

import { AccountAddress } from '@aptos-labs/ts-sdk'

import type { AptosChain } from '../../../../aptos/index.ts'
import { type UnsignedAptosTx, isAptosAccount } from '../../../../aptos/types.ts'
import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { getAddressBytes } from '../../../../utils.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import type { TransactionHash } from '../../../operation.ts'
import { discoverPoolModule, ensurePoolInitialized } from '../../common.ts'
import {
  type AptosExecuteParams,
  type AptosGenerateParams,
  AptosOperation,
} from '../../operation.ts'
import { submit } from '../../submit.ts'

/** Parameters shared by Aptos TokenPool `appendRemotePoolAddresses` generation and execution. */
type AppendRemotePoolAddressesParams = {
  /** Local pool object address (Aptos hex). */
  poolAddress: string
  /** Remote chain selector (must already be configured via applyChainUpdates). */
  remoteChainSelector: bigint
  /** Remote pool addresses to append, in native format. At least one required. */
  remotePoolAddresses: string[]
}

/** Parameters for unsigned Aptos TokenPool `appendRemotePoolAddresses` generation. */
export type GenerateAppendRemotePoolAddressesParams =
  AptosGenerateParams<AppendRemotePoolAddressesParams>

/** Unsigned Aptos TokenPool `appendRemotePoolAddresses` result (one tx per address). */
export type GenerateAppendRemotePoolAddressesResult = UnsignedAptosTx

/** Parameters for executing Aptos TokenPool `appendRemotePoolAddresses`. */
export type ExecuteAppendRemotePoolAddressesParams =
  AptosExecuteParams<AppendRemotePoolAddressesParams>

/** Result of executing Aptos TokenPool `appendRemotePoolAddresses`. */
export type ExecuteAppendRemotePoolAddressesResult = TransactionHash

/** Aptos TokenPool `appendRemotePoolAddresses` operation (one tx per address). */
export class AppendRemotePoolAddresses extends AptosOperation<AppendRemotePoolAddressesParams> {
  readonly name = 'appendRemotePoolAddresses'

  /** Validates the pool address, selector, and each remote pool address before any RPC. */
  protected validate(params: GenerateAppendRemotePoolAddressesParams): void {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCTParamsInvalidError(this.name, 'poolAddress', 'must be non-empty')
    }
    if (params.remoteChainSelector === 0n) {
      throw new CCTParamsInvalidError(this.name, 'remoteChainSelector', 'must be non-zero')
    }
    if (params.remotePoolAddresses.length === 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'remotePoolAddresses',
        'must have at least one address',
      )
    }
    for (const [i, addr] of params.remotePoolAddresses.entries()) {
      if (!addr || addr.trim().length === 0) {
        throw new CCTParamsInvalidError(this.name, `remotePoolAddresses[${i}]`, 'must be non-empty')
      }
    }
  }

  /** Discovers the pool module and builds one `add_remote_pool` tx per address. */
  protected async buildUnsigned(
    chain: AptosChain,
    params: GenerateAppendRemotePoolAddressesParams,
  ): Promise<UnsignedAptosTx> {
    const poolModule = await discoverPoolModule(chain, params.poolAddress)
    await ensurePoolInitialized(chain, params.poolAddress, poolModule)

    const senderAddr = AccountAddress.from(params.sender)

    // Fetch current sequence number so multi-tx batches get consecutive nonces.
    const { sequence_number } = await chain.provider.getAccountInfo({ accountAddress: senderAddr })
    let nextSeq = BigInt(sequence_number)

    const transactions: Uint8Array[] = []
    for (const remotePoolAddress of params.remotePoolAddresses) {
      const encodedAddress = Array.from(getAddressBytes(remotePoolAddress))
      const tx = await chain.provider.transaction.build.simple({
        sender: senderAddr,
        data: {
          function: `${params.poolAddress}::${poolModule}::add_remote_pool`,
          functionArguments: [params.remoteChainSelector, encodedAddress],
        },
        options: { accountSequenceNumber: nextSeq++ },
      })
      transactions.push(tx.bcsToBytes())
    }

    chain.logger.debug(
      `${this.name}: pool = ${params.poolAddress}, module = ${poolModule}, addresses = ${params.remotePoolAddresses.length}`,
    )
    return {
      family: ChainFamily.Aptos,
      transactions: transactions as [Uint8Array, ...Uint8Array[]],
    }
  }

  /** Signs and submits every generated transaction sequentially, returning the last hash. */
  override async execute(
    chain: AptosChain,
    params: ExecuteAppendRemotePoolAddressesParams,
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
