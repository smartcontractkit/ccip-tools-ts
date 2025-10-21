import { type AnchorProvider, Program } from '@coral-xyz/anchor'
import {
  type AccountMeta,
  type Connection,
  type SimulateTransactionConfig,
  type Transaction,
  type TransactionInstruction,
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  TransactionExpiredBlockheightExceededError,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { hexlify } from 'ethers'

import type { ChainTransaction } from '../chain.ts'
import type { ExecutionReport } from '../types.ts'
import { sleep } from '../utils.ts'
import { getManuallyExecuteInputs } from './getManuallyExecuteInputs.ts'
import './patchBorsh.ts'
import { IDL as CCIP_OFFRAMP_IDL } from './programs/1.6.0/CCIP_OFFRAMP.ts'
import type { CCIPMessage_V1_6_Solana } from './types.ts'
import { bytesToBuffer } from './utils.ts'

type ExecStepTx = [reason: string, transactions: VersionedTransaction]

type ExecAlt = {
  addressLookupTableAccount: AddressLookupTableAccount
  initialTxs: ExecStepTx[]
  finalTxs: ExecStepTx[]
}

export async function executeReport({
  offrampProgram,
  execReport,
  ...opts
}: {
  offrampProgram: Program<typeof CCIP_OFFRAMP_IDL>
  execReport: ExecutionReport<CCIPMessage_V1_6_Solana>
  gasLimit?: number
  forceLookupTable?: boolean
  forceBuffer?: boolean
  clearBufferFirst?: boolean
}): Promise<Pick<ChainTransaction, 'hash'>> {
  const provider = offrampProgram.provider as AnchorProvider
  const wallet = provider.wallet
  const connection = provider.connection

  const execTxs = await buildExecTxToSolana(offrampProgram, execReport, opts?.gasLimit, opts)

  let execTxSignature: string, signature: string
  for (const [i, [reason, transaction]] of execTxs.entries()) {
    // Refresh the blockhash for each transaction, as the blockhash is only valid for a short time
    // and we spend a lot of time waiting for finalization of the previous transactions.
    transaction.message.recentBlockhash = (await connection.getLatestBlockhash()).blockhash

    const signed = await wallet.signTransaction(transaction)

    try {
      signature = await connection.sendTransaction(signed)

      if (reason === 'exec') execTxSignature = signature
    } catch (e) {
      if (
        e instanceof SendTransactionError &&
        e.logs?.some((log) =>
          log.includes('Error Code: ExecutionReportBufferAlreadyContainsChunk.'),
        )
      ) {
        console.warn(
          `Skipping tx ${i + 1} of ${execTxs.length} because a chunk is already in the buffer.`,
        )
        continue
      } else {
        throw e
      }
    }

    console.debug(`Confirming tx #${i + 1} of ${execTxs.length}: ${signature} (${reason})...`)
    for (let currentAttempt = 0; ; currentAttempt++) {
      try {
        const latestBlockhash = await connection.getLatestBlockhash()
        await connection.confirmTransaction(
          {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          'confirmed',
        )
        break
      } catch (e) {
        if (currentAttempt < 5 && e instanceof TransactionExpiredBlockheightExceededError) {
          await sleep(1000)
        } else {
          throw e
        }
      }
    }
  }

  return { hash: execTxSignature! }
}

async function buildExecTxToSolana(
  offrampProgram: Program<typeof CCIP_OFFRAMP_IDL>,
  execReport: ExecutionReport<CCIPMessage_V1_6_Solana>,
  computeUnitsOverride: number | undefined,
  opts?: { forceLookupTable?: boolean; forceBuffer?: boolean; clearBufferFirst?: boolean },
): Promise<ExecStepTx[]> {
  const provider = offrampProgram.provider as AnchorProvider
  offrampProgram = new Program(CCIP_OFFRAMP_IDL, offrampProgram.programId, provider)
  const payerAddress = provider.wallet.publicKey

  let bufferId
  if (opts?.forceBuffer) {
    // Use messageId for bufferId. This is arbitrary, but easy to track.
    bufferId = bytesToBuffer(execReport.message.header.messageId)
  }

  const {
    executionReport: preparedReport,
    tokenIndexes,
    accounts,
    addressLookupTables,
  } = await getManuallyExecuteInputs({
    execReport,
    offrampProgram,
    transmitter: payerAddress.toBase58(),
    bufferId,
  })

  const addressLookupTableAccounts = await Promise.all(
    addressLookupTables.map(async (acc) => {
      const lookupTableAccountInfo = await provider.connection.getAddressLookupTable(acc)

      if (!lookupTableAccountInfo.value) {
        throw new Error(`Lookup table account not found: ${acc.toBase58()}`)
      }

      return lookupTableAccountInfo.value
    }),
  )

  let serializedReport = offrampProgram.coder.types.encode(
    'ExecutionReportSingleChain',
    preparedReport,
  )

  const { blockhash: recentBlockhash } = await provider.connection.getLatestBlockhash()

  let alt
  if (opts?.forceLookupTable) {
    alt = await buildLookupTableTxs(provider, accounts)
    addressLookupTableAccounts.push(alt.addressLookupTableAccount)
  }

  const transactions: ExecStepTx[] = []
  if (bufferId) {
    console.log(`Execute report will be pre-buffered through the offramp. This may take some time.`)
    transactions.push(
      ...(await bufferedTransactionData(
        offrampProgram,
        serializedReport,
        recentBlockhash,
        bufferId,
        opts,
      )),
    )
    serializedReport = Buffer.from([]) // clear 1st param to manuallyExecute method if buffered
  }

  const execTx = await offrampProgram.methods
    .manuallyExecute(serializedReport, tokenIndexes)
    .accounts({
      config: accounts[0].pubkey,
      referenceAddresses: accounts[1].pubkey,
      sourceChain: accounts[2].pubkey,
      commitReport: accounts[3].pubkey,
      offramp: accounts[4].pubkey,
      allowedOfframp: accounts[5].pubkey,
      authority: accounts[6].pubkey,
      systemProgram: accounts[7].pubkey,
      sysvarInstructions: accounts[8].pubkey,
      rmnRemote: accounts[9].pubkey,
      rmnRemoteCurses: accounts[10].pubkey,
      rmnRemoteConfig: accounts[11].pubkey,
    })
    .remainingAccounts(accounts.slice(12))
    .transaction()

  computeUnitsOverride ||= Math.ceil(
    1.1 *
      (await simulateUnitsConsumed({
        instructions: execTx.instructions,
        connection: provider.connection,
        payerKey: provider.wallet.publicKey,
        addressLookupTableAccounts,
        computeUnitsOverride,
      })),
  )

  // Add compute budget instruction at the beginning of instructions
  execTx.instructions.unshift(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnitsOverride,
    }),
  )

  // actual exec tx
  transactions.push([
    'exec',
    toVersionedTransaction(
      execTx.instructions,
      provider.wallet.publicKey,
      recentBlockhash,
      addressLookupTableAccounts,
    ),
  ])

  if (alt) {
    transactions.unshift(...alt.initialTxs)
    transactions.push(...alt.finalTxs)
  }

  return transactions
}

