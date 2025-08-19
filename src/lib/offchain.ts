import { Connection, PublicKey } from '@solana/web3.js'
import * as borsh from 'borsh'
import { type Addressable, type Log, EventFragment, Interface, keccak256 } from 'ethers'

import TokenPoolABI_1_5 from '../abi/BurnMintTokenPool_1_5_1.ts'
import TokenPoolABI_1_6 from '../abi/BurnMintTokenPool_1_6_1.ts'
import { type SourceTokenData, parseSourceTokenData } from './extra-args.ts'
import { chainNameFromSelector } from './index.ts'
import {
  getClusterUrlByChainSelectorName,
  isSupportedSolanaCluster,
} from './solana/getClusterByChainSelectorName.ts'
import type { CcipCctpMessageSentEvent } from './solana/types.ts'
import { computeAnchorEventDiscriminant } from './solana/utils.ts'
import { type CCIPMessage, type CCIPRequest, defaultAbiCoder } from './types.ts'
import { lazyCached, networkInfo } from './utils.ts'

const TokenPoolInterface_1_5 = lazyCached(
  `Interface BurnMintTokenPool 1.5.1`,
  () => new Interface(TokenPoolABI_1_5),
)
const TokenPoolInterface_1_6 = lazyCached(
  `Interface BurnMintTokenPool 1.6.1`,
  () => new Interface(TokenPoolABI_1_6),
)
const BURNED_EVENT_1_5 = TokenPoolInterface_1_5.getEvent('Burned')!
const BURNED_EVENT_1_6 = TokenPoolInterface_1_6.getEvent('LockedOrBurned')!
const BURNED_EVENT_TOPIC_HASHES = new Set([BURNED_EVENT_1_5.topicHash, BURNED_EVENT_1_6.topicHash])

const USDC_EVENT = EventFragment.from('MessageSent(bytes message)')
const TRANSFER_EVENT = EventFragment.from('Transfer(address from, address to, uint256 value)')

export const LBTC_EVENT = EventFragment.from(
  'DepositToBridge(address fromAddress, bytes32 toAddress, bytes32 payloadHash, bytes payload)',
)

const CCIP_CCTP_EVENT_DISCRIMINATOR = computeAnchorEventDiscriminant('CcipCctpMessageSentEvent')

const CIRCLE_API_URL = {
  mainnet: 'https://iris-api.circle.com/v1',
  testnet: 'https://iris-api-sandbox.circle.com/v1',
}
const LOMBARD_API_URL = {
  mainnet: 'https://mainnet.prod.lombard.finance',
  testnet: 'https://gastald-testnet.prod.lombard.finance',
}

type AttestationResponse =
  | { error: 'string' }
  | { status: 'pending_confirmations' }
  | { status: 'complete'; attestation: string }

type LombardAttestation =
  | { status: 'NOTARIZATION_STATUS_SESSION_APPROVED'; message_hash: string; attestation: string }
  | { status: string; message_hash: string }
type LombardAttestationsResponse = { attestations: Array<LombardAttestation> }

/**
 * Returns the USDC attestation for a given MessageSent Log
 * https://developers.circle.com/stablecoins/reference/getattestation
 *
 * @param message - payload of USDC MessageSent(bytes message) event
 * @param isTestnet - true if this was from a testnet
 * @returns USDC/CCTP attestation bytes
 */
export async function getUsdcAttestation(message: string, isTestnet: boolean): Promise<string> {
  const msgHash = keccak256(message)

  const circleApiBaseUrl = isTestnet ? CIRCLE_API_URL.testnet : CIRCLE_API_URL.mainnet
  const res = await fetch(`${circleApiBaseUrl}/attestations/${msgHash}`)
  const json = (await res.json()) as AttestationResponse
  if (!('status' in json) || json.status !== 'complete' || !json.attestation) {
    throw new Error('Could not fetch USDC attestation. Response: ' + JSON.stringify(json, null, 2))
  }
  return json.attestation
}

