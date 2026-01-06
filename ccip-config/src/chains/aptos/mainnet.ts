import { registerDeployment } from '../../registry.ts'

// CCIP Aptos Mainnet deployments
// Only contains: chainSelector, displayName, router
// Protocol data (chainId, name, family, isTestnet) lives in the SDK

// [chainSelector, displayName, router?]
export const chains: readonly [bigint, string, string?][] = [
  [
    4741433654826277614n,
    'Aptos',
    '0x20f808de3375db34d17cc946ec6b43fc26962f6afa125182dc903359756caf6b',
  ],
]

for (const [chainSelector, displayName, router] of chains) {
  registerDeployment({ chainSelector, displayName, router })
}