async function buildLookupTableTxs(
  provider: AnchorProvider,
  accounts: readonly AccountMeta[],
): Promise<ExecAlt> {
  const recentSlot = await provider.connection.getSlot('finalized')

  const [createIx, altAddr] = AddressLookupTableProgram.createLookupTable({
    authority: provider.wallet.publicKey,
    payer: provider.wallet.publicKey,
    recentSlot,
  })
  console.log('Using Address Lookup Table', altAddr.toBase58())

  const addresses = accounts.map((a) => a.pubkey)

  if (addresses.length > 256) {
    throw new Error(
      `The number of addresses (${addresses.length}) exceeds the maximum limit imposed by Solana of 256 for Address Lookup Tables`,
    )
  }

  // 1232 bytes is the max size of a transaction, 32 bytes used for each address.
  // 1232 / 32 ~= 38.5
  const firstChunkLength = 28
  const maxAddressesPerTx = 35
  const extendIxs: TransactionInstruction[] = []
  const ranges: [number, number][] = []
  for (
    let [start, end] = [0, firstChunkLength];
    start < addresses.length;
    [start, end] = [end, end + maxAddressesPerTx]
  ) {
    const addressesChunk = addresses.slice(start, end)
    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: provider.wallet.publicKey,
      authority: provider.wallet.publicKey,
      lookupTable: altAddr,
      addresses: addressesChunk,
    })
    extendIxs.push(extendIx)
    ranges.push([start, start + addressesChunk.length - 1])
  }

  const deactivateIx = AddressLookupTableProgram.deactivateLookupTable({
    lookupTable: altAddr,
    authority: provider.wallet.publicKey,
  })

  // disable closeTx, to be cleaned in SolanaChain.cleanUpBuffers
  // const closeIx = AddressLookupTableProgram.closeLookupTable({
  //   authority: provider.wallet.publicKey,
  //   recipient: provider.wallet.publicKey,
  //   lookupTable: altAddr,
  // })

  const { blockhash: recentBlockhash } = await provider.connection.getLatestBlockhash()

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
    initialTxs: [
      // first extendIx fits in create tx
      [
        `lookup[create + 0..${ranges[0][1]}]`,
        toVersionedTransaction(
          [createIx, extendIxs[0]],
          provider.wallet.publicKey,
          recentBlockhash,
        ),
      ],
      ...extendIxs
        .slice(1)
        .map<ExecStepTx>((ix, i) => [
          `lookup[${ranges[i + 1][0]}..${ranges[i + 1][1]}]`,
          toVersionedTransaction([ix], provider.wallet.publicKey, recentBlockhash),
        ]),
    ],
    finalTxs: [
      [
        `lookup[deactivate]`,
        toVersionedTransaction([deactivateIx], provider.wallet.publicKey, recentBlockhash),
      ],
    ],
  }
}

