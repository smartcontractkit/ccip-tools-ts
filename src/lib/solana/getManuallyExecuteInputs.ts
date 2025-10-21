import type { IdlTypes, Program } from '@coral-xyz/anchor'
import { type AccountMeta, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import type { ExecutionReport } from '../types.ts'
import { getDataBytes, toLeArray } from '../utils.ts'
import { encodeSolanaOffchainTokenData } from './offchain.ts'
import type { IDL as CCIP_OFFRAMP_IDL } from './programs/1.6.0/CCIP_OFFRAMP.ts'
import type { CCIPMessage_V1_6_Solana } from './types.ts'
import { bytesToBuffer } from './utils.ts'

export async function getManuallyExecuteInputs({
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

    // Execute as a view call to get the response
    const response = (await offrampProgram.methods
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
