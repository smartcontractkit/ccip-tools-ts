---
id: ccip-tools-adding-new-chain
title: Adding New Chain Support
sidebar_label: Adding New Chain
sidebar_position: 3
edit_url: https://github.com/smartcontractkit/ccip-tools-ts/edit/main/docs/adding-new-chain.md
---

# Adding New Chain Support

This guide walks through implementing a new chain family in the CCIP SDK.

## What You'll Build

A complete chain implementation includes:

| Component | File | Purpose |
|-----------|------|---------|
| Chain class | `ccip-sdk/src/{chain}/index.ts` | Core implementation |
| Hasher | `ccip-sdk/src/{chain}/hasher.ts` | Message ID computation |
| Wallet provider | `ccip-cli/src/providers/{chain}.ts` | CLI wallet loading |

## Prerequisites

Before starting, study these files:

1. **`ccip-sdk/src/chain.ts`** - Abstract base class with required methods
2. **`ccip-sdk/src/types.ts`** - Core types (`ChainFamily`, `CCIPRequest`, etc.)
3. **One reference implementation** - See below

### Reference Implementations

| Chain | File | Completeness |
|-------|------|--------------|
| EVM | `ccip-sdk/src/evm/index.ts` | Full implementation |
| Solana | `ccip-sdk/src/solana/index.ts` | Full implementation |
| Aptos | `ccip-sdk/src/aptos/index.ts` | Full implementation |
| TON | `ccip-sdk/src/ton/index.ts` | Partial (execution only) |
| Sui | `ccip-sdk/src/sui/index.ts` | Stub (hasher only) |

---

## Step 1: Register the Chain Family

**File:** `ccip-sdk/src/types.ts`

Add your chain to the `ChainFamily` constant:

```ts
export const ChainFamily = {
  EVM: 'evm',
  Solana: 'solana',
  Aptos: 'aptos',
  Sui: 'sui',
  TON: 'ton',
  YourChain: 'yourchain',  // Add this
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

Implement all static methods from `ChainStatic` interface:

```ts
// Required static methods
static fromUrl(url: string, ctx?: WithLogger): Promise<YourChainChain>
static decodeMessage(log: Log_): CCIPMessage | undefined
static decodeExtraArgs(extraArgs: BytesLike): ExtraArgs | undefined
static encodeExtraArgs(extraArgs: ExtraArgs): string
static decodeCommits(log: Log_, lane?: Lane): CommitReport[] | undefined
static decodeReceipt(log: Log_): ExecutionReceipt | undefined
static getAddress(bytes: BytesLike): string
static isTxHash(v: unknown): v is string
static getDestLeafHasher(lane: Lane, ctx?: WithLogger): LeafHasher
```

### 3.3 Constructor

```ts
import { type ChainContext } from '../chain.ts'

readonly client: YourChainClient  // Your chain's SDK client

constructor(
  client: YourChainClient,
  network: NetworkInfo<typeof ChainFamily.YourChain>,
  ctx?: ChainContext  // Includes logger and optional apiClient
) {
  super(network, ctx)  // Handles apiClient and logger initialization
  this.client = client
  // Memoize expensive RPC calls
  this.getTransaction = memoize(this.getTransaction.bind(this))
}
```

**Note:** `ChainContext` extends `WithLogger` and adds optional `apiClient` for CCIP API integration. The base class handles API client initialization automatically.

### 3.4 Abstract Methods

Implement all abstract methods from `Chain` class. Key methods include:

```ts
// Block and transaction operations
abstract getBlockTimestamp(block: number | 'finalized'): Promise<number>
abstract getTransaction(hash: string): Promise<ChainTransaction>
abstract getLogs(opts: LogFilter): AsyncIterableIterator<Log_>

// Message operations
abstract getMessagesInTx(tx: string | ChainTransaction): Promise<CCIPRequest[]>
abstract fetchAllMessagesInBatch(request, commit, opts?): Promise<CCIPMessage[]>

// Contract queries
abstract typeAndVersion(address: string): Promise<[type, version, typeAndVersion, suffix?]>
abstract getRouterForOnRamp(onRamp: string, destChainSelector: bigint): Promise<string>
abstract getOnRampForRouter(router: string, destChainSelector: bigint): Promise<string>
// ... and more router/ramp methods

// Fee and tokens
abstract getFee(router: string, destChainSelector: bigint, message: AnyMessage): Promise<bigint>
abstract getTokenInfo(token: string): Promise<TokenInfo>
abstract getSupportedTokens(address: string): Promise<string[]>

