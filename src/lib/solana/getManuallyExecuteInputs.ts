import {
  type AccountMeta,
  type Connection,
  PublicKey,
} from '@solana/web3.js'
import { BN } from 'bn.js'
import type { ExecutionReport } from '../types.ts'
import type { OfframpProgram } from './programs/getCcipOfframp.ts'
import { type MessageWithAccounts, isMessageWithAccounts } from './utils.ts'
import { CCIP_OFFRAMP_IDL } from './programs/1.6.0/CCIP_OFFRAMP.ts'
import type { IdlTypes } from '@coral-xyz/anchor'

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
  buffered
}: {
  executionReportRaw: ExecutionReport
  connection: Connection
  offrampProgram: OfframpProgram
  root: string
  senderAddress: string,
  buffered: boolean
}) {
  const message = executionReportRaw.message


  if (!isMessageWithAccounts(message)) {
    throw new Error('Invalid message')
  }

  const executionReport = getExecutionReport(executionReportRaw, message)

  // Convert message.receiver to AccountMeta and prepend to messaging accounts
  const receiverAccountMeta = {
    pubkey: new PublicKey(message.receiver),
    isSigner: false,
    isWritable: false,
  }
  
  const messageAccountMetas = message.accounts!.map((acc, index) => {
    const bitmap = BigInt(message.accountIsWritableBitmap?.toString() || '0')
    const isWritable = (bitmap & (1n << BigInt(index))) !== 0n
    
    return {
      pubkey: new PublicKey(acc),
      isSigner: false,
      isWritable,
    }
  })
  
  // Prepend receiver to messaging accounts
  const messagingAccounts = [receiverAccountMeta, ...messageAccountMetas]
  const tokenTransferAndOffchainData: Array<IdlTypes<typeof CCIP_OFFRAMP_IDL>['TokenTransferAndOffchainData']> = message.tokenAmounts.map((token, idx) => ({
      data: hexToBuffer(executionReportRaw.offchainTokenData[idx] || '0x'),
      transfer: {
      sourcePoolAddress: hexToBuffer(token.sourcePoolAddress),
      destTokenAddress: new PublicKey(token.destTokenAddress),
      destGasAmount: Number(token.destGasAmount),
      extraData: base64ToBuffer(token.extraData || ''),
      amount: {
        leBytes: Array.from(new BN(token.amount.toString()).toArrayLike(Buffer, 'le', 32)),
      },
    }
  }))
  
  let bufferId;
  if (buffered) {
  // Use merkleRoot for bufferId. This is arbitrary, but easy to track.
    bufferId = Buffer.from(root.replace(/^0x/, ''), 'hex')
  } else {
    bufferId = Buffer.alloc(32)
  }
  
  const originalSender = hexToBuffer(message.sender)
  const { accounts, addressLookupTableAccounts: addressLookupTables, tokenIndexes } =
    await autoDeriveExecutionAccounts({
      offrampProgram,
      originalSender,
      transmitter: new PublicKey(senderAddress),
      messagingAccounts,
      sourceChainSelector: executionReportRaw.sourceChainSelector,
      tokenTransferAndOffchainData,
      merkleRoot: hexToBuffer(root),
      bufferId,
      tokenReceiver: new PublicKey(message.tokenReceiver),
      connection,
    })

  return {
    executionReport,
    tokenIndexes,
    accounts,
    addressLookupTables,
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
      tokenReceiver: new PublicKey(message.tokenReceiver),
      tokenAmounts: message.tokenAmounts.map((token) => ({
        sourcePoolAddress: hexToBuffer(token.sourcePoolAddress),
        destTokenAddress: new PublicKey(token.destTokenAddress),
        destGasAmount: new BN(token.destGasAmount?.toString() || '0'),
        extraData: base64ToBuffer(token.extraData || ''),
        amount: {
          leBytes: Array.from(new BN(token.amount.toString()).toArrayLike(Buffer, 'le', 32)),
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

async function autoDeriveExecutionAccounts({
  offrampProgram,
  originalSender,
  transmitter,
  messagingAccounts,
  sourceChainSelector,
  tokenTransferAndOffchainData,
  merkleRoot,
  bufferId,
  tokenReceiver,
}: {
  offrampProgram: OfframpProgram
  originalSender: Buffer
  transmitter: PublicKey
  messagingAccounts: Array<IdlTypes<typeof CCIP_OFFRAMP_IDL>['CcipAccountMeta']>
  sourceChainSelector: bigint
  tokenTransferAndOffchainData: Array<IdlTypes<typeof CCIP_OFFRAMP_IDL>['TokenTransferAndOffchainData']>
  merkleRoot: Buffer
  bufferId: Buffer
  tokenReceiver: PublicKey
  connection: Connection
}) {
  const derivedAccounts: AccountMeta[] = []
  const lookupTables: PublicKey[] = []
  const tokenIndices: number[] = []
  let askWith: AccountMeta[] = []
  let stage = 'Start'
  let tokenIndex = 0
  const tokenTransferStartRegex = /^TokenTransferStaticAccounts\/\d+\/0$/
  
  const [configPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    offrampProgram.programId,
  )

  
  while (true) {
    let params = {
          executeCaller: transmitter,
          messageAccounts: messagingAccounts,
          sourceChainSelector: new BN(sourceChainSelector.toString()),
          originalSender: originalSender,
          tokenTransfers: tokenTransferAndOffchainData,
          merkleRoot: Array.from(merkleRoot),
          bufferId: bufferId,
          tokenReceiver,
      
    }
    
    // Execute as a view call to get the response
        const response: IdlTypes<typeof CCIP_OFFRAMP_IDL>['DeriveAccountsResponse'] = await offrampProgram.methods
      .deriveAccountsExecute(
          params,
          stage,
      )
      .accounts({
        config: configPDA,
      })
      .remainingAccounts(askWith)
      .view()

   
    // Check if we're at the start of a token transfer
    const isStartOfToken = tokenTransferStartRegex.test(response.currentStage)
    if (isStartOfToken) {
      const numKnownAccounts = 12
      tokenIndices.push(tokenIndex - numKnownAccounts)
    }
    
    // Update token index
    tokenIndex += response.accountsToSave.length
    
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
  
  return {
    accounts: derivedAccounts,
    addressLookupTableAccounts: lookupTables,
    tokenIndexes: Buffer.from(tokenIndices),
  }
}