/**
 * Try to fetch USDC attestations for transfers, return undefined in position if can't
 *
 * @param tokenAmounts - all tokenAmounts to try
 * @param allLogsInRequest - all other logs in same tx as CCIPSendRequested
 * @param isTestnet - use testnet CCTP API endpoint
 * @returns array where each position is either the attestation for that transfer or undefined
 **/
async function getUsdcTokenData(
  tokenAmounts: CCIPMessage['tokenAmounts'],
  allLogsInRequest: Pick<Log, 'topics' | 'address' | 'data'>[],
  isTestnet: boolean,
  destChainSelector: bigint,
): Promise<(string | undefined)[]> {
  const attestations: (string | undefined)[] = []

  const messageSentPerTokenAndPool = allLogsInRequest.reduce((acc, log, i, arr) => {
    // for our MessageSent of interest (USDC-like), the token is the contract
    // which emitted a (burn) Transfer immediately before this event, and the pool emitted a Burned
    // event 2 events after
    const transferLog = arr[i - 1]
    const poolLog = arr[i + 2]
    if (
      log.topics[0] !== USDC_EVENT.topicHash ||
      transferLog?.topics?.[0] !== TRANSFER_EVENT.topicHash ||
      !BURNED_EVENT_TOPIC_HASHES.has(poolLog?.topics?.[0])
    ) {
      return acc
    }
    const token = transferLog.address
    const pool = poolLog.address
    acc.set(token, [...(acc.get(token) ?? []), log])
    acc.set(pool, [...(acc.get(pool) ?? []), log])
    return acc
  }, new Map<string | Addressable, (typeof allLogsInRequest)[number][]>())

  for (const [i, tokenAmount] of tokenAmounts.entries()) {
    const tokenOrPool = 'token' in tokenAmount ? tokenAmount.token : tokenAmount.sourcePoolAddress

    // what if there are more USDC transfers of this same token after this one?
    const tokenTransfersCountAfter = tokenAmounts.filter(
      (ta, j) => ('token' in ta ? ta.token : ta.sourcePoolAddress) === tokenOrPool && j > i,
    ).length

    let messageSentLog: (typeof allLogsInRequest)[number] | undefined
    const messageSents = messageSentPerTokenAndPool.get(tokenOrPool)
    if (messageSents) {
      // look from the end (near our request), but skip MessageSents for further transfers
      messageSentLog = messageSents[messageSents.length - 1 - tokenTransfersCountAfter]
    }

    let tokenData: string | undefined
    if (messageSentLog) {
      try {
        const message = defaultAbiCoder.decode(USDC_EVENT.inputs, messageSentLog.data)[0] as string
        const attestation = await getUsdcAttestation(message, isTestnet)
        tokenData = encodeOffchainTokenData(destChainSelector, message, attestation)
      } catch (_) {
        // maybe not a USDC transfer
      }
    }
    attestations.push(tokenData)
  }

  return attestations
}

/**
 * Returns the LBTC attestation for a given payload hash
 *
 * @param payloadHash - hash of the payload of the LBTC transfer
 * @param isTestnet - true if this was from a testnet
 * @returns LBTC attestation bytes
 */
async function getLbtcAttestation(payloadHash: string, isTestnet: boolean): Promise<string> {
  const lbtcApiBaseUrl = isTestnet ? LOMBARD_API_URL.testnet : LOMBARD_API_URL.mainnet
  const res = await fetch(`${lbtcApiBaseUrl}/api/bridge/v1/deposits/getByHash`, {
    method: 'POST',
    body: JSON.stringify({ messageHash: [payloadHash] }),
  })
  const response = (await res.json()) as LombardAttestationsResponse
  if (response == null || !('attestations' in response)) {
    throw new Error(
      'Error while fetching LBTC attestation. Response: ' + JSON.stringify(response, null, 2),
    )
  }
  const attestation = response.attestations.find((att) => att.message_hash === payloadHash)
  if (attestation == null) {
    throw new Error(
      'Could not find requested LBTC attestation with hash:' +
        payloadHash +
        ' in response: ' +
        JSON.stringify(response, null, 2),
    )
  }
  if (
    attestation.status === 'NOTARIZATION_STATUS_SESSION_APPROVED' &&
    'attestation' in attestation
  ) {
    return attestation.attestation
  }
  throw new Error(
    'LBTC attestation is not approved or invalid. Response: ' +
      JSON.stringify(attestation, null, 2),
  )
}

