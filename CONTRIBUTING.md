# Contributing

For project overview and architecture, see the [documentation](docs/index.md).

## Prerequisites

- Node.js v24+
- npm

## Quick Start

```bash
npm ci          # Install dependencies
npm test        # Run all tests
npm run check   # Lint + typecheck
```

## Quality Gates

Run before submitting a PR:

```bash
npm run lint        # Prettier + ESLint
npm run typecheck   # TypeScript validation
npm run test        # All tests with coverage
npm run build       # Full build
```

CI runs: `npm ci` → `npm run check` → `npm test`

## Error Handling

The SDK defines specialized `CCIPError` classes in `ccip-sdk/src/errors/`. Never throw generic `Error`.

```
CCIPError (base)
├── code: CCIPErrorCode         # Machine-readable
├── message: string             # Human-readable
├── context: Record<...>        # Structured data
├── isTransient: boolean        # Retry hint
├── retryAfterMs?: number       # Retry delay
└── recovery?: string           # Actionable fix
```

| Scenario             | Error Class                    |
| -------------------- | ------------------------------ |
| Chain not found      | `CCIPChainNotFoundError`       |
| Invalid input        | `CCIPArgumentInvalidError`     |
| Transaction pending  | `CCIPTransactionNotFoundError` |
| Message not in batch | `CCIPMessageNotInBatchError`   |
| HTTP/RPC failure     | `CCIPHttpError`                |
| Not implemented      | `CCIPNotImplementedError`      |

To add a new error type:

1. `codes.ts` - Define the error code
1. `specialized.ts` - Create the error class
1. `recovery.ts` - Add recovery hints (actionable fix suggestions)
1. `index.ts` - Export the new class

ESLint enforces `CCIPError` usage. Generic `throw new Error()` fails linting.

## Cross-Platform Portability

The SDK runs in **Node.js** (CLI, scripts) and **browsers** (frontend apps). All code must work in both environments.

### Quick Reference

| Do                                 | Don't                             |
| ---------------------------------- | --------------------------------- |
| `import { Buffer } from 'buffer'`  | Use `Buffer` as global            |
| `globalThis.fetch(url)`            | `import fetch from 'node-fetch'`  |
| `import { x } from 'ethers'`       | `import { x } from 'node:crypto'` |
| ES module syntax (`import/export`) | CommonJS (`require()`)            |

### Rules

1. **Always import `Buffer`** - Node.js has `Buffer` as a global; browsers don't. Always use explicit import:

   ```typescript
   import { Buffer } from 'buffer'

   // Now safe to use in browser and Node.js
   const bytes = Buffer.from(data, 'hex')
   ```

2. **Use `globalThis.fetch`** - Available in Node.js 18+ and all browsers. Never use `node-fetch` or `http`/`https` modules:

   ```typescript
   // ✅ Cross-platform
   const response = await globalThis.fetch(url)

   // ❌ Node.js only
   import fetch from 'node-fetch'
   ```

3. **No `node:*` imports in production code** - Node.js built-in modules (`node:fs`, `node:crypto`, `node:path`) are not available in browsers. Use them only in test files (`.test.ts`):

   ```typescript
   // ✅ OK in test files
   import assert from 'node:assert/strict'
   import { describe, it } from 'node:test'

   // ❌ Never in production code (src/*.ts excluding tests)
   import { readFileSync } from 'node:fs'
   ```

### Tree-Shaking

The SDK uses `"sideEffects": false` in `package.json` to enable tree-shaking. Frontend bundlers can exclude unused chain families:

```typescript
// Only EVMChain is bundled (Solana, Sui, TON, Aptos excluded)
import { EVMChain } from '@chainlink/ccip-sdk'
```

