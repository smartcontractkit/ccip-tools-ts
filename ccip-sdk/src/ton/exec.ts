import { Address, beginCell, toNano } from '@ton/core'
import { type TonClient, internal } from '@ton/ton'

import type { ExecutionReport } from '../types.ts'
import { type CCIPMessage_V1_6_TON, type TONWallet, serializeExecutionReport } from './types.ts'
import { waitForTransaction } from './utils.ts'

/**
 * Executes a CCIP message on the TON OffRamp contract.
 * Serializes the execution report, constructs the OffRamp_ManuallyExecute message,
 * sends the transaction via the wallet, and waits for confirmation.
 *
 * @param client - TonClient instance for RPC calls.
 * @param wallet - TON wallet with contract and keypair for signing.
 * @param offRamp - OffRamp contract address.
 * @param execReport - Execution report containing the CCIP message and proofs.
 * @param opts - Optional execution options. Gas limit override for execution (0 = no override).
 * @returns Transaction hash in format "workchain:address:lt:hash".
 */
export async function executeReport(
  client: TonClient,
  wallet: TONWallet,
  offRamp: string,
  execReport: ExecutionReport<CCIPMessage_V1_6_TON>,
  opts?: { gasLimit?: number },
): Promise<{ hash: string }> {
  // Serialize the execution report
  const serializedReport = serializeExecutionReport(execReport)

  // Use provided gasLimit as override, or 0 for no override
  const gasOverride = opts?.gasLimit ? BigInt(opts.gasLimit) : 0n

  // Construct the OffRamp_ManuallyExecute message
  const payload = beginCell()
    .storeUint(0xa00785cf, 32) // Opcode for OffRamp_ManuallyExecute
    .storeUint(0, 64) // queryID (default 0)
    .storeRef(serializedReport) // ExecutionReport as reference
    .storeCoins(gasOverride) // gasOverride (optional, 0 = no override)
    .endCell()

  // Open wallet and send transaction
  const openedWallet = client.open(wallet.contract)
  const seqno = await openedWallet.getSeqno()
  const walletAddress = wallet.contract.address

  await openedWallet.sendTransfer({
    seqno,
    secretKey: wallet.keyPair.secretKey,
    messages: [
      internal({
        to: offRamp,
        value: toNano('0.5'),
        body: payload,
      }),
    ],
  })

  // Wait for transaction to be confirmed
  const offRampAddress = Address.parse(offRamp)
  const txInfo = await waitForTransaction(client, walletAddress, seqno, offRampAddress)

  // Return composite hash in format "workchain:address:lt:hash"
  // we use toRawString() to get "workchain:addr" format
  return {
    hash: `${walletAddress.toRawString()}:${txInfo.lt}:${txInfo.hash}`,
  }
}
