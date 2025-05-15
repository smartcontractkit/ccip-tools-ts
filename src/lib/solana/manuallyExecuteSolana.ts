import { AnchorProvider, BorshCoder, type Instruction } from '@coral-xyz/anchor'
import {
  PublicKey,
  type GetVersionedTransactionConfig,
  type PartiallyDecodedInstruction,
} from '@solana/web3.js'
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { ComputeBudgetProgram } from '@solana/web3.js'
import { CCIPVersion, normalizeExecutionReport, type ExecutionReport } from '../types.ts'
import { getCcipOfframp } from './programs/getCcipOfframp'
import { getManuallyExecuteInputs } from './getManuallyExecuteInputs'
import { simulateManuallyExecute } from './simulateManuallyExecute'
import type { CCIPRequest } from '../../../dist/lib/types'
import type { SupportedSolanaCCIPVersion } from './programs/versioning.ts'
import { CCIP_OFFRAMP_IDL } from './programs/1.6.0/CCIP_OFFRAMP.ts'

export async function buildManualExecutionTxWithSolanaDestination<
  V extends SupportedSolanaCCIPVersion,
>(
  destinationProvider: AnchorProvider,
  ccipRequest: CCIPRequest<V>,
  solanaTxSignature: string,
  computeUnitsOverride: number | undefined,
): Promise<VersionedTransaction> {
  var config: GetVersionedTransactionConfig = {
    maxSupportedTransactionVersion: 0,
  }

  const transaction = await destinationProvider.connection.getParsedTransaction(
    solanaTxSignature,
    config,
  )

  if (transaction === null) {
    throw new Error('Could not parse destination transaction')
  }

  const instructions = transaction.transaction.message.instructions
  const executeInstruction = instructions[1] as PartiallyDecodedInstruction
  const offrampAddress = executeInstruction.programId

  const offrampProgram = getCcipOfframp({
    ccipVersion: CCIPVersion.V1_6,
    address: offrampAddress.toBase58(),
    provider: destinationProvider,
  })

  const TnV = await offrampProgram.methods.typeVersion().accounts({}).signers([]).view()

  if (TnV != 'ccip-offramp 0.1.0-dev') {
    throw new Error('Unsupported offramp version: ', TnV)
  }

  const commitReportAddress: PublicKey = executeInstruction.accounts[3]
  const commitReport = await offrampProgram.account.commitReport.fetch(commitReportAddress)
  // console.debug('Merkle root: ', commitReport.merkleRoot)
  const rootString = '0x' + Buffer.from(commitReport.merkleRoot).toString('hex')
  // console.debug('Merkle root string:', rootString)

  const coder = new BorshCoder(CCIP_OFFRAMP_IDL)
  const decodedData = coder.instruction.decode(executeInstruction.data, 'base58') as Instruction
  const executionReportDecoded = coder.types.decode(
    'ExecutionReportSingleChain',
    decodedData.data.rawExecutionReport,
  )

  const executionReportRaw: ExecutionReport = normalizeExecutionReport({
    message: ccipRequest.message,
    offchainTokenData: executionReportDecoded.offchainTokenData.map((data: Buffer) => '0x' + data.toString('hex')),
    proofs: executionReportDecoded.proofs,
    sourceChainSelector: ccipRequest.message.header.sourceChainSelector,
  })

  console.debug(executionReportRaw)

  const payerAddress = destinationProvider.wallet.publicKey.toBase58()
  const { executionReport, tokenIndexes, accounts, remainingAccounts, addressLookupTableAccounts } =
    await getManuallyExecuteInputs({
      executionReportRaw,
      connection: destinationProvider.connection,
      offrampProgram,
      root: rootString,
      senderAddress: payerAddress,
    })

  const serializedReport = coder.types.encode('ExecutionReportSingleChain', executionReport)
  const serializedTokenIndexes = Buffer.from(tokenIndexes)

  const anchorTx = await offrampProgram.methods
    .manuallyExecute(serializedReport, serializedTokenIndexes)
    .accounts(accounts)
    .remainingAccounts(remainingAccounts)
    .transaction()

  const manualExecuteInstructions = anchorTx.instructions

  const { blockhash } = await destinationProvider.connection.getLatestBlockhash()

  // const computeUnits = await simulateManuallyExecute({
  //   instructions: manualExecuteInstructions,
  //   connection: destinationProvider.connection,
  //   payerKey: destinationProvider.wallet.publicKey,
  //   blockhash,
  //   addressLookupTableAccounts,
  //   computeUnitsOverride,
  // })
  const computeUnits = 1070146
  const computeUnitsWithBuffer = Math.ceil(computeUnits * 1.1)
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: computeUnitsOverride || computeUnitsWithBuffer,
  })

  // Add compute budget instruction at the beginning of instructions
  const finalInstructions = [computeBudgetIx, ...manualExecuteInstructions]

  const message = new TransactionMessage({
    payerKey: destinationProvider.wallet.publicKey,
    recentBlockhash: blockhash,
    instructions: finalInstructions,
  })
  const messageV0 = message.compileToV0Message(addressLookupTableAccounts)
  const tx = new VersionedTransaction(messageV0)

  console.debug('Serialized transaction:', Buffer.from(tx.serialize().buffer).toString('base64'))

  return tx
}