For chain implementations that must self-register, use the static block pattern documented in [Chain Registration](#chain-registration).

## Code Patterns

### Quick Reference

| Pattern                 | Rule                                                             | Example File                              |
| ----------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| Object Parameters       | Use `*Opts` types for methods with 3+ parameters                 | [chain.ts](ccip-sdk/src/chain.ts)         |
| Injectable Dependencies | Three-state: `undefined` (default) / instance / `null` (opt-out) | [chain.ts](ccip-sdk/src/chain.ts)         |
| TSDoc                   | Document public APIs with `@example` and `@throws`               | [api/index.ts](ccip-sdk/src/api/index.ts) |
| Const + Type            | Use `const X = {} as const` + `type X = typeof...` (not enums)   | [types.ts](ccip-sdk/src/types.ts)         |
| Named Exports           | No default exports; use barrel files                             | [index.ts](ccip-sdk/src/index.ts)         |
| Async Iteration         | Return `AsyncIterableIterator` for paginated results             | [chain.ts](ccip-sdk/src/chain.ts)         |
| Error Classes           | Extend `CCIPError`, never throw generic `Error`                  | [errors/](ccip-sdk/src/errors/)           |
| Factory Methods         | Use `static async fromUrl()` for async construction              | [evm/index.ts](ccip-sdk/src/evm/index.ts) |
| Memoization             | Cache expensive RPC calls with `memoize()`                       | [evm/index.ts](ccip-sdk/src/evm/index.ts) |
| Chain Registration      | Use `static { supportedChains[...] = this }`                     | [evm/index.ts](ccip-sdk/src/evm/index.ts) |

### Object Parameters

Prefer options objects over positional arguments for readability, extensibility, and self-documentation:

```typescript
// ✅ Good: Clear at call site, new optional fields don't break existing code
export type SendMessageOpts = {
  router: string
  destChainSelector: bigint
  message: AnyMessage & { fee?: bigint }
  approveMax?: boolean  // Adding this didn't break existing callers
}
async sendMessage(opts: SendMessageOpts & { wallet: unknown }): Promise<CCIPRequest>

// ❌ Avoid: Positional args are hard to read and break on new params
async sendMessage(router: string, dest: bigint, msg: AnyMessage, wallet: unknown, approveMax?: boolean)
```

### Injectable Dependencies (Three-State Pattern)

For optional dependencies, use a three-state pattern that enables features by default but allows explicit opt-out:

```typescript
export type ChainContext = {
  logger?: Logger                       // undefined → use console
  apiClient?: CCIPAPIClient | null      // undefined → create default, null → disable
}

// Constructor implementation (from chain.ts):
constructor(network: NetworkInfo, ctx?: ChainContext) {
  const { logger = console, apiClient } = ctx ?? {}
  this.logger = logger

  // Three-state initialization
  if (apiClient === null) {
    this.apiClient = null                              // Explicit opt-out
  } else if (apiClient !== undefined) {
    this.apiClient = apiClient                         // Use provided instance
  } else {
    this.apiClient = new CCIPAPIClient(undefined, { logger })  // Default
  }
}
```

**Usage:**

```typescript
// Default: API enabled with production endpoint
const chain = await EVMChain.fromUrl(rpcUrl)

// Custom API endpoint
const api = new CCIPAPIClient('https://staging.example.com')
const chain = await EVMChain.fromUrl(rpcUrl, { apiClient: api })

// Decentralized mode: no external API calls (100% on-chain)
const chain = await EVMChain.fromUrl(rpcUrl, { apiClient: null })
```

### TSDoc Guidelines

| Element              | Documentation Level                         |
| -------------------- | ------------------------------------------- |
| Public types/classes | Full description + `@example`               |
| Type properties      | Inline `/** comment */`                     |
| Public methods       | `@param`, `@returns`, `@throws`, `@example` |
| Private/internal     | Minimal or `@internal` tag                  |

````typescript
/**
 * Fetches estimated lane latency to a destination chain.
 *
 * @param destChainSelector - Destination CCIP chain selector
 * @returns Promise resolving to {@link LaneLatencyResponse}
 * @throws {@link CCIPApiClientNotAvailableError} if apiClient was disabled
 * @throws {@link CCIPHttpError} if API request fails
 *
 * @example
 * ```typescript
 * const latency = await chain.getLaneLatency(4949039107694359620n)
 * console.log(`ETA: ${Math.round(latency.totalMs / 60000)} min`)
 * ```
 */
async getLaneLatency(destChainSelector: bigint): Promise<LaneLatencyResponse>
````

### Type Definition Patterns

**Const objects + type extraction** (preferred over enums):

```typescript
// ✅ Good: Runtime values + type safety, tree-shakeable, no enum overhead
export const ChainFamily = {
  EVM: 'evm',
  Solana: 'solana',
  Aptos: 'aptos',
  Sui: 'sui',
  TON: 'ton',
} as const
export type ChainFamily = (typeof ChainFamily)[keyof typeof ChainFamily]

// Runtime: ChainFamily.EVM → 'evm'
// Type: ChainFamily is 'evm' | 'solana' | 'aptos' | 'sui' | 'ton'
```

**Discriminated unions with `_tag`** for runtime type narrowing:

```typescript
// Return type includes _tag for type narrowing at runtime
function decodeExtraArgs(
  data: BytesLike,
):
  | (EVMExtraArgsV1 & { _tag: 'EVMExtraArgsV1' })
  | (EVMExtraArgsV2 & { _tag: 'EVMExtraArgsV2' })
  | undefined

// Usage: narrow type based on _tag
const args = decodeExtraArgs(data)
if (args?._tag === 'EVMExtraArgsV2') {
  console.log(args.allowOutOfOrderExecution) // TypeScript knows this exists
}
```

### Naming Conventions

| Element          | Convention                        | Example                                   |
| ---------------- | --------------------------------- | ----------------------------------------- |
| Files (modules)  | `kebab-case.ts` for multi-word    | `extra-args.ts`, `http-status.ts`         |
| Files (simple)   | `lowercase.ts`                    | `chain.ts`, `types.ts`, `index.ts`        |
| Classes          | `PascalCase`                      | `EVMChain`, `CCIPAPIClient`               |
| Types/Interfaces | `PascalCase` with semantic suffix | `SendMessageOpts`, `LogFilter`            |
| Functions        | `camelCase` starting with verb    | `encodeExtraArgs`, `getLogs`              |
| Constants        | `PascalCase` or `SCREAMING_CASE`  | `ChainFamily`, `DEFAULT_API_BASE_URL`     |
| Private methods  | `_underscore` prefix              | `_getProvider`, `_fetch`                  |
| Error classes    | `CCIP` prefix + `Error` suffix    | `CCIPHttpError`, `CCIPBlockNotFoundError` |

### Export Patterns

```typescript
// Named exports only, no default exports
export type { ChainContext, LogFilter } from './chain.ts'
export { EVMChain } from './evm/index.ts'
export { encodeExtraArgs } from './extra-args.ts'
export * from './errors/index.ts' // Star export acceptable for errors
```

### Async Patterns

**AsyncIterableIterator** for paginated or streaming results:

```typescript
abstract getLogs(opts: LogFilter): AsyncIterableIterator<Log_>

// Consumer uses for-await-of
for await (const log of chain.getLogs({ startBlock: 1000 })) {
  console.log(log.transactionHash)
}
```

**Watch mode with cancellation** via the `watch` option:

```typescript
export type LogFilter = {
  // false/undefined: fetch once and return
  // true: poll continuously for new logs
  // Promise: poll until the promise resolves (cancellation)
  watch?: boolean | Promise<unknown>
}

// Continuous polling until cancelled
const controller = new AbortController()
const cancel$ = new Promise((resolve) => controller.signal.addEventListener('abort', resolve))

for await (const log of chain.getLogs({ watch: cancel$ })) {
  if (shouldStop) controller.abort() // Stops iteration
}
```

### Factory Methods

Use `static async` factory methods instead of async constructors (which TypeScript doesn't support):

```typescript
export class EVMChain extends Chain<typeof ChainFamily.EVM> {
  // Private constructor - use factory methods
  constructor(provider: JsonRpcApiProvider, network: NetworkInfo, ctx?: ChainContext) {
    super(network, ctx)
    this.provider = provider
  }

  // Primary factory: from RPC URL
  static async fromUrl(url: string, ctx?: ChainContext): Promise<EVMChain> {
    return this.fromProvider(await this._getProvider(url), ctx)
  }

  // Secondary factory: from existing provider
  static async fromProvider(provider: JsonRpcApiProvider, ctx?: ChainContext): Promise<EVMChain> {
    return new EVMChain(provider, networkInfo(Number((await provider.getNetwork()).chainId)), ctx)
  }
}
```

### Memoization

Cache expensive RPC calls using `micro-memoize` to avoid repeated network requests:

```typescript
import memoize from 'micro-memoize'

constructor(provider: JsonRpcApiProvider, network: NetworkInfo, ctx?: ChainContext) {
  super(network, ctx)

  // Memoize methods that make RPC calls
  this.typeAndVersion = memoize(this.typeAndVersion.bind(this))
  this.getTokenInfo = memoize(this.getTokenInfo.bind(this))

  // With options for fine-grained control
  this.getTransaction = memoize(this.getTransaction.bind(this), {
    maxSize: 100,        // Cache up to 100 entries
    maxArgs: 1,          // Only use first arg as cache key
  })

  this.getBlockTimestamp = memoize(this.getBlockTimestamp.bind(this), {
    async: true,
    maxSize: 100,
    forceUpdate: ([block]) => typeof block !== 'number' || block <= 0,  // Don't cache special blocks
  })
}
```

### Chain Registration

New chain classes must self-register using a static initialization block:

```typescript
import { Chain, supportedChains, ChainFamily } from '../chain.ts'

export class MyChain extends Chain<typeof ChainFamily.MyChain> {
  // Auto-register when module is imported
  static {
    supportedChains[ChainFamily.MyChain] = MyChain
  }

  static readonly family = ChainFamily.MyChain
  static readonly decimals = 18 // Native token decimals

  // ... implementation
}
```

This enables dynamic chain discovery via `supportedChains[family]` and is required for CLI auto-detection.

## Pull Requests

1. Run quality gates locally
1. Write tests for new functionality
1. Update CHANGELOG.md
1. Keep commits focused and atomic

## Adding New Chain Support

See **[docs/adding-new-chain.md](docs/adding-new-chain.md)** for the complete guide.

## Project Structure

```
ccip-tools-ts/
├── ccip-sdk/     # Chain-agnostic SDK
│   └── src/
│       ├── chain.ts    # Base Chain class
│       ├── types.ts    # Core types
│       └── {chainFamily}/    # Chain family implementations
└── ccip-cli/     # CLI wrapper
    └── src/
        └── providers/  # Wallet loaders
```
