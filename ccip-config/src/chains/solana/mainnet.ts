import { registerDeployment } from '../../registry.ts'

// CCIP Solana Mainnet deployments
// Only contains: chainSelector, displayName, router
// Protocol data (chainId, name, family, isTestnet) lives in the SDK

// [chainSelector, displayName, router?]
export const chains: readonly [bigint, string, string?][] = [
  [124615329519749607n, 'Solana', 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C'],
]

for (const [chainSelector, displayName, router] of chains) {
  registerDeployment({ chainSelector, displayName, router })
}
