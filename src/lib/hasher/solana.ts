import { keccak256 } from 'ethers'
import {
  type CCIPMessage,
  type CCIPVersion,
  type SVMExtraArgsV1,
  parseExtraArgs,
} from '../types.ts'
import { bigintToBeBytes, decodeBase58 } from '../utils.ts'
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
  senderSizeBuffer.writeUInt16BE(message.sender.replace('0x', '').length / 2)
  buffers.push(senderSizeBuffer)
  buffers.push(Buffer.from(message.sender.replace('0x', ''), 'hex'))

  // Write data length + data
  const data = Buffer.from(message.data.replace('0x', ''), 'base64')
  const dataSizeBuffer = Buffer.alloc(2)
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

export function serializeHeader(header: CCIPMessage<typeof CCIPVersion.V1_6>['header']): Buffer {
  const buffers: Buffer[] = []
  const nonceSizeBuffer = Buffer.alloc(2)
  nonceSizeBuffer.writeUInt16BE(8)
  buffers.push(nonceSizeBuffer)
  buffers.push(bigintToBeBytes(header.nonce, 8))
  buffers.push(bigintToBeBytes(header.sourceChainSelector, 8))
  buffers.push(bigintToBeBytes(header.destChainSelector, 8))
  return Buffer.concat(buffers)
}

function serializeTokenAmounts(
  tokenAmounts: CCIPMessage<typeof CCIPVersion.V1_6>['tokenAmounts'],
): Buffer {
  const buffers: Buffer[] = []

  // Write array length
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32BE(tokenAmounts.length)
  buffers.push(lengthBuffer)

  // Write each token amount
  for (const token of tokenAmounts) {
    // Write source pool address length + data
    const sourcePoolAddressLen = Buffer.alloc(4)
    const sourcePoolAddress = Buffer.from(token.sourcePoolAddress.replace('0x', ''), 'hex')
    sourcePoolAddressLen.writeUInt32BE(sourcePoolAddress.length)
    buffers.push(sourcePoolAddressLen)
    buffers.push(sourcePoolAddress)

    // Write dest token address
    const destTokenAddressBytes = decodeBase58(token.destTokenAddress)
    buffers.push(Buffer.from(destTokenAddressBytes))

    // Write dest gas amount
    const destGasAmountBuffer = Buffer.alloc(4)
    destGasAmountBuffer.writeUInt32BE(Number(token.destGasAmount))
    buffers.push(destGasAmountBuffer)

    // Write extra data length + data
    const extraDataLen = Buffer.alloc(4)
    const extraData = Buffer.from(token.extraData, 'base64')
    extraDataLen.writeUInt32BE(extraData.length)
    buffers.push(extraDataLen)
    buffers.push(extraData)

    // Write dest exec data
    const destExecData = Buffer.from(token.destExecData, 'base64')
    buffers.push(destExecData)

    // Write amount
    buffers.push(bigintToBeBytes(token.amount, 32))
  }

  return Buffer.concat(buffers)
}

