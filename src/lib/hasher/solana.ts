import { encodeBase58, keccak256 } from 'ethers'
import {
  type CCIPMessage,
  type CCIPVersion,
  type SVMExtraArgsV1,
  encodeExtraArgs,
  parseExtraArgs,
} from '../types.ts'
import { bigintToLeBytes } from '../utils.ts'
import type { LeafHasher } from './common.ts'

type CCIPExecutionReportV1_6 = {
  sourceChainSelector: bigint
  message: CCIPMessage<typeof CCIPVersion.V1_6>
  offchainTokenData: Uint8Array[]
  proofs: Uint8Array[]
}

function serializeRampMessage(message: CCIPMessage<typeof CCIPVersion.V1_6>): Buffer {
  const buffers: Buffer[] = []

  // Write header
  const headerBuffer = serializeHeader(message.header)
  buffers.push(headerBuffer)

  // Write sender length + data
  const senderSizeBuffer = Buffer.alloc(2)
  senderSizeBuffer.writeUInt16BE(message.sender.length)
  buffers.push(senderSizeBuffer)
  buffers.push(Buffer.from(message.sender))

  // Write data length + data
  const dataSizeBuffer = Buffer.alloc(2)
  const data = Buffer.from(message.data.replace('0x', ''), 'base64')
  dataSizeBuffer.writeUInt16BE(data.length)
  buffers.push(dataSizeBuffer)
  buffers.push(data)

  // Write receiver
  buffers.push(Buffer.from(message.receiver))

  // Write token amounts
  const tokenAmountsBuffer = serializeTokenAmounts(message.tokenAmounts)
  buffers.push(tokenAmountsBuffer)

  const extraArgs = parseExtraArgs(message.extraArgs)
  const extraArgsBuffer = Buffer.from(message.extraArgs.replace('0x', ''), 'hex')
  buffers.push(extraArgsBuffer)

  console.debug('serializeRampMessage', {
    buffers,
    extraArgsBuffer,
    extraArgs,
    message,
    headerBuffer,
    senderSizeBuffer,
    dataSizeBuffer,
    tokenAmountsBuffer,
  })

  return Buffer.concat(buffers)
}

function serializeHeader(header: CCIPMessage<typeof CCIPVersion.V1_6>['header']): Buffer {
  const buffer = Buffer.alloc(32 + 8 * 4) // 32 bytes for message_id + 8 bytes each for 4 u64 values
  Buffer.from(header.messageId.replace('0x', ''), 'hex').copy(buffer, 0)
  bigintToLeBytes(header.sourceChainSelector, 8).copy(buffer, 32)
  bigintToLeBytes(header.destChainSelector, 8).copy(buffer, 40)
  bigintToLeBytes(header.sequenceNumber, 8).copy(buffer, 48)
  bigintToLeBytes(header.nonce, 8).copy(buffer, 56)
  return buffer
}

function serializeTokenAmounts(
  tokenAmounts: CCIPMessage<typeof CCIPVersion.V1_6>['tokenAmounts'],
): Buffer {
  const buffers: Buffer[] = []

  // Write array length
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32LE(tokenAmounts.length)
  buffers.push(lengthBuffer)

  // Write each token amount
  for (const token of tokenAmounts) {
    // Write source pool address length + data
    const sourcePoolAddressLen = Buffer.alloc(4)
    const sourcePoolAddress = Buffer.from(token.sourcePoolAddress.replace('0x', ''), 'hex')
    sourcePoolAddressLen.writeUInt32LE(sourcePoolAddress.length)
    buffers.push(sourcePoolAddressLen)
    buffers.push(sourcePoolAddress)

    // Write dest token address
    buffers.push(Buffer.from(token.destTokenAddress))

    // Write dest gas amount
    const destGasAmountBuffer = Buffer.alloc(4)
    destGasAmountBuffer.writeUInt32LE(Number(token.destGasAmount))
    buffers.push(destGasAmountBuffer)

    // Write extra data length + data
    const extraDataLen = Buffer.alloc(4)
    const extraData = Buffer.from(token.extraData, 'base64')
    extraDataLen.writeUInt32LE(extraData.length)
    buffers.push(extraDataLen)
    buffers.push(extraData)

    // Write dest exec data
    const destExecData = Buffer.from(token.destExecData, 'base64')
    buffers.push(destExecData)

    // Write amount
    buffers.push(bigintToLeBytes(token.amount, 32))
  }

  return Buffer.concat(buffers)
}

