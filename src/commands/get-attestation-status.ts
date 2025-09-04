import { bigIntReplacer, getUsdcAttestationV2 } from '../lib/index.ts'
import type { Providers } from '../providers.ts'
import { Format } from './types.ts'
import { withDateTimestamp } from './utils.ts'

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

  // Call the new Circle API v2
  const apiUrl = `https://iris-api.circle.com/v2/messages/${sourceDomainId}?transactionHash=${txHash}`

  try {
    const data = await getUsdcAttestationV2(sourceDomainId, txHash)

    switch (argv.format) {
      case Format.log:
        console.log(
          'attestation_status =',
          withDateTimestamp({
            txHash,
            sourceDomainId,
            chainId,
            messages: data.messages,
            timestamp: Date.now() / 1000, // Current timestamp in seconds
          }),
        )
        break

      case Format.pretty:
        console.log('\n=== Circle CCTP Attestation Status ===')
        console.log(`Fetching from: ${apiUrl}`)
        console.log(`Transaction Hash: ${txHash}`)
        if (chainId !== undefined) {
          console.log(`Network Chain ID: ${chainId}`)
        }
        console.log(`Circle Domain ID: ${sourceDomainId}`)

        if (data.messages && data.messages.length > 0) {
          // Create table data for each message
          data.messages.forEach((message, index) => {
            console.log(`\n📄 Message ${index + 1}:`)

            // Basic message info table
            const messageInfo = {
              Status: message.status,
              'Event Nonce': message.eventNonce,
              'CCTP Version': message.cctpVersion,
              'Delay Reason': message.delayReason || 'None',
            }
            console.table(messageInfo)

            // Decoded message table
            if (message.decodedMessage) {
              console.log('\n🔍 Decoded Message:')
              const decodedInfo = {
                'Source Domain': message.decodedMessage.sourceDomain,
                'Destination Domain': message.decodedMessage.destinationDomain,
                Sender: message.decodedMessage.sender,
                Recipient: message.decodedMessage.recipient,
                'Destination Caller': message.decodedMessage.destinationCaller,
              }
              console.table(decodedInfo)

              // Token transfer details table
              if (message.decodedMessage.decodedMessageBody) {
                console.log('\n💰 Token Transfer Details:')
                const body = message.decodedMessage.decodedMessageBody
                const tokenInfo = {
                  'Burn Token': body.burnToken,
                  'Mint Recipient': body.mintRecipient,
                  Amount: body.amount,
                  'Message Sender': body.messageSender,
                }
                console.table(tokenInfo)
              }
            }

            // Attestation info
            if (message.attestation) {
              console.log('\n🔐 Attestation:')
              console.log(`${message.attestation}`)
            }
          })
        } else {
          console.log('❌ No messages found for this transaction.')
        }
        break

      case Format.json:
        console.info(
          JSON.stringify(
            {
              txHash,
              sourceDomainId,
              chainId,
              ...data,
            },
            bigIntReplacer,
            2,
          ),
        )
        break
    }
  } catch (error) {
    console.error('Error fetching attestation status:', error)
    throw error
  }
}
