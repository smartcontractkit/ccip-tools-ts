import {
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js'
import fs from 'fs'
import path from 'path'
import { AnchorProvider, BorshCoder, Program, Wallet } from '@coral-xyz/anchor'
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { calculateManualExecProof } from '../execution.ts'
import { type CCIPMessage, type CCIPRequest, type ExecutionReport, CCIPVersion } from '../types.ts'
import { getClusterUrlByChainSelectorName } from './getClusterByChainSelectorName.ts'
import { getManuallyExecuteInputs } from './getManuallyExecuteInputs'
import { CCIP_OFFRAMP_IDL } from './programs/1.6.0/CCIP_OFFRAMP.ts'
import { getCcipOfframp } from './programs/getCcipOfframp'
import type { SupportedSolanaCCIPVersion } from './programs/versioning.ts'
import { simulateManuallyExecute } from './simulateManuallyExecute'
import { normalizeExecutionReportForSolana } from './utils.ts'
import { EXECUTION_BUFFER_IDL } from './programs/1.6.0/EXECUTION_BUFFER.ts'
import { randomBytes } from 'crypto'

export async function buildManualExecutionTxWithSolanaDestination<
  V extends SupportedSolanaCCIPVersion,
>(
  destinationProvider: AnchorProvider,
  ccipRequest: CCIPRequest<V>,
  offrampAddress: string,
  bufferProgramAddress: string,
  forceBuffer: boolean,
  computeUnitsOverride: number | undefined,
): Promise<VersionedTransaction[]> {
  const offrampProgram = getCcipOfframp({
    ccipVersion: CCIPVersion.V1_6,
    address: offrampAddress,
    provider: destinationProvider,
  })

  const TnV = (await offrampProgram.methods.typeVersion().accounts({}).signers([]).view()) as string

  if (TnV != 'ccip-offramp 0.1.0-dev') {
    throw new Error(`Unsupported offramp version: ${TnV}`)
  }

  const { proofs, merkleRoot } = calculateManualExecProof([ccipRequest.message], ccipRequest.lane, [
    ccipRequest.message.header.messageId,
  ])
  const executionReportRaw: ExecutionReport = normalizeExecutionReportForSolana({
    sourceChainSelector: BigInt(ccipRequest.lane.sourceChainSelector),
    message: ccipRequest.message as CCIPMessage<typeof CCIPVersion.V1_6>,
    proofs,
    // Offchain token data is unsupported for manual exec
    offchainTokenData: ['0x'],
  })

  const payerAddress = destinationProvider.wallet.publicKey.toBase58()

  const { executionReport, tokenIndexes, accounts, remainingAccounts, addressLookupTableAccounts } =
    await getManuallyExecuteInputs({
      executionReportRaw,
      connection: destinationProvider.connection,
      offrampProgram,
      root: merkleRoot,
      senderAddress: payerAddress,
    })

  const coder = new BorshCoder(CCIP_OFFRAMP_IDL)
  const serializedReport = coder.types.encode('ExecutionReportSingleChain', executionReport)
  const serializedTokenIndexes = Buffer.from(tokenIndexes)

  const anchorTx = await offrampProgram.methods
    .manuallyExecute(serializedReport, serializedTokenIndexes)
    .accounts(accounts)
    .remainingAccounts(remainingAccounts)
    .transaction()

  const manualExecuteInstructions = anchorTx.instructions

  const { blockhash } = await destinationProvider.connection.getLatestBlockhash()

  const computeUnits = await simulateManuallyExecute({
    instructions: manualExecuteInstructions,
    connection: destinationProvider.connection,
    payerKey: destinationProvider.wallet.publicKey,
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
    payerKey: destinationProvider.wallet.publicKey,
    recentBlockhash: blockhash,
    instructions: finalInstructions,
  })
  const messageV0 = message.compileToV0Message(addressLookupTableAccounts)
  const transaction = new VersionedTransaction(messageV0)

  if (transaction.serialize().length > 1232 || forceBuffer) {
    console.log(
      `Execute report will be pre-buffered through the buffering contract ${bufferProgramAddress}. This may take some time.`,
    )
    return bufferedTransactions(
      destinationProvider,
      bufferProgramAddress,
      serializedReport,
      serializedTokenIndexes,
      accounts,
      remainingAccounts,
      computeBudgetIx,
      blockhash,
      addressLookupTableAccounts,
    )
  }

  return [transaction]
}

export function newAnchorProvider(chainName: string, keypairFile: string | undefined) {
  let keypairPath: string

  if (keypairFile === undefined) {
    const homeDir = process.env.HOME || process.env.USERPROFILE
    keypairPath = path.join(homeDir as string, '.config', 'solana', 'id.json')
  } else {
    keypairPath = keypairFile
  }

  console.log('Using keypair file ', keypairPath)

  const secretKeyString = fs.readFileSync(keypairPath, 'utf8')
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString) as number[])

  const keypair = Keypair.fromSecretKey(secretKey)
  const wallet = new Wallet(keypair)
  const connection = new Connection(getClusterUrlByChainSelectorName(chainName))
  const anchorProvider = new AnchorProvider(connection, wallet, {
    commitment: 'processed',
  })
  return { anchorProvider, keypair }
}

