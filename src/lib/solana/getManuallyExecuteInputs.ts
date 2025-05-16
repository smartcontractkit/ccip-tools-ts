import type { Connection } from '@solana/web3.js'
import { PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js'
import type { ExecutionReport } from '../types.ts'
import type { OfframpProgram } from './programs/getCcipOfframp'
import { getAddressLookupTableAccount } from './getAddressLookupTableAccount'
import { deriveAccounts } from './deriveAccounts'
import { deriveTokenAccounts } from './deriveTokenAccounts'
import type { MessageWithAccounts } from './utils'
import { isMessageWithAccounts } from './utils'
import { BN } from 'bn.js'

function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64')
}

function hexToBuffer(hex: string): Buffer {
  const cleanHex = hex.replace('0x', '')
  // trim hex incorrectly formatted with leading zeros - should be fixed in ccip-tools-ts
  const trimmedHex = cleanHex.replace(/^0+/, '')
  const evenHex = trimmedHex.length % 2 === 0 ? trimmedHex : '0' + trimmedHex

  return Buffer.from(evenHex, 'hex')
}

export async function getManuallyExecuteInputs({
  executionReportRaw,
  connection,
  offrampProgram,
  root,
  senderAddress,
}: {
  executionReportRaw: ExecutionReport
  connection: Connection
  offrampProgram: OfframpProgram
  root: string
  senderAddress: string
}) {
  const offrampProgramPubkey = offrampProgram.programId
  const message = executionReportRaw.message

  const derivedAccounts = await deriveAccounts({
    connection,
    offrampProgramPubkey,
    sourceChainSelector: executionReportRaw.sourceChainSelector,
    root,
    receiver: message.receiver,
  })

  if (!isMessageWithAccounts(message)) {
    throw new Error('Invalid message')
  }

  const executionReport = getExecutionReport(executionReportRaw, message)

  const { accounts, remainingAccounts, addressLookupTableAccounts, tokenIndexes } =
    await getAccounts({
      derivedAccounts,
      offrampProgram,
      senderAddress,
      message,
      connection,
    })

  return {
    executionReport,
    tokenIndexes,
    accounts,
    remainingAccounts,
    addressLookupTableAccounts,
  }
}

function getExecutionReport(executionReportRaw: ExecutionReport, message: MessageWithAccounts) {
  return {
    sourceChainSelector: new BN(executionReportRaw.sourceChainSelector.toString()),
    message: {
      header: {
        messageId: hexToBuffer(message.header.messageId),
        sourceChainSelector: new BN(message.header.sourceChainSelector.toString()),
        destChainSelector: new BN(message.header.destChainSelector.toString()),
        sequenceNumber: new BN(message.header.sequenceNumber.toString()),
        nonce: new BN(message.header.nonce.toString()),
      },
      sender: hexToBuffer(message.sender),
      data: base64ToBuffer(message.data),
      tokenReceiver: new PublicKey(message.tokenReceiver as string),
      tokenAmounts: message.tokenAmounts.map((token) => ({
        sourcePoolAddress: hexToBuffer(token.sourcePoolAddress),
        destTokenAddress: new PublicKey(token.destTokenAddress),
        destGasAmount: new BN(token.destGasAmount?.toString() || '0'),
        extraData: base64ToBuffer(token.extraData || ''),
        amount: {
          leBytes: new BN(token.amount.toString()).toArrayLike(Buffer, 'le', 32),
        },
      })),
      extraArgs: {
        computeUnits: new BN(message.computeUnits?.toString() || '0'),
        isWritableBitmap: new BN(message.accountIsWritableBitmap?.toString() || '0'),
      },
    },
    offchainTokenData: executionReportRaw.offchainTokenData.map(hexToBuffer),
    proofs: executionReportRaw.proofs.map(hexToBuffer),
  }
}

async function getAccounts({
  derivedAccounts,
  offrampProgram,
  senderAddress,
  message,
  connection,
}: {
  derivedAccounts: Awaited<ReturnType<typeof deriveAccounts>>
  offrampProgram: OfframpProgram
  senderAddress: string
  message: MessageWithAccounts
  connection: Connection
}) {
  const accounts = {
    config: derivedAccounts.configPubKey,
    referenceAddresses: derivedAccounts.referenceAddressesPubKey,
    sourceChain: derivedAccounts.sourceChainPubKey,
    commitReport: derivedAccounts.commitReportPubKey,
    offramp: offrampProgram.programId,
    allowedOfframp: derivedAccounts.allowedOfframpPubKey,
    rmnRemote: derivedAccounts.rmnRemotePubKey,
    rmnRemoteCurses: derivedAccounts.rmnRemoteCursesPubKey,
    rmnRemoteConfig: derivedAccounts.rmnRemoteConfigPubKey,
    authority: new PublicKey(senderAddress),
    systemProgram: SystemProgram.programId,
    sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
  }

  const remainingAccountsDefault = [
    {
      pubkey: new PublicKey(message.receiver),
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: derivedAccounts.externalExecutionConfigPubKey,
      isWritable: false,
      isSigner: false,
    },
  ]

  const remainingAccounts =
    message.accounts?.reduce((acc, pubkey, index) => {
      const writableBitmap = new BN(message.accountIsWritableBitmap?.toString() || '0')
      return [
        ...acc,
        {
          pubkey: new PublicKey(pubkey),
          isWritable: writableBitmap.and(new BN(1).shln(index)).gt(new BN(0)),
          isSigner: false,
        },
      ]
    }, remainingAccountsDefault) ?? remainingAccountsDefault

  const {
    tokenAccounts,
    addressLookupTableAccounts: tokenPoolAddressLookupTableAccounts,
    tokenIndexes,
  } = await deriveTokenAccounts({
    connection,
    offrampProgram,
    routerProgramPubkey: derivedAccounts.router,
    feeQuoterPubkey: derivedAccounts.feeQuoter,
    message,
    remainingAccounts,
  })

  const remainingAccountsWithTokenAccounts = [...remainingAccounts, ...tokenAccounts]

  const offrampAddressLookupTableAccount = await getAddressLookupTableAccount({
    connection,
    lookupTablePubKey: derivedAccounts.offrampLookupTable,
  })

  const addressLookupTableAccounts = [
    ...tokenPoolAddressLookupTableAccounts,
    offrampAddressLookupTableAccount,
  ]

  return {
    accounts,
    remainingAccounts: remainingAccountsWithTokenAccounts,
    addressLookupTableAccounts,
    tokenIndexes,
  }
}
