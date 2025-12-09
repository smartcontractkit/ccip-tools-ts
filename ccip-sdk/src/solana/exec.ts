import { type AnchorProvider, type IdlTypes, Program } from '@coral-xyz/anchor'
import {
  type AccountMeta,
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
import BN from 'bn.js'
import { hexlify } from 'ethers'

import type { ChainTransaction, ExecutionReport } from '../types.ts'
import { IDL as CCIP_OFFRAMP_IDL } from './idl/1.6.0/CCIP_OFFRAMP.ts'
import { encodeSolanaOffchainTokenData } from './offchain.ts'
import type { CCIPMessage_V1_6_Solana } from './types.ts'
import { bytesToBuffer, getDataBytes, sleep, toLeArray } from '../utils.ts'
import { simulateTransaction, simulationProvider } from './utils.ts'

type ExecStepTx = readonly [reason: string, transactions: VersionedTransaction]

type ExecAlt = {
  addressLookupTableAccount: AddressLookupTableAccount
  initialTxs: ExecStepTx[]
  finalTxs: ExecStepTx[]
}

/**
 * Executes a CCIP execution report on Solana.
 * @param params - Execution parameters including offramp program and report.
 * @returns Transaction hash of the execution.
 */
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
  clearLeftoverAccounts?: boolean
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
  opts?: { forceLookupTable?: boolean; forceBuffer?: boolean; clearLeftoverAccounts?: boolean },
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
      ((
        await simulateTransaction({
          instructions: execTx.instructions,
          connection: provider.connection,
          payerKey: provider.wallet.publicKey,
          addressLookupTableAccounts,
          computeUnitsOverride,
        })
      ).unitsConsumed || 0),
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
  opts?: { clearLeftoverAccounts?: boolean },
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

  if (opts?.clearLeftoverAccounts) {
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

async function getManuallyExecuteInputs({
  execReport,
  offrampProgram,
  transmitter,
  bufferId,
}: {
  execReport: ExecutionReport<CCIPMessage_V1_6_Solana>
  offrampProgram: Program<typeof CCIP_OFFRAMP_IDL>
  transmitter: string
  bufferId?: Buffer
}) {
  const executionReport = prepareExecutionReport(execReport)

  const messageAccountMetas = execReport.message.accounts.map((acc, index) => {
    const bitmap = BigInt(execReport.message.accountIsWritableBitmap)
    const isWritable = (bitmap & (1n << BigInt(index))) !== 0n

    return {
      pubkey: new PublicKey(acc),
      isSigner: false,
      isWritable,
    }
  })

  // Convert message.receiver to AccountMeta and prepend to messaging accounts
  const receiverAccountMeta = {
    pubkey: new PublicKey(execReport.message.receiver),
    isSigner: false,
    isWritable: false,
  }

  console.debug('Message receiver:', execReport.message.receiver)

  // Prepend receiver to messaging accounts
  const messagingAccounts: AccountMeta[] =
    execReport.message.receiver !== PublicKey.default.toBase58()
      ? [receiverAccountMeta, ...messageAccountMetas]
      : [] // on plain token transfers, there are no messaging accounts
  const tokenTransferAndOffchainData: IdlTypes<
    typeof CCIP_OFFRAMP_IDL
  >['TokenTransferAndOffchainData'][] = execReport.message.tokenAmounts.map((ta, idx) => ({
    data: bytesToBuffer(encodeSolanaOffchainTokenData(execReport.offchainTokenData[idx])),
    transfer: {
      sourcePoolAddress: bytesToBuffer(ta.sourcePoolAddress),
      destTokenAddress: new PublicKey(ta.destTokenAddress),
      destGasAmount: Number(ta.destGasAmount),
      extraData: bytesToBuffer(ta.extraData || '0x'),
      amount: {
        leBytes: Array.from(toLeArray(ta.amount, 32)),
      },
    },
  }))

  const {
    accounts,
    addressLookupTableAccounts: addressLookupTables,
    tokenIndexes,
  } = await autoDeriveExecutionAccounts({
    offrampProgram,
    originalSender: bytesToBuffer(execReport.message.sender),
    transmitter: new PublicKey(transmitter),
    messagingAccounts,
    sourceChainSelector: execReport.message.header.sourceChainSelector,
    tokenTransferAndOffchainData,
    merkleRoot: bytesToBuffer(execReport.merkleRoot),
    bufferId,
    tokenReceiver: new PublicKey(execReport.message.tokenReceiver),
  })

  return {
    executionReport,
    tokenIndexes,
    accounts,
    addressLookupTables,
  }
}

function prepareExecutionReport({
  message,
  offchainTokenData,
  proofs,
}: ExecutionReport<CCIPMessage_V1_6_Solana>): IdlTypes<
  typeof CCIP_OFFRAMP_IDL
>['ExecutionReportSingleChain'] {
  return {
    sourceChainSelector: new BN(message.header.sourceChainSelector.toString()),
    message: {
      header: {
        messageId: Array.from(getDataBytes(message.header.messageId)),
        sourceChainSelector: new BN(message.header.sourceChainSelector),
        destChainSelector: new BN(message.header.destChainSelector),
        sequenceNumber: new BN(message.header.sequenceNumber),
        nonce: new BN(message.header.nonce),
      },
      sender: bytesToBuffer(message.sender),
      data: bytesToBuffer(message.data),
      tokenReceiver: new PublicKey(message.tokenReceiver),
      tokenAmounts: message.tokenAmounts.map((token) => ({
        sourcePoolAddress: bytesToBuffer(token.sourcePoolAddress),
        destTokenAddress: new PublicKey(token.destTokenAddress),
        destGasAmount: Number(token.destGasAmount),
        extraData: bytesToBuffer(token.extraData),
        amount: {
          leBytes: Array.from(toLeArray(token.amount, 32)),
        },
      })),
      extraArgs: {
        computeUnits: Number(message.computeUnits),
        isWritableBitmap: new BN(message.accountIsWritableBitmap),
      },
    },
    offchainTokenData: offchainTokenData.map((d) =>
      bytesToBuffer(encodeSolanaOffchainTokenData(d)),
    ),
    proofs: proofs.map((p) => Array.from(getDataBytes(p))),
  }
}

async function autoDeriveExecutionAccounts({
  offrampProgram,
  originalSender,
  transmitter,
  messagingAccounts,
  sourceChainSelector,
  tokenTransferAndOffchainData,
  merkleRoot,
  tokenReceiver,
  bufferId,
}: {
  offrampProgram: Program<typeof CCIP_OFFRAMP_IDL>
  originalSender: Buffer
  transmitter: PublicKey
  messagingAccounts: IdlTypes<typeof CCIP_OFFRAMP_IDL>['CcipAccountMeta'][]
  sourceChainSelector: bigint
  tokenTransferAndOffchainData: Array<
    IdlTypes<typeof CCIP_OFFRAMP_IDL>['TokenTransferAndOffchainData']
  >
  merkleRoot: Buffer
  tokenReceiver: PublicKey
  bufferId?: Buffer
}) {
  const derivedAccounts: AccountMeta[] = []
  const lookupTables: PublicKey[] = []
  const tokenIndices: number[] = []
  let askWith: AccountMeta[] = []
  let stage = 'Start'
  let tokenIndex = 0

  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    offrampProgram.programId,
  )

  while (true) {
    const params: IdlTypes<typeof CCIP_OFFRAMP_IDL>['DeriveAccountsExecuteParams'] = {
      executeCaller: transmitter,
      messageAccounts: messagingAccounts,
      sourceChainSelector: new BN(sourceChainSelector.toString()),
      originalSender: originalSender,
      tokenTransfers: tokenTransferAndOffchainData,
      merkleRoot: Array.from(merkleRoot),
      bufferId: bufferId ?? Buffer.from([]),
      tokenReceiver,
    }

    // Workarounds for tx-too-large issues during account derivation
    if (/BuildDynamicAccounts/.test(stage)) {
      params.messageAccounts = [] // omit messaging accounts
    } else {
      params.tokenTransfers = tokenTransferAndOffchainData.map((tt) => ({
        ...tt,
        data: Buffer.from([]), // omit offchain token data
      }))
    }

    // copy of Program which avoids signing every simulation
    const readOnlyProgram = new Program(
      offrampProgram.idl,
      offrampProgram.programId,
      simulationProvider(offrampProgram.provider.connection, transmitter),
    )
    // Execute as a view call to get the response
    const response = (await readOnlyProgram.methods
      .deriveAccountsExecute(params, stage)
      .accounts({
        config: configPDA,
      })
      .remainingAccounts(askWith)
      .view()
      .catch((error: unknown) => {
        console.error('Error deriving accounts:', error)
        console.error('Params:', params)
        throw error as Error
      })) as IdlTypes<typeof CCIP_OFFRAMP_IDL>['DeriveAccountsResponse']

    // Check if we're at the start of a token transfer
    const isStartOfToken = /^TokenTransferStaticAccounts\/\d+\/0$/.test(response.currentStage)
    if (isStartOfToken) {
      const numKnownAccounts = 12
      tokenIndices.push(tokenIndex - numKnownAccounts)
    }

    // Update token index
    tokenIndex += response.accountsToSave.length

    console.debug('After stage', stage, 'tokenIndices', tokenIndices, 'nextTokenIndex', tokenIndex)

    // Collect the derived accounts
    for (const meta of response.accountsToSave) {
      derivedAccounts.push({
        pubkey: meta.pubkey,
        isWritable: meta.isWritable,
        isSigner: meta.isSigner,
      })
    }

    // Prepare askWith for next iteration
    askWith = response.askAgainWith.map((meta) => ({
      pubkey: meta.pubkey,
      isWritable: meta.isWritable,
      isSigner: meta.isSigner,
    }))

    // Collect lookup tables
    lookupTables.push(...response.lookUpTablesToSave)

    // Check if derivation is complete
    if (!response.nextStage || response.nextStage.length === 0) {
      break
    }

    stage = response.nextStage
  }

  console.debug('Resulting derived accounts:', derivedAccounts)
  console.debug('Resulting derived address lookup tables:', lookupTables)
  console.debug('Resulting derived token indexes:', tokenIndices)

  return {
    accounts: derivedAccounts,
    addressLookupTableAccounts: lookupTables,
    tokenIndexes: Buffer.from(tokenIndices),
  }
}