/**
 * Try to fetch LBTC attestations for transfers, return undefined in position if can't or not required
 *
 * @param message - CCIPMessage to fetch attestation for every tokenAmounts
 * @param isTestnet - use testnet CCTP API endpoint
 * @returns array where each position is either the attestation for that transfer or undefined
 **/
async function getLbtcTokenData(
  tokenAmounts: readonly SourceTokenData[],
  allLogsInRequest: readonly Pick<Log, 'topics' | 'address' | 'data'>[],
  isTestnet: boolean,
): Promise<(string | undefined)[]> {
  const lbtcDepositHashes = new Set(
    allLogsInRequest
      .filter(({ topics }) => topics[0] === LBTC_EVENT.topicHash)
      .map(({ topics }) => topics[3]),
  )
  return Promise.all(
    tokenAmounts.map(async ({ extraData }) => {
      // Attestation is required when SourceTokenData.extraData is 32 bytes long ('0x' + 64 hex chars)
      // otherwise attestation is not required
      if (lbtcDepositHashes.has(extraData)) {
        try {
          return await getLbtcAttestation(extraData, isTestnet)
        } catch (_) {
          // fallback: undefined
        }
      }
    }),
  )
}

/**
 * Fetches offchain token data for cross-chain token transfers
 *
 * This is the main entry point for fetching attestations and encoding offchain data
 * required for CCIP token transfers (e.g., CCTP).
 *
 * Routes to chain-specific implementations based on the source chain type:
 * - Solana sources → fetchSolanaOffchainTokenData(...)
 * - EVM sources → fetchEVMOffchainTokenData(...)
 *
 * Output encoding depends on destination chain:
 * - EVM destinations → ABI-encoded tuple
 * - Solana destinations → Borsh-encoded struct
 *
 * @param request.tx - Transaction to analyze
 * @param request.lane - Source and destination chain selectors
 * @param request.message - CCIP message with token transfer details
 * @param request.log - Specific log entry that triggered this request
 * @returns Array of encoded offchain token data
 *
 * @throws Error if transaction parsing or attestation fetching fails
 *
 * @example
 * Solana → EVM transfer
 * const data = await fetchOffchainTokenData({
 *   lane: { sourceChainSelector: 16423721717087811551n, destChainSelector: 1n },
 *   message: { tokenAmounts: [...] },
 *   log: { transactionHash: "3k81..." },
 *   tx: { logs: [...] }
 * })
 */
export function fetchOffchainTokenData(
  request: Pick<CCIPRequest, 'tx' | 'lane'> & {
    message: CCIPMessage
    log: Pick<CCIPRequest['log'], 'topics' | 'index' | 'transactionHash'>
  },
): Promise<string[]> {
  const sourceChainName = chainNameFromSelector(request.lane.sourceChainSelector)
  if (isSupportedSolanaCluster(sourceChainName)) {
    return fetchSolanaOffchainTokenData(request)
  }

  // EVM by default
  return fetchEVMOffchainTokenData(request)
}

/**
 * Fetch offchain token data for all transfers in request
 *
 * @param request - Request (or subset of) to fetch offchainTokenData for
 * @returns Array of byte arrays, one per transfer in request
 */