type ManualExecAccounts = {
  config: PublicKey
  referenceAddresses: PublicKey
  sourceChain: PublicKey
  commitReport: PublicKey
  offramp: PublicKey
  allowedOfframp: PublicKey
  rmnRemote: PublicKey
  rmnRemoteCurses: PublicKey
  rmnRemoteConfig: PublicKey
  authority: PublicKey
  systemProgram: PublicKey
  sysvarInstructions: PublicKey
}

async function bufferedTransactions(
  destinationProvider: AnchorProvider,
  bufferProgramAddress: string,
  serializedReport: Buffer,
  serializedTokenIndexes: Buffer<ArrayBuffer>,
  originalManualExecAccounts: ManualExecAccounts,
  originalManualExecRemainingAccounts: AccountMeta[],
  computeBudgetIx: TransactionInstruction,
  blockhash: string,
  addressLookupTableAccounts: AddressLookupTableAccount[],
): Promise<VersionedTransaction[]> {
  // Arbitrary as long as there's consistency for all translations.
  const bufferId = {
    bytes: Array.from(randomBytes(32)),
  }
  const [bufferAddress] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('execution_buffer'),
      destinationProvider.wallet.publicKey.toBuffer(),
      Buffer.from(bufferId.bytes),
    ],
    new PublicKey(bufferProgramAddress),
  )

  const hexBytes = '0x' + bufferId.bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  console.log(
    `The bufferID is ${hexBytes}, and the PDA address for the buffer is ${bufferAddress.toString()}. If this buffering process is aborted, remember to manually close the account to recover any spent funds.`,
  )

  const chunkSize = 800

  const bufferingProgram = new Program(
    EXECUTION_BUFFER_IDL,
    new PublicKey(bufferProgramAddress),
    destinationProvider,
  )

  let transactions: VersionedTransaction[] = []

  const bufferingAccounts = {
    bufferedReport: bufferAddress,
    authority: destinationProvider.wallet.publicKey,
    systemProgram: SystemProgram.programId,
  }
  const initTx = await bufferingProgram.methods
    .initializeExecutionReportBuffer(bufferId)
    .accounts(bufferingAccounts)
    .transaction()
  transactions.push(toVersionedTransaction(initTx, destinationProvider.wallet.publicKey, blockhash))

  for (let i = 0; i < serializedReport.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, serializedReport.length)
    const chunk: Buffer = serializedReport.subarray(i, end)

    const appendTx = await bufferingProgram.methods
      .appendExecutionReportData(bufferId, chunk)
      .accounts(bufferingAccounts)
      .transaction()
    transactions.push(
      toVersionedTransaction(appendTx, destinationProvider.wallet.publicKey, blockhash),
    )
  }

  const executeTx = await bufferingProgram.methods
    .manuallyExecuteBuffered(bufferId, serializedTokenIndexes)
    .accounts({
      ...originalManualExecAccounts,
      bufferedReport: bufferAddress,
    })
    .remainingAccounts(originalManualExecRemainingAccounts)
    .transaction()

  const executeTxInstructions = executeTx.instructions

  // Add compute budget instruction at the beginning of instructions
  const finalInstructions = [computeBudgetIx, ...executeTxInstructions]

  const message = new TransactionMessage({
    payerKey: destinationProvider.wallet.publicKey,
    recentBlockhash: blockhash,
    instructions: finalInstructions,
  })
  const messageV0 = message.compileToV0Message(addressLookupTableAccounts)
  transactions.push(new VersionedTransaction(messageV0))

  return transactions
}

function toVersionedTransaction(
  tx: Transaction,
  payerKey: PublicKey,
  blockhash: string,
): VersionedTransaction {
  const instructions = tx.instructions

  const message = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions,
  })
  return new VersionedTransaction(message.compileToV0Message())
}
