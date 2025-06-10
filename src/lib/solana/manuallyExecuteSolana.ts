import { randomBytes } from 'crypto'
import fs from 'fs'
import path from 'path'
import { type Idl, type web3, AnchorProvider, BorshCoder, Program, Wallet } from '@coral-xyz/anchor'
import { BorshTypesCoder } from '@coral-xyz/anchor/dist/cjs/coder/borsh/types.js'
import {
  type AccountMeta,
  type Transaction,
  type TransactionInstruction,
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import type { Layout } from 'buffer-layout'
import { calculateManualExecProof } from '../execution.ts'
import { type CCIPMessage, type CCIPRequest, type ExecutionReport, CCIPVersion } from '../types.ts'
import { getClusterUrlByChainSelectorName } from './getClusterByChainSelectorName.ts'
import { getManuallyExecuteInputs } from './getManuallyExecuteInputs.ts'
import { CCIP_OFFRAMP_IDL } from './programs/1.6.0/CCIP_OFFRAMP.ts'
import { EXECUTION_BUFFER_IDL } from './programs/1.6.0/EXECUTION_BUFFER.ts'
import { getCcipOfframp } from './programs/getCcipOfframp.ts'
import type { SupportedSolanaCCIPVersion } from './programs/versioning.ts'
import { simulateUnitsConsumed } from './simulateManuallyExecute.ts'
import { normalizeExecutionReportForSolana } from './utils.ts'

class ExtendedBorshTypesCoder<N extends string = string> extends BorshTypesCoder<N> {
  public constructor(idl: Idl) {
    super(idl)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public override encode<T = any>(typeName: N, type: T): Buffer {
    const buffer = Buffer.alloc(3000) // TODO: use a tighter buffer.
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

type ManualExecAlt = {
  addressLookupTableAccount: AddressLookupTableAccount
  initialTxs: web3.VersionedTransaction[]
  closeTxs: web3.VersionedTransaction[]
}

export type ManualExecTxs = { transactions: VersionedTransaction[]; manualExecIdx: number }

export async function buildManualExecutionTxWithSolanaDestination<
  V extends SupportedSolanaCCIPVersion,
>(
  destinationProvider: AnchorProvider,
  ccipRequest: CCIPRequest<V>,
  offrampAddress: string,
  bufferProgramAddress: string,
  forceBuffer: boolean,
  forceLookupTable: boolean,
  computeUnitsOverride: number | undefined,
): Promise<ManualExecTxs> {
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
    offchainTokenData: new Array(ccipRequest.message.tokenAmounts.length).fill('0x') as string[],
  })

  const payerAddress = destinationProvider.wallet.publicKey

  const { executionReport, tokenIndexes, accounts, remainingAccounts, addressLookupTableAccounts } =
    await getManuallyExecuteInputs({
      executionReportRaw,
      connection: destinationProvider.connection,
      offrampProgram,
      root: merkleRoot,
      senderAddress: payerAddress.toBase58(),
    })

  const coder = new AlteredBorshCoder(CCIP_OFFRAMP_IDL)
  const serializedReport = coder.types.encode('ExecutionReportSingleChain', executionReport)
  const serializedTokenIndexes = Buffer.from(tokenIndexes)

  const { blockhash } = await destinationProvider.connection.getLatestBlockhash()

  console.log('ForceLookupTable', forceLookupTable)

  const alt: ManualExecAlt | undefined = !forceLookupTable
    ? undefined
    : await (async () => {
        const recentSlot = await destinationProvider.connection.getSlot('finalized')

        const [createIx, altAddr] = AddressLookupTableProgram.createLookupTable({
          authority: payerAddress,
          payer: payerAddress,
          recentSlot,
        })
        console.log('Using Address Lookup Table', altAddr.toBase58())

        const addresses = [...Object.values(accounts), ...remainingAccounts.map((a) => a.pubkey)]

        if (addresses.length > 256) {
          throw new Error(
            `The number of addresses (${addresses.length}) exceeds the maximum limit imposed by Solana of 256 for Address Lookup Tables`,
          )
        }

        // 1232 bytes is the max size of a transaction, 32 bytes used for each address.
        // Setting a max of 30 addresses per transaction to avoid exceeding the limit.
        // 1232 / 32 = 38.5, so we set it to 30 to be safe.
        const maxAddressesPerTx = 30
        const extendIxs: TransactionInstruction[] = []
        for (let i = 0; i < addresses.length; i += maxAddressesPerTx) {
          const end = Math.min(i + maxAddressesPerTx, addresses.length)
          const addressesChunk = addresses.slice(i, end)
          const extendIx = AddressLookupTableProgram.extendLookupTable({
            payer: payerAddress,
            authority: payerAddress,
            lookupTable: altAddr,
            addresses: addressesChunk,
          })
          extendIxs.push(extendIx)
        }

        const deactivateIx = AddressLookupTableProgram.deactivateLookupTable({
          lookupTable: altAddr,
          authority: payerAddress,
        })

        const closeIx = AddressLookupTableProgram.closeLookupTable({
          authority: payerAddress,
          lookupTable: altAddr,
          recipient: payerAddress,
        })

        return {
          addressLookupTableAccount: new AddressLookupTableAccount({
            key: altAddr,
            state: {
              deactivationSlot: BigInt(0),
              lastExtendedSlot: recentSlot,
              lastExtendedSlotStartIndex: 0,
              addresses,
            },
          }),
          initialTxs: [createIx, ...extendIxs].map((ix) =>
            toVersionedTransaction(ix, payerAddress, blockhash),
          ),
          closeTxs: [deactivateIx, closeIx].map((ix) =>
            toVersionedTransaction(ix, payerAddress, blockhash),
          ),
        }
      })()

  if (forceBuffer) {
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
      computeUnitsOverride,
      blockhash,
      addressLookupTableAccounts,
      alt,
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

  if (alt) {
    return {
      transactions: [...alt.initialTxs, transaction, ...alt.closeTxs],
      manualExecIdx: alt.initialTxs.length,
    }
  }

  return { transactions: [transaction], manualExecIdx: 0 }
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
  computeUnitsOverride: number | undefined,
  blockhash: string,
  addressLookupTableAccounts: AddressLookupTableAccount[],
  alt: ManualExecAlt | undefined,
): Promise<ManualExecTxs> {
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

  const bufferedExecTxs: VersionedTransaction[] = []

  const bufferingAccounts = {
    bufferedReport: bufferAddress,
    authority: destinationProvider.wallet.publicKey,
    systemProgram: SystemProgram.programId,
  }
  const initTx = await bufferingProgram.methods
    .initializeExecutionReportBuffer(bufferId)
    .accounts(bufferingAccounts)
    .transaction()
  bufferedExecTxs.push(
    toVersionedTransaction(initTx, destinationProvider.wallet.publicKey, blockhash),
  )

  for (let i = 0; i < serializedReport.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, serializedReport.length)
    const chunk: Buffer = serializedReport.subarray(i, end)

    const appendTx = await bufferingProgram.methods
      .appendExecutionReportData(bufferId, chunk)
      .accounts(bufferingAccounts)
      .transaction()
    bufferedExecTxs.push(
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
  let finalInstructions: TransactionInstruction[]

  if (computeUnitsOverride !== undefined) {
    // Add compute budget instruction at the beginning of instructions
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnitsOverride,
    })
    finalInstructions = [computeBudgetIx, ...executeTxInstructions]
  } else {
    finalInstructions = executeTxInstructions
  }

  const message = new TransactionMessage({
    payerKey: destinationProvider.wallet.publicKey,
    recentBlockhash: blockhash,
    instructions: finalInstructions,
  })

  const altAccs = [...addressLookupTableAccounts]
  if (alt) {
    altAccs.push(alt.addressLookupTableAccount)
  }
  const messageV0 = message.compileToV0Message(altAccs)
  bufferedExecTxs.push(new VersionedTransaction(messageV0))

  if (alt) {
    return {
      transactions: [...alt.initialTxs, ...bufferedExecTxs, ...alt.closeTxs],
      manualExecIdx: alt.initialTxs.length + bufferedExecTxs.length - 1,
    }
  }

  return {
    transactions: bufferedExecTxs,
    manualExecIdx: bufferedExecTxs.length - 1,
  }
}

function toVersionedTransaction(
  input: Transaction | TransactionInstruction,
  payerKey: PublicKey,
  blockhash: string,
): VersionedTransaction {
  const instructions: TransactionInstruction[] = isTransaction(input) ? input.instructions : [input]

  const message = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions,
  })
  return new VersionedTransaction(message.compileToV0Message())
}

function isTransaction(input: Transaction | TransactionInstruction): input is Transaction {
  return (input as Transaction).signatures !== undefined
}