async function fetchEVMOffchainTokenData(
  request: Pick<CCIPRequest, 'tx' | 'lane'> & {
    message: CCIPMessage
    log: Pick<CCIPRequest['log'], 'topics' | 'index'>
  },
): Promise<string[]> {
  const { isTestnet } = networkInfo(request.lane.sourceChainSelector)
  // there's a chance there are other CCIPSendRequested in same tx,
  // and they may contain USDC transfers as well, so we select
  // any USDC logs after that and before our CCIPSendRequested
  const prevCcipRequestIdx =
    request.tx.logs.find(
      ({ topics, index }) => topics[0] === request.log.topics[0] && index < request.log.index,
    )?.index ?? -1
  const usdcRequestLogs = request.tx.logs.filter(
    ({ index }) => prevCcipRequestIdx < index && index < request.log.index,
  )

  const offchainTokenData: string[] = request.message.tokenAmounts.map(
    () => '0x', // default tokenData
  )
  const usdcTokenData = await getUsdcTokenData(
    request.message.tokenAmounts,
    usdcRequestLogs,
    isTestnet,
    request.lane.destChainSelector,
  )
  let lbtcTokenData: (string | undefined)[] = []
  try {
    let tokenAmounts
    if ('sourceTokenData' in request.message) {
      tokenAmounts = request.message.sourceTokenData.map(parseSourceTokenData)
    } else {
      tokenAmounts = request.message.tokenAmounts as readonly SourceTokenData[]
    }
    //for lbtc we distinguish logs by hash in event, so we can pass all of them
    lbtcTokenData = await getLbtcTokenData(tokenAmounts, request.tx.logs, isTestnet)
  } catch (_) {
    // pass
  }

  for (let i = 0; i < offchainTokenData.length; i++) {
    if (usdcTokenData[i]) {
      offchainTokenData[i] = usdcTokenData[i] as string
    } else if (lbtcTokenData[i]) {
      offchainTokenData[i] = lbtcTokenData[i] as string
    }
  }
  return offchainTokenData
}

/**
 * Analyzes a Solana transaction to extract CcipCctpMessageSentEvent, fetch Circle attestation,
 * and encode the data in the format required by the destination chain.
 *
 * @param request - CCIP request containing transaction data and chain routing info
 * @returns Array of encoded offchain token data (only one supported for Solana right now)
 *
 * @throws Error if transaction hash is missing or CcipCctpMessageSentEvent parsing fails
 *
 * @example
 * const tokenData = await fetchSolanaOffchainTokenData({
 *   lane: { sourceChainSelector: ..., destChainSelector: ... },
 *   message: { ... },
 *   log: { transactionHash: "3k81TLhJuhwB8fvurCwyMPHXR3k9Tmtqe2ZrUQ8e3rMxk9fWFJT2xVHGgKJg1785FkJcaiQkthY4m86JrESGPhMY" },
 *   tx: { logs: [...] }
 * })
 */
export async function fetchSolanaOffchainTokenData(
  request: Pick<CCIPRequest, 'tx' | 'lane'> & {
    message: CCIPMessage
    log: Pick<CCIPRequest['log'], 'topics' | 'index' | 'transactionHash'>
  },
): Promise<string[]> {
  if (request.message.tokenAmounts.length > 1) {
    throw new Error(
      `Expected at most 1 token transfer, found ${request.message.tokenAmounts.length}`,
    )
  }

  if (request.message.tokenAmounts.length === 0) {
    return []
  }

  const { isTestnet } = networkInfo(request.lane.sourceChainSelector)
  const txSignature = request.log.transactionHash
  if (!txSignature) {
    throw new Error('Transaction hash not found for OffchainTokenData parsing')
  }

  // Parse Solana transaction to find CCTP event
  const cctpEvents = await parseCcipCctpEvents(txSignature, request.lane.sourceChainSelector)
  const offchainTokenData: string[] = ['0x']

  // If no CcipCctpMessageSentEvent found, return defaults so we don't block execution
  if (cctpEvents.length === 0) {
    return offchainTokenData
  }

  // Currently, we only support ONE token per transfer
  if (cctpEvents.length > 1) {
    throw new Error(
      `Expected only 1 CcipCctpMessageSentEvent, found ${cctpEvents.length} in transaction ${txSignature}.`,
    )
  }

  // NOTE: assuming USDC token is the first (and only) token in the CCIP message, we will process the CCTP event.
  // If later multi-token transfers support is added, we need to add more info in order to match each token with it's event and offchainTokenData.
  const cctpEvent = cctpEvents[0]
  if (cctpEvent) {
    try {
      // Extract message bytes to fetch circle's attestation and then encode offchainTokenData.
      const messageHex = '0x' + Buffer.from(cctpEvent.messageSentBytes).toString('hex') // 0x must be prepended before calling keccak ethers.js func.
      const attestation = await getUsdcAttestation(messageHex, isTestnet)

      offchainTokenData[0] = encodeOffchainTokenData(
        request.lane.destChainSelector,
        messageHex,
        attestation,
      )
    } catch (error) {
      console.warn(`❌ Solana CCTP: Failed to fetch attestation for ${txSignature}:`, error)
    }
  }

  return offchainTokenData
}

