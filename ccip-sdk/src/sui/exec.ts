import type { Keypair } from '@mysten/sui/cryptography'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'

import {
  CCIPError,
  CCIPErrorCode,
  CCIPExecTxRevertedError,
  CCIPExecutionReportChainMismatchError,
} from '../errors/index.ts'
import { type ExecutionInput, ChainFamily } from '../types.ts'
import { getCcipStateAddress } from './discovery.ts'
import {
  type SuiManuallyExecuteInput,
  type TokenConfig,
  buildManualExecutionPTB,
} from './manuallyExec/index.ts'
import { fetchTokenConfigs, getObjectRef, getReceiverModule } from './objects.ts'
import type { CCIPMessage_V1_6_Sui, UnsignedSuiTx } from './types.ts'

/**
 * Builds a Sui manual-execution PTB and returns it as an {@link UnsignedSuiTx}.
 *
 * @param client - Sui RPC client.
 * @param offRamp - OffRamp object ID / address.
 * @param input - Execution input (message + proofs).
 * @param opts - Optional overrides such as `gasLimit` and `receiverObjectIds`.
 * @returns Serialized unsigned transaction ready to sign and submit.
 */
export async function generateUnsignedExecutePTB(
  client: SuiJsonRpcClient,
  offRamp: string,
  input: ExecutionInput<CCIPMessage_V1_6_Sui>,
  opts?: { gasLimit?: number | bigint; receiverObjectIds?: string[] },
): Promise<UnsignedSuiTx> {
  if (!('message' in input)) {
    throw new CCIPExecutionReportChainMismatchError('Sui')
  }

  const ccip = await getCcipStateAddress(offRamp, client)

  const ccipObjectRef = await getObjectRef(ccip, client)
  const [offrampStateObject, receiverConfig] = await Promise.all([
    getObjectRef(offRamp, client),
    getReceiverModule(client, ccip, ccipObjectRef, input.message.receiver),
  ])

  let tokenConfigs: TokenConfig[] = []
  if (input.message.tokenAmounts.length !== 0) {
    tokenConfigs = await fetchTokenConfigs(client, ccip, ccipObjectRef, input.message.tokenAmounts)
  }

  const suiInput: SuiManuallyExecuteInput = {
    executionReport: input,
    offrampAddress: offRamp,
    ccipAddress: ccip,
    ccipObjectRef,
    offrampStateObject,
    receiverConfig,
    tokenConfigs,
    ...(opts?.receiverObjectIds ? { overrideReceiverObjectIds: opts.receiverObjectIds } : {}),
  }

  const tx = buildManualExecutionPTB(suiInput)

  if (opts?.gasLimit) {
    tx.setGasBudget(opts.gasLimit)
  }

  return {
    family: ChainFamily.Sui,
    transactions: [tx.serialize()],
  }
}

/**
 * Signs and executes a pre-built {@link UnsignedSuiTx} using the provided keypair.
 *
 * @param client - Sui RPC client.
 * @param wallet - Keypair used to sign the transaction.
 * @param unsignedTx - The unsigned Sui transaction to execute.
 * @param logger - Optional logger.
 * @returns The finalized transaction digest string.
 */
export async function signAndExecuteSuiTx(
  client: SuiJsonRpcClient,
  wallet: Keypair,
  unsignedTx: UnsignedSuiTx,
  logger?: { info: (...args: unknown[]) => void },
): Promise<string> {
  const tx = Transaction.from(unsignedTx.transactions[0])

  logger?.info('Executing Sui CCIP execute transaction...')

  let digest: string
  try {
    const result = await client.signAndExecuteTransaction({
      signer: wallet,
      transaction: tx,
      options: {
        showEffects: true,
        showEvents: true,
      },
    })

    if (result.effects?.status.status !== 'success') {
      const errorMsg = result.effects?.status.error ?? 'Unknown error'
      throw new CCIPExecTxRevertedError(result.digest, { context: { error: errorMsg } })
    }

    digest = result.digest
  } catch (e) {
    if (e instanceof CCIPExecTxRevertedError) throw e
    throw new CCIPError(
      CCIPErrorCode.TRANSACTION_NOT_FINALIZED,
      `Failed to send Sui execute transaction: ${(e as Error).message}`,
    )
  }

  logger?.info(`Waiting for Sui transaction ${digest} to be finalized...`)

  await client.waitForTransaction({
    digest,
    options: {
      showEffects: true,
      showEvents: true,
    },
  })

  return digest
}