function encodeCCIPExecutionReportV1_6(report: CCIPExecutionReportV1_6): Buffer {
  const buffers: Buffer[] = []

  // Write source chain selector
  const sourceChainBuffer = bigintToLeBytes(report.sourceChainSelector, 8)
  buffers.push(sourceChainBuffer)

  // Write message
  const messageBuffer = serializeRampMessage(report.message)
  buffers.push(messageBuffer)

  // Write offchain token data length
  const tokenDataLengthBuffer = Buffer.alloc(4)
  tokenDataLengthBuffer.writeUInt32LE(report.offchainTokenData.length)
  buffers.push(tokenDataLengthBuffer)

  // Write offchain token data
  for (const tokenData of report.offchainTokenData) {
    buffers.push(Buffer.from(tokenData))
  }

  // Write proofs length
  const proofsLengthBuffer = Buffer.alloc(4)
  proofsLengthBuffer.writeUInt32LE(report.proofs.length)
  buffers.push(proofsLengthBuffer)

  // Write proofs
  for (const proof of report.proofs) {
    buffers.push(Buffer.from(proof))
  }

  return Buffer.concat(buffers)
}

function hashAnyToSVMMessage(
  message: CCIPMessage<typeof CCIPVersion.V1_6>,
  onRamp: string,
  msgAccounts: Uint8Array[] = [],
): Buffer {
  const buffers: Buffer[] = []

  // Write domain separator
  const domainSeparator = Buffer.alloc(32, 0)
  buffers.push(domainSeparator)

  // Write message type
  const messageType = Buffer.from('Any2SVMMessageHashV1')
  buffers.push(messageType)

  // Write source chain selector
  const sourceChainBuffer = bigintToLeBytes(message.header.sourceChainSelector, 8)
  buffers.push(sourceChainBuffer)

  // Write dest chain selector
  const destChainBuffer = bigintToLeBytes(message.header.destChainSelector, 8)
  buffers.push(destChainBuffer)

  // Write onRamp size and data
  const onRampData = Buffer.from(onRamp)
  const onRampSizeBuffer = Buffer.alloc(2)
  onRampSizeBuffer.writeUInt16BE(onRampData.length)
  buffers.push(onRampSizeBuffer)
  buffers.push(onRampData)

  // Write message ID
  const messageId = Buffer.from(message.header.messageId.replace('0x', ''), 'hex')
  buffers.push(messageId)

  // Write receiver
  const receiver = Buffer.from(message.receiver)
  buffers.push(receiver)

  // Write sequence number
  const seqBuffer = bigintToLeBytes(message.header.sequenceNumber, 8)
  buffers.push(seqBuffer)

  // Write extra args
  const extraArgs = parseExtraArgs(message.extraArgs)
  const svmExtraArgs = extraArgs as SVMExtraArgsV1
  const extraArgsBuffer = encodeExtraArgs({
    computeUnits: svmExtraArgs.computeUnits,
    isWritableBitmap: svmExtraArgs.isWritableBitmap,
    tokenReceiver: svmExtraArgs.tokenReceiver,
    accounts: svmExtraArgs.accounts,
  })
  buffers.push(Buffer.from(extraArgsBuffer.replace('0x', ''), 'hex'))

  // Write nonce
  const nonceBuffer = bigintToLeBytes(message.header.nonce, 8)
  buffers.push(nonceBuffer)

  // Write sender
  const sender = Buffer.from(message.sender)
  buffers.push(sender)

  // Write data
  const data = Buffer.from(message.data.replace('0x', ''), 'base64')
  buffers.push(data)

  // Write token amounts
  const tokenAmountsBuffer = serializeTokenAmounts(message.tokenAmounts)
  buffers.push(tokenAmountsBuffer)

  // Write accounts
  const accountsBuffer = Buffer.alloc(4)
  accountsBuffer.writeUInt32LE(msgAccounts.length)
  buffers.push(accountsBuffer)
  for (const account of msgAccounts) {
    buffers.push(Buffer.from(account))
  }

  return Buffer.concat(buffers)
}