/**
 * Parses CcipCctpMessageSentEvent from a Solana transaction by analyzing program logs
 *
 * @param txSignature - Solana transaction signature to analyze
 * @param sourceChainSelector - Source chain selector to determine RPC endpoint
 * @returns Array of parsed CcipCctpMessageSentEvent found in the transaction (only 1 supported though)
 *
 * @throws Error if transaction is not found or RPC fails
 *
 * @example
 * const events = await parseSolanaCctpEvents(
 *   '3k81TLhJuhwB8fvurCwyMPHXR3k9Tmtqe2ZrUQ8e3rMxk9fWFJT2xVHGgKJg1785FkJcaiQkthY4m86JrESGPhMY',
 *   16423721717087811551n // Solana Devnet
 * )
 */
export async function parseCcipCctpEvents(
  txSignature: string,
  sourceChainSelector: bigint,
): Promise<CcipCctpMessageSentEvent[]> {
  // Fetch transaction details using Solana RPC
  const sourceChainName = chainNameFromSelector(sourceChainSelector)
  const connection = new Connection(getClusterUrlByChainSelectorName(sourceChainName))
  const tx = await connection.getTransaction(txSignature, {
    commitment: 'finalized',
    maxSupportedTransactionVersion: 0,
  })
  if (!tx || !tx.meta) {
    throw new Error(`Transaction not found: ${txSignature}`)
  }

  // Look for "Program data:" logs which contain the event data
  const programDataLogs =
    tx.meta.logMessages?.filter((log) => log.startsWith('Program data: ')) || []

  // Parse each program data log to find CCTP events
  const cctpEvents: CcipCctpMessageSentEvent[] = []
  for (const log of programDataLogs) {
    try {
      // Remove prefix and parse as base64 data
      const eventData = Buffer.from(log.replace('Program data: ', ''), 'base64')

      // Check if it's a CcipCctpMessageSentEvent by looking in it's discriminator before trying to fully parse
      if (eventData.length >= 8) {
        const discriminator = eventData.subarray(0, 8)
        if (discriminator.equals(CCIP_CCTP_EVENT_DISCRIMINATOR)) {
          const event = parseCcipCctpEvent(eventData)
          if (event) {
            cctpEvents.push(event)
          }
        }
      }
    } catch (error) {
      // Invalid or non-CCTP events
      console.debug(
        `🔍 Solana CCTP: Skipped program data log in transaction ${txSignature}:`,
        error,
      )
    }
  }

  return cctpEvents
}

/**
 * Parses a CcipCctpMessageSentEvent from a Solana program data buffer
 *
 * @param buffer - Raw buffer containing the event data
 * @returns Parsed CCTP event object or null if parsing fails
 *
 * @see https://github.com/smartcontractkit/chainlink-ccip/blob/fc205e32dfa66cb5aa6a97e196792a3e813c1787/chains/solana/contracts/target/idl/cctp_token_pool.json#L1191-L1230
 */