async function bufferedTransactionData(
  offrampProgram: Program<typeof CCIP_OFFRAMP_IDL>,
  serializedReport: Buffer,
  recentBlockhash: string,
  bufferId: Buffer,
  opts?: { clearBufferFirst?: boolean },
): Promise<ExecStepTx[]> {
  const provider = offrampProgram.provider as AnchorProvider

  const [bufferAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('execution_report_buffer'), bufferId, provider.wallet.publicKey.toBuffer()],
    offrampProgram.programId,
  )

  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    offrampProgram.programId,
  )

  console.log(
    `The bufferID is ${hexlify(bufferId)}, and the PDA address for the buffer is ${bufferAddress.toString()}\nIf this buffering process is aborted, remember to cleanUp the account to recover locked rent.`,
  )

  const chunkSize = 800
  const bufferedExecTxs: ExecStepTx[] = []

  const bufferingAccounts = {
    executionReportBuffer: bufferAddress,
    config: configPDA,
    authority: provider.wallet.publicKey,
    systemProgram: SystemProgram.programId,
  }

  if (opts?.clearBufferFirst) {
    const clearTx = await offrampProgram.methods
      .closeExecutionReportBuffer(bufferId)
      .accounts(bufferingAccounts)
      .transaction()

    bufferedExecTxs.push([
      'buffering[clear]',
      toVersionedTransaction(clearTx, provider.wallet.publicKey, recentBlockhash),
    ])
  }

  const numChunks = Math.ceil(serializedReport.length / chunkSize)
  for (let i = 0; i < serializedReport.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, serializedReport.length)
    const chunk: Buffer = serializedReport.subarray(i, end)

    const appendTx = await offrampProgram.methods
      .bufferExecutionReport(bufferId, serializedReport.length, chunk, i / chunkSize, numChunks)
      .accounts(bufferingAccounts)
      .transaction()
    bufferedExecTxs.push([
      `buffering[${i / chunkSize}=${end - i}B]`,
      toVersionedTransaction(appendTx, provider.wallet.publicKey, recentBlockhash),
    ])
  }

  return bufferedExecTxs
}

function toVersionedTransaction(
  input: Transaction | TransactionInstruction[],
  payerKey: PublicKey,
  recentBlockhash: string,
  addressLookupTableAccounts?: AddressLookupTableAccount[],
): VersionedTransaction {
  const instructions: TransactionInstruction[] = Array.isArray(input) ? input : input.instructions

  const message = new TransactionMessage({ payerKey, recentBlockhash, instructions })
  return new VersionedTransaction(message.compileToV0Message(addressLookupTableAccounts))
}

const simulateUnitsConsumed = async ({
  instructions,
  connection,
  payerKey,
  addressLookupTableAccounts = [],
  computeUnitsOverride,
}: {
  instructions: TransactionInstruction[]
  connection: Connection
  payerKey: PublicKey
  addressLookupTableAccounts?: AddressLookupTableAccount[]
  computeUnitsOverride?: number
}): Promise<number> => {
  try {
    // Add max compute units for simulation
    const maxComputeUnits = 1_400_000
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnitsOverride || maxComputeUnits,
    })

    // Create message with compute budget instruction
    const message = new TransactionMessage({
      payerKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [computeBudgetIx, ...instructions],
    })

    const messageV0 = message.compileToV0Message(addressLookupTableAccounts)
    const simulationTx = new VersionedTransaction(messageV0)

    const config: SimulateTransactionConfig = {
      commitment: 'confirmed',
      replaceRecentBlockhash: true,
      sigVerify: false,
    }

    const simulation = await connection.simulateTransaction(simulationTx, config)

    console.info('Simulation results:', {
      logs: simulation.value.logs,
      unitsConsumed: simulation.value.unitsConsumed,
      returnData: simulation.value.returnData,
      err: simulation.value.err,
    })

    if (simulation.value.err) {
      throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`)
    }

    return simulation.value.unitsConsumed || 0
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Transaction simulation error: ${error.message}`)
    }

    throw new Error('Transaction simulation error: Unknown error occurred')
  }
}
