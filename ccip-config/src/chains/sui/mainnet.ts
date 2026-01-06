import { registerDeployment } from '../../registry.ts'

// CCIP Sui Mainnet deployments
// Only contains: chainSelector, displayName, router
// Protocol data (chainId, name, family, isTestnet) lives in the SDK

// [chainSelector, displayName, router?]
export const chains: readonly [bigint, string, string?][] = [[17529533435026248318n, 'Sui']]

for (const [chainSelector, displayName, router] of chains) {
  registerDeployment({ chainSelector, displayName, router })
}
