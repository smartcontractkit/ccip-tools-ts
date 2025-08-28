import { type ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js'
import {
  type EventFragment,
  type Log,
  type Numeric,
  type Provider,
  type Result,
  type TransactionReceipt,
  Contract,
  Interface,
  ZeroAddress,
  getUint,
  hexlify,
  isBytesLike,
  isHexString,
} from 'ethers'
import yaml from 'yaml'

import { parseExtraArgs, parseSourceTokenData } from './extra-args.ts'
import { computeAnchorEventDiscriminant } from './solana/utils.ts'
import {
  type CCIPContractEVM,
  type CCIPMessage,
  type CCIPRequest,
  type ChainFamily,
  type Lane,
  CCIPContractType,
  CCIPVersion,
  CCIP_ABIs,
  defaultAbiCoder,
} from './types.ts'
import {
  bigIntReplacer,
  blockRangeGenerator,
  chainNameFromSelector,
  convertKeysToCamelCase,
  decodeAddress,
  getDataBytes,
  lazyCached,
  networkInfo,
  toObject,
  validateContractType,
} from './utils.ts'

async function getOnRampInterface(
  source: Provider,
  onRamp: string,
): Promise<readonly [Interface, CCIPVersion]> {
  const [version] = await validateContractType(source, onRamp, CCIPContractType.OnRamp)
  return [
    lazyCached(
      `Interface ${CCIPContractType.OnRamp} ${version}`,
      () => new Interface(CCIP_ABIs[CCIPContractType.OnRamp][version]),
    ),
    version,
  ] as const
}

export async function getOnRampLane(source: Provider, address: string, destChainSelector?: bigint) {
  return lazyCached(`OnRamp ${address} lane`, async () => {
    const [iface, version] = await getOnRampInterface(source, address)
    const onRampContract = new Contract(address, iface, source) as unknown as CCIPContractEVM<
      typeof CCIPContractType.OnRamp,
      typeof version
    >
    const staticConfig = toObject(await onRampContract.getStaticConfig())
    if (!('destChainSelector' in staticConfig)) {
      if (!destChainSelector) {
        throw new Error('destChainSelector is required for v1.6 OnRamp')
      }
      const [, , destRouter] = await onRampContract.getDestChainConfig(destChainSelector)
      if (destRouter === ZeroAddress) {
        throw new Error(
          `OnRamp ${address} is not configured for dest ${chainNameFromSelector(destChainSelector)}`,
        )
      }
    } else {
      destChainSelector = staticConfig.destChainSelector
    }
    return [
      {
        sourceChainSelector: staticConfig.chainSelector,
        destChainSelector,
        onRamp: address,
        version,
      },
      onRampContract,
    ] as {
      [V in CCIPVersion]: readonly [Lane<V>, CCIPContractEVM<typeof CCIPContractType.OnRamp, V>]
    }[CCIPVersion]
  })
}

const ccipMessagesFragments: readonly EventFragment[] = [
  // v1.2 has similar schema as v1.5
  lazyCached(
    `Interface ${CCIPContractType.OnRamp} ${CCIPVersion.V1_5}`,
    () => new Interface(CCIP_ABIs[CCIPContractType.OnRamp][CCIPVersion.V1_5]),
  ).getEvent('CCIPSendRequested')!,
  lazyCached(
    `Interface ${CCIPContractType.OnRamp} ${CCIPVersion.V1_6}`,
    () => new Interface(CCIP_ABIs[CCIPContractType.OnRamp][CCIPVersion.V1_6]),
  ).getEvent('CCIPMessageSent')!,
]
const ccipMessagesTopicHashes = new Set(ccipMessagesFragments.map((fragment) => fragment.topicHash))

/**
 * Decodes hex strings, bytearrays, JSON strings and raw objects as CCIPMessages
 * Does minimal validation, but converts objects in the format expected by ccip-tools-ts
 **/
export function decodeMessage(data: string | Uint8Array | Record<string, unknown>): CCIPMessage {
  if (typeof data === 'string' && data.startsWith('{')) {
    data = yaml.parse(data, { intAsBigInt: true }) as Record<string, unknown>
    // Convert snake_case keys to camelCase after YAML parsing
    data = convertKeysToCamelCase(data) as Record<string, unknown>
  }
  if (isBytesLike(data)) {
    let result: Result | undefined
    for (const fragment of ccipMessagesFragments) {
      try {
        result = defaultAbiCoder.decode(
          fragment.inputs.filter((p) => !p.indexed),
          data,
        )[0] as Result
        if (typeof result?.sender != 'string') throw new Error('next')
        break
      } catch (_) {
        // try next fragment
      }
    }
    if (!isHexString(result?.sender)) throw new Error('could not decode CCIPMessage')
    data = resultsToMessage(result)
  }
  if (typeof data !== 'object' || typeof data?.sender !== 'string')
    throw new Error('unknown message format: ' + JSON.stringify(data, bigIntReplacer))

  if (!data.header) {
    data.header = {
      messageId: data.messageId as string,
      sequenceNumber: data.sequenceNumber as bigint,
      nonce: data.nonce as bigint,
      sourceChainSelector: data.sourceChainSelector as bigint,
    }
  }

  const sourceFamily = networkInfo(
    (data.header as { sourceChainSelector: bigint }).sourceChainSelector,
  ).family
  let destFamily: ChainFamily | undefined
  if ((data.header as { destChainSelector: bigint } | undefined)?.destChainSelector) {
    destFamily = networkInfo(
      (data.header as { destChainSelector: bigint }).destChainSelector,
    ).family
  }
  // conversions to make any message version be compatible with latest v1.6
  data.tokenAmounts = (data.tokenAmounts as Record<string, string | bigint | number>[]).map(
    (tokenAmount, i) => {
      if (data.sourceTokenData) {
        try {
          tokenAmount = {
            ...parseSourceTokenData((data.sourceTokenData as string[])[i]),
            ...tokenAmount,
          }
        } catch (_) {
          console.debug('legacy sourceTokenData:', i, (data.sourceTokenData as string[])[i])
        }
      }
      if (typeof tokenAmount.destExecData === 'string' && tokenAmount.destGasAmount == null) {
        tokenAmount.destGasAmount = getUint(hexlify(getDataBytes(tokenAmount.destExecData)))
      }
      // Can be undefined if the message is from before v1.5 and failed to parse sourceTokenData
      if (tokenAmount.sourcePoolAddress) {
        tokenAmount.sourcePoolAddress = decodeAddress(
          tokenAmount.sourcePoolAddress as string,
          sourceFamily,
        )
      }
      if (tokenAmount.destTokenAddress) {
        tokenAmount.destTokenAddress = decodeAddress(
          tokenAmount.destTokenAddress as string,
          destFamily,
        )
      }
      return tokenAmount
    },
  )
  data.sender = decodeAddress(data.sender, sourceFamily)
  data.feeToken = decodeAddress(data.feeToken as string, sourceFamily)
  data.receiver = decodeAddress(data.receiver as string, destFamily)
  if (data.gasLimit == null && data.computeUnits == null) {
    const parsed = parseExtraArgs(data.extraArgs as string)!
    const { _tag, ...rest } = parsed
    Object.assign(data, rest)
  }
  return data as CCIPMessage
}

function resultsToMessage(result: Result): Record<string, unknown> {
  if (result.message) result = result.message as Result
  return {
    ...result.toObject(),
    tokenAmounts: (result.tokenAmounts as Result[]).map((ta) => ta.toObject()),
    ...(result.sourceTokenData
      ? { sourceTokenData: (result.sourceTokenData as Result).toArray() }
      : {}),
    ...(result.header ? { header: (result.header as Result).toObject() } : {}),
  } as unknown as CCIPMessage
}

/**
 * Fetch all CCIP messages in a transaction
 * @param tx - TransactionReceipt to search in
 * @returns CCIP messages in the transaction (at least one)
 **/
export async function fetchCCIPMessagesInTx(tx: TransactionReceipt): Promise<CCIPRequest[]> {
  const source = tx.provider
  const txHash = tx.hash
  const timestamp = (await tx.getBlock()).timestamp

  const requests: CCIPRequest[] = []
  for (const log of tx.logs) {
    if (!ccipMessagesTopicHashes.has(log.topics[0])) continue
    let message: CCIPMessage, lane
    try {
      message = decodeMessage(log.data)
      if ('destChainSelector' in message.header) {
        lane = {
          sourceChainSelector: message.header.sourceChainSelector,
          destChainSelector: message.header.destChainSelector,
          onRamp: log.address,
          version: CCIPVersion.V1_6,
        }
      } else {
        ;[lane] = await getOnRampLane(source, log.address)
      }
    } catch (err) {
      console.debug('failed parsing log in tx:', tx.hash, log, err)
      continue
    }
    requests.push({ lane, message, log, tx, timestamp })
  }
  if (!requests.length) {
    throw new Error(`Could not find any CCIPSendRequested message in tx: ${txHash}`)
  }

  return requests
}

/**
 * Fetch a CCIP message by its log index in a transaction
 * @param tx - TransactionReceipt to search in
 * @param logIndex - log index to search for
 * @returns CCIPRequest in the transaction, with given logIndex
 **/
export async function fetchCCIPMessageInLog(
  tx: TransactionReceipt,
  logIndex: number,
): Promise<CCIPRequest> {
  const requests = await fetchCCIPMessagesInTx(tx)
  const request = requests.find(({ log }) => log.index === logIndex)
  if (!request)
    throw new Error(
      `Could not find a CCIPSendRequested message in tx ${tx.hash} with logIndex=${logIndex}`,
    )
  return request
}

/**
 * Fetch a CCIP message by its messageId
 * Can be slow due to having to paginate backwards through logs
 *
 * @param source - Provider to fetch logs from
 * @param messageId - messageId to search for
 * @param hints - Optional hints for pagination
 * @returns CCIPRequest with given messageId
 **/
export async function fetchCCIPMessageById(
  source: Provider,
  messageId: string,
  hints?: { page?: number },
): Promise<CCIPRequest> {
  for (const blockRange of blockRangeGenerator(
    { endBlock: await source.getBlockNumber() },
    hints?.page,
  )) {
    const logs = await source.getLogs({
      ...blockRange,
      topics: [Array.from(ccipMessagesTopicHashes)],
    })
    console.debug('fetchCCIPMessageById: found', logs.length, 'logs in', blockRange)
    for (const log of logs) {
      let message
      try {
        message = decodeMessage(log.data)
      } catch (_) {
        continue
      }
      if (message.header.messageId !== messageId) continue
      return fetchCCIPMessageInLog(
        (await source.getTransactionReceipt(log.transactionHash))!,
        log.index,
      )
    }
  }
  throw new Error('Could not find a CCIPSendRequested message with messageId: ' + messageId)
}

// Number of blocks to expand the search window for logs
const BLOCK_LOG_WINDOW_SIZE = 5000

// Helper function to find the sequence number from CCIPSendRequested event logs
export async function fetchAllMessagesInBatch(
  source: Provider,
  destChainSelector: bigint,
  {
    address: onRamp,
    blockNumber: sendBlock,
    topics: [topic0],
  }: Pick<Log, 'address' | 'blockNumber' | 'topics'>,
  { minSeqNr, maxSeqNr }: { minSeqNr: Numeric; maxSeqNr: Numeric },
  { page: eventsBatchSize = BLOCK_LOG_WINDOW_SIZE }: { page?: number } = {},
): Promise<Omit<CCIPRequest, 'tx' | 'timestamp'>[]> {
  const min = Number(minSeqNr)
  const max = Number(maxSeqNr)
  const latestBlock: number = await source.getBlockNumber()

  const [lane] = await getOnRampLane(source, onRamp, destChainSelector)
  const getDecodedEvents = async (fromBlock: number, toBlock: number) => {
    const logs = await source.getLogs({
      address: onRamp,
      topics: [topic0],
      fromBlock,
      toBlock,
    })
    console.debug('fetchAllMessagesInBatch: found', logs.length, 'logs in', { fromBlock, toBlock })
    const result: Omit<CCIPRequest, 'tx' | 'timestamp'>[] = []
    for (const log of logs) {
      let message
      try {
        message = decodeMessage(log.data)
      } catch (_) {
        continue
      }
      if (min > message.header.sequenceNumber || message.header.sequenceNumber > max) {
        continue
      }
      result.push({ lane, message, log })
    }
    return result
  }

  const initFromBlock = Math.max(1, Math.trunc(sendBlock - eventsBatchSize / 2 + 1))
  const initToBlock = Math.min(latestBlock, initFromBlock + eventsBatchSize - 1)
  const events = await getDecodedEvents(initFromBlock, initToBlock)

  // page back if needed
  for (const { fromBlock, toBlock } of blockRangeGenerator(
    { endBlock: initFromBlock - 1 },
    eventsBatchSize,
  )) {
    if (events[0].message.header.sequenceNumber <= min) break
    const newEvents = await getDecodedEvents(fromBlock, toBlock)
    events.unshift(...newEvents)
  }

  // page forward if needed
  for (const { fromBlock, toBlock } of blockRangeGenerator(
    { startBlock: initToBlock + 1, endBlock: latestBlock },
    eventsBatchSize,
  )) {
    if (events[events.length - 1].message.header.sequenceNumber >= max) break
    const newEvents = await getDecodedEvents(fromBlock, toBlock)
    events.push(...newEvents)
  }

  if (events.length != max - min + 1) {
    throw new Error(
      `Could not find all expected request events: from=${sendBlock}, wanted=[${min}..${max}:${max - min + 1}], got=[${events.map((e) => Number(e.message.header.sequenceNumber)).join(',')}]`,
    )
  }
  return events
}

export async function* fetchRequestsForSender(
  source: Provider,
  firstRequest: Omit<CCIPRequest, 'tx' | 'timestamp' | 'log' | 'message'> & {
    log: Pick<CCIPRequest['log'], 'address' | 'topics' | 'blockNumber'>
    message: Pick<CCIPRequest['message'], 'sender'>
  },
): AsyncGenerator<Omit<CCIPRequest, 'tx' | 'timestamp'>, void, unknown> {
  for (const blockRange of blockRangeGenerator({
    endBlock: await source.getBlockNumber(),
    startBlock: firstRequest.log.blockNumber,
  })) {
    const logs = await source.getLogs({
      ...blockRange,
      topics: [firstRequest.log.topics[0]],
      address: firstRequest.log.address,
    })

    console.debug('fetchRequestsForSender: found', logs.length, 'logs in', blockRange)
    for (const log of logs) {
      let message
      try {
        message = decodeMessage(log.data)
      } catch (_) {
        continue
      }
      if (message.sender !== firstRequest.message.sender) continue
      yield { lane: firstRequest.lane, message, log }
    }
  }
}

// ============= SOLANA FUNCTIONS =============
const CCIP_MESSAGE_SENT_DISCRIMINATOR = computeAnchorEventDiscriminant('CCIPMessageSent')

/**
 * Fetch all CCIP messages in a Solana transaction
 * @param signature - Solana transaction signature
 * @param transaction - Parsed Solana transaction
 * @returns CCIP messages in the transaction
 **/
export function fetchSolanaCCIPMessagesInTx(
  signature: string,
  transaction: ParsedTransactionWithMeta,
): CCIPRequest[] {
  // Look for "Program data:" logs which contain the CCIP event data
  const programDataLogs =
    transaction.meta?.logMessages?.filter((log) => log.startsWith('Program data: ')) || []

  if (programDataLogs.length === 0) {
    throw new Error(`Could not find any CCIP program data logs in Solana tx: ${signature}`)
  }

  // Extract CCIP router address from the last "Program return:" log
  // Format: "Program return: [RouterAddress] [Base64MessageId]"
  let ccipRouterAddress: string | null = null

  if (transaction.meta?.logMessages) {
    // Find all program return logs
    const programReturnLogs = transaction.meta.logMessages.filter((log) =>
      log.startsWith('Program return: '),
    )

    // Use the last one (final return from the CCIP Router)
    if (programReturnLogs.length > 0) {
      const lastReturnLog = programReturnLogs[programReturnLogs.length - 1]
      const parts = lastReturnLog.replace('Program return: ', '').split(' ')
      if (parts.length >= 1) {
        ccipRouterAddress = parts[0]
      }
    }
  }

  if (!ccipRouterAddress) {
    throw new Error(`Could not extract CCIP Router address from Solana tx: ${signature}`)
  }

  // Parse each program data log to find CCIP events
  const ccipRequests: CCIPRequest[] = []
  for (const log of programDataLogs) {
    try {
      // Extract the base64 data directly
      const eventDataBuffer = Buffer.from(log.replace('Program data: ', ''), 'base64')

      // Check if it's a CCIPMessageSent event by discriminator and we need to parse it
      if (eventDataBuffer.length >= 8) {
        const discriminator = eventDataBuffer.subarray(0, 8)
        if (discriminator.equals(CCIP_MESSAGE_SENT_DISCRIMINATOR)) {
          const ccipRequest = parseCCIPMessageSentEvent(
            eventDataBuffer,
            signature,
            transaction.slot,
            ccipRouterAddress,
          )
          ccipRequest.timestamp = transaction.blockTime || 0
          ccipRequests.push(ccipRequest)
        }
      }
    } catch (_) {
      // Skip non relevant logs
    }
  }

  if (ccipRequests.length === 0) {
    throw new Error(`Could not parse any CCIP events in Solana tx: ${signature}`)
  }

  return ccipRequests
}

// TODO: We should replicate the general decoder we did in Go for o11y and handle these cases.
/**
 * Parse a CCIP MessageSent event from Solana program data (without discriminator)
 * @param eventData - Binary event data without the 8-byte discriminator
 * @param signature - Solana transaction signature
 * @param slot - Solana block slot number
 * @returns Parsed CCIPRequest object
 */
export function parseCCIPMessageSentEvent(
  eventData: Buffer,
  signature: string,
  slot: number,
  routerAddress: string,
): CCIPRequest {
  try {
    // Structure of CCIPMessageSent event:
    // ┌─ discriminator: 8b
    // ├─ destChainSelector: u64
    // ├─ sequenceNumber: u64
    // └─ message {
    //    ├─ header {
    //    │  ├─ messageId: 32 bytes
    //    │  ├─ sourceChainSelector: u64
    //    │  ├─ destChainSelector: u64
    //    │  ├─ sequenceNumber: u64
    //    │  └─ nonce: u64
    //    │ }
    //    ├─ sender: PublicKey (32 bytes)
    //    ├─ data: bytes (u32 len + data)
    //    ├─ receiver: bytes (u32 len + data)
    //    ├─ extraArgs: bytes (u32 len + data)
    //    ├─ feeToken: PublicKey (32 bytes)
    //    ├─ tokenAmounts: vec<TokenTransfer> {
    //    │  ├─ length: u32
    //    │  └─ for each token: {
    //    │     ├─ sourcePoolAddress: PublicKey (32 bytes)
    //    │     ├─ destTokenAddress: bytes (u32 len + data)
    //    │     ├─ extraData: bytes (u32 len + data)
    //    │     ├─ amount: 32 bytes (little-endian)
    //    │     └─ destExecData: bytes (u32 len + data)
    //    │  }
    //    │ }
    //    ├─ feeTokenAmount: 32 bytes (little-endian)
    //    └─ feeValueJuels: 32 bytes (little-endian)

    let offset = 0

    // Skip discriminator (already verified by caller)
    offset += 8

    // ----- PARSE INITIAL EVENT FIELDS -----
    const destChainSelector = eventData.readBigUInt64LE(offset)
    offset += 8

    //const sequenceNumber = eventData.readBigUInt64LE(offset) unused but left for clarity.
    offset += 8

    // ----- PARSE MESSAGE HEADER -----
    const messageIdBuffer = eventData.subarray(offset, offset + 32)
    offset += 32

    const sourceChainSelector = eventData.readBigUInt64LE(offset)
    offset += 8

    const headerDestChainSelector = eventData.readBigUInt64LE(offset)
    offset += 8

    const headerSequenceNumber = eventData.readBigUInt64LE(offset)
    offset += 8

    const nonce = eventData.readBigUInt64LE(offset)
    offset += 8

    // ----- PARSE MESSAGE -----
    const senderBuffer = eventData.subarray(offset, offset + 32)
    const sender = new PublicKey(senderBuffer).toString()
    offset += 32

    const dataLength = eventData.readUInt32LE(offset)
    offset += 4
    const dataBuffer = eventData.subarray(offset, offset + dataLength)
    offset += dataLength

    const receiverLength = eventData.readUInt32LE(offset)
    offset += 4
    const receiverBuffer = eventData.subarray(offset, offset + receiverLength)
    offset += receiverLength

    const extraArgsLength = eventData.readUInt32LE(offset)
    offset += 4
    const extraArgsBuffer = eventData.subarray(offset, offset + extraArgsLength)
    offset += extraArgsLength

    const feeTokenBuffer = eventData.subarray(offset, offset + 32)
    const feeToken = new PublicKey(feeTokenBuffer).toString()
    offset += 32

    // ----- PARSE TOKEN AMOUNTS -----
    const tokenAmountsCount = eventData.readUInt32LE(offset)
    offset += 4

    const tokenAmounts: Array<{
      sourcePoolAddress: string
      destTokenAddress: string
      extraData: string
      amount: bigint
      destExecData: string
      destGasAmount: bigint
    }> = []

    for (let i = 0; i < tokenAmountsCount; i++) {
      const sourcePoolBuffer = eventData.subarray(offset, offset + 32)
      const sourcePoolAddress = new PublicKey(sourcePoolBuffer).toString()
      offset += 32

      const destTokenAddressLength = eventData.readUInt32LE(offset)
      offset += 4
      const destTokenAddressBuffer = eventData.subarray(offset, offset + destTokenAddressLength)
      offset += destTokenAddressLength

      const taExtraDataLength = eventData.readUInt32LE(offset)
      offset += 4
      const taExtraDataBuffer = eventData.subarray(offset, offset + taExtraDataLength)
      offset += taExtraDataLength

      const amountBuffer = eventData.subarray(offset, offset + 32)
      const amount = parseCrossChainAmount(amountBuffer)
      offset += 32

      const destExecDataLength = eventData.readUInt32LE(offset)
      offset += 4
      const destExecDataBuffer = eventData.subarray(offset, offset + destExecDataLength)
      offset += destExecDataLength

      tokenAmounts.push({
        sourcePoolAddress,
        destTokenAddress: '0x' + Buffer.from(destTokenAddressBuffer).toString('hex'),
        extraData: '0x' + Buffer.from(taExtraDataBuffer).toString('hex'),
        amount,
        destExecData: '0x' + Buffer.from(destExecDataBuffer).toString('hex'),
        destGasAmount: parseDestGasAmount(destExecDataBuffer),
      })
    }

    // ----- PARSE FEE FIELDS -----
    const feeTokenAmountBuffer = eventData.subarray(offset, offset + 32)
    const feeTokenAmount = parseCrossChainAmount(feeTokenAmountBuffer)
    offset += 32

    const feeValueJuelsBuffer = eventData.subarray(offset, offset + 32)
    const feeValueJuels = parseCrossChainAmount(feeValueJuelsBuffer)
    offset += 32

    // ----- CREATE CCIP MESSAGE AND REQUEST OBJECTS -----
    const ccipMessage: CCIPMessage = {
      header: {
        messageId: '0x' + Buffer.from(messageIdBuffer).toString('hex'),
        sourceChainSelector,
        destChainSelector: headerDestChainSelector,
        sequenceNumber: headerSequenceNumber,
        nonce,
      },
      sender,
      receiver: '0x' + Buffer.from(receiverBuffer).toString('hex'),
      data: '0x' + Buffer.from(dataBuffer).toString('hex'),
      tokenAmounts,
      gasLimit: parseGasLimitFromExtraArgs(extraArgsBuffer),
      feeToken,
      feeTokenAmount,
      feeValueJuels,
      extraArgs: '0x' + Buffer.from(extraArgsBuffer).toString('hex'),
    }

    const ccipRequest: CCIPRequest = {
      lane: {
        sourceChainSelector,
        destChainSelector,
        onRamp: routerAddress,
        version: CCIPVersion.V1_6,
      },
      message: ccipMessage,
      log: {
        index: 0, // Solana doesn't have log indices like EVM
        address: routerAddress,
        transactionHash: signature,
        blockNumber: slot,
        topics: [], // Solana events don't have topics like EVM
        data: eventData.toString('base64'),
      },
      tx: {
        hash: signature,
        blockNumber: slot,
        logs: [],
        from: routerAddress,
        to: null,
        contractAddress: null,
        gasUsed: 0n,
        gasPrice: 0n,
        cumulativeGasUsed: 0n,
        effectiveGasPrice: 0n,
        logsBloom: '',
        status: null,
        type: 0,
        byzantium: false,
        index: 0,
        provider: null,
        getBlock: () => null,
        confirmations: () => 0,
        wait: () => null,
        toJSON: () => ({}),
      } as unknown as TransactionReceipt,
      timestamp: 0, // Will be set by caller
    }

    return ccipRequest
  } catch (error) {
    throw new Error(
      `Failed to parse Solana CCIP event: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Parse destination gas amount from destExecData buffer
 * @param buffer - Buffer containing the destExecData
 * @returns The gas amount as a bigint
 */
function parseDestGasAmount(buffer: Buffer): bigint {
  // Solana CCIP format for destExecData is a uint32 gas limit
  // The first byte is the data length
  try {
    if (buffer.length >= 4) {
      return BigInt(buffer.readUInt32LE(0))
    }
  } catch (e) {
    console.debug('Failed to parse destGasAmount:', e)
  }

  // Fallback to zero if we can't parse it
  return 0n
}

/**
 * Parse CrossChainAmount from buffer (little-endian byte array)
 * @param buffer - 32-byte buffer containing the CrossChainAmount
 * @returns The parsed amount as a bigint
 */
function parseCrossChainAmount(buffer: Buffer): bigint {
  let result = 0n
  for (let i = 0; i < buffer.length; i++) {
    result += BigInt(buffer[i]) * 256n ** BigInt(i)
  }
  return result
}

/**
 * Parse gas limit from extraArgs buffer containing a Borsh-serialized GenericExtraArgsV2 struct
 * @param extraArgsBuffer - The buffer containing the extraArgs data
 * @returns The parsed gas limit as a bigint
 */
export function parseGasLimitFromExtraArgs(extraArgsBuffer: Buffer): bigint {
  // Format: [tag (4 bytes)][gas_limit (16 bytes u128)][allow_out_of_order_execution (1 byte bool)]
  if (extraArgsBuffer.length < 21) {
    return 0n
  }

  // Parse the gas_limit as a u128 in little-endian format
  let gasLimit = 0n
  for (let i = 0; i < 16; i++) {
    gasLimit += BigInt(extraArgsBuffer[4 + i]) * 256n ** BigInt(i)
  }

  return gasLimit
}
