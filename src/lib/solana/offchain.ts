import { type BN, BorshCoder, EventParser } from '@coral-xyz/anchor'
import { type Connection, PublicKey } from '@solana/web3.js'
import { hexlify } from 'ethers'

import { getUsdcAttestation } from '../offchain.ts'
import type { CCIPMessage, CCIPRequest, OffchainTokenData } from '../types.ts'
import { networkInfo } from '../utils.ts'
import { IDL as BASE_TOKEN_POOL } from './programs/1.6.0/BASE_TOKEN_POOL.ts'
import { IDL as CCTP_TOKEN_POOL } from './programs/1.6.0/CCIP_CCTP_TOKEN_POOL.ts'
import { bytesToBuffer } from './utils.ts'

interface CcipCctpMessageSentEvent {
  originalSender: PublicKey
  remoteChainSelector: BN
  msgTotalNonce: BN
  eventAddress: PublicKey
  sourceDomain: number
  cctpNonce: BN
  messageSentBytes: Uint8Array
}

interface CcipCctpMessageAndAttestation {
  message: {
    data: Uint8Array
  }
  attestation: Uint8Array
}
const cctpTokenPoolCoder = new BorshCoder({
  ...CCTP_TOKEN_POOL,
  types: [...BASE_TOKEN_POOL.types, ...CCTP_TOKEN_POOL.types],
  events: BASE_TOKEN_POOL.events,
  errors: [...BASE_TOKEN_POOL.errors, ...CCTP_TOKEN_POOL.errors],
})

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
  connection: Connection,
  request: Pick<CCIPRequest, 'tx' | 'lane'> & {
    message: CCIPMessage
    log: Pick<CCIPRequest['log'], 'topics' | 'index' | 'transactionHash'>
  },
): Promise<OffchainTokenData[]> {
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
  const cctpEvents = await parseCcipCctpEvents(connection, txSignature)
  const offchainTokenData: OffchainTokenData[] = request.message.tokenAmounts.map(() => undefined)

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
      const message = hexlify(cctpEvent.messageSentBytes)
      const attestation = await getUsdcAttestation(message, isTestnet)

      offchainTokenData[0] = { _tag: 'usdc', message, attestation }
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
async function parseCcipCctpEvents(
  connection: Connection,
  txSignature: string,
): Promise<CcipCctpMessageSentEvent[]> {
  // Fetch transaction details using Solana RPC
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

  const eventParser = new EventParser(new PublicKey(cctpPoolAddress), cctpTokenPoolCoder)

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

/**
 * Encodes CCTP message and attestation
 *
 * @param data - OffchainTokenData (_tag="usdc")
 * @returns Encoded data - Borsh-encoded attestation for Solana
 */
export function encodeSolanaOffchainTokenData(data: OffchainTokenData): string {
  if (data?._tag === 'usdc') {
    const messageBuffer = bytesToBuffer(data.message)
    const attestationBuffer = bytesToBuffer(data.attestation)

    // Solana destination: use Borsh encoding
    const messageAndAttestation: CcipCctpMessageAndAttestation = {
      message: {
        data: messageBuffer, // u8 array
      },
      attestation: attestationBuffer, // u8 array
    }

    const encoded = cctpTokenPoolCoder.types.encode('MessageAndAttestation', messageAndAttestation)
    return hexlify(encoded)
  }
  return '0x'
}
