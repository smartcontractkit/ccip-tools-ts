import { registerDeployment } from '../../registry.ts'

// CCIP TON Testnet/Localnet deployments
// Only contains: chainSelector, displayName, router
// Protocol data (chainId, name, family, isTestnet) lives in the SDK

// [chainSelector, displayName, router?]
export const chains: readonly [bigint, string, string?][] = [
  [13879075125137744094n, 'TON Localnet'],
  [1399300952838017768n, 'TON Testnet'],
]

for (const [chainSelector, displayName, router] of chains) {
  registerDeployment({ chainSelector, displayName, router })
}
