import {
  Connection,
  PublicKey,
  clusterApiUrl,
  type ParsedTransactionWithMeta,
  type GetVersionedTransactionConfig,
} from '@solana/web3.js'

const OFFRAMP_ADDRESS = 'offVkroQ4wYMv6QFPBvJazAx2p8BnLh7sJRdyQ5GYfx'

const TRANSACTION_LIMIT = 500

async function fetchRecentTransactions() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')
  const publicKey = new PublicKey(OFFRAMP_ADDRESS)

  try {
    const signatures = await connection.getSignaturesForAddress(publicKey, {
      limit: TRANSACTION_LIMIT,
    })

    console.log(`Fetched ${signatures.length} transaction signatures`)

    for (const signatureInfo of signatures) {
      const signature = signatureInfo.signature

      var config: GetVersionedTransactionConfig = {
        maxSupportedTransactionVersion: 0,
      }
      const transaction: ParsedTransactionWithMeta | null = await connection.getParsedTransaction(
        signature,
        config,
      )

      if (transaction) {
        console.log('----------------------------------------')
        console.log(`Signature: ${signature}`)
        console.log(`Slot: ${transaction.slot}`)
        console.log(`Block Time: ${transaction.blockTime}`)
        console.log('Transaction Details:', JSON.stringify(transaction, null, 2))
        console.log('----------------------------------------')
      } else {
        console.log(`Transaction details not available for signature: ${signature}`)
      }
    }
  } catch (error) {
    console.error('Error fetching transactions:', error)
  }
}

async function offrampExplorations() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed')
  const publicKey = new PublicKey(OFFRAMP_ADDRESS)

  try {
    const signatures = await connection.getSignaturesForAddress(publicKey, {
      limit: TRANSACTION_LIMIT,
    })

    console.log(`Fetched ${signatures.length} transaction signatures`)

    for (const signatureInfo of signatures) {
      const signature = signatureInfo.signature

      var config: GetVersionedTransactionConfig = {
        maxSupportedTransactionVersion: 0,
      }
      const transaction: ParsedTransactionWithMeta | null = await connection.getParsedTransaction(
        signature,
        config,
      )

      if (
        signature ==
        '5aMj5oG7p72kn7MrEizWkxkcZr6X1X8kJ8ioMBP6RqQKAq5amiDKmEN7ZPZzhRLJ3GZEsXHcMkuozmQdSHyBJCSF'
      ) {
        console.log('----------------------------------------')
        console.log(`Signature: ${signature}`)
        console.log(`Slot: ${transaction.slot}`)
        console.log(`Block Time: ${transaction.blockTime}`)
        console.log('Transaction Details:', JSON.stringify(transaction, null, 2))
        console.log('----------------------------------------')
        return
      } else {
        console.log(`Transaction details not available for signature: ${signature}`)
      }
    }
  } catch (error) {
    console.error('Error fetching transactions:', error)
  }
}

// fetchRecentTransactions();
offrampExplorations()