// Transaction building and sending
abstract generateUnsignedSendMessage(sender, router, dest, message, opts?): Promise<UnsignedTx>
abstract sendMessage(router, dest, message, opts: { wallet }): Promise<CCIPRequest>
abstract generateUnsignedExecuteReport(payer, offRamp, execReport, opts): Promise<UnsignedTx>
abstract executeReport(offRamp, execReport, opts: { wallet }): Promise<ChainTransaction>
```

See `ccip-sdk/src/chain.ts` for the complete list (~25 abstract methods).

---

## Step 4: Implement the Hasher

**File:** `ccip-sdk/src/yourchain/hasher.ts`

The hasher computes deterministic message IDs. Each chain encodes messages differently.

```ts
import { keccak256 } from '../hasher/common.ts'
import type { CCIPMessage } from '../types.ts'

export function hashMessage(message: CCIPMessage): string {
  // Encode message fields according to your chain's format
  const encoded = encodeMessageForYourChain(message)
  return keccak256(encoded)
}
```

:::warning Critical
Message ID computation must match the on-chain implementation exactly. Test against real transactions.
:::

---

## Step 5: Define Types

**File:** `ccip-sdk/src/yourchain/types.ts`

Define your unsigned transaction type:

```ts
export interface YourChainUnsignedTx {
  // Chain-specific transaction structure
  instructions: YourChainInstruction[]
  recentBlockhash?: string
  // ...
}
```

Then add it to `UnsignedTx` in `ccip-sdk/src/chain.ts`:

```ts
export type UnsignedTx = {
  [ChainFamily.EVM]: UnsignedEVMTx
  [ChainFamily.Solana]: UnsignedSolanaTx
  [ChainFamily.Aptos]: UnsignedAptosTx
  [ChainFamily.TON]: UnsignedTONTx
  [ChainFamily.Sui]: never // Not yet implemented
  [ChainFamily.YourChain]: UnsignedYourChainTx  // Add this
}
```

---

## Step 6: Export from SDK

**File:** `ccip-sdk/src/index.ts`

```ts
// Add import
export { YourChainChain } from './yourchain/index.ts'

// Add to allSupportedChains (keys are ChainFamily values)
export const allSupportedChains = {
  [ChainFamily.EVM]: EVMChain,
  [ChainFamily.Solana]: SolanaChain,
  [ChainFamily.Aptos]: AptosChain,
  [ChainFamily.Sui]: SuiChain,
  [ChainFamily.TON]: TONChain,
  [ChainFamily.YourChain]: YourChainChain,  // Add this
}
```

---

## Step 7: CLI Wallet Provider

**File:** `ccip-cli/src/providers/yourchain.ts`

```ts
export async function loadYourChainWallet(
  walletArg: string | undefined,
): Promise<YourChainWallet> {
  // Load from:
  // - Environment variable (PRIVATE_KEY)
  // - File path
  // - Ledger (if supported)
  
  const privateKey = process.env['PRIVATE_KEY'] || walletArg
  if (!privateKey) {
    throw new Error('No wallet provided')
  }
  
  return createWalletFromPrivateKey(privateKey)
}
```

**File:** `ccip-cli/src/providers/index.ts`

```ts
import { loadYourChainWallet } from './yourchain.ts'

export async function loadChainWallet(chain: Chain): Promise<[string, unknown]> {
  switch (chain.family) {
    // ... existing cases
    case ChainFamily.YourChain: {
      const wallet = await loadYourChainWallet(walletArg)
      return [wallet.address, wallet]
    }
  }
}
```

---

## Step 8: Testing

### Required: Hasher Tests

**File:** `ccip-sdk/src/yourchain/hasher.test.ts`

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { hashMessage } from './hasher.ts'

describe('YourChain hasher', () => {
  it('computes correct message ID', () => {
    // Use a real message from your chain
    const message = { /* ... */ }
    const expectedId = '0x...' // From on-chain transaction
    
    assert.strictEqual(hashMessage(message), expectedId)
  })
})
```

### Integration Testing

```bash
# Build
npm run build

# Test message tracking
./ccip-cli/ccip-cli show <your-chain-tx-hash> --rpcs <your-rpc-url>

# Test token info
./ccip-cli/ccip-cli getSupportedTokens <chainSelector> <router> --rpcs <your-rpc-url>
```

---

## Checklist

Before submitting your PR:

- [ ] Chain class implements all abstract methods
- [ ] Static registration block added
- [ ] Hasher tests pass with real transaction data
- [ ] Types exported from SDK
- [ ] CLI wallet provider implemented
- [ ] All quality gates pass (`npm run check && npm test`)
- [ ] CHANGELOG.md updated

## Need Help?

- Study the reference implementations
- Open a [draft PR](https://github.com/smartcontractkit/ccip-tools-ts/pulls) for early feedback
- Ask questions in the PR comments
