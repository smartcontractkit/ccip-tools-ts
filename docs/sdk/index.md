---
id: ccip-tools-sdk
title: CCIP SDK
sidebar_label: CCIP SDK Overview
sidebar_position: 0
edit_url: https://github.com/smartcontractkit/ccip-tools-ts/edit/main/docs/sdk/index.md
---

# CCIP SDK

The TypeScript SDK for integrating CCIP into your applications.

## Installation

```bash
npm install @chainlink/ccip-sdk
```

:::note Requirements
Node.js v20+ required. v23+ recommended for native TypeScript execution.
:::

## Core Concepts

### Chain Class

The SDK uses an abstract `Chain` class that provides a unified interface across different blockchain families. Each chain family has its own implementation.

```ts
import { EVMChain, SolanaChain, AptosChain, SuiChain, TONChain } from '@chainlink/ccip-sdk'

// Create a chain instance from an RPC URL
const evmChain = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')
const solanaChain = await SolanaChain.fromUrl('https://api.devnet.solana.com')
const aptosChain = await AptosChain.fromUrl('https://api.testnet.aptoslabs.com/v1')
```

### Supported Chain Families

| Chain Family | Class | Library | Status |
|--------------|-------|---------|--------|
| EVM | `EVMChain` | [ethers.js v6](https://docs.ethers.org/v6/) or [viem](https://viem.sh/) | Supported |
| Solana | `SolanaChain` | [solana-web3.js](https://github.com/solana-foundation/solana-web3.js) | Supported |
| Aptos | `AptosChain` | [aptos-ts-sdk](https://github.com/aptos-labs/aptos-ts-sdk) | Supported |
| Sui | `SuiChain` | [@mysten/sui](https://github.com/MystenLabs/sui) | Partial (manual exec) |
| TON | `TONChain` | [@ton/ton](https://github.com/ton-org/ton) | Partial (manual exec) |

## Common Tasks

### Track a CCIP Message

```ts
import { EVMChain } from '@chainlink/ccip-sdk'

// Connect to the source chain
const source = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')

// Fetch message details from a transaction
const requests = await source.getMessagesInTx(
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
)

// Access message and lane details
const request = requests[0]
console.log('Message ID:', request.message.messageId)
console.log('Sender:', request.message.sender)
console.log('Destination chain:', request.lane.destChainSelector)
```

### Query Token Balance

```ts
import { EVMChain, SolanaChain, AptosChain } from '@chainlink/ccip-sdk'

// EVM - native balance
const evmChain = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')
const nativeBalance = await evmChain.getBalance({
  address: '0xYourAddress',
})

// EVM - ERC-20 token balance
const tokenBalance = await evmChain.getBalance({
  address: '0xYourAddress',
  token: '0xTokenContractAddress',
})

// Solana - SOL balance
const solanaChain = await SolanaChain.fromUrl('https://api.devnet.solana.com')
const solBalance = await solanaChain.getBalance({
  address: 'YourSolanaAddress',
})

// Solana - SPL Token balance (auto-detects Token-2022)
const splBalance = await solanaChain.getBalance({
  address: 'YourSolanaAddress',
  token: 'TokenMintAddress',
})

// Aptos - APT balance
const aptosChain = await AptosChain.fromUrl('https://api.testnet.aptoslabs.com/v1')
const aptBalance = await aptosChain.getBalance({
  address: '0xYourAptosAddress',
})

// Aptos - Fungible Asset balance
const faBalance = await aptosChain.getBalance({
  address: '0xYourAptosAddress',
  token: '0xFungibleAssetAddress',
})

console.log('Balance:', nativeBalance.toString()) // Raw bigint
```

### Get CCIP Fee Estimate

```ts
import { EVMChain, networkInfo } from '@chainlink/ccip-sdk'

const source = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')
const router = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59' // Sepolia Router
const destSelector = networkInfo('ethereum-testnet-sepolia-arbitrum-1').chainSelector

const fee = await source.getFee(router, destSelector, {
  receiver: '0xYourReceiverAddress',
  data: '0x', // Empty data payload
  extraArgs: { gasLimit: 200_000 }, // Gas limit for receiver's ccipReceive callback
})

console.log('Fee in native token:', fee.toString())
```

### Send a Cross-Chain Message

```ts
import { EVMChain, networkInfo } from '@chainlink/ccip-sdk'
import { Wallet } from 'ethers'

const source = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')
const wallet = new Wallet('YOUR_PRIVATE_KEY', source.provider)

const router = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59' // Sepolia Router
const destSelector = networkInfo('ethereum-testnet-sepolia-arbitrum-1').chainSelector

// Get fee first
const fee = await source.getFee(router, destSelector, {
  receiver: '0xYourReceiverAddress',
  data: '0x48656c6c6f', // "Hello" in hex
  extraArgs: {
    gasLimit: 200_000, // Gas for receiver's ccipReceive callback
    allowOutOfOrderExecution: true, // Don't wait for prior messages from this sender
  },
})

// Send the message
const request = await source.sendMessage(
  router,
  destSelector,
  {
    receiver: '0xYourReceiverAddress',
    data: '0x48656c6c6f',
    extraArgs: { gasLimit: 200_000, allowOutOfOrderExecution: true },
    fee,
  },
  { wallet }
)

console.log('Transaction hash:', request.tx.hash)
console.log('Message ID:', request.message.messageId)
```

## CCIP API Client

Query lane latency from the CCIP REST API.

### Standalone Usage

```ts
import { CCIPAPIClient } from '@chainlink/ccip-sdk'

const api = new CCIPAPIClient()

// Get estimated delivery time
const latency = await api.getLaneLatency(
  5009297550715157269n,  // Ethereum mainnet selector
  4949039107694359620n,  // Arbitrum mainnet selector
)

console.log(`Estimated delivery: ${Math.round(latency.totalMs / 60000)} minutes`)
```

### Via Chain Instance

```ts
const chain = await EVMChain.fromUrl('https://eth-mainnet.example.com')

// Uses chain's selector as source
const latency = await chain.getLaneLatency(4949039107694359620n) // To Arbitrum
console.log(`ETA: ${Math.round(latency.totalMs / 60000)} min`)
```

### Disable API (Decentralization Mode)

```ts
// Opt-out of API - uses only RPC data
const chain = await EVMChain.fromUrl(url, { apiClient: null })

// This will throw CCIPApiClientNotAvailableError
await chain.getLaneLatency(destSelector)
```

## Chain Identification

Use `networkInfo()` to convert between chain identifiers:

```ts
import { networkInfo } from '@chainlink/ccip-sdk'

// All return the same NetworkInfo object:
const info1 = networkInfo('ethereum-mainnet')       // by name
const info2 = networkInfo(1)                        // by chain ID
const info3 = networkInfo(5009297550715157269n)     // by selector (bigint)
const info4 = networkInfo('5009297550715157269')    // by selector (string)

console.log(info1.chainSelector)  // 5009297550715157269n
console.log(info1.name)           // 'ethereum-mainnet'
console.log(info1.family)         // 'evm'
```

## Error Handling

The SDK provides typed errors with recovery hints:

```ts
import {
  CCIPHttpError,
  CCIPApiClientNotAvailableError,
  CCIPTransactionNotFoundError,
  isTransientError
} from '@chainlink/ccip-sdk'

try {
  const latency = await api.getLaneLatency(source, dest)
} catch (err) {
  if (err instanceof CCIPHttpError) {
    console.error(`API error ${err.context.status}: ${err.context.apiErrorMessage}`)

    // Check if safe to retry
    if (err.isTransient) {
      // Retry after delay
    }
  }

  if (err instanceof CCIPApiClientNotAvailableError) {
    console.error('API disabled - remove apiClient: null to use this feature')
  }

  // Generic transient check
  if (isTransientError(err)) {
    console.log('Retrying...')
  }
}
```

## Wallet Configuration

Transaction-sending methods require a chain-specific wallet:

| Chain | Wallet Type | Example |
|-------|-------------|---------|
| EVM | `ethers.Signer` | `new Wallet(privateKey, provider)` |
| EVM (viem) | `viemWallet(WalletClient)` | See [Using with Viem](#using-with-viem) |
| Solana | `anchor.Wallet` | `new Wallet(Keypair.fromSecretKey(...))` |
| Aptos | `aptos.Account` | `Account.fromPrivateKey(...)` |

### Unsigned Transactions

For custom signing workflows, use the `generateUnsigned*` methods:

```ts
// Generate unsigned transaction data (returns chain-specific tx format)
const unsignedTx = await source.generateUnsignedSendMessage(
  senderAddress,  // Your wallet address
  router,
  destSelector,
  message
)

// Sign and send with your own logic
const signedTx = await customSigner.sign(unsignedTx)
await customSender.broadcast(signedTx)
```

:::tip Browser Integration
For EVM chains in browsers, get a signer from the connected wallet:
```ts
const signer = await source.provider.getSigner()
```
:::

## Using with Viem

If you prefer [viem](https://viem.sh/) over ethers.js, the SDK provides adapters via a separate entry point:

```bash
npm install viem  # Required peer dependency
```

### Create EVMChain from viem PublicClient

```ts
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { fromViemClient } from '@chainlink/ccip-sdk/viem'

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http('https://ethereum-rpc.publicnode.com'),
})

const chain = await fromViemClient(publicClient)

// All read operations work the same way
const messages = await chain.getMessagesInTx(txHash)
const fee = await chain.getFee(router, destSelector, message)
```

### Send Transactions with viem WalletClient

```ts
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { fromViemClient, viemWallet } from '@chainlink/ccip-sdk/viem'

// Create viem clients
const account = privateKeyToAccount('0x...')

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http('https://ethereum-rpc.publicnode.com'),
})

const walletClient = createWalletClient({
  chain: mainnet,
  transport: http('https://ethereum-rpc.publicnode.com'),
  account,
})

// Create EVMChain
const chain = await fromViemClient(publicClient)

// Send message using viemWallet adapter
const request = await chain.sendMessage(
  router,
  destSelector,
  message,
  { wallet: viemWallet(walletClient) }
)

console.log('Transaction:', request.tx.hash)
```

:::note Local Accounts
The `viemWallet` adapter properly handles both local accounts (created with `privateKeyToAccount`) and JSON-RPC accounts (browser wallets). It uses a custom `AbstractSigner` implementation to avoid the `eth_accounts` limitation with local accounts.
:::

## Extending the SDK

You can extend chain classes to customize behavior:

```ts
import { SolanaChain, supportedChains, ChainFamily } from '@chainlink/ccip-sdk'

class CustomSolanaChain extends SolanaChain {
  // Override methods as needed
}

// Register your custom implementation
supportedChains[ChainFamily.Solana] = CustomSolanaChain
```

## Tree-Shaking

For optimal bundle size, import only the chains you need:

```ts
// ✅ Good - only imports EVM chain
import { EVMChain } from '@chainlink/ccip-sdk'

// ⚠️ Imports all chains - larger bundle
import { allSupportedChains } from '@chainlink/ccip-sdk'
```

## Next Steps

- [CLI Reference](../cli/) - Use the command-line interface
- [Adding New Chain](../adding-new-chain) - Contribute a new chain family
- [CCIP Documentation](https://docs.chain.link/ccip) - Official CCIP docs
