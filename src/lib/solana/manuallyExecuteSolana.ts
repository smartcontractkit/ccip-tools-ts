import { AccountClient, AnchorProvider, BorshCoder } from '@coral-xyz/anchor'
import { clusterApiUrl, Connection, Keypair, PublicKey } from '@solana/web3.js'
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { ComputeBudgetProgram } from '@solana/web3.js'
import { CCIPVersion, type ExecutionReport } from '../types.ts'
import { getCcipOfframp } from './programs/getCcipOfframp'
import { getManuallyExecuteInputs } from './getManuallyExecuteInputs'
import { simulateManuallyExecute } from './simulateManuallyExecute'
import type { CCIPRequest } from '../../../dist/lib/types'
import { decodeBase58, type Numeric, type Provider } from 'ethers'
import { fetchAllMessagesInBatch } from '../requests.ts'
import { calculateManualExecProof } from '../execution.ts'
import type { SupportedSolanaCCIPVersion } from './programs/versioning.ts'
import bs58  from 'bs58'

export async function buildManualExecutionTxWithSolanaDestination <V extends SupportedSolanaCCIPVersion>(
  sourceProvider: Provider,
  destinationProvider: AnchorProvider,
  ccipRequest: CCIPRequest<V>,
  offrampAddress: string,
  senderAddress: string,
  commitReportAddress: string,
  computeUnitsOverride: number | undefined,
  page: number,
): Promise<VersionedTransaction> {

  const offrampPubkey = new PublicKey(offrampAddress)
  console.debug("Pubkey: ", offrampPubkey, "base58: ", offrampPubkey.toBase58())
  
  const offrampProgram = getCcipOfframp({
    ccipVersion: CCIPVersion.V1_6,
    address: "offVkroQ4wYMv6QFPBvJazAx2p8BnLh7sJRdyQ5GYfx",
    provider: destinationProvider,
  })

  const TnV = await offrampProgram.methods.typeVersion()
    .accounts({})
    .signers([])
    .view()

  if (TnV != "ccip-offramp 0.1.0-dev") {
    throw new Error("Unsupported offramp version: ", TnV)
  }

  const commitReport = await offrampProgram.account.commitReport.fetch(commitReportAddress)
  console.debug(commitReport)
  console.debug(commitReport.minMsgNr.toNumber())
  console.debug(commitReport.maxMsgNr.toNumber())

  const requestsInBatch = await fetchAllMessagesInBatch(
    sourceProvider,
    ccipRequest.lane.destChainSelector,
    ccipRequest.log,
    { minSeqNr: commitReport.minMsgNr, maxSeqNr: commitReport.maxMsgNr },
    { page },
  )

  const manualExecReport = calculateManualExecProof(
    requestsInBatch.map(({ message }) => message),
    ccipRequest.lane,
    [ccipRequest.message.header.messageId],
    commitReport.merkleRoot,
  )

  const executionReportRaw: ExecutionReport = {
    message: ccipRequest.message,
    // OffchainTokenData not supported for manual exec yet.
    offchainTokenData: [],
    proofs: manualExecReport.proofs,
    sourceChainSelector: ccipRequest.lane.sourceChainSelector,
  }

  const { executionReport, tokenIndexes, accounts, remainingAccounts, addressLookupTableAccounts } =
    await getManuallyExecuteInputs({
      executionReportRaw,
      connection: destinationProvider,
      offrampProgram,
      root: manualExecReport.root,
      senderAddress,
    })

  const coder = new BorshCoder(offrampProgram.idl)

  const serializedReport = coder.types.encode('ExecutionReportSingleChain', executionReport)

  const serializedTokenIndexes = Buffer.from(tokenIndexes)

  const anchorTx = await offrampProgram.methods
    .manuallyExecute(serializedReport, serializedTokenIndexes)
    .accounts(accounts)
    .remainingAccounts(remainingAccounts)
    .transaction()

  const manualExecuteInstructions = anchorTx.instructions

  const { blockhash } = await destinationProvider.getLatestBlockhash()

  const computeUnits = await simulateManuallyExecute({
    instructions: manualExecuteInstructions,
    connection: destinationProvider,
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

  console.info('Serialized transaction:', Buffer.from(tx.serialize().buffer).toString('base64'))

  return tx
}
