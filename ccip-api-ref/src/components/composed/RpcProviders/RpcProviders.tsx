import TabItem from '@theme/TabItem'
import Tabs from '@theme/Tabs'
import React from 'react'

import styles from './RpcProviders.module.css'
import type { ChainType } from '../../../types/index.ts'
import { cn } from '../../../utils/index.ts'

/**
 * RPC Provider configuration with multi-chain support
 */
interface RpcProvider {
  name: string
  url: string
  description: string
  chains: ChainType[]
}

/**
 * List of RPC providers - single source of truth for CLI and SDK docs
 * Organized by multi-chain support first, then chain-specific
 */
const RPC_PROVIDERS: RpcProvider[] = [
  // Multi-chain providers
  {
    name: 'QuickNode',
    url: 'https://quicknode.com',
    description: 'Multi-chain support with free tier',
    chains: ['evm', 'solana', 'aptos'],
  },
  {
    name: 'Alchemy',
    url: 'https://alchemy.com',
    description: 'Enterprise-grade with free tier',
    chains: ['evm', 'solana'],
  },
  // EVM-only providers
  {
    name: 'Chainlist.org',
    url: 'https://chainlist.org/',
    description: 'Free public RPCs for EVM networks',
    chains: ['evm'],
  },
  {
    name: 'Infura',
    url: 'https://infura.io',
    description: 'Reliable EVM endpoints with free tier',
    chains: ['evm'],
  },
  // Solana-only providers
  {
    name: 'Helius',
    url: 'https://helius.dev',
    description: 'Popular Solana RPC with generous free tier',
    chains: ['solana'],
  },
  {
    name: 'Solana Official',
    url: 'https://docs.solana.com/cluster/rpc-endpoints',
    description: 'Free but rate-limited official endpoints',
    chains: ['solana'],
  },
  // Aptos providers
  {
    name: 'Aptos Labs',
    url: 'https://aptos.dev/en/network/nodes/networks',
    description: 'Official Aptos endpoints',
    chains: ['aptos'],
  },
  {
    name: 'Nodereal',
    url: 'https://nodereal.io',
    description: 'Aptos and EVM support with free tier',
    chains: ['evm', 'aptos'],
  },
]

/** Chain family filter options */
type ChainFamily = 'evm' | 'solana' | 'aptos' | 'all'

export interface RpcProvidersProps {
  /** Display as table or list */
  variant?: 'table' | 'list'
  /** Filter by chain family (default: 'all' shows tabs) */
  chainFamily?: ChainFamily
  /** Additional CSS class */
  className?: string
  /** Show tip (default: true) */
  showTip?: boolean
}

/** Get providers for a specific chain */
function getProvidersForChain(chain: ChainType): RpcProvider[] {
  return RPC_PROVIDERS.filter((p) => p.chains.includes(chain))
}

/** Chain display labels */
const CHAIN_LABELS: Record<ChainType, string> = {
  evm: 'EVM',
  solana: 'Solana',
  aptos: 'Aptos',
  sui: 'Sui', // Not used but kept for type safety
}

/** Chain-specific tips */
const CHAIN_TIPS: Record<ChainType, React.ReactNode> = {
  evm: (
    <>
      For quick testing,{' '}
      <a href="https://chainlist.org/" target="_blank" rel="noopener noreferrer">
        Chainlist.org
      </a>{' '}
      provides free public RPCs. For production, use Alchemy or Infura for better rate limits.
    </>
  ),
  solana: (
    <>
      For development,{' '}
      <a href="https://helius.dev" target="_blank" rel="noopener noreferrer">
        Helius
      </a>{' '}
      offers a generous free tier. Official Solana endpoints are rate-limited but work for testing.
    </>
  ),
  aptos: (
    <>
      Official{' '}
      <a
        href="https://aptos.dev/en/network/nodes/networks"
        target="_blank"
        rel="noopener noreferrer"
      >
        Aptos Labs endpoints
      </a>{' '}
      work well for development. For production, consider QuickNode or Nodereal.
    </>
  ),
  sui: <>Sui support coming soon.</>, // Placeholder
}

/**
 * RpcProviders displays a list of RPC endpoint providers
 * Shared component for consistent RPC guidance across CLI and SDK docs
 */
export function RpcProviders({
  variant = 'table',
  chainFamily = 'all',
  className,
  showTip = true,
}: RpcProvidersProps): React.JSX.Element {
  // Single chain view
  if (chainFamily !== 'all') {
    const providers = getProvidersForChain(chainFamily)
    return (
      <div className={cn(styles.rpcProviders, className)}>
        <ProviderDisplay providers={providers} variant={variant} />
        {showTip && <Tip chain={chainFamily} />}
      </div>
    )
  }

  // Tabbed view for all chains
  const chains: ChainType[] = ['evm', 'solana', 'aptos']

  return (
    <div className={cn(styles.rpcProviders, className)}>
      <Tabs>
        {chains.map((chain) => (
          <TabItem key={chain} value={chain} label={CHAIN_LABELS[chain]}>
            <ProviderDisplay providers={getProvidersForChain(chain)} variant={variant} />
            {showTip && <Tip chain={chain} />}
          </TabItem>
        ))}
      </Tabs>
    </div>
  )
}

interface ProviderDisplayProps {
  providers: RpcProvider[]
  variant: 'table' | 'list'
}

function ProviderDisplay({ providers, variant }: ProviderDisplayProps): React.JSX.Element {
  if (variant === 'list') {
    return (
      <ul className={styles.list}>
        {providers.map((provider) => (
          <li key={provider.name}>
            <a href={provider.url} target="_blank" rel="noopener noreferrer">
              {provider.name}
            </a>{' '}
            - {provider.description}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Provider</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {providers.map((provider) => (
          <tr key={provider.name}>
            <td>
              <a href={provider.url} target="_blank" rel="noopener noreferrer">
                {provider.name}
              </a>
            </td>
            <td>{provider.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface TipProps {
  chain: ChainType
}

function Tip({ chain }: TipProps): React.JSX.Element {
  return (
    <div className={styles.tip}>
      <strong>Tip:</strong> {CHAIN_TIPS[chain]}
    </div>
  )
}
