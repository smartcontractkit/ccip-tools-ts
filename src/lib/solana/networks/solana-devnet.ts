import { type NetworkInfo } from '../../../types'

export const solanaDevnet = {
  name: 'Solana Devnet',
  chainId: 2303460267, // fake chainId used in Atlas
  chainSlug: 'solana',
  linkTokenAddress: '0xnotcreated', // TODO: update https://smartcontract-it.atlassian.net/browse/FRONT-6574
  explorer: {
    url: 'https://explorer.solana.com?cluster=devnet',
    tx: 'https://explorer.solana.com/tx/{resourceId}?cluster=devnet',
    address: 'https://explorer.solana.com/address/{resourceId}?cluster=devnet',
    token: 'https://explorer.solana.com/address/{resourceId}?cluster=devnet',
    name: 'Solana Explorer',
  },
  nativeCurrency: {
    name: 'Solana',
    symbol: 'SOL',
    decimals: 9,
  },
  networkSlug: 'solana-devnet',
  publicRpcUrl: 'https://api.devnet.solana.com',
  atlasNetworkName: 'solana-devnet',
  referenceDataDirectorySchema: 'solana-devnet',
  chainSelector: { name: 'solana-devnet', selector: '16423721717087811551' },
  chainFamily: 'solana',
  isTestnet: true,
  isPrivate: false,
  safeVaultSupported: false,
  rpcProxyUrl: 'solana/devnet',
} as const satisfies NetworkInfo
