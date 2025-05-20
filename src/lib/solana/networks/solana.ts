export const solana = {
  name: 'Solana',
  chainId: 2961997552, //fake chain ID used in atlas
  chainSlug: 'solana',
  linkTokenAddress: '0xnotcreated', // TODO: update https://smartcontract-it.atlassian.net/browse/FRONT-6574
  explorer: {
    url: 'https://explorer.solana.com',
    tx: 'https://explorer.solana.com/tx',
    address: 'https://explorer.solana.com/address',
    token: 'https://explorer.solana.com/address',
    name: 'Solana Explorer',
  },
  nativeCurrency: {
    name: 'Solana',
    symbol: 'SOL',
    decimals: 9,
  },
  networkSlug: 'solana',
  publicRpcUrl: 'https://api.mainnet-beta.solana.com',
  atlasNetworkName: 'solana-mainnet',
  referenceDataDirectorySchema: 'solana-mainnet',
  chainSelector: { name: 'solana-mainnet', selector: '124615329519749607' },
  chainFamily: 'solana',
  isTestnet: false,
  isPrivate: false,
  safeVaultSupported: false,
  rpcProxyUrl: 'solana/mainnet',
} as const
