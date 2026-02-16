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

| Chain Family | Class         | Library                                                                 | Status                |
| ------------ | ------------- | ----------------------------------------------------------------------- | --------------------- |
| EVM          | `EVMChain`    | [ethers.js v6](https://docs.ethers.org/v6/) or [viem](https://viem.sh/) | Supported             |
| Solana       | `SolanaChain` | [solana-web3.js](https://github.com/solana-foundation/solana-web3.js)   | Supported             |
| Aptos        | `AptosChain`  | [aptos-ts-sdk](https://github.com/aptos-labs/aptos-ts-sdk)              | Supported             |
| Sui          | `SuiChain`    | [@mysten/sui](https://github.com/MystenLabs/sui)                        | Partial (manual exec) |
| TON          | `TONChain`    | [@ton/ton](https://github.com/ton-org/ton)                              | Partial (manual exec) |

## Common Tasks

### Track a CCIP Message

```ts
import { EVMChain } from '@chainlink/ccip-sdk'

// Connect to the source chain
const source = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')

// Fetch message details from a transaction
const requests = await source.getMessagesInTx(
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
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
  holder: '0xYourAddress',
})

// EVM - ERC-20 token balance
const tokenBalance = await evmChain.getBalance({
  holder: '0xYourAddress',
  token: '0xTokenContractAddress',
})

// Solana - SOL balance
const solanaChain = await SolanaChain.fromUrl('https://api.devnet.solana.com')
const solBalance = await solanaChain.getBalance({
  holder: 'YourSolanaAddress',
})

// Solana - SPL Token balance (auto-detects Token-2022)
const splBalance = await solanaChain.getBalance({
  holder: 'YourSolanaAddress',
  token: 'TokenMintAddress',
})

// Aptos - APT balance
const aptosChain = await AptosChain.fromUrl('https://api.testnet.aptoslabs.com/v1')
const aptBalance = await aptosChain.getBalance({
  holder: '0xYourAptosAddress',
})

// Aptos - Fungible Asset balance
const faBalance = await aptosChain.getBalance({
  holder: '0xYourAptosAddress',
  token: '0xFungibleAssetAddress',
})

console.log('Balance:', nativeBalance.toString()) // Raw bigint
```

### Query Token Pool Configuration

Inspect token pool configurations and remote chain settings:

```ts
import { EVMChain } from '@chainlink/ccip-sdk'

const chain = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')
const poolAddress = '0xYourTokenPoolAddress'

// Get pool configuration (token, router, version)
const config = await chain.getTokenPoolConfig(poolAddress)
console.log('Token:', config.token)
console.log('Router:', config.router)
console.log('Version:', config.typeAndVersion) // e.g., "BurnMintTokenPool 1.5.1"

// Get all remote chain configurations
const remotes = await chain.getTokenPoolRemotes(poolAddress)
// Returns: { "arbitrum-mainnet": { remoteToken, remotePools, ... }, ... }

for (const [chainName, remote] of Object.entries(remotes)) {
  console.log(`${chainName}: token=${remote.remoteToken}, pools=${remote.remotePools.length}`)
}

// Get configuration for a specific remote chain
const arbitrumSelector = 4949039107694359620n
const arbRemote = await chain.getTokenPoolRemote(poolAddress, arbitrumSelector)
console.log('Remote token on Arbitrum:', arbRemote.remoteToken)
console.log('Inbound rate limit:', arbRemote.inboundRateLimiterState) // null if disabled
```

:::note Chain-Specific Fields
Some chains return additional fields:
- **Solana**: Includes `tokenPoolProgram` (the program ID)
- **EVM**: `typeAndVersion` is always present

Use `instanceof` to access chain-specific fields with full TypeScript support:

```ts
import { SolanaChain, EVMChain } from '@chainlink/ccip-sdk'

if (chain instanceof SolanaChain) {
  const config = await chain.getTokenPoolConfig(poolAddress)
  console.log('Program:', config.tokenPoolProgram) // TypeScript knows this exists!
} else if (chain instanceof EVMChain) {
  const config = await chain.getTokenPoolConfig(poolAddress)
  console.log('Version:', config.typeAndVersion) // Required on EVM
}
```
:::

### Query Token Admin Registry

Look up token administrator and pool information:

```ts
const registryAddress = '0xYourTokenAdminRegistryAddress'
const tokenAddress = '0xYourTokenAddress'

const tokenConfig = await chain.getRegistryTokenConfig(registryAddress, tokenAddress)
console.log('Administrator:', tokenConfig.administrator)
console.log('Token Pool:', tokenConfig.tokenPool)
if (tokenConfig.pendingAdministrator) {
  console.log('Pending admin transfer to:', tokenConfig.pendingAdministrator)
}

// List all supported tokens in a registry
const tokens = await chain.getSupportedTokens(registryAddress)
console.log('Supported tokens:', tokens)
```

### Get CCIP Fee Estimate

> **Note:** The `receiver` field must be a valid address for the destination chain family. For instance: EVM uses 20-byte hex (e.g., `0x6d1af98d635d3121286ddda1a0c2d7078b1523ed`), Solana uses Base58 (e.g., `7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV`).

```ts
import { EVMChain, networkInfo } from '@chainlink/ccip-sdk'

const source = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')
const router = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59' // Sepolia Router
const destSelector = networkInfo('ethereum-testnet-sepolia-arbitrum-1').chainSelector

const fee = await source.getFee({
  router,
  destChainSelector: destSelector,
  message: {
    receiver: '0xYourReceiverAddress',
    data: '0x', // Empty data payload
    extraArgs: { gasLimit: 200_000 }, // Gas limit for receiver's ccipReceive callback
  },
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
const fee = await source.getFee({
  router,
  destChainSelector: destSelector,
  message: {
    receiver: '0xYourReceiverAddress',
    data: '0x48656c6c6f', // "Hello" in hex
    extraArgs: {
      gasLimit: 200_000, // Gas for receiver's ccipReceive callback
      allowOutOfOrderExecution: true, // Don't wait for prior messages from this sender
    },
  },
})

// Send the message
const request = await source.sendMessage({
  router,
  destChainSelector: destSelector,
  message: {
    receiver: '0xYourReceiverAddress',
    data: '0x48656c6c6f',
    extraArgs: { gasLimit: 200_000, allowOutOfOrderExecution: true },
    fee,
  },
  wallet,
})

console.log('Transaction hash:', request.tx.hash)
console.log('Message ID:', request.message.messageId)
```

### Transfer Tokens Cross-Chain

Send tokens to another chain. Only `receiver` is required:

**EVM:**

```ts
import { EVMChain, networkInfo, type MessageInput } from '@chainlink/ccip-sdk'
import { Wallet } from 'ethers'

const source = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')
const wallet = new Wallet('YOUR_PRIVATE_KEY', source.provider)

const router = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59' // Sepolia Router
const destSelector = networkInfo('ethereum-testnet-sepolia-arbitrum-1').chainSelector
const linkToken = '0x779877A7B0D9E8603169DdbD7836e478b4624789' // LINK on Sepolia

const message: MessageInput = {
  receiver: '0xYourReceiverAddress',
  tokenAmounts: [{ token: linkToken, amount: 1_500_000_000_000_000_000n }], // 1.5 LINK
}

const request = await source.sendMessage({
  router,
  destChainSelector: destSelector,
  message,
  wallet,
})

console.log('Transaction hash:', request.tx.hash)
console.log('Message ID:', request.message.messageId)
```

**Solana:**

```ts
import { SolanaChain, networkInfo, type MessageInput } from '@chainlink/ccip-sdk'
import { Wallet } from '@coral-xyz/anchor'
import { Keypair } from '@solana/web3.js'

const source = await SolanaChain.fromUrl('https://api.devnet.solana.com')
const wallet = new Wallet(Keypair.fromSecretKey(yourSecretKey))

const message: MessageInput = {
  receiver: '0xYourEVMReceiverAddress',
  tokenAmounts: [{ token: 'SPLTokenMintAddress', amount: 1_000_000n }],
}

const request = await source.sendMessage({
  router: 'SolanaRouterProgramAddress',
  destChainSelector: networkInfo('ethereum-testnet-sepolia').chainSelector,
  message,
  wallet,
})

console.log('Transaction hash:', request.tx.hash)
console.log('Message ID:', request.message.messageId)
```

:::note Defaults

- `extraArgs.gasLimit` / `extraArgs.computeUnits`: `0` for token-only transfers
- `extraArgs.allowOutOfOrderExecution`: `true`
- `data`: Empty
- `feeToken`: Native token (ETH or SOL)
- Token approvals and fee calculation handled by `sendMessage`
  :::

### Generate Unsigned Transactions

For custom signing workflows (hardware wallets, multi-sig), use `generateUnsignedSendMessage`:

```ts
import { EVMChain, networkInfo, type MessageInput } from '@chainlink/ccip-sdk'

const source = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')

const message: MessageInput = {
  receiver: '0xYourReceiverAddress',
  tokenAmounts: [
    { token: '0x779877A7B0D9E8603169DdbD7836e478b4624789', amount: 1_500_000_000_000_000_000n },
  ],
}

const unsignedTxs = await source.generateUnsignedSendMessage({
  sender: '0xYourWalletAddress',
  router: '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59',
  destChainSelector: networkInfo('ethereum-testnet-sepolia-arbitrum-1').chainSelector,
  message,
})

// Returns: { transactions: [approvalTx?, approvalTx?, ..., ccipSendTx] }
// Last transaction is always ccipSend
for (const tx of unsignedTxs.transactions) {
  const signedTx = await yourSigner.sign(tx)
  await yourBroadcaster.send(signedTx)
}
```

:::note
Only generates approval transactions for tokens with insufficient allowance.
:::

## CCIP API Client

Query lane latency from the CCIP REST API.

### Standalone Usage

```ts
import { CCIPAPIClient } from '@chainlink/ccip-sdk'

const api = new CCIPAPIClient()

// Get estimated delivery time
const latency = await api.getLaneLatency(
  5009297550715157269n, // Ethereum mainnet selector
  4949039107694359620n, // Arbitrum mainnet selector
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

### Custom Configuration

```ts
const api = new CCIPAPIClient('https://api.ccip.chain.link', {
  timeoutMs: 60000, // Request timeout in ms (default: 30000)
  logger: customLogger, // Custom logger instance
  fetch: customFetch, // Custom fetch function
})
```

### Fetch Message by ID

Retrieve full message details using a message ID:

```ts
import { CCIPAPIClient } from '@chainlink/ccip-sdk'

const api = new CCIPAPIClient()

// Fetch message by its unique ID
const request = await api.getMessageById(
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
)

// Access standard fields
console.log('Message ID:', request.message.messageId)
console.log('Sender:', request.message.sender)
console.log('Lane:', request.lane.sourceChainSelector, '→', request.lane.destChainSelector)

// Access API metadata (present when fetched via API)
if (request.metadata) {
  console.log('Status:', request.metadata.status) // 'SUCCESS', 'FAILED', 'SENT', etc.
  console.log('Ready for manual exec:', request.metadata.readyForManualExecution)
  if (request.metadata.deliveryTime) {
    console.log('Delivery time:', request.metadata.deliveryTime, 'ms')
  }
}
```

When fetched via the API, `CCIPRequest` includes a `metadata` field with additional information:

#### API Metadata Fields

| Field                     | Type            | Description                              |
| ------------------------- | --------------- | ---------------------------------------- |
| `status`                  | `MessageStatus` | SENT, COMMITTED, SUCCESS, FAILED, etc.   |
| `readyForManualExecution` | `boolean`       | Whether manual execution is available    |
| `finality`                | `bigint`        | Block confirmations on source chain      |
| `receiptTransactionHash`  | `string?`       | Execution tx hash (if completed)         |
| `receiptTimestamp`        | `number?`       | Execution timestamp (if completed)       |
| `deliveryTime`            | `bigint?`       | End-to-end delivery time in ms           |
| `sourceNetworkInfo`       | `NetworkInfo`   | Source chain metadata                    |
| `destNetworkInfo`         | `NetworkInfo`   | Destination chain metadata               |

#### Message Status Lifecycle

The `MessageStatus` enum represents the current state of a cross-chain message:

```ts
import { MessageStatus } from '@chainlink/ccip-sdk'

// Check message status
if (request.metadata.status === MessageStatus.Success) {
  console.log('Transfer complete!')
}
```

| Status | Description |
| ------ | ----------- |
| `Sent` | Message sent on source chain, pending finalization |
| `SourceFinalized` | Source chain transaction finalized |
| `Committed` | Commit report accepted on destination chain |
| `Blessed` | Commit blessed by Risk Management Network |
| `Verifying` | Message is being verified by the CCIP network |
| `Verified` | Message has been verified by the CCIP network |
| `Success` | Message executed successfully on destination |
| `Failed` | Message execution failed on destination |
| `Unknown` | API returned an unrecognized status (see note below) |

:::warning Unknown Status
If you encounter `MessageStatus.Unknown`, it means the CCIP API returned a status value that your SDK version doesn't recognize. This typically happens when new status values are added to the API. **Update to the latest SDK version** to handle new status values properly.
:::

### Find Messages in a Transaction

Get all CCIP message IDs from a source transaction:

```ts
const api = new CCIPAPIClient()

// Get message IDs from transaction hash
const messageIds = await api.getMessageIdsInTx(
  '0x9428debf5e5f0123456789abcdef1234567890abcdef1234567890abcdef1234',
)

console.log(`Found ${messageIds.length} CCIP message(s)`)

// Fetch full details for each message
for (const id of messageIds) {
  const request = await api.getMessageById(id)
  console.log(`Message ${id}: ${request.metadata?.status}`)
}
```

Supports both EVM hex hashes (`0x...`) and Solana Base58 signatures.

### API Mode Configuration

By default, Chain instances use the CCIP API for enhanced functionality. You can configure this behavior:

```ts
import { EVMChain, DEFAULT_API_RETRY_CONFIG } from '@chainlink/ccip-sdk'

// Default: API enabled with automatic retry on fallback
const chain = await EVMChain.fromUrl(url)

// Custom retry configuration for API fallback operations
const chainWithRetry = await EVMChain.fromUrl(url, {
  apiRetryConfig: {
    maxRetries: 5, // Max retry attempts (default: 3)
    initialDelayMs: 2000, // Initial delay before first retry (default: 1000)
    backoffMultiplier: 1.5, // Multiplier for exponential backoff (default: 2)
    maxDelayMs: 60000, // Maximum delay cap (default: 30000)
    respectRetryAfterHint: true, // Use error's retryAfterMs when available (default: true)
  },
})

// Fully decentralized mode - uses only RPC data, no API
const decentralizedChain = await EVMChain.fromUrl(url, { apiClient: null })
```

#### API Fallback Workflow

When `getMessagesInTx()` fails to retrieve messages via RPC (e.g., due to an unsupported chain or RPC errors), it automatically falls back to the CCIP API with retry logic:

1. First attempt via RPC
2. On failure, query the API for message IDs
3. Retry with exponential backoff on transient errors (5xx, timeouts)
4. Respects `retryAfterMs` hints from error responses

This provides resilience against temporary API issues while maintaining decentralization as the primary path.

Similarly, `getMessageById()` uses retry logic when fetching message details by ID:

1. Query the API for message details
2. Retry with exponential backoff on transient errors (5xx, timeouts)
3. Respects `retryAfterMs` hints from error responses

#### Decentralized Mode

Disable the API entirely for fully decentralized operation:

```ts
// Opt-out of API - uses only RPC data
const chain = await EVMChain.fromUrl(url, { apiClient: null })

// API-dependent methods will throw CCIPApiClientNotAvailableError
await chain.getLaneLatency(destSelector) // Throws
```

### Retry Utility

The SDK exports a `withRetry` utility for implementing custom retry logic with exponential backoff:

```ts
import { withRetry, DEFAULT_API_RETRY_CONFIG } from '@chainlink/ccip-sdk'

const result = await withRetry(
  async () => {
    // Your async operation that may fail transiently
    return await someApiCall()
  },
  {
    maxRetries: 3,
    initialDelayMs: 1000,
    backoffMultiplier: 2,
    maxDelayMs: 30000,
    respectRetryAfterHint: true,
    logger: console, // Optional: logs retry attempts
  },
)
```

The utility only retries on transient errors (5xx HTTP errors, timeouts). Non-transient errors (4xx, validation errors) are thrown immediately.

## Chain Identification

Use `networkInfo()` to convert between chain identifiers:

```ts
import { networkInfo } from '@chainlink/ccip-sdk'

// All return the same NetworkInfo object:
const info1 = networkInfo('ethereum-mainnet') // by name
const info2 = networkInfo(1) // by chain ID
const info3 = networkInfo(5009297550715157269n) // by selector (bigint)
const info4 = networkInfo('5009297550715157269') // by selector (string)

console.log(info1.chainSelector) // 5009297550715157269n
console.log(info1.name) // 'ethereum-mainnet'
console.log(info1.family) // 'evm'
```

## Error Handling

The SDK provides typed errors with recovery hints:

```ts
import {
  CCIPHttpError,
  CCIPApiClientNotAvailableError,
  CCIPTransactionNotFoundError,
  CCIPMessageIdNotFoundError,
  CCIPMessageIdValidationError,
  CCIPMessageRetrievalError,
  CCIPMessageNotFoundInTxError,
  CCIPUnexpectedPaginationError,
  CCIPTimeoutError,
  isTransientError,
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

### Message Retrieval Errors

```ts
try {
  const request = await api.getMessageById(messageId)
} catch (err) {
  if (err instanceof CCIPMessageIdValidationError) {
    // Invalid format - must be 0x + 64 hex chars
    console.error('Invalid message ID format')
  }

  if (err instanceof CCIPMessageIdNotFoundError) {
    // Message not found - may still be indexing (transient)
    if (err.isTransient) {
      console.log('Message not indexed yet, retrying...')
    }
  }

  if (err instanceof CCIPMessageRetrievalError) {
    // Both API and RPC failed
    console.error('API error:', err.context.apiError)
    console.error('RPC error:', err.context.rpcError)
  }
}
```

### Transaction Message Lookup Errors

```ts
try {
  const messageIds = await api.getMessageIdsInTx(txHash)
} catch (err) {
  if (err instanceof CCIPMessageNotFoundInTxError) {
    // No CCIP messages found - tx may still be indexing
    if (err.isTransient) {
      console.log('Transaction not indexed yet, retrying in 30s...')
    }
  }

  if (err instanceof CCIPUnexpectedPaginationError) {
    // Rare: transaction contains >100 CCIP messages
    console.error(`Too many messages: ${err.context.messageCount}+`)
  }
}
```

### Timeout Errors

```ts
try {
  const request = await api.getMessageById(messageId)
} catch (err) {
  if (err instanceof CCIPTimeoutError) {
    // Request timed out - transient, safe to retry
    console.log(`Timeout after ${err.context.timeoutMs}ms`)
    // err.retryAfterMs suggests 5000ms delay before retry
  }
}
```

Configure custom timeout when creating the client:

```ts
const api = new CCIPAPIClient('https://api.ccip.chain.link', {
  timeoutMs: 60000, // 60 seconds (default: 30000ms)
})
```

## Wallet Configuration

Transaction-sending methods require a chain-specific wallet:

| Chain      | Wallet Type                | Example                                  |
| ---------- | -------------------------- | ---------------------------------------- |
| EVM        | `ethers.Signer`            | `new Wallet(privateKey, provider)`       |
| EVM (viem) | `viemWallet(WalletClient)` | See [Using with Viem](#using-with-viem)  |
| Solana     | `anchor.Wallet`            | `new Wallet(Keypair.fromSecretKey(...))` |
| Aptos      | `aptos.Account`            | `Account.fromPrivateKey(...)`            |

### Unsigned Transactions

For custom signing workflows, use the `generateUnsigned*` methods:

```ts
// Generate unsigned transaction data (returns chain-specific tx format)
const unsignedTx = await source.generateUnsignedSendMessage({
  sender: senderAddress, // Your wallet address
  router,
  destChainSelector: destSelector,
  message,
})

// Sign and send with your own logic
for (const tx of unsignedTx.transactions) {
  const signedTx = await customSigner.sign(tx)
  await customSender.broadcast(signedTx)
}
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
const fee = await chain.getFee({ router, destChainSelector: destSelector, message })
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
const request = await chain.sendMessage({
  router,
  destChainSelector: destSelector,
  message,
  wallet: viemWallet(walletClient),
})

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

The CCIP SDK supports multiple blockchain ecosystems, each with distinct dependencies. Tree-shaking allows your bundler to include only the chains you actually use, significantly reducing your application's bundle size.

```ts
// Single chain - smallest bundle
import { EVMChain } from '@chainlink/ccip-sdk'

// Multiple specific chains
import { EVMChain, SolanaChain } from '@chainlink/ccip-sdk'

// All chains - largest bundle, use only if needed
import { allSupportedChains } from '@chainlink/ccip-sdk/all'
```

### Bundle Sizes

| Import | Minified | Gzipped |
|--------|----------|---------|
| EVM | 740 KB | ~180 KB |
| Solana | 1.2 MB | ~290 KB |
| Aptos | 1.4 MB | ~340 KB |
| TON | 1.0 MB | ~240 KB |
| EVM + Solana | 1.4 MB | ~340 KB |
| All chains | 3.0 MB | ~720 KB |

### Browser Polyfills

#### Do I Need Polyfills?

| Your Setup | Buffer Polyfill Required? |
|------------|---------------------------|
| Node.js (any chain) | No - Buffer is built-in |
| Browser + EVM only | No (production) / Yes (Vite dev mode) |
| Browser + Aptos only | No |
| Browser + Solana | Yes |
| Browser + TON | Yes |
| Browser + Sui | Yes |
| Browser + All chains | Yes |

#### Why Polyfills Are Needed

Solana, TON, and Sui blockchain libraries use Node.js's built-in `Buffer` class for binary data handling. Browsers don't provide this global, so you need to polyfill it.

**EVM and Aptos chains** use browser-native APIs (`Uint8Array`, `TextEncoder`) and don't require polyfills.

> **Important**: Even if you only use EVM chains, Vite's development server pre-bundles all SDK dependencies. Add the Buffer polyfill to avoid errors during `vite dev`.

#### Bundler Configurations

The following configurations are production-ready and handle both polyfills and tree-shaking. Tree-shaking works automatically when using ES module imports (`import { X } from`), but each bundler needs proper setup for the Buffer polyfill.

**Vite**

```bash
npm install vite-plugin-node-polyfills
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['buffer'],
      globals: { Buffer: true },
    }),
  ],
})
```

> Tree-shaking and minification work automatically in Vite. This config works for both `vite dev` and `vite build`.

**Webpack 5**

```bash
npm install buffer
```

```js
// webpack.config.js
const webpack = require('webpack')

module.exports = {
  resolve: {
    fallback: { buffer: require.resolve('buffer/') },
  },
  plugins: [
    new webpack.ProvidePlugin({ Buffer: ['buffer', 'Buffer'] }),
  ],
}
```

```bash
# Development
webpack --mode development

# Production (tree-shaking + minification)
webpack --mode production
```

> Tree-shaking and minification are enabled automatically with `--mode production`. Add TypeScript loader and entry/output as needed for your project.

**esbuild**

```bash
npm install buffer
```

```js
// buffer-shim.js
import { Buffer } from 'buffer'
globalThis.Buffer = Buffer
```

```bash
# Development (faster builds, no minification)
esbuild src/index.ts --bundle --inject:./buffer-shim.js --platform=browser --define:global=globalThis --outfile=dist/bundle.js

# Production (minified, tree-shaken)
esbuild src/index.ts --bundle --inject:./buffer-shim.js --platform=browser --define:global=globalThis --minify --outfile=dist/bundle.js
```

> Tree-shaking is automatic in esbuild. Add `--minify` for production builds.

**Parcel**

Parcel 2 automatically polyfills Buffer when dependencies require it:

```bash
npm install buffer
```

```bash
# Development (with HMR)
parcel src/index.html

# Production (minified, tree-shaken)
parcel build src/index.html
```

> Parcel handles polyfills, tree-shaking, and minification automatically. No configuration file needed.

**Rollup**

```bash
npm install buffer @rollup/plugin-node-resolve @rollup/plugin-commonjs @rollup/plugin-inject @rollup/plugin-terser
```

```js
// rollup.config.js
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import inject from '@rollup/plugin-inject'
import terser from '@rollup/plugin-terser'

export default {
  input: 'src/index.js',
  output: { file: 'dist/bundle.js', format: 'es' },
  plugins: [
    resolve({ browser: true, preferBuiltins: false }),
    commonjs(),
    inject({ Buffer: ['buffer', 'Buffer'] }),
    terser(), // Minification
  ],
}
```

> Tree-shaking is Rollup's core feature and works automatically. Add `@rollup/plugin-typescript` if using TypeScript.

**Bun**

Bun requires a custom build script to ensure the Buffer polyfill loads before the SDK code:

```bash
bun add buffer
```

```js
// buffer-shim.js
import { Buffer } from 'buffer/'
globalThis.Buffer = Buffer
```

```ts
// build.ts
const isProduction = process.env.NODE_ENV === 'production'

const polyfillResult = await Bun.build({
  entrypoints: ['./buffer-shim.js'],
  target: 'browser',
  minify: isProduction,
})
const polyfillCode = await polyfillResult.outputs[0].text()

const mainResult = await Bun.build({
  entrypoints: ['./src/index.ts'],
  target: 'browser',
  minify: isProduction,
})
const mainCode = await mainResult.outputs[0].text()

// Wrap in IIFEs to avoid variable conflicts
const combined = `(function(){${polyfillCode}})();(function(){${mainCode}})();`
await Bun.write('./dist/bundle.js', combined)

console.log(`Built ${isProduction ? 'production' : 'development'} bundle`)
```

```bash
# Development
bun run build.ts

# Production
NODE_ENV=production bun run build.ts
```

> Bun's tree-shaking is automatic. The custom script is required because Bun hoists imports, which can place the polyfill after SDK code that needs it.

#### Framework Integration

**Next.js**

```bash
npm install buffer
```

```js
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Client-side polyfill
      config.resolve.fallback = {
        ...config.resolve.fallback,
        buffer: require.resolve('buffer/'),
      }
    }
    return config
  },
}
module.exports = nextConfig
```

For client components using Solana/TON, add at the top of your component:

```tsx
'use client'
import { Buffer } from 'buffer'
if (typeof window !== 'undefined') {
  window.Buffer = Buffer
}
```

> Next.js handles tree-shaking automatically in production builds. The polyfill is only needed client-side.

**Remix**

Remix uses esbuild under the hood. Add the buffer shim to your client entry:

```bash
npm install buffer
```

```ts
// app/entry.client.tsx
import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

