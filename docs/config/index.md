---
id: ccip-tools-config
title: CCIP Config
sidebar_label: CCIP Config Overview
sidebar_position: 0
edit_url: https://github.com/smartcontractkit/ccip-tools-ts/edit/main/docs/config/index.md
---

# CCIP Config

Chain deployment configuration registry for CCIP-enabled chains.

:::important
This package is provided under an MIT license and is for convenience and illustration purposes only.
:::

## Overview

`@chainlink/ccip-config` provides deployment data (router addresses, display names) for CCIP-enabled chains. It is designed to work alongside `@chainlink/ccip-sdk`.

**Separation of Concerns:**

| Package | Data Type | Examples |
|---------|-----------|----------|
| `@chainlink/ccip-sdk` | Protocol data | Chain selectors, families, network info |
| `@chainlink/ccip-config` | Deployment data | Router addresses, display names |

## Installation

```bash
npm install @chainlink/ccip-config
```

## Quick Start

```typescript
import { getRouter, requireRouter, getDisplayName } from '@chainlink/ccip-config'
import '@chainlink/ccip-config/chains/evm/mainnet'

// Get Ethereum mainnet router
const router = getRouter(5009297550715157269n)
// => '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D'
```

---

## Importing Chain Deployments

Chain deployments are registered via **side-effect imports**. Import only what you need for optimal bundle size:

### Specific Environments

```typescript
// EVM chains only
import '@chainlink/ccip-config/chains/evm/mainnet'  // EVM mainnets
import '@chainlink/ccip-config/chains/evm/testnet'  // EVM testnets
import '@chainlink/ccip-config/chains/evm'          // All EVM

// Non-EVM chains
import '@chainlink/ccip-config/chains/solana/mainnet'
import '@chainlink/ccip-config/chains/solana/testnet'
import '@chainlink/ccip-config/chains/solana'

import '@chainlink/ccip-config/chains/aptos'
import '@chainlink/ccip-config/chains/sui'
import '@chainlink/ccip-config/chains/ton'
```

### All Chains

```typescript
// Import everything (larger bundle)
import '@chainlink/ccip-config/chains'
```

### Available Import Paths

| Import Path | Description |
|-------------|-------------|
| `@chainlink/ccip-config/chains` | All chains |
| `@chainlink/ccip-config/chains/evm` | All EVM chains |
| `@chainlink/ccip-config/chains/evm/mainnet` | EVM mainnets only |
| `@chainlink/ccip-config/chains/evm/testnet` | EVM testnets only |
| `@chainlink/ccip-config/chains/solana` | All Solana chains |
| `@chainlink/ccip-config/chains/solana/mainnet` | Solana mainnet |
| `@chainlink/ccip-config/chains/solana/testnet` | Solana testnets |
| `@chainlink/ccip-config/chains/aptos` | All Aptos chains |
| `@chainlink/ccip-config/chains/aptos/mainnet` | Aptos mainnet |
| `@chainlink/ccip-config/chains/aptos/testnet` | Aptos testnets |
| `@chainlink/ccip-config/chains/sui` | All Sui chains |
| `@chainlink/ccip-config/chains/sui/mainnet` | Sui mainnet |
| `@chainlink/ccip-config/chains/sui/testnet` | Sui testnets |
| `@chainlink/ccip-config/chains/ton` | All TON chains |
| `@chainlink/ccip-config/chains/ton/mainnet` | TON mainnet |
| `@chainlink/ccip-config/chains/ton/testnet` | TON testnets |

---

## API Reference

### Lookup Functions

#### getRouter

Get router address for a chain. Returns `undefined` if not found.

```typescript
import { getRouter } from '@chainlink/ccip-config'

const router = getRouter(5009297550715157269n)
// => '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D' or undefined
```

#### requireRouter

Get router address, throws if not found or not configured.

```typescript
import { requireRouter } from '@chainlink/ccip-config'

try {
  const router = requireRouter(5009297550715157269n)
} catch (e) {
  // CCIPDeploymentNotFoundError or CCIPRouterNotFoundError
}
```

#### getDisplayName

Get human-readable display name for a chain.

```typescript
import { getDisplayName } from '@chainlink/ccip-config'

const name = getDisplayName(5009297550715157269n)
// => 'Ethereum'
```

#### isCCIPEnabled (Type Guard)

Type guard to check if a deployment has CCIP router configured. Narrows `ChainDeployment` to `CCIPEnabledDeployment`.

```typescript
import { getDeployment, isCCIPEnabled } from '@chainlink/ccip-config'

const deployment = getDeployment(5009297550715157269n)
if (deployment && isCCIPEnabled(deployment)) {
  // deployment.router is now string (not string | undefined)
  console.log(deployment.router)
}
```

#### isCCIPEnabledBySelector

Check if a chain has CCIP router configured by selector.

```typescript
import { isCCIPEnabledBySelector } from '@chainlink/ccip-config'

if (isCCIPEnabledBySelector(5009297550715157269n)) {
  // Chain has CCIP router
}
```

#### getDeployment / requireDeployment

Get full deployment object.

```typescript
import { getDeployment, requireDeployment } from '@chainlink/ccip-config'

const deployment = getDeployment(5009297550715157269n)
// => { chainSelector: 5009297550715157269n, displayName: 'Ethereum', router: '0x...' }

const deployment = requireDeployment(5009297550715157269n)
// Throws if not found
```

#### getDeploymentByName

Find deployment by SDK canonical name (case-sensitive, O(1) lookup).

```typescript
import { getDeploymentByName } from '@chainlink/ccip-config'

const deployment = getDeploymentByName('ethereum-mainnet')
// => { chainSelector: 5009297550715157269n, name: 'ethereum-mainnet', displayName: 'Ethereum', router: '0x...' }

// Case-sensitive: 'Ethereum' won't match (that's displayName, not SDK name)
```

