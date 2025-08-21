import { BorshCoder, EventParser, Program } from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { type Addressable, type Log, EventFragment, Interface, keccak256 } from 'ethers'

import TokenPoolABI_1_5 from '../abi/BurnMintTokenPool_1_5_1.ts'
import TokenPoolABI_1_6 from '../abi/BurnMintTokenPool_1_6_1.ts'
import { type SourceTokenData, parseSourceTokenData } from './extra-args.ts'
import { chainNameFromSelector } from './index.ts'
import {
  getClusterUrlByChainSelectorName,
  isSupportedSolanaCluster,
} from './solana/getClusterByChainSelectorName.ts'
import { newAnchorProvider } from './solana/manuallyExecuteSolana.ts'
import { CCIP_CCTP_TOKEN_POOL_IDL } from './solana/programs/1.6.0/CCIP_CCTP_TOKEN_POOL.ts' // TODO this seems duplicated
import type { CcipCctpMessageAndAttestation, CcipCctpMessageSentEvent } from './solana/types.ts'
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

  console.debug('Got EVM offchain token data', offchainTokenData)
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
  if (request.message.tokenAmounts === undefined || request.message.tokenAmounts.length === 0) {
    return []
  }

  if (request.message.tokenAmounts.length > 1) {
    throw new Error(
      `Expected at most 1 token transfer, found ${request.message.tokenAmounts?.length}`,
    )
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
    console.debug('No events')
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

  console.debug('Got Solana offchain token data', offchainTokenData)

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

  if (!tx.meta.logMessages?.length) {
    throw new Error(`Transaction has no logs: ${txSignature}`)
  }

  const cctpPoolAddress = getCctpPoolAddress(tx.meta.logMessages)
  if (!cctpPoolAddress) {
    return []
  }

  // the anchor provider is just to instantiate the event parser, so the devnet env is actually irrelevant,
  // as is the keypair used
  const { anchorProvider } = newAnchorProvider('solana-devnet', undefined, Keypair.generate())
  const cctpPoolProgram = new Program(
    CCIP_CCTP_TOKEN_POOL_IDL,
    new PublicKey(cctpPoolAddress),
    anchorProvider,
  )
  const eventParser = new EventParser(
    new PublicKey(cctpPoolAddress),
    new BorshCoder(cctpPoolProgram.idl),
  )

  const events: CcipCctpMessageSentEvent[] = Array.from(eventParser.parseLogs(tx.meta.logMessages))
    .filter((event) => event.name === 'CcipCctpMessageSentEvent')
    .map((event) => event.data as unknown as CcipCctpMessageSentEvent)
  return events
}

function getCctpPoolAddress(logs: string[]): string | null {
  // Example logs include lines like the following (though the indexes of the "invoke [1]" are unreliable):
  // "Program <POOL ADDRESS HERE, THIS IS WHAT WE'RE LOOKING FOR> invoke [1]",
  // "Program log: Instruction: LockOrBurnTokens",
  const candidateIx = logs.indexOf('Program log: Instruction: LockOrBurnTokens')
  if (candidateIx < 1) {
    return null
  }

  const candidateAddress = logs[candidateIx - 1].split(' ')[1]

  if (!candidateAddress.toLowerCase().startsWith('ccitp')) {
    // The vanity address of the pool includes "ccitp" (case-insensitive) as a prefix
    return null
  }

  // basic sanity check that we have the pool address: The pool returns a value, so the logs should show that
  const sanityCheck = logs.find((log) => log.startsWith(`Program return: ${candidateAddress} `))
  if (!sanityCheck) {
    return null
  }

  return candidateAddress
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
    const messageAndAttestation: CcipCctpMessageAndAttestation = {
      message: {
        data: messageBuffer, // u8 array
      },
      attestation: attestationBuffer, // u8 array
    }

    const borshCoder = new BorshCoder(CCIP_CCTP_TOKEN_POOL_IDL)
    const encoded = borshCoder.types.encode('MessageAndAttestation', messageAndAttestation)
    return '0x' + Buffer.from(encoded).toString('hex')
  }

  // EVM destination default: use ABI encoding
  return defaultAbiCoder.encode(
    ['tuple(bytes message, bytes attestation)'],
    [{ message, attestation }],
  )
}