function parseCcipCctpEvent(buffer: Buffer): CcipCctpMessageSentEvent | null {
  try {
    // Structure of CcipCctpMessageSentEvent is the following:
    // discriminator: 8 bytes
    // originalSender: 32 bytes (PublicKey)
    // remoteChainSelector: 8 bytes (u64)
    // msgTotalNonce: 8 bytes (u64)
    // eventAddress: 32 bytes (PublicKey)
    // sourceDomain: 4 bytes (u32)
    // cctpNonce: 8 bytes (u64)
    // messageSentBytes: variable length (bytes)

    // Minimum size: 8 (discriminator) + 92 (fixed fields) = 100
    if (buffer.length < 100) {
      return null
    }

    let offset = 0

    // Skip discriminator (already verified by caller)
    offset += 8

    // Parse the event fields
    const originalSender = new PublicKey(buffer.subarray(offset, offset + 32)).toString()
    offset += 32

    const remoteChainSelector = buffer.readBigUInt64LE(offset)
    offset += 8

    const msgTotalNonce = buffer.readBigUInt64LE(offset)
    offset += 8

    const eventAddress = new PublicKey(buffer.subarray(offset, offset + 32)).toString()
    offset += 32

    const sourceDomain = buffer.readUInt32LE(offset)
    offset += 4

    const cctpNonce = buffer.readBigUInt64LE(offset)
    offset += 8

    // Parse messageSentBytes (length-prefixed)
    if (offset + 4 > buffer.length) return null

    const messageLength = buffer.readUInt32LE(offset)
    offset += 4

    if (offset + messageLength > buffer.length) return null

    const messageSentBytes = buffer.subarray(offset, offset + messageLength)

    return {
      originalSender,
      remoteChainSelector,
      msgTotalNonce,
      eventAddress,
      sourceDomain,
      cctpNonce,
      messageSentBytes,
    }
  } catch (error) {
    console.debug('🔍 Solana CCTP: Failed to parse CcipCctpMessageSentEvent buffer:', error)
    return null
  }
}

// https://github.com/smartcontractkit/chainlink-ccip/blob/bf22fbf2d7b828dd48440061b92d33f946d1712e/chains/solana/contracts/target/idl/cctp_token_pool.json#L1071-L1088
const MessageAndAttestationSchema = {
  struct: {
    message: {
      struct: {
        data: { array: { type: 'u8' } }, // bytes as u8 array
      },
    },
    attestation: { array: { type: 'u8' } }, // bytes as u8 array
  },
}

function isValidHex(hex: string): boolean {
  if (!hex.startsWith('0x')) return false
  const hexPattern = /^0x[0-9a-fA-F]*$/
  return hexPattern.test(hex) && hex.length % 2 === 0
}

/**
 * Encodes CCTP message and attestation
 *
 * @param destChainSelector - Target chain selector (determines encoding format)
 * @param message - CCTP message as hex string (e.g., "0x123...")
 * @param attestation - Circle API attestation as hex string
 * @returns Encoded data - ABI tuple for EVM, Borsh-encoded for Solana
 *
 * @example
 *
 * const solanaData = encodeOffchainTokenData(16423721717087811551n, "0x123...", "0xabc...")
 */
export function encodeOffchainTokenData(
  destChainSelector: bigint,
  message: string,
  attestation: string,
): string {
  if (!isValidHex(message)) {
    throw new Error(`Invalid hex string for message: ${message}`)
  }
  if (!isValidHex(attestation)) {
    throw new Error(`Invalid hex string for attestation: ${attestation}`)
  }
  const destChainName = chainNameFromSelector(destChainSelector)

  // The `0x` prefix must be removed from hex strings before converting to a Buffer.
  const messageBuffer = Buffer.from(message.slice(2), 'hex')
  const attestationBuffer = Buffer.from(attestation.slice(2), 'hex')

  // Solana destination: use Borsh encoding
  if (isSupportedSolanaCluster(destChainName)) {
    const messageAndAttestation = {
      message: {
        data: Array.from(messageBuffer), // u8 array
      },
      attestation: Array.from(attestationBuffer), // u8 array
    }

    const encoded = borsh.serialize(MessageAndAttestationSchema, messageAndAttestation)
    return '0x' + Buffer.from(encoded).toString('hex')
  }

  // EVM destination default: use ABI encoding
  return defaultAbiCoder.encode(
    ['tuple(bytes message, bytes attestation)'],
    [{ message, attestation }],
  )
}
