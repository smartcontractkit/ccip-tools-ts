---
id: ccip-tools-adding-new-chain
title: Adding New Chain Family Support
sidebar_label: Adding New Chain Family
sidebar_position: 3
edit_url: https://github.com/smartcontractkit/ccip-tools-ts/edit/main/docs/adding-new-chain.md
---

# Adding New Chain Family Support

This guide walks through implementing a new chain family in the CCIP SDK.

## What You'll Build

A complete chain implementation includes:

| Component       | File                                | Purpose                |
| --------------- | ----------------------------------- | ---------------------- |
| Chain class     | `ccip-sdk/src/{chain}/index.ts`     | Core implementation    |
| Hasher          | `ccip-sdk/src/{chain}/hasher.ts`    | Message ID computation |
| Wallet provider | `ccip-cli/src/providers/{chain}.ts` | CLI wallet loading     |

## Prerequisites

Before starting, study these files:

1. **`ccip-sdk/src/chain.ts`** - Abstract base class with required methods
2. **`ccip-sdk/src/types.ts`** - Core types (`ChainFamily`, `CCIPRequest`, etc.)
3. **One reference implementation** - See below

### Reference Implementations

| Chain  | File                           | Completeness             |
| ------ | ------------------------------ | ------------------------ |
| EVM    | `ccip-sdk/src/evm/index.ts`    | Full implementation      |
| Solana | `ccip-sdk/src/solana/index.ts` | Full implementation      |
| Aptos  | `ccip-sdk/src/aptos/index.ts`  | Full implementation      |
| TON    | `ccip-sdk/src/ton/index.ts`    | Partial (manual exec) |
| Sui    | `ccip-sdk/src/sui/index.ts`    | Partial (manual exec) |

---

## Data Encoding Conventions

When implementing a new chain, you must decide how to encode addresses and bytearrays. The SDK follows a **destination-chain-native format** convention.

### Design Principle

All bytearray fields (addresses, data payloads) use the **destination chain's native format**:

- Receivers on the destination chain can use values directly without conversion
- Block explorers display human-readable formats
- Compatibility with chain-specific web3 libraries

### Format by Chain Family

| Chain Family | Address Format | Data Payload | Explorer Example |
|--------------|----------------|--------------|------------------|
| EVM | Checksummed hex (`0x...`) | Hex string | Etherscan |
| Solana | Base58 | Base64 | Solana Explorer |
| Aptos | Full 32-byte hex + `::module` suffix | Hex string | Aptos Explorer |
| Sui | Full 32-byte hex + `::module` suffix | Hex string | SuiVision |
| TON | `workchain:hash` | Hex string | TONScan |

:::tip Aptos/Sui Module Suffixes
Aptos and Sui addresses often include module suffixes (e.g., `0x123...abc::router`, `0x123...abc::onramp`). The `getAddress()` method preserves these suffixes. Different CCIP components share the same package address but differ by module: `::router`, `::onramp`, `::offramp`, `::fee_quoter`.
:::

### Determining Format for New Chains

Before implementing, check:

