# @chainlink/ccip-sdk

TypeScript SDK for integrating [CCIP](https://chain.link/cross-chain) (Cross-Chain Interoperability Protocol) into your applications.

> [!IMPORTANT]
> This tool is provided under an MIT license and is for convenience and illustration purposes only.

📖 **[Full SDK Documentation](https://docs.chain.link/ccip/tools/sdk/)** - Complete API reference, advanced patterns, and tree-shaking guide.

## Installation

```bash
npm install @chainlink/ccip-sdk
```

> [!NOTE]
> Node.js v20+ required. v24+ recommended for development (native TypeScript execution).

## Chain Classes

The SDK provides a unified `Chain` class interface for each blockchain family. Create instances using `fromUrl`:

```ts
import { EVMChain, SolanaChain, AptosChain } from '@chainlink/ccip-sdk'

// EVM chains (Ethereum, Arbitrum, Optimism, etc.)
const evmChain = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')

// Solana
const solanaChain = await SolanaChain.fromUrl('https://api.devnet.solana.com')

// Aptos
const aptosChain = await AptosChain.fromUrl('https://api.testnet.aptoslabs.com/v1')
```

## Common Tasks

### Track a CCIP Message

```ts
import { EVMChain } from '@chainlink/ccip-sdk'

const source = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')

// Fetch message details from a transaction
const requests = await source.getMessagesInTx(
  '0xb8b27d9811509e3c364c9afaf8f14d8ebc65dec06327493981d7f7f4a00f2918'
)

const request = requests[0]
console.log('Message ID:', request.message.messageId)
console.log('Sender:', request.message.sender)
console.log('Destination chain:', request.lane.destChainSelector)
```

### Get Fee Estimate

```ts
import { EVMChain, networkInfo } from '@chainlink/ccip-sdk'

const source = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')
const router = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59' // Sepolia Router
const destChainSelector = networkInfo('ethereum-testnet-sepolia-arbitrum-1').chainSelector

const fee = await source.getFee({ router, destChainSelector, message: {
  receiver: '0xYourReceiverAddress',
  data: '0x48656c6c6f', // "Hello" in hex
  extraArgs: { gasLimit: 200_000n }, // Gas limit for receiver's ccipReceive callback
} })

console.log('Fee in native token:', fee.toString())
```

### Send a Cross-Chain Message

```ts
import { EVMChain, networkInfo } from '@chainlink/ccip-sdk'
import { Wallet } from 'ethers'

const source = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')
const wallet = new Wallet('YOUR_PRIVATE_KEY', source.provider)

const router = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const destChainSelector = networkInfo('ethereum-testnet-sepolia-arbitrum-1').chainSelector

// Get fee first
const fee = await source.getFee({ router, destChainSelector, message: {
  receiver: '0xYourReceiverAddress',
  data: '0x48656c6c6f',
  extraArgs: {
    gasLimit: 200_000n,
    allowOutOfOrderExecution: true, // Don't wait for prior messages from this sender
  },
} })

// Send the message
const request = await source.sendMessage({
  router,
  destChainSelector,
  message: {
    receiver: '0xYourReceiverAddress',
    data: '0x48656c6c6f',
    extraArgs: { gasLimit: 200_000n, allowOutOfOrderExecution: true },
    fee,
  },
  wallet,
})

console.log('Transaction hash:', request.tx.hash)
console.log('Message ID:', request.message.messageId)
```

## Wallet Configuration

Transaction-sending methods require a chain-specific wallet:

| Chain  | Wallet Type     | Example                                    |
| ------ | --------------- | ------------------------------------------ |
| EVM    | `ethers.Signer` | `new Wallet(privateKey, provider)`         |
| Solana | `anchor.Wallet` | `new Wallet(Keypair.fromSecretKey(...))` |
| Aptos  | `aptos.Account` | `Account.fromPrivateKey(...)`              |

### Unsigned Transactions

For custom signing workflows (e.g., browser wallets, hardware wallets), use the `generateUnsigned*` methods:

```ts
// Generate unsigned transaction data
const unsignedTx = await source.generateUnsignedSendMessage({
  sender, // Your wallet address
  router,
  destChainSelector,
  message
})

// Sign and send with your own logic (EVM example - uses .transactions)
// Solana uses .instructions, Aptos uses .transactions (BCS-encoded), TON uses .body
// Sui does not support unsigned transaction generation
for (const tx of unsignedTx.transactions) {
  const signed = await customSigner.sign(tx)
  await customSender.broadcast(signed)
}
```

For EVM chains in browsers, get a signer from the connected wallet:

```ts
const signer = await source.provider.getSigner(0)
```

## Supported Chains

| Chain Family | Class         | Library                                                                  | Status         |
| ------------ | ------------- | ------------------------------------------------------------------------ | -------------- |
| EVM          | `EVMChain`    | [ethers.js v6](https://docs.ethers.org/v6/) ([viem](https://viem.sh) optional) | Supported      |
| Solana       | `SolanaChain` | [solana-web3.js](https://github.com/solana-foundation/solana-web3.js)    | Supported      |
| Aptos        | `AptosChain`  | [aptos-ts-sdk](https://github.com/aptos-labs/aptos-ts-sdk)               | Supported      |
| Sui          | `SuiChain`    | [@mysten/sui](https://github.com/MystenLabs/sui)                         | Partial (manual exec) |
| TON          | `TONChain`    | [@ton/ton](https://github.com/ton-org/ton)                               | Partial (no token pool/registry queries) |

## Related

- [SDK API Reference](https://docs.chain.link/ccip/tools/sdk/) - Full SDK documentation
- [@chainlink/ccip-cli](https://www.npmjs.com/package/@chainlink/ccip-cli) - Command-line interface
- [CCIP Official Docs](https://docs.chain.link/ccip) - Protocol documentation
- [CCIP Directory](https://docs.chain.link/ccip/directory) - Router addresses

## License

MIT
