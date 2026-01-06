# @chainlink/ccip-config

Chain deployment configuration registry for CCIP (Cross-Chain Interoperability Protocol).

> [!IMPORTANT]
> This package is provided under an MIT license and is for convenience and illustration purposes only.

## Overview

This package provides deployment data (router addresses, display names) for CCIP-enabled chains. It is designed to work alongside `@chainlink/ccip-sdk`, which provides protocol-level chain information.

**Separation of Concerns:**
- `@chainlink/ccip-sdk` - Protocol data (chain selectors, families, network info)
- `@chainlink/ccip-config` - Deployment data (router addresses, display names)

## Installation

```bash
npm install @chainlink/ccip-config
```

## Usage

### Import Chain Deployments

Chain deployments are registered via side-effect imports. Import only the chains you need:

```typescript
// Import specific chain families/environments
import '@chainlink/ccip-config/chains/evm/mainnet'
import '@chainlink/ccip-config/chains/evm/testnet'
import '@chainlink/ccip-config/chains/solana/mainnet'

// Or import all chains for a family
import '@chainlink/ccip-config/chains/evm'
import '@chainlink/ccip-config/chains/solana'

// Or import everything
import '@chainlink/ccip-config/chains'
```

### Lookup Functions

```typescript
import { getRouter, requireRouter, getDisplayName, isCCIPEnabled, isCCIPEnabledBySelector } from '@chainlink/ccip-config'
import '@chainlink/ccip-config/chains/evm/mainnet'

// Get router address (returns undefined if not found)
const router = getRouter(5009297550715157269n) // Ethereum mainnet
// => '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D'

// Get router address (throws if not found)
const router = requireRouter(5009297550715157269n)

// Get display name
const name = getDisplayName(5009297550715157269n)
// => 'Ethereum'

// Check if chain has CCIP router (by selector)
const enabled = isCCIPEnabledBySelector(5009297550715157269n)
// => true

// Type guard for narrowing ChainDeployment to CCIPEnabledDeployment
const deployment = getDeployment(5009297550715157269n)
if (deployment && isCCIPEnabled(deployment)) {
  // deployment.router is now string (not string | undefined)
  console.log(deployment.router)
}
```

### Lookup by SDK Canonical Name

```typescript
import { getDeploymentByName } from '@chainlink/ccip-config'
import '@chainlink/ccip-config/chains/evm/mainnet'

// Find by SDK canonical name (case-sensitive, O(1) lookup)
const deployment = getDeploymentByName('ethereum-mainnet')
// => { chainSelector: 5009297550715157269n, name: 'ethereum-mainnet', displayName: 'Ethereum', router: '0x...' }

// Names are case-sensitive (SDK canonical names are lowercase)
const notFound = getDeploymentByName('Ethereum') // undefined (display name, not SDK name)
```

### List All Deployments

```typescript
import { getAllDeployments, getCCIPEnabledDeployments, getCCIPEnabledCount } from '@chainlink/ccip-config'
import '@chainlink/ccip-config/chains'

// Get all registered deployments
const all = getAllDeployments()

// Get only CCIP-enabled deployments (with router addresses)
const ccipEnabled = getCCIPEnabledDeployments()

// Get count of CCIP-enabled chains (O(1) operation)
const count = getCCIPEnabledCount()
```

### With SDK Integration

```typescript
import { networkInfo } from '@chainlink/ccip-sdk'
import { getRouter } from '@chainlink/ccip-config'
import '@chainlink/ccip-config/chains/evm/mainnet'

// Get chain info from SDK
const network = networkInfo('ethereum-mainnet')

// Get router from ccip-config
const router = getRouter(network.chainSelector)

console.log(`${network.name} router: ${router}`)
```

### Isolated Registries (for Testing)

```typescript
import { createRegistry } from '@chainlink/ccip-config'

// Create an isolated registry that doesn't affect the global registry
const registry = createRegistry()

// Register using a real chain selector (name auto-populated from SDK)
registry.register({
  chainSelector: 5009297550715157269n,  // Ethereum mainnet
  displayName: 'Ethereum',
  router: '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
})

// Use the isolated registry
const deployment = registry.get(5009297550715157269n)
const byName = registry.getByName('ethereum-mainnet')  // SDK canonical name, O(1)
const enabled = registry.getCCIPEnabled()
const count = registry.getCCIPEnabledCount()

// For testing with fake chain selectors, use skipValidation
const testRegistry = createRegistry({ skipValidation: true })
testRegistry.register({ chainSelector: 123n, displayName: 'Test Chain' })

// Clear when done
registry.clear()
```

```typescript
// With per-registry logger for full test isolation
const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}
const registry = createRegistry({ logger: silentLogger })
```

### Custom Logger

By default, duplicate registrations log a warning via `console.warn`. You can customize this behavior with a logger that matches the SDK's Logger interface (`debug`, `info`, `warn`, `error` methods):

```typescript
import { setLogger } from '@chainlink/ccip-config'

// Use custom logger (all 4 methods required)
setLogger({
  debug: (msg) => myLogger.debug(msg),
  info: (msg) => myLogger.info(msg),
  warn: (msg) => myLogger.warning(msg),
  error: (msg) => myLogger.error(msg),
})

// Suppress all logging (silent mode)
setLogger({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
})
```

## API Reference