1. **Block explorer format** - What format does the chain's primary explorer display?
2. **Web3 library convention** - What format does the chain's JS/TS SDK return?
3. **Default to hex** - Unless the ecosystem strongly prefers otherwise (like Solana's base58/base64)

### SDK Utilities

The SDK provides utilities that handle format conversion:

| Utility | Purpose | File |
|---------|---------|------|
| `getDataBytes(data)` | Normalize any input format to bytes | `utils.ts` |
| `getAddressBytes(address)` | Extract address bytes (handles hex, base58, base64, strips `::module` suffixes) | `utils.ts` |
| `decodeAddress(bytes, family)` | Convert bytes to chain-native string | `utils.ts` |

### Implementation Requirements

Your chain class must implement:

```ts
// Convert raw bytes to your chain's native address format
static getAddress(bytes: BytesLike): string {
  // Return address in your chain's canonical format
  // e.g., Base58 for Solana, checksummed hex for EVM
}

// Optional: Human-friendly display format (if different from canonical)
static formatAddress?(address: string): string {
  // e.g., TON converts "0:abc..." to "EQabc..."
}

// Optional: Human-friendly transaction hash display
static formatTxHash?(hash: string): string {
  // e.g., TON extracts hash from composite format
}
```

### Cross-Chain Address Handling

When decoding CCIP messages, addresses are formatted based on their chain:

```ts
// In your decodeMessage() implementation:
// - Sender addresses → source chain format
// - Receiver addresses → destination chain format
```

See `ccip-sdk/src/requests.ts` for the pattern used in `decodeJsonMessage()`.

:::note
If your chain's address format is not hex, base58, or base64, you may need to extend `getAddressBytes()` in `utils.ts` to handle the new format.
:::

---

## Step 1: Register the Chain Family

**File:** `ccip-sdk/src/types.ts`

Add your chain to the `ChainFamily` constant:

```ts
export const ChainFamily = {
  EVM: 'EVM',
  Solana: 'SVM',
  Aptos: 'APTOS',
  Sui: 'SUI',
  TON: 'TON',
  YourChain: 'YOURCHAIN', // Add this
} as const
```

---

## Step 2: Create Directory Structure

```bash
mkdir -p ccip-sdk/src/yourchain
touch ccip-sdk/src/yourchain/index.ts
touch ccip-sdk/src/yourchain/hasher.ts
touch ccip-sdk/src/yourchain/types.ts
```

---

## Step 3: Implement the Chain Class

**File:** `ccip-sdk/src/yourchain/index.ts`

### 3.1 Class Declaration with Auto-Registration

```ts
import { Chain } from '../chain.ts'
import { supportedChains } from '../supported-chains.ts'
import { ChainFamily, type NetworkInfo, type WithLogger } from '../types.ts'

export class YourChainChain extends Chain<typeof ChainFamily.YourChain> {
  // Auto-register when this module is imported
  static {
    supportedChains[ChainFamily.YourChain] = YourChainChain
  }

  static readonly family = ChainFamily.YourChain
  static readonly decimals = 18 // Native token decimals for your chain

  // ... implementation
}
```

### 3.2 Static Methods

Implement all static methods defined in the `ChainStatic` interface.

**Reference:** See `ccip-sdk/src/chain.ts` for the complete `ChainStatic` type definition with all required static methods and their signatures.

**Key concepts:**
- `fromUrl` - Async factory that creates a chain instance from an RPC URL
- `decodeMessage` / `decodeCommits` / `decodeReceipt` - Parse chain-specific log formats; return `undefined` if log doesn't match (don't throw)
- `decodeExtraArgs` / `encodeExtraArgs` - Handle your chain's extra args serialization; decoded args include a `_tag` discriminator (e.g., `{ ..., _tag: 'EVMExtraArgsV2' }`)
- `getAddress` - Convert raw bytes to your chain's native address format
- `getDestLeafHasher` - Return a hasher function for computing message hashes (see Step 4)

### 3.3 Constructor

Your constructor should:

1. **Call `super(network, ctx)`** - The base class handles logger and API client initialization
2. **Store your chain's client** - The SDK client for your chain (e.g., ethers provider, Solana connection)
3. **Setup `destroy$` pattern** - For resource cleanup (see Engineering Patterns)
4. **Memoize expensive methods** - Cache RPC calls like `getTransaction`, `typeAndVersion` (see Engineering Patterns)

**Reference:** See `EVMChain` or `SolanaChain` constructors for complete examples.

**Note:** `ChainContext` includes `logger` and optional `apiClient` for CCIP API integration.

### 3.4 Abstract Methods

Implement all abstract methods from the `Chain` base class.

**Reference:** See `ccip-sdk/src/chain.ts` for the complete list of abstract methods with JSDoc descriptions.

