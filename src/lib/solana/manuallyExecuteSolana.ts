import { BorshCoder } from '@coral-xyz/anchor'
import { clusterApiUrl, Connection, PublicKey } from '@solana/web3.js'
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { ComputeBudgetProgram } from '@solana/web3.js'
import { CCIPVersion } from '../types.ts'
import { success } from '@chainlink/chain-agnostic'
import { Features, WalletCoordinator } from '@chainlink/wallet'
import type {
  ManuallyExecuteSolanaInputs,
  ManuallyExecuteSolanaOutput,
} from '../../../features'
import { getCcipOfframp } from './programs/getCcipOfframp'
import { getManuallyExecuteInputs } from './getManuallyExecuteInputs'
import { simulateManuallyExecute } from './simulateManuallyExecute'

export async function executeFeature(
  args: ManuallyExecuteSolanaInputs,
): ManuallyExecuteSolanaOutput {
  const {
    offrampAddress,
    executionReport: executionReportRaw,
    cluster,
    root,
    destChainSelectorName,
    senderAddress,
    computeUnitsOverride,
  } = args
  const connection = new Connection(clusterApiUrl(cluster))

  const offrampProgram = getCcipOfframp({
    ccipVersion: CCIPVersion.V1_6,
    address: offrampAddress,
    connection,
  })

  const {
    executionReport,
    tokenIndexes,
    accounts,
    remainingAccounts,
    addressLookupTableAccounts,
  } = await getManuallyExecuteInputs({
    executionReportRaw,
    connection,
    offrampProgram,
    root,
    senderAddress,
  })

  const coder = new BorshCoder(offrampProgram.idl)

  const serializedReport = coder.types.encode(
    'ExecutionReportSingleChain',
    executionReport,
  )

  const serializedTokenIndexes = Buffer.from(tokenIndexes)

  const anchorTx = await offrampProgram.methods
    .manuallyExecute(serializedReport, serializedTokenIndexes)
    .accounts(accounts)
    .remainingAccounts(remainingAccounts)
    .transaction()

  const manualExecuteInstructions = anchorTx.instructions

  const { blockhash } = await connection.getLatestBlockhash()

  const computeUnits = await simulateManuallyExecute({
    instructions: manualExecuteInstructions,
    connection,
    payerKey: new PublicKey(senderAddress),
    blockhash,
    addressLookupTableAccounts,
    computeUnitsOverride,
  })
  const computeUnitsWithBuffer = Math.ceil(computeUnits * 1.1)
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: computeUnitsOverride || computeUnitsWithBuffer,
  })

  // Add compute budget instruction at the beginning of instructions
  const finalInstructions = [computeBudgetIx, ...manualExecuteInstructions]

  const message = new TransactionMessage({
    payerKey: new PublicKey(senderAddress),
    recentBlockhash: blockhash,
    instructions: finalInstructions,
  })
  const messageV0 = message.compileToV0Message(addressLookupTableAccounts)
  const tx = new VersionedTransaction(messageV0)

  console.info(
    'Serialized transaction:',
    Buffer.from(tx.serialize().buffer).toString('base64'),
  )

  const walletFilter = {
    chainFamily: 'solana' as const,
    chainSelectorName: destChainSelectorName,
    address: senderAddress,
  }
  const walletCoordinator = WalletCoordinator.getInstance()
  const submitTransactionFeature = walletCoordinator.getFeature(
    walletFilter,
    Features.SendSolanaTransaction,
    {
      chainSelectorName: destChainSelectorName,
      transaction: tx,
    },
  )

  if (!submitTransactionFeature.success) {
    throw new Error(submitTransactionFeature.error)
  }

  return submitTransactionFeature.executeFeature()
}

export default function getFeature(args: ManuallyExecuteSolanaInputs) {
  return success(() => executeFeature(args))
}
