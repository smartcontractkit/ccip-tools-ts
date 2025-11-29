import util from 'util'

import { type BN, BorshCoder } from '@coral-xyz/anchor'
import type { Connection, PublicKey } from '@solana/web3.js'
import { hexlify } from 'ethers'

import { getUsdcAttestation } from '../offchain.ts'
import type { CCIPMessage, CCIPRequest, OffchainTokenData } from '../types.ts'
import { networkInfo } from '../utils.ts'
import { IDL as BASE_TOKEN_POOL } from './idl/1.6.0/BASE_TOKEN_POOL.ts'
import { IDL as CCTP_TOKEN_POOL } from './idl/1.6.0/CCIP_CCTP_TOKEN_POOL.ts'
import type { SolanaLog, SolanaTransaction } from './index.ts'
import { bytesToBuffer, hexDiscriminator } from './utils.ts'

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
  events: [...BASE_TOKEN_POOL.events, ...CCTP_TOKEN_POOL.events],
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
    log: Pick<CCIPRequest['log'], 'topics' | 'index' | 'transactionHash' | 'address'>
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

  // Parse Solana transaction to find CCTP event
  const tx = request.tx as SolanaTransaction
  const log = request.log as SolanaLog
  const logMessages = tx.tx.meta!.logMessages!
  // there may have multiple ccipSend calls in same tx;
  // use `invoke [level]` to filter only logs inside this call
  const requestInvokeIdx = logMessages.findLastIndex(
    (l, i) => i < log.index && l === `Program ${request.log.address} invoke [${log.level}]`,
  )
  const cctpEvents = []
  for (const l of tx.logs) {
    if (requestInvokeIdx >= l.index || l.index >= log.index) continue
    if (l.topics[0] !== hexDiscriminator('CcipCctpMessageSentEvent')) continue
    const decoded = cctpTokenPoolCoder.events.decode(l.data)
    if (!decoded) throw new Error(`Failed to decode CCTP event: ${util.inspect(l)}`)
    cctpEvents.push(decoded.data as unknown as CcipCctpMessageSentEvent)
  }
  const offchainTokenData: OffchainTokenData[] = request.message.tokenAmounts.map(() => undefined)

  // If no CcipCctpMessageSentEvent found, return defaults so we don't block execution
  if (cctpEvents.length === 0) {
    console.debug('No USDC/CCTP events found')
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
    const message = hexlify(cctpEvent.messageSentBytes)
    try {
      // Extract message bytes to fetch circle's attestation and then encode offchainTokenData.
      const attestation = await getUsdcAttestation(message, isTestnet)

      offchainTokenData[0] = { _tag: 'usdc', message, attestation }
    } catch (error) {
      console.warn(
        `❌ Solana CCTP: Failed to fetch attestation for ${txSignature}:`,
        message,
        error,
      )
    }
  }

  console.debug('Got Solana offchain token data', offchainTokenData)

  return offchainTokenData
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
