import { type AnchorProvider, type IdlTypes, Program } from '@coral-xyz/anchor'
import {
  type AccountMeta,
  type Connection,
  type TransactionInstruction,
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js'
import BN from 'bn.js'
import { hexlify } from 'ethers'

import type { ExecutionReport } from '../types.ts'
import { IDL as CCIP_OFFRAMP_IDL } from './idl/1.6.0/CCIP_OFFRAMP.ts'
import { encodeSolanaOffchainTokenData } from './offchain.ts'
import type { CCIPMessage_V1_6_Solana, UnsignedTx } from './types.ts'
import { getDataBytes, toLeArray } from '../utils.ts'
import { bytesToBuffer, simulationProvider } from './utils.ts'

type ExecAlt = {
  initialIxs: TransactionInstruction[]
  lookupTable: AddressLookupTableAccount
  finalIxs: TransactionInstruction[]
}

/**
 * Generate unsigned tx to execute a CCIP report on Solana.
 * @param connection - Connection to the Solana network.
 * @param payer - Payer of the transaction.
 * @param offramp - Address of the OffRamp contract.
 * @param execReport - Execution report.
 * @param opts - Options for txs to be generated
 *   - forceBuffer - Sends report in chunks for buffering in offRamp before execution
 *   - forceLookupTable - Creates lookup table for execution transaction, and deactivates in the end
 *   - clearLeftoverAccounts - Resets buffer before filling it in
 * @returns Transaction hash of the execution.
 */
export async function generateUnsignedExecuteReport(
  connection: Connection,
  payer: PublicKey,
  offramp: PublicKey,
  execReport: ExecutionReport<CCIPMessage_V1_6_Solana>,
  opts?: { forceLookupTable?: boolean; forceBuffer?: boolean; clearLeftoverAccounts?: boolean },
): Promise<UnsignedTx> {
  const program = new Program(CCIP_OFFRAMP_IDL, offramp, { connection })

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
    offrampProgram: program,
    transmitter: payer.toBase58(),
    bufferId,
  })

  const addressLookupTableAccounts = await Promise.all(
    addressLookupTables.map(async (acc) => {
      const lookupTableAccountInfo = await connection.getAddressLookupTable(acc)

      if (!lookupTableAccountInfo.value) {
        throw new Error(`Lookup table account not found: ${acc.toBase58()}`)
      }

      return lookupTableAccountInfo.value
    }),
  )

  let serializedReport = program.coder.types.encode('ExecutionReportSingleChain', preparedReport)

  let alt
  if (opts?.forceLookupTable) {
    alt = await buildLookupTableIxs(
      connection,
      payer,
      accounts.map((acc) => acc.pubkey),
    )
    addressLookupTableAccounts.push(alt.lookupTable)
  }

  const instructions: TransactionInstruction[] = []
  if (bufferId) {
    console.log(`Execute report will be pre-buffered through the offramp. This may take some time.`)
    instructions.push(...(await bufferedTransactionData(program, serializedReport, bufferId, opts)))
    serializedReport = Buffer.from([]) // clear 1st param to manuallyExecute method if buffered
  }

  const execIx = await program.methods
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
    .instruction()

  // actual exec tx
  let execIndex = instructions.length
  instructions.push(execIx)

  // "sandwich" instructions with ALT create+extend, then deactivate
  if (alt) {
    instructions.unshift(...alt.initialIxs)
    execIndex += alt.initialIxs.length
    instructions.push(...alt.finalIxs)
  }

  return {
    instructions,
    lookupTables: addressLookupTableAccounts,
    mainIndex: execIndex,
  }
}

async function buildLookupTableIxs(
  connection: Connection,
  authority: PublicKey,
  addresses: PublicKey[],
): Promise<ExecAlt> {
  const recentSlot = await connection.getSlot('confirmed')

  const [createIx, altAddr] = AddressLookupTableProgram.createLookupTable({
    authority,
    payer: authority,
    recentSlot,
  })
  console.log('Using Address Lookup Table', altAddr.toBase58())

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
  for (
    let [start, end] = [0, firstChunkLength];
    start < addresses.length;
    [start, end] = [end, end + maxAddressesPerTx]
  ) {
    const addressesChunk = addresses.slice(start, end)
    const extendIx = AddressLookupTableProgram.extendLookupTable({
      authority,
      payer: authority,
      lookupTable: altAddr,
      addresses: addressesChunk,
    })
    extendIxs.push(extendIx)
  }

  const deactivateIx = AddressLookupTableProgram.deactivateLookupTable({
    lookupTable: altAddr,
    authority,
  })

  // disable closeTx, to be cleaned in SolanaChain.cleanUpBuffers
  // const closeIx = AddressLookupTableProgram.closeLookupTable({
  //   authority: provider.wallet.publicKey,
  //   recipient: provider.wallet.publicKey,
  //   lookupTable: altAddr,
  // })

  return {
    lookupTable: new AddressLookupTableAccount({
      key: altAddr,
      state: {
        deactivationSlot: 2n ** 64n - 1n,
        lastExtendedSlot: recentSlot,
        lastExtendedSlotStartIndex: 0,
        addresses,
      },
    }),
    initialIxs: [createIx, ...extendIxs],
    finalIxs: [deactivateIx],
  }
}

async function bufferedTransactionData(
  offrampProgram: Program<typeof CCIP_OFFRAMP_IDL>,
  serializedReport: Buffer,
  bufferId: Buffer,
  opts?: { clearLeftoverAccounts?: boolean },
): Promise<TransactionInstruction[]> {
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
  const bufferedExecIxs: TransactionInstruction[] = []

  const bufferingAccounts = {
    executionReportBuffer: bufferAddress,
    config: configPDA,
    authority: provider.wallet.publicKey,
    systemProgram: SystemProgram.programId,
  }

  if (opts?.clearLeftoverAccounts) {
    bufferedExecIxs.push(
      await offrampProgram.methods
        .closeExecutionReportBuffer(bufferId)
        .accounts(bufferingAccounts)
        .instruction(),
    )
  }

  const numChunks = Math.ceil(serializedReport.length / chunkSize)
  for (let i = 0; i < serializedReport.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, serializedReport.length)
    const chunk: Buffer = serializedReport.subarray(i, end)

    bufferedExecIxs.push(
      await offrampProgram.methods
        .bufferExecutionReport(bufferId, serializedReport.length, chunk, i / chunkSize, numChunks)
        .accounts(bufferingAccounts)
        .instruction(),
    )
  }

  return bufferedExecIxs
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
