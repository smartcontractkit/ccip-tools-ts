import { registerDeployment } from '../../registry.ts'

// CCIP Aptos Testnet/Localnet deployments
// Only contains: chainSelector, displayName, router
// Protocol data (chainId, name, family, isTestnet) lives in the SDK

// [chainSelector, displayName, router?]
export const chains: readonly [bigint, string, string?][] = [
  [4457093679053095497n, 'Aptos Localnet'],
  [
    743186221051783445n,
    'Aptos Testnet',
    '0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45',
  ],
]

for (const [chainSelector, displayName, router] of chains) {
  registerDeployment({ chainSelector, displayName, router })
}