**Method categories:**
- **Block/Transaction** - `getBlockTimestamp`, `getTransaction`, `getLogs`
- **Message operations** - `getMessagesInBatch` (note: `getMessagesInTx` has a default implementation)
- **Contract queries** - `typeAndVersion`, router/ramp getters
- **Tokens** - `getTokenInfo`, `getSupportedTokens`, `getFeeTokens`, token pool methods
- **Transaction building** - `generateUnsignedSendMessage`, `generateUnsignedExecuteReport`
- **Execution** - `sendMessage`, `executeReport`, `getOffchainTokenData`

**Important patterns:**
- Methods use opts objects (e.g., `SendMessageOpts`, `ExecuteReportOpts`) - see type definitions in `chain.ts`
- `getLogs` is an async generator - see Engineering Patterns section
- Some methods have default implementations that can be overridden

---

## Step 4: Implement the Hasher

**File:** `ccip-sdk/src/yourchain/hasher.ts`

The hasher computes deterministic message hashes that must match the on-chain implementation exactly.

**Pattern:** Create a factory function that returns a `LeafHasher` (a function `(message: CCIPMessage) => string`).

**Reference:** See `ccip-sdk/src/evm/hasher.ts` or `ccip-sdk/src/solana/hasher.ts` for complete examples.

**Key points:**
- Pre-compute lane metadata hash in the factory (done once per lane)
- The returned hasher function encodes the message according to your chain's on-chain format
- Implement `static getDestLeafHasher(lane, ctx)` in your chain class to return the appropriate hasher

:::warning Critical
Message hash computation must match the on-chain implementation exactly. Test against real transactions to verify correctness.
:::

---

## Step 5: Define Types

**File:** `ccip-sdk/src/yourchain/types.ts`

Define your chain-specific types, including the unsigned transaction type for `generateUnsignedSendMessage` and `generateUnsignedExecuteReport`.

**Then update `ccip-sdk/src/chain.ts`:**
- Add your `UnsignedYourChainTx` to the `UnsignedTx` type mapping

**Reference:** See `ccip-sdk/src/solana/types.ts` or `ccip-sdk/src/evm/types.ts` for examples.

---

## Step 6: Export from SDK

**File:** `ccip-sdk/src/index.ts`

1. Export your chain class
2. Add it to `allSupportedChains`

**Reference:** Follow the existing pattern in `index.ts` for other chain families.

---

## Step 7: CLI Wallet Provider

**Files:**
- `ccip-cli/src/providers/yourchain.ts` - Wallet loading logic
- `ccip-cli/src/providers/index.ts` - Add case to `loadChainWallet` switch

**Wallet sources to support:**
- Environment variable (`PRIVATE_KEY`)
- File path
- Ledger (if applicable)

**Reference:** See `ccip-cli/src/providers/evm.ts` or `ccip-cli/src/providers/solana.ts` for examples.

---

## Step 8: Testing

### Required: Hasher Tests

Create `ccip-sdk/src/yourchain/hasher.test.ts` with tests that verify message hash computation against real on-chain transactions.

**Reference:** See `ccip-sdk/src/evm/hasher.test.ts` or `ccip-sdk/src/solana/hasher.test.ts` for test patterns.

### Integration Testing

```bash
npm run build
./ccip-cli/ccip-cli show <your-chain-tx-hash> --rpcs <your-rpc-url>
```

---

## Engineering Patterns

These patterns ensure consistency across chain implementations. Study the existing implementations (especially EVM and Solana) to see these patterns in action.

### Memoization Strategy

The SDK uses `micro-memoize` to cache expensive RPC calls. Memoize methods in your constructor using `memoize(this.methodName.bind(this))`.

**Reference:** See `EVMChain` or `SolanaChain` constructors for memoization patterns.

**Common `micro-memoize` options:**
- `maxSize` - Limit cache size
- `maxArgs` - Only use first N args for cache key
- `transformKey` - Normalize cache keys
- `async: true` - Handle Promise caching properly
- `forceUpdate` - Conditional cache invalidation