// ... rest of entry.client.tsx
```

> Remix tree-shakes automatically in production builds.

#### Verify Your Setup

After configuring your bundler, verify the polyfill is working:

```ts
// Add to your app's entry point or browser console
console.log('Buffer available:', typeof Buffer !== 'undefined')
console.log('Buffer works:', Buffer.from('test').toString('hex') === '74657374')
```

**Check bundle size** to verify tree-shaking:

```bash
# Check output file size
ls -lh dist/*.js

# For detailed analysis (install source-map-explorer first)
npx source-map-explorer dist/bundle.js
```

Expected sizes for EVM-only: ~740 KB minified, ~180 KB gzipped.

### Troubleshooting

#### `ReferenceError: Buffer is not defined`

**Cause**: Using Solana or TON chains without the Buffer polyfill, or the polyfill isn't loading before SDK code.

**Solution**:
1. Verify the polyfill configuration for your bundler (see above)
2. Ensure `buffer` package is installed: `npm ls buffer`
3. For Bun, use the custom build script to ensure correct load order

#### `Cannot find module 'buffer'`

**Cause**: The `buffer` package is not installed.

**Solution**:
```bash
npm install buffer
```

#### Bundle size larger than expected

**Cause**: Tree-shaking may not be working, or you're importing more chains than needed.

**Symptoms**: EVM-only bundle exceeds 1 MB.

**Solution**:
1. Verify you're using ES module imports (not `require()`)
2. Check you're importing specific chains, not `allSupportedChains`
3. Run a bundle analyzer to identify unexpected inclusions:
   ```bash
   # Webpack
   npx webpack-bundle-analyzer dist/stats.json

   # Vite
   npx vite-bundle-visualizer
   ```

#### Vite dev server errors with EVM-only code

**Cause**: Vite pre-bundles all SDK dependencies in development mode, including Solana/TON libraries that need Buffer.

**Solution**: Add the Buffer polyfill even for EVM-only development. This is only needed for `vite dev`; production builds will tree-shake correctly.

#### `The requested module does not provide an export named 'X'`

**Cause**: CommonJS/ESM compatibility issues, typically with older dependencies.

**Solution**: Clear Vite's cache and rebuild:

```bash
rm -rf node_modules/.vite
npm run dev
```

If the issue persists, add the problematic package to Vite's pre-bundling:

```ts
// vite.config.ts
export default defineConfig({
  optimizeDeps: {
    include: ['problematic-package-name'],
  },
  // ... rest of config
})
```

## Next Steps

- [CLI Reference](../cli/) - Use the command-line interface
- [Adding New Chain](../adding-new-chain) - Contribute a new chain family
- [CCIP Documentation](https://docs.chain.link/ccip) - Official CCIP docs
