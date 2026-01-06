import { registerDeployment } from '../../registry.ts'

// CCIP Sui Testnet/Localnet deployments
// Only contains: chainSelector, displayName, router
// Protocol data (chainId, name, family, isTestnet) lives in the SDK

// [chainSelector, displayName, router?]
export const chains: readonly [bigint, string, string?][] = [
  [18395503381733958356n, 'Sui Localnet'],
  [9762610643973837292n, 'Sui Testnet'],
]

for (const [chainSelector, displayName, router] of chains) {
  registerDeployment({ chainSelector, displayName, router })
}
