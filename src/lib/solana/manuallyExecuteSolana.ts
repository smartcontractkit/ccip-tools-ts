import {
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js'
import fs from 'fs'
import path from 'path'
import { AnchorProvider, BorshCoder, Wallet, type Idl } from '@coral-xyz/anchor'
import { ComputeBudgetProgram, Connection, Keypair } from '@solana/web3.js'
import type { Layout } from 'buffer-layout'
import { calculateManualExecProof } from '../execution.ts'
import { type CCIPMessage, type CCIPRequest, type ExecutionReport, CCIPVersion } from '../types.ts'
import { getClusterUrlByChainSelectorName } from './getClusterByChainSelectorName.ts'
import { getManuallyExecuteInputs } from './getManuallyExecuteInputs'
import { CCIP_OFFRAMP_IDL } from './programs/1.6.0/CCIP_OFFRAMP.ts'
import { getCcipOfframp } from './programs/getCcipOfframp'
import type { SupportedSolanaCCIPVersion } from './programs/versioning.ts'
import { simulateUnitsConsumed } from './simulateManuallyExecute'
import { normalizeExecutionReportForSolana } from './utils.ts'
import { BorshTypesCoder } from '@coral-xyz/anchor/dist/cjs/coder/borsh/types'

class ExtendedBorshTypesCoder<N extends string = string> extends BorshTypesCoder<N> {
  public constructor(idl: Idl) {
    super(idl)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public override encode<T = any>(typeName: N, type: T): Buffer {
    const buffer = Buffer.alloc(32000) // TODO: use a tighter buffer.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const layout: Layout<any> | undefined = (this as any).typeLayouts.get(typeName)
    if (!layout) {
      throw new Error(`Unknown type: ${typeName}`)
    }
    const len = layout.encode(type, buffer)

    return buffer.slice(0, len)
  }
}

class AlteredBorshCoder<A extends string = string, T extends string = string> extends BorshCoder<
  A,
  T
> {
  constructor(idl: Idl) {
    super(idl)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const self = this as any
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    self.types = new ExtendedBorshTypesCoder(idl)
  }
}

export type QueuedTransaction = {
  instructions: TransactionInstruction[]
  addressLookupTableAccounts?: AddressLookupTableAccount[]
}

export async function buildManualExecutionTxDataWithSolanaDestination<
  V extends SupportedSolanaCCIPVersion,
>(
  destinationProvider: AnchorProvider,
  ccipRequest: CCIPRequest<V>,
  offrampAddress: string,
  forceBuffer: boolean,
  clearBufferFirst: boolean,
  computeUnitsOverride: number | undefined,
): Promise<QueuedTransaction[]> {
  const offrampProgram = getCcipOfframp({
    ccipVersion: CCIPVersion.V1_6,
    address: offrampAddress,
    provider: destinationProvider,
  })

  const TnV = (await offrampProgram.methods.typeVersion().accounts({}).signers([]).view()) as string
  if (TnV !== 'ccip-offramp 0.1.0-dev') {
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
    offchainTokenData: new Array(ccipRequest.message.tokenAmounts.length).fill('0x'),
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

  const coder = new AlteredBorshCoder(CCIP_OFFRAMP_IDL)
  const serializedReport = coder.types.encode('ExecutionReportSingleChain', executionReport)
  const serializedTokenIndexes = Buffer.from(tokenIndexes)

  if (forceBuffer) {
    console.log(`Execute report will be pre-buffered through the offramp. This may take some time.`)
    return bufferedTransactionData(
      destinationProvider,
      offrampAddress,
      serializedReport,
      serializedTokenIndexes,
      accounts,
      remainingAccounts,
      computeUnitsOverride,
      addressLookupTableAccounts,
      merkleRoot,
      clearBufferFirst,
    )
  }

  const anchorTx = await offrampProgram.methods
    .manuallyExecute(serializedReport, serializedTokenIndexes)
    .accounts(accounts)
    .remainingAccounts(remainingAccounts)
    .transaction()

  const manualExecuteInstructions = anchorTx.instructions

  const computeUnits = await simulateUnitsConsumed({
    instructions: manualExecuteInstructions,
    connection: destinationProvider.connection,
    payerKey: destinationProvider.wallet.publicKey,
    addressLookupTableAccounts,
    computeUnitsOverride,
  })

  const computeUnitsWithBuffer = Math.ceil(computeUnits * 1.1)
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: computeUnitsOverride || computeUnitsWithBuffer,
  })

  return [
    {
      instructions: [computeBudgetIx, ...manualExecuteInstructions],
      addressLookupTableAccounts,
    },
  ]
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

export async function bufferedTransactionData(
  destinationProvider: AnchorProvider,
  offrampAddress: string,
  serializedReport: Buffer,
  serializedTokenIndexes: Buffer<ArrayBuffer>,
  manualExecAccounts: ManualExecAccounts,
  manualExecRemainingAccounts: AccountMeta[],
  computeUnitsOverride: number | undefined,
  addressLookupTableAccounts: AddressLookupTableAccount[],
  merkleRoot: string,
  clearBufferFirst: boolean,
): Promise<QueuedTransaction[]> {
  const offrampProgram = getCcipOfframp({
    ccipVersion: CCIPVersion.V1_6,
    address: offrampAddress,
    provider: destinationProvider,
  })

  // Arbitrary as long as there's consistency for all transactions.
  const bufferId = Buffer.from(merkleRoot.replace(/^0x/, ''), 'hex')

  const [bufferAddress] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('execution_report_buffer'),
      bufferId,
      destinationProvider.wallet.publicKey.toBuffer(),
    ],
    new PublicKey(offrampAddress),
  )

  console.log(
    `The bufferID is ${merkleRoot}, and the PDA address for the buffer is ${bufferAddress.toString()}. If this buffering process is aborted, remember to manually close the account to recover any spent funds.`,
  )

  const chunkSize = 800
  const txQueue: QueuedTransaction[] = []

  if (clearBufferFirst) {
    const clearTx = await offrampProgram.methods
      .closeExecutionReportBuffer(bufferId)
      .accounts({
        executionReportBuffer: bufferAddress,
        authority: destinationProvider.wallet.publicKey,
      })
      .transaction()

    txQueue.push({
      instructions: clearTx.instructions,
    })
  }

  const bufferingAccounts = {
    executionReportBuffer: bufferAddress,
    config: manualExecAccounts.config,
    authority: destinationProvider.wallet.publicKey,
    systemProgram: SystemProgram.programId,
  }

  for (let i = 0; i < serializedReport.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, serializedReport.length)
    const chunk: Buffer = serializedReport.subarray(i, end)

    const appendTx = await offrampProgram.methods
      .bufferExecutionReport(bufferId, serializedReport.length, chunk, i / chunkSize)
      .accounts(bufferingAccounts)
      .transaction()

    txQueue.push({
      instructions: appendTx.instructions,
    })
  }

  // Add buffer PDA to execution remaining accounts
  manualExecRemainingAccounts.push({
    pubkey: new PublicKey(bufferAddress),
    isWritable: true,
    isSigner: false,
  })

  const executeTx = await offrampProgram.methods
    .manuallyExecute(Buffer.alloc(0), serializedTokenIndexes)
    .accounts(manualExecAccounts)
    .remainingAccounts(manualExecRemainingAccounts)
    .transaction()

  const computeBudgetIx = computeUnitsOverride
    ? ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitsOverride })
    : null

  txQueue.push({
    instructions: computeBudgetIx
      ? [computeBudgetIx, ...executeTx.instructions]
      : executeTx.instructions,
    addressLookupTableAccounts,
  })

  return txQueue
}
