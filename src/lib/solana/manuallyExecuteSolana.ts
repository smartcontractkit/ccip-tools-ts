import { BN, BorshCoder } from '@coral-xyz/anchor'
import { clusterApiUrl, Connection, PublicKey } from '@solana/web3.js'
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { ComputeBudgetProgram } from '@solana/web3.js'
import { CCIPVersion, type ExecutionReport } from '../types.ts'
import { getCcipOfframp } from './programs/getCcipOfframp'
import { getManuallyExecuteInputs } from './getManuallyExecuteInputs'
import { simulateManuallyExecute } from './simulateManuallyExecute'
import type { CCIPRequest } from '../../../dist/lib/types'
import type { Provider } from 'ethers'
import { fetchAllMessagesInBatch } from '../requests.ts'
import { calculateManualExecProof } from '../execution.ts'
import type { SupportedSolanaCCIPVersion } from './programs/versioning.ts'


export async function manualExecuteWithSolanaDestination<V extends SupportedSolanaCCIPVersion>(
  source: Provider,
  destination: Connection,
  ccip_request: CCIPRequest<V>,
  offrampAddress: string,
  senderAddress: string,
  root: string,
  computeUnitsOverride: number | undefined,
  page: number
): Promise<VersionedTransaction> {

  const offrampProgram = getCcipOfframp({
    ccipVersion: CCIPVersion.V1_6,
    address: offrampAddress,
    connection: destination,
  })

 
  const offrampPubkey = new PublicKey(offrampAddress)
  const [commitReportAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("commit_report"), BN(ccip_request.lane.sourceChainSelector.toString()).toArrayLike(Buffer, 'le', 8), Buffer.from(root, "hex")],
    offrampPubkey,
  )
  const commit_report = await offrampProgram.account.commit_report.fetch(commitReportAccount)

    const requestsInBatch = await fetchAllMessagesInBatch(
        source,
        ccip_request.lane.destChainSelector,
        ccip_request.log,
        { minSeqNr: commit_report.minMsgNr, maxSeqNr: commit_report.maxMsgNr},
        { page }
    )

    const manualExecReport = calculateManualExecProof(
        requestsInBatch.map(({ message }) => message),
        ccip_request.lane,
        [ccip_request.message.header.messageId],
        commit_report.merkleRoot
    )

    const executionReportRaw: ExecutionReport = {
      message: ccip_request.message,
      // TODO: Figure out where to obtain these from. Args? offchainTokenData
      // isn't really supported.
      offchainTokenData: [], 
      proofs: [],
      sourceChainSelector: ccip_request.lane.sourceChainSelector
    }


  const {
    executionReport,
    tokenIndexes,
    accounts,
    remainingAccounts,
    addressLookupTableAccounts,
  } = await getManuallyExecuteInputs({
    executionReportRaw,
    connection: destination,
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

  const { blockhash } = await destination.getLatestBlockhash()

  const computeUnits = await simulateManuallyExecute({
    instructions: manualExecuteInstructions,
    connection: destination,
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

  return tx
}

