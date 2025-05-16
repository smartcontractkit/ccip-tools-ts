const selectorToClusterMap = {
  'solana-mainnet': 'mainnet-beta',
  'solana-devnet': 'devnet',
} as const

type SupportedCluster = 'mainnet-beta' | 'devnet'

export const isSupportedSolanaCluster = (
  selector: string,
): selector is keyof typeof selectorToClusterMap => selector in selectorToClusterMap

export const getClusterByChainSelectorName = (selector: string): SupportedCluster => {
  if (!isSupportedSolanaCluster(selector)) {
    throw new Error(`Unsupported chain selector name: ${selector}`)
  }

  return selectorToClusterMap[selector]
}

export const getClusterUrlByChainSelectorName = (selector: string) => {
  const cluster = getClusterByChainSelectorName(selector)
  return `https://api.${cluster}.solana.com`
}