export const getV16SolanaLeafHasher =
  (
    sourceChainSelector: bigint,
    destChainSelector: bigint,
    onRamp: string,
  ): LeafHasher<typeof CCIPVersion.V1_6> =>
  (message: CCIPMessage<typeof CCIPVersion.V1_6>): string => {
    // Debug logging for encoded fields
    console.debug('Exact Bytes in Hex Format:')
    console.debug('MessageID:', message.header.messageId)
    console.debug('SourceChainSelector:', sourceChainSelector.toString())
    console.debug('DestChainSelector:', destChainSelector.toString())
    console.debug('SequenceNumber:', message.header.sequenceNumber.toString())
    console.debug('Nonce:', message.header.nonce.toString())
    console.debug('OnRamp:', onRamp)
    console.debug('Sender:', message.sender)
    console.debug('Receiver:', message.receiver)
    console.debug('Data:', message.data)

    if (message.tokenAmounts.length > 0) {
      console.debug(
        'TokenAmounts[0].Amount:',
        message.tokenAmounts[0].amount.toString(16).padStart(64, '0'),
      )
      console.debug('TokenAmounts[0].DestTokenAddress:', message.tokenAmounts[0].destTokenAddress)
      console.debug('TokenAmounts[0].SourcePoolAddress:', message.tokenAmounts[0].sourcePoolAddress)
      console.debug('TokenAmounts[0].DestExecData:', message.tokenAmounts[0].destExecData)
      console.debug('TokenAmounts[0].ExtraData:', message.tokenAmounts[0].extraData)
    }

    console.debug('FeeToken:', message.feeToken)
    console.debug('FeeTokenAmount:', message.feeTokenAmount.toString(16).padStart(12, '0'))
    console.debug('ExtraArgs:', message.extraArgs)

    return hashSolanaMessage(
      message,
      hashSolanaMetadata(message, sourceChainSelector, destChainSelector, onRamp),
    )
  }

export const hashSolanaMessage = (
  message: CCIPMessage<typeof CCIPVersion.V1_6>,
  metadataHash: string,
): string => {
  const report = {
    sourceChainSelector: BigInt(message.header.sourceChainSelector.toString()),
    message,
    offchainTokenData: [],
    proofs: [],
  }

  const encodedReport = encodeCCIPExecutionReportV1_6(report)
  const combined = Buffer.concat([Buffer.from(metadataHash, 'hex'), encodedReport])
  console.debug('v1.6 hashSolanaMessage:', {
    messageId: message.header.messageId,
    report,
    combined,
  })
  return keccak256(combined)
}

export const hashSolanaMetadata = (
  message: CCIPMessage<typeof CCIPVersion.V1_6>,
  sourceChainSelector: bigint,
  destChainSelector: bigint,
  onRamp: string,
): string => {
  const header = {
    messageId: message.header.messageId,
    sourceChainSelector: BigInt(sourceChainSelector.toString()),
    destChainSelector: BigInt(destChainSelector.toString()),
    sequenceNumber: BigInt(message.header.sequenceNumber.toString()),
    nonce: BigInt(message.header.nonce.toString()),
  }

  const rampMessage: CCIPMessage<typeof CCIPVersion.V1_6> = {
    header,
    sender: message.sender,
    data: message.data,
    receiver: message.receiver,
    extraArgs: message.extraArgs,
    feeToken: message.feeToken,
    feeTokenAmount: message.feeTokenAmount,
    feeValueJuels: message.feeValueJuels,
    tokenAmounts: message.tokenAmounts,
    gasLimit: message.gasLimit,
  }

  // Parse extraArgs to get accounts
  const extraArgs = parseExtraArgs(message.extraArgs)
  if (!extraArgs || extraArgs._tag !== 'SVMExtraArgsV1') {
    throw new Error('Invalid extraArgs format for Solana message')
  }

  const svmExtraArgs = extraArgs as SVMExtraArgsV1
  const accounts = svmExtraArgs.accounts || []
  const accountBuffers = accounts.map((account) => Buffer.from(account.replace('0x', ''), 'hex'))
  return hashAnyToSVMMessage(rampMessage, onRamp, accountBuffers).toString('hex')
}
