---
sidebar_position: 1
---

# CCIP Tools

TypeScript SDK and CLI for interacting with Chainlink's Cross-Chain Interoperability Protocol (CCIP).

## Packages

### SDK (`@chainlink/ccip-sdk`)

Programmatic access to CCIP functionality:

- Multi-chain support: EVM, Solana, Aptos, and Sui
- Message sending and tracking
- Execution proof generation
- Gas estimation

[View SDK API Reference →](/sdk/)

### CLI (`@chainlink/ccip-cli`)

Command-line access to CCIP operations:

- Track cross-chain message status
- Send messages between chains
- Execute pending messages manually
- Discover supported tokens

[View CLI Documentation →](/cli/)

### CCIP API

REST API for querying CCIP message status and lane information:

- Retrieve message details by ID
- Query lane latency metrics
- Create and track cross-chain intents

[View API Reference →](/api/)

## Installation

```bash
# Install the SDK
npm install @chainlink/ccip-sdk

# Install the CLI globally
npm install -g @chainlink/ccip-cli
```

## Quick Start

Track a CCIP message:

```bash
ccip-cli show 0xYourTxHash -r https://eth-rpc.example.com -r https://arb-rpc.example.com
```

Send a cross-chain message:

```bash
ccip-cli send ethereum-testnet-sepolia 0xRouterAddress arbitrum-sepolia \
  --receiver 0xReceiverAddress \
  --data "hello"
```

## Links

- [GitHub Repository](https://github.com/smartcontractkit/ccip-tools-ts)
- [Chainlink CCIP Documentation](https://docs.chain.link/ccip)
