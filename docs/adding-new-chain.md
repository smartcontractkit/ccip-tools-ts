# Adding New Chain Support

> Back to [CONTRIBUTING.md](../CONTRIBUTING.md)

This guide walks through implementing a new chain family in the CCIP SDK.

## Overview

A chain implementation consists of:

1. **SDK Implementation** (`ccip-sdk/src/{chainFamily}/index.ts`) - Lane discovery, token operations, message tracking, transaction building
1. **Hasher** (`ccip-sdk/src/{chainFamily}/hasher.ts`) - Computes unique message IDs from CCIP message contents
1. **CLI Wallet Provider** (`ccip-cli/src/providers/{chainFamily}.ts`) - Loads signing keys (file or Ledger) for transaction testing

## Prerequisites

Before starting:

- Read `ccip-sdk/src/chain.ts` - the abstract base class
- Read `ccip-sdk/src/types.ts` - core types (`ChainFamily`, `CCIPRequest`, `NetworkInfo`, etc.)
- Study one reference implementation thoroughly (see below)

## Reference Implementations

| Chain  | File                           |
| ------ | ------------------------------ |
| EVM    | `ccip-sdk/src/evm/index.ts`    |
| Solana | `ccip-sdk/src/solana/index.ts` |
| Aptos  | `ccip-sdk/src/aptos/index.ts`  |

---

## Step-by-Step

### Step 1: Add ChainFamily

File: `ccip-sdk/src/types.ts`

Add your chain to the `ChainFamily` object. Search for `export const ChainFamily` to find the location.

### Step 2: Create Directory Structure

```
ccip-sdk/src/{chainFamily}/
├── index.ts    # Main chain class (required)
└── hasher.ts   # Message hashing (required)
```

Add other files as needed (types.ts, logs.ts, utils.ts). See reference implementations for examples.

### Step 3: Implement the Chain Class

File: `ccip-sdk/src/{chainFamily}/index.ts`

#### 3.1 Static Registration Block

This pattern auto-registers your chain when the module loads:

```typescript
import { supportedChains } from '../supported-chains.ts'
import { ChainFamily } from '../types.ts'

export class {ChainName}Chain extends Chain<typeof ChainFamily.{ChainName}> {
  static {
    supportedChains[ChainFamily.{ChainName}] = {ChainName}Chain
  }
  // ... rest of implementation
}
```

Search for `static {` in any existing chain implementation to see this pattern.

#### 3.2 Static Methods (ChainStatic Interface)

Search for `export type ChainStatic` in `ccip-sdk/src/chain.ts` for the complete list of static methods to implement.

#### 3.3 Constructor Pattern

Search for the constructor in `ccip-sdk/src/solana/index.ts` to see:

- How to initialize chain-specific clients
- Memoization of expensive RPC calls using `micro-memoize`

#### 3.4 Abstract Methods to Implement

Search for `abstract` in `ccip-sdk/src/chain.ts` for the complete list of methods to implement.

### Step 4: Implement the Hasher

File: `ccip-sdk/src/{chainFamily}/hasher.ts`

Hasher computes message IDs for CCIP messages. Each chain has different encoding.

See existing hasher files in `ccip-sdk/src/evm/`, `ccip-sdk/src/solana/`, `ccip-sdk/src/aptos/`.

### Step 5: Define UnsignedTx Type

Define your unsigned transaction type in `ccip-sdk/src/{chainFamily}/types.ts`. See existing implementations for examples.

Then add it to the `UnsignedTx` mapped type in `ccip-sdk/src/chain.ts`. Search for `export type UnsignedTx` to find the location.

### Step 6: Export from SDK

File: `ccip-sdk/src/index.ts`

Add your chain class import and export it. Also add to `allSupportedChains` object. Search for `allSupportedChains` to find the location.

### Step 7: CLI Wallet Provider

File: `ccip-cli/src/providers/{chainFamily}.ts`

Create a `load{ChainFamily}Wallet` function that returns a wallet object. See existing providers for examples.

Then register it in `ccip-cli/src/providers/index.ts`:

1. Import your wallet loader
1. Add a case to the `loadChainWallet` switch that extracts the address and returns `[address, wallet]`

---

## Testing

### Unit Tests

Add tests in `ccip-sdk/src/{chainFamily}/` as `*.test.ts` files.

**Required**: Message hashing tests (`hasher.test.ts`) - these verify correctness of message ID computation, which is critical for cross-chain message tracking.

**Recommended**: Follow `ccip-sdk/src/evm/` for comprehensive test coverage patterns including message decoding, error handling, and request parsing.

### Integration Testing via CLI

After implementing, test with the CLI:

```bash
# Build
npm run build

# Test message tracking (requires real tx hash from your chain)
./ccip-cli/ccip-cli show <transaction-hash> --rpcs <your-rpc-url>

# Test token info
./ccip-cli/ccip-cli getSupportedTokens <chain-selector> <router-address> --rpcs <your-rpc-url>
```

Alternatively, create a `.env` file with RPC endpoints to avoid passing `--rpcs` each time.

---

## Before Submitting

See [Quality Gates](../CONTRIBUTING.md#quality-gates) and [Error Handling](../CONTRIBUTING.md#error-handling) in CONTRIBUTING.md.
