import { registerDeployment } from '../../registry.ts'

// CCIP Solana Testnet/Devnet deployments
// Only contains: chainSelector, displayName, router
// Protocol data (chainId, name, family, isTestnet) lives in the SDK

// [chainSelector, displayName, router?]
export const chains: readonly [bigint, string, string?][] = [
  [16423721717087811551n, 'Solana Devnet', 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C'],
  [6302590918974934319n, 'Solana Testnet'],
]

for (const [chainSelector, displayName, router] of chains) {
  registerDeployment({ chainSelector, displayName, router })
}