### List Functions

#### getAllDeployments

Get all registered deployments.

```typescript
import { getAllDeployments } from '@chainlink/ccip-config'
import '@chainlink/ccip-config/chains'

const deployments = getAllDeployments()
console.log(`Total: ${deployments.length} chains`)
```

#### getCCIPEnabledDeployments

Get only deployments with router addresses configured.

```typescript
import { getCCIPEnabledDeployments } from '@chainlink/ccip-config'
import '@chainlink/ccip-config/chains'

const enabled = getCCIPEnabledDeployments()
// Only chains with router addresses
```

#### getCCIPEnabledCount

Get count of CCIP-enabled chains (O(1) operation).

```typescript
import { getCCIPEnabledCount } from '@chainlink/ccip-config'
import '@chainlink/ccip-config/chains'

const count = getCCIPEnabledCount()
// => 100+ (number of chains with routers)
```

### Registry Functions

#### createRegistry

Create an isolated registry instance for testing or advanced use cases.

```typescript
import { createRegistry } from '@chainlink/ccip-config'

const registry = createRegistry()

// Register using real chain selector (name auto-populated from SDK)
registry.register({
  chainSelector: 5009297550715157269n,  // Ethereum mainnet
  displayName: 'Ethereum',
  router: '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
})

// Use the isolated registry
const deployment = registry.get(5009297550715157269n)
const byName = registry.getByName('ethereum-mainnet')  // SDK canonical name
const enabled = registry.getCCIPEnabled()
const count = registry.getCCIPEnabledCount()
registry.clear()

// For testing with fake chain selectors, use skipValidation
const testRegistry = createRegistry({ skipValidation: true })
testRegistry.register({ chainSelector: 123n, displayName: 'Test' })
```

---

## Types

### ChainDeploymentInput

Input type for registration (name is auto-populated from SDK).

```typescript
type ChainDeploymentInput = {
  readonly chainSelector: bigint
  readonly displayName: string
  readonly router?: string
}
```

### ChainDeployment

Full deployment type with SDK canonical name.

```typescript
type ChainDeployment = {
  readonly chainSelector: bigint
  readonly name: string       // SDK canonical name (e.g., 'ethereum-mainnet')
  readonly displayName: string // Human-readable name for UI
  readonly router?: string
}
```

### CCIPEnabledDeployment

A `ChainDeployment` with guaranteed router address.

```typescript
type CCIPEnabledDeployment = ChainDeployment & {
  readonly router: string
}
```

### Registry

Interface for isolated registries.

```typescript
interface Registry {
  register(input: ChainDeploymentInput): void  // Name auto-populated from SDK
  get(chainSelector: bigint): ChainDeployment | undefined
  getByName(name: string): ChainDeployment | undefined  // SDK canonical name, O(1)
  getRouter(chainSelector: bigint): string | undefined
  getAll(): readonly ChainDeployment[]
  getCCIPEnabled(): readonly CCIPEnabledDeployment[]
  getCCIPEnabledCount(): number
  clear(): void
}
```

---

## Errors

### CCIPDeploymentNotFoundError

Thrown when no deployment is found for a chain selector.

```typescript
import { CCIPDeploymentNotFoundError, ErrorCodes } from '@chainlink/ccip-config'

try {
  requireDeployment(123n)
} catch (e) {
  if (e instanceof CCIPDeploymentNotFoundError) {
    console.log(e.code)           // ErrorCodes.DEPLOYMENT_NOT_FOUND
    console.log(e.chainSelector)  // 123n
    console.log(e.recovery)       // Suggestion to import chain data
  }
}
```

### CCIPRouterNotFoundError

Thrown when a chain exists but has no router configured.

```typescript
import { CCIPRouterNotFoundError, ErrorCodes } from '@chainlink/ccip-config'

try {
  requireRouter(someChainWithoutRouter)
} catch (e) {
  if (e instanceof CCIPRouterNotFoundError) {
    console.log(e.code)           // ErrorCodes.ROUTER_NOT_FOUND
    console.log(e.chainSelector)
    console.log(e.displayName)
  }
}
```

### Error Codes

```typescript
import { ErrorCodes } from '@chainlink/ccip-config'

ErrorCodes.DEPLOYMENT_NOT_FOUND  // 'CCIP_DEPLOYMENT_NOT_FOUND'
ErrorCodes.ROUTER_NOT_FOUND      // 'CCIP_ROUTER_NOT_FOUND'
```

---

## Integration with SDK

Use ccip-config with ccip-sdk for complete chain information:

```typescript
import { networkInfo } from '@chainlink/ccip-sdk'
import { getRouter } from '@chainlink/ccip-config'
import '@chainlink/ccip-config/chains/evm/mainnet'

// Get protocol info from SDK
const network = networkInfo('ethereum-mainnet')
console.log(network.chainSelector)  // 5009297550715157269n
console.log(network.family)         // 'evm'
console.log(network.isTestnet)      // false

// Get deployment info from ccip-config
const router = getRouter(network.chainSelector)
console.log(router)  // '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D'
```

---

## Tree Shaking

This package is designed for optimal tree-shaking. Only imported chains are included in your bundle:

```typescript
// Only EVM mainnet chains in bundle (~50 chains)
import '@chainlink/ccip-config/chains/evm/mainnet'

// vs all chains (~250 chains)
import '@chainlink/ccip-config/chains'
```

---

## Next Steps

- [SDK Documentation](../sdk/) - Chain abstraction and message handling
- [CLI Reference](../cli/) - Use `ccip chains` command for chain discovery
- [CCIP Directory](https://docs.chain.link/ccip/directory) - Official router addresses