### Lookup Functions

| Function | Description |
|----------|-------------|
| `getRouter(selector)` | Get router address, returns `undefined` if not found |
| `getRouterByName(name)` | Get router by name, returns `undefined` if not found |
| `requireRouter(selector)` | Get router address, throws if not found |
| `getDisplayName(selector)` | Get display name, returns `undefined` if not found |
| `isCCIPEnabled(deployment)` | Type guard to check if deployment has router (narrows type) |
| `isCCIPEnabledBySelector(selector)` | Check if chain has router by selector |
| `getDeployment(selector)` | Get full deployment object |
| `requireDeployment(selector)` | Get deployment, throws if not found |
| `getDeploymentByName(name)` | Find deployment by SDK canonical name (case-sensitive, O(1)) |
| `requireDeploymentByName(name)` | Get deployment by SDK name, throws if not found |
| `requireRouterByName(name)` | Get router by SDK name, throws if not found or no router |
| `getAllDeployments()` | Get all registered deployments (returns frozen array) |
| `getCCIPEnabledDeployments()` | Get deployments with routers |
| `getCCIPEnabledCount()` | Get count of CCIP-enabled chains (O(1)) |

### Registry Functions

| Function | Description |
|----------|-------------|
| `createRegistry()` | Create an isolated registry instance |
| `registerDeployment(deployment)` | Register a deployment to global registry |
| `clearRegistry()` | Clear all deployments from global registry |
| `setLogger(logger)` | Set custom logger for duplicate registration warnings |

### Types

```typescript
// Input type for registration (name is auto-populated from SDK)
type ChainDeploymentInput = {
  readonly chainSelector: bigint
  readonly displayName: string
  readonly router?: string
}

// Full deployment type (with SDK canonical name)
type ChainDeployment = {
  readonly chainSelector: bigint
  readonly name: string  // SDK canonical name (e.g., 'ethereum-mainnet')
  readonly displayName: string  // Human-readable name for UI
  readonly router?: string
}

type CCIPEnabledDeployment = ChainDeployment & {
  readonly router: string
}

interface Registry {
  register(input: ChainDeploymentInput): void  // Name auto-populated from SDK
  get(chainSelector: bigint): ChainDeployment | undefined
  getByName(name: string): ChainDeployment | undefined  // SDK canonical name, O(1)
  getRouter(chainSelector: bigint): string | undefined
  getAll(): readonly ChainDeployment[]  // Returns frozen array
  getCCIPEnabled(): readonly CCIPEnabledDeployment[]  // Returns frozen array
  getCCIPEnabledCount(): number
  clear(): void
}

interface RegistryOptions {
  logger?: Logger  // Per-registry logger for full isolation
  skipValidation?: boolean  // For testing only
}

interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}
```

### Error Handling

```typescript
import {
  CCIPDeploymentNotFoundError,
  CCIPDeploymentNotFoundByNameError,
  CCIPRouterNotFoundError,
  ErrorCodes
} from '@chainlink/ccip-config'

try {
  requireDeployment(123n)
} catch (e) {
  if (e instanceof CCIPDeploymentNotFoundError) {
    console.log(e.code)           // 'CCIP_DEPLOYMENT_NOT_FOUND'
    console.log(e.chainSelector)  // 123n
    console.log(e.recovery)       // Suggestion to import chain data
  }
}

try {
  requireDeploymentByName('Unknown Chain')
} catch (e) {
  if (e instanceof CCIPDeploymentNotFoundByNameError) {
    console.log(e.code)        // 'CCIP_DEPLOYMENT_NOT_FOUND'
    console.log(e.displayName) // 'Unknown Chain'
  }
}
```

### Errors

- `CCIPDeploymentNotFoundError` - Thrown when deployment not found for selector
- `CCIPDeploymentNotFoundByNameError` - Thrown when deployment not found for display name
- `CCIPRouterNotFoundError` - Thrown when router not configured for chain

### Error Codes

- `ErrorCodes.DEPLOYMENT_NOT_FOUND` - `'CCIP_DEPLOYMENT_NOT_FOUND'`
- `ErrorCodes.ROUTER_NOT_FOUND` - `'CCIP_ROUTER_NOT_FOUND'`

## Available Chain Imports

| Import Path | Description |
|-------------|-------------|
| `@chainlink/ccip-config/chains` | All chains (all families, mainnet + testnet) |
| `@chainlink/ccip-config/chains/evm` | All EVM chains |
| `@chainlink/ccip-config/chains/evm/mainnet` | EVM mainnets only |
| `@chainlink/ccip-config/chains/evm/testnet` | EVM testnets only |
| `@chainlink/ccip-config/chains/solana` | All Solana chains |
| `@chainlink/ccip-config/chains/solana/mainnet` | Solana mainnet only |
| `@chainlink/ccip-config/chains/solana/testnet` | Solana testnets only |
| `@chainlink/ccip-config/chains/aptos` | All Aptos chains |
| `@chainlink/ccip-config/chains/sui` | All Sui chains |
| `@chainlink/ccip-config/chains/ton` | All TON chains |

## Tree Shaking

This package is designed for tree-shaking. Only the chains you import will be included in your bundle:

```typescript
// Only EVM mainnet chains included in bundle
import '@chainlink/ccip-config/chains/evm/mainnet'
```

## License

MIT
