import type { Providers } from '../providers.ts'
import { Format } from './types.ts'

// TypeScript interfaces for Circle CCTP API response
interface CircleDecodedMessageBody {
  burnToken: string
  mintRecipient: string
  amount: string
  messageSender: string
}

interface CircleDecodedMessage {
  sourceDomain: string
  destinationDomain: string
  nonce: string
  sender: string
  recipient: string
  destinationCaller: string
  messageBody: string
  decodedMessageBody?: CircleDecodedMessageBody
}

interface CircleMessage {
  attestation?: string
  message: string
  eventNonce: string
  cctpVersion: number
  status: string
  decodedMessage?: CircleDecodedMessage
  delayReason?: string | null
}

interface CircleApiResponse {
  messages: CircleMessage[]
}

// Circle CCTP Domain ID mapping based on https://developers.circle.com/cctp/cctp-supported-blockchains#cctp-v2-supported-domains
const CHAIN_ID_TO_CIRCLE_DOMAIN: Record<number, number> = {
  // Mainnet
  1: 0, // Ethereum
  43114: 1, // Avalanche
  10: 2, // OP Mainnet
  42161: 3, // Arbitrum
  8453: 6, // Base
  137: 7, // Polygon PoS
  1829: 10, // Unichain
  59144: 11, // Linea
  81457: 12, // Codex
  146: 13, // Sonic
  480: 14, // World Chain
  1329: 16, // Sei
  56: 17, // BNB Smart Chain

  // Testnet
  421614: 3, // Arbitrum Sepolia
  43113: 1, // Avalanche Fuji
  84532: 6, // Base Sepolia
  97: 17, // BNB Smart Chain Testnet
  11155111: 0, // Ethereum Sepolia
  59141: 11, // Linea Sepolia
  11155420: 2, // OP Sepolia
  80002: 7, // Polygon PoS Amoy
  713715: 16, // Sei Testnet
  1919: 10, // Unichain Sepolia
  4801: 14, // World Chain Sepolia
  51: 50, // XDC Apothem
}

export async function getUSDCAttestationStatus(
  providers: Providers,
  txHash: string,
  argv: {
    format: Format
    wallet?: string
    sourceDomainId?: number
  },
) {
  const receipt = await providers.getTxReceipt(txHash)
  if (!receipt) throw new Error('Transaction not found')

  const source = receipt.provider

  // Determine the Circle domain ID
  let sourceDomainId: number
  let chainId: number | undefined

  if (argv.sourceDomainId !== undefined) {
    // Use the provided source domain ID
    sourceDomainId = argv.sourceDomainId
    console.log(`Using provided source domain ID: ${sourceDomainId}`)
  } else {
    // Fall back to automatic detection from chain ID
    const network = await source.getNetwork()
    chainId = Number(network.chainId)

    if (chainId in CHAIN_ID_TO_CIRCLE_DOMAIN) {
      sourceDomainId = CHAIN_ID_TO_CIRCLE_DOMAIN[chainId]
    } else {
      throw new Error(
        `Unsupported chain ID for Circle CCTP: ${chainId}. Please check the supported networks at https://developers.circle.com/cctp/cctp-supported-blockchains or provide --source-domain-id manually`,
      )
    }
  }

  console.log(`Transaction Hash: ${txHash}`)
  if (chainId !== undefined) {
    console.log(`Network Chain ID: ${chainId}`)
  }
  console.log(`Circle Domain ID: ${sourceDomainId}`)

  // Call the new Circle API v2
  const apiUrl = `https://iris-api.circle.com/v2/messages/${sourceDomainId}?transactionHash=${txHash}`
  console.log(`Fetching from: ${apiUrl}`)

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}: ${response.statusText}`)
    }

    const data = (await response.json()) as CircleApiResponse

    console.log('\n=== Circle CCTP Attestation Status ===')

    if (data.messages && data.messages.length > 0) {
      data.messages.forEach((message, index) => {
        console.log(`\nMessage ${index + 1}:`)
        console.log(`  Status: ${message.status}`)
        console.log(`  Event Nonce: ${message.eventNonce}`)
        console.log(`  CCTP Version: ${message.cctpVersion}`)

        if (message.decodedMessage) {
          console.log(`  Source Domain: ${message.decodedMessage.sourceDomain}`)
          console.log(`  Destination Domain: ${message.decodedMessage.destinationDomain}`)
          console.log(`  Sender: ${message.decodedMessage.sender}`)
          console.log(`  Recipient: ${message.decodedMessage.recipient}`)
          console.log(`  Destination Caller: ${message.decodedMessage.destinationCaller}`)

          if (message.decodedMessage.decodedMessageBody) {
            const body = message.decodedMessage.decodedMessageBody
            console.log(`  Burn Token: ${body.burnToken}`)
            console.log(`  Mint Recipient: ${body.mintRecipient}`)
            console.log(`  Amount: ${body.amount}`)
            console.log(`  Message Sender: ${body.messageSender}`)
          }
        }

        if (message.attestation) {
          console.log(`  Attestation: ${message.attestation}`)
        }

        if (message.delayReason) {
          console.log(`  Delay Reason: ${message.delayReason}`)
        }
      })
    } else {
      console.log('No messages found for this transaction.')
    }

    // Also output raw JSON for debugging if requested
    if (argv.format === Format.json) {
      console.log('\n=== Raw JSON Response ===')
      console.log(JSON.stringify(data, null, 2))
    }
  } catch (error) {
    console.error('Error fetching attestation status:', error)
    throw error
  }
}
