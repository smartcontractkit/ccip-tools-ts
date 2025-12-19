---
id: ccip-tools-overview
title: CCIP Tools
sidebar_label: Overview
sidebar_position: 0
edit_url: https://github.com/smartcontractkit/ccip-tools-ts/edit/main/docs/index.md
---

# CCIP Tools

TypeScript SDK and CLI for [Chainlink CCIP](https://chain.link/cross-chain) (Cross-Chain Interoperability Protocol).

:::important
This tool is provided under an MIT license and is for convenience and illustration purposes only.
:::

## What You Can Do

| Task | Tool | Example |
|------|------|---------|
| Track message status | CLI | `ccip-cli show 0xTxHash` |
| Send cross-chain message | SDK/CLI | Programmatic or command-line |
| Manually execute stuck message | CLI | `ccip-cli manualExec 0xTxHash` |
| Check supported tokens | CLI | `ccip-cli getSupportedTokens chain router` |
| Integrate CCIP in your dApp | SDK | Import and use in your code |

## Quick Start

### Install

```bash
# CLI (global install)
npm install -g @chainlink/ccip-cli

# SDK (project dependency)
npm install @chainlink/ccip-sdk
```

### Verify Installation

Track an existing CCIP message to verify everything works:

```bash
# Track a message on Sepolia → Arbitrum Sepolia
ccip-cli show 0x0e0e39d96754b8a35a07b233e79e20807af3045e77f183ee6a23e6d628396273 \
  -r https://ethereum-sepolia-rpc.publicnode.com \
  -r https://arbitrum-sepolia-rpc.publicnode.com
```

You should see message details, commit status, and execution state.

### Your First Message (SDK)

```ts
import { EVMChain, networkInfo } from '@chainlink/ccip-sdk'

// 1. Connect to source chain
const source = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')

// 2. Define your message
const router = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59' // Sepolia Router
const dest = networkInfo('ethereum-testnet-sepolia-arbitrum-1').chainSelector
const message = {
  receiver: '0xYourReceiverAddress',
  data: '0x48656c6c6f', // "Hello" in hex
  extraArgs: { gasLimit: 200_000 }, // Gas for receiver's ccipReceive callback
}

// 3. Get the fee
const fee = await source.getFee(router, dest, message)
console.log('Fee:', fee.toString())

// 4. Send (requires wallet - see SDK docs)
// const request = await source.sendMessage(router, dest, { ...message, fee }, { wallet })
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  ccip-tools-ts                                                      │
│                                                                     │
│  ┌──────────────────────────┐        ┌──────────────────────────┐  │
│  │                          │        │                          │  │
│  │   @chainlink/ccip-sdk    │◀───────│   @chainlink/ccip-cli    │  │
│  │                          │        │                          │  │
│  │  • Chain abstraction     │        │  • show, send, manualExec│  │
│  │  • Message tracking      │        │  • RPC management        │  │
│  │  • Fee estimation        │        │  • Wallet integration    │  │
│  │  • Transaction building  │        │  • Output formatting     │  │
│  │                          │        │                          │  │
│  └──────────────────────────┘        └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**SDK** - Library for programmatic integration. Supports multiple chain families.

**CLI** - Command-line tool that uses the SDK. Great for debugging, testing, and scripting.

## Supported Chains

| Chain Family | Networks | Library | Status |
|--------------|----------|---------|--------|
| EVM | Ethereum, Arbitrum, Optimism, Polygon, Avalanche, Base, etc. | [ethers.js v6](https://docs.ethers.org/v6/) | Supported |
| Solana | Mainnet, Devnet | [solana-web3.js](https://github.com/solana-foundation/solana-web3.js) | Supported |
| Aptos | Mainnet, Testnet | [aptos-ts-sdk](https://github.com/aptos-labs/aptos-ts-sdk) | Supported |
| Sui | Mainnet, Testnet | [@mysten/sui](https://github.com/MystenLabs/sui) | In Development |
| TON | Mainnet, Testnet | [@ton/ton](https://github.com/ton-org/ton) | In Development |

## Requirements

- **Node.js** v20+ (v23+ recommended for native TypeScript execution)
- **npm** for package management
- **RPC endpoints** for the networks you want to interact with

## Documentation

| Guide | Description |
|-------|-------------|
| [SDK Guide](./sdk/) | Integrate CCIP in your TypeScript application |
| [CLI Reference](./cli/) | Command-line usage and examples |
| [Contributing](./contributing/) | Development setup and guidelines |
| [Adding New Chain](./adding-new-chain) | Implement support for a new blockchain |

## Resources

- [CCIP Official Documentation](https://docs.chain.link/ccip)
- [CCIP Directory](https://docs.chain.link/ccip/directory) - Router addresses by network
- [GitHub Repository](https://github.com/smartcontractkit/ccip-tools-ts)
- [npm: @chainlink/ccip-sdk](https://www.npmjs.com/package/@chainlink/ccip-sdk)
- [npm: @chainlink/ccip-cli](https://www.npmjs.com/package/@chainlink/ccip-cli)