function encodeCCIPExecutionReportV1_6(report: CCIPExecutionReportV1_6): Buffer {
  const buffers: Buffer[] = []

  // Write source chain selector
  const sourceChainBuffer = bigintToBeBytes(report.sourceChainSelector, 8)
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

export function hashAnyToSVMMessage(
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
  const sourceChainBuffer = bigintToBeBytes(message.header.sourceChainSelector, 8)
  buffers.push(sourceChainBuffer)

  // Write dest chain selector
  const destChainBuffer = bigintToBeBytes(message.header.destChainSelector, 8)
  buffers.push(destChainBuffer)

  // Write onRamp size and data
  const onRampBytes = decodeBase58(onRamp)
  const onRampSizeBuffer = Buffer.alloc(2)
  onRampSizeBuffer.writeUInt16BE(onRampBytes.length)
  buffers.push(onRampSizeBuffer)
  buffers.push(Buffer.from(onRampBytes))

  // Write message ID
  const messageId = Buffer.from(message.header.messageId.replace('0x', ''), 'hex')
  buffers.push(messageId)

  // Write token receiver
  const tokenReceiverBytes = decodeBase58(message.receiver)
  buffers.push(Buffer.from(tokenReceiverBytes))

  // Write sequence number
  const seqBuffer = bigintToBeBytes(message.header.sequenceNumber, 8)
  buffers.push(seqBuffer)

  // Write extra args - use the raw extra args since they're already properly encoded
  const extraArgsBuffer = Buffer.from(message.extraArgs.replace('0x', ''), 'hex')
  buffers.push(extraArgsBuffer)

  // Write nonce
  const nonceBuffer = bigintToBeBytes(message.header.nonce, 8)
  buffers.push(nonceBuffer)

  // Write sender size and data
  const senderBytes = Buffer.from(message.sender.replace('0x', ''), 'hex')
  const senderSizeBuffer = Buffer.alloc(2)
  senderSizeBuffer.writeUInt16BE(senderBytes.length)
  buffers.push(senderSizeBuffer)
  buffers.push(senderBytes)

  // Write data length + data
  const data = Buffer.from(message.data.replace('0x', ''), 'base64')
  const dataSizeBuffer = Buffer.alloc(2)
  dataSizeBuffer.writeUInt16BE(data.length)
  buffers.push(dataSizeBuffer)
  buffers.push(data)

  // Write token amounts
  const tokenAmountsBuffer = serializeTokenAmounts(message.tokenAmounts)
  buffers.push(tokenAmountsBuffer)

  // Write accounts
  const accountsLengthBuffer = Buffer.alloc(4)
  accountsLengthBuffer.writeUInt32LE(msgAccounts.length)
  buffers.push(accountsLengthBuffer)
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
  const combined = Buffer.concat([
    Buffer.from(metadataHash.replace('0x', ''), 'hex'),
    encodedReport,
  ])
  console.log('v1.6 hashSolanaMessage:', {
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
    sourceChainSelector: message.header.sourceChainSelector,
    destChainSelector: message.header.destChainSelector,
    sequenceNumber: BigInt(message.header.sequenceNumber.toString()),
    nonce: BigInt(message.header.nonce.toString()),
    onRamp: onRamp,
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
  return '0x' + hashAnyToSVMMessage(rampMessage, onRamp, accountBuffers).toString('hex')
}

export function hashSVMToAnyMessage(message: CCIPMessage<typeof CCIPVersion.V1_6>): Buffer {
  const buffers: Buffer[] = []
  // Write message header
  const headerBuffer = serializeHeader(message.header)
  buffers.push(headerBuffer)

  // Write sender length + data
  const senderSizeBuffer = Buffer.alloc(2)
  senderSizeBuffer.writeUInt16BE(message.sender.replace('0x', '').length / 2)
  buffers.push(senderSizeBuffer)
  buffers.push(Buffer.from(message.sender.replace('0x', ''), 'hex'))

  // Write data length + data
  const data = Buffer.from(message.data.replace('0x', ''), 'base64')
  const dataSizeBuffer = Buffer.alloc(2)
  dataSizeBuffer.writeUInt16BE(data.length)
  buffers.push(dataSizeBuffer)
  buffers.push(data)

  // Write receiver
  buffers.push(Buffer.from(message.receiver))

  // Write token amounts
  const tokenAmountsBuffer = serializeTokenAmounts(message.tokenAmounts)
  buffers.push(tokenAmountsBuffer)

  // Write extra arguments
  const extraArgs = parseExtraArgs(message.extraArgs)
  const extraArgsBuffer = Buffer.from(message.extraArgs.replace('0x', ''), 'hex')
  buffers.push(extraArgsBuffer)

  // Write accounts
  for (const account of msgAccounts) {
    buffers.push(account)
  }
  return Buffer.concat(buffers)
}