**Methods to memoize:** `typeAndVersion`, `getTransaction`, `getTokenInfo`, `getTokenForTokenPool`, `getNativeTokenForRouter`, `getTokenAdminRegistryFor`, `getFeeTokens`

### Resource Cleanup (`destroy$` Pattern)

Chain instances hold network connections that need cleanup.

**Pattern:**
1. Create `destroy$: Promise<void>` that resolves when `destroy()` is called
2. Use `destroy$.finally()` to clean up the client connection
3. In `getLogs`, integrate `destroy$` with watch cancellation via `Promise.race`

**Reference:** See `EVMChain` constructor for the pattern.

### Error Handling Conventions

- **Decode methods** (`decodeMessage`, `decodeCommits`, `decodeReceipt`, `decodeExtraArgs`): Return `undefined` if the log/data doesn't match expected format - don't throw
- **Instance methods** (`getTransaction`, `getBlockTimestamp`, etc.): Throw typed errors from `ccip-sdk/src/errors/` for actual failures
- **Unimplemented optional methods**: Throw `CCIPNotImplementedError`
- **Chain-specific errors**: Add new error classes in `ccip-sdk/src/errors/specialized.ts` if needed (see existing Solana/Aptos errors for examples)

### Key Method Conventions

**`decodeExtraArgs`:** Returns tagged objects with `_tag` discriminator (e.g., `{ ..., _tag: 'EVMExtraArgsV2' }`). Check the 4-byte tag prefix to determine format, return `undefined` if not recognized.

**`fromUrl`:** Async factory that creates client, fetches chain ID, returns chain instance. Clean up client on failure.

**`typeAndVersion`:** Returns 4-tuple `[type, version, typeAndVersion, suffix?]`. Use `parseTypeAndVersion` utility from `utils.ts`.

**`getLogs`:** Async generator that handles:
- Forward vs backward iteration (based on `startBlock`/`startTime`)
- Watch mode validation and polling
- Integration with `destroy$` for cancellation

**Reference:** See `ccip-sdk/src/evm/index.ts` for complete implementations.

### CCIPMessage Type Variations

CCIP message types vary by version (v1.2/v1.5 vs v1.6) and may contain extra args targeting different chain families. Your `decodeMessage` should handle cross-chain scenarios where messages on your chain target other chains.

### ExtraArgs Tag System

Each chain family has 4-byte tag prefixes for their extra args encoding (see existing tags in `ccip-sdk/src/extra-args.ts`).

**When adding a new chain with custom extra args:**
1. Generate a tag: `id('CCIP YourChainExtraArgsV1').substring(0, 10)` (using ethers `id`)
2. Add the constant to `ccip-sdk/src/extra-args.ts`
3. Define your `YourChainExtraArgsV1` type in `extra-args.ts`
4. Implement `encodeExtraArgs` and `decodeExtraArgs` in your chain class

---

## Checklist

Before submitting your PR:

**Core Implementation:**
- [ ] `ChainFamily` constant added to `types.ts`
- [ ] Chain class extends `Chain<typeof ChainFamily.YourChain>`
- [ ] Static registration block added (`static { supportedChains[...] = ... }`)
- [ ] All abstract methods implemented
- [ ] `destroy$` cleanup pattern implemented
- [ ] Key methods memoized (see Engineering Patterns)

**Types and Exports:**
- [ ] `UnsignedTx` type mapping added to `chain.ts`
- [ ] Chain class exported from `index.ts`
- [ ] Added to `allSupportedChains` in `index.ts`

**Hasher:**
- [ ] `getDestLeafHasher` static method implemented
- [ ] Hasher tests pass with real transaction data

**CLI:**
- [ ] Wallet provider implemented in `ccip-cli/src/providers/`

**Quality:**
- [ ] All quality gates pass (`npm run check && npm test`)
- [ ] CHANGELOG.md updated

## Need Help?

- Study the reference implementations
- Open a [draft PR](https://github.com/smartcontractkit/ccip-tools-ts/pulls) for early feedback
- Ask questions in the PR comments
