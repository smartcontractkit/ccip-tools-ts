/**
 * ChainsExplorer - Interactive chain explorer with search and filters
 *
 * Features:
 * - Search chains by name, chain ID, or selector
 * - Filter by family (EVM, SVM, APTOS, SUI, TON) and environment (mainnet/testnet)
 * - Copy chain selector to clipboard
 * - Responsive design: table on desktop, cards on mobile
 * - URL state persistence for shareable links
 */

import { ChainFamily as ChainFamilyEnum } from '@chainlink/ccip-sdk'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import styles from './ChainsExplorer.module.css'
import { useChains, useFilters, useSearch } from './hooks/index.ts'
import type { ChainInfo, ChainsExplorerProps } from './types.ts'
import { cn } from '../../utils/classNames.ts'

// Family options for filter dropdown
const FAMILY_OPTIONS = [
  { value: 'all', label: 'All Families' },
  { value: ChainFamilyEnum.EVM, label: 'EVM' },
  { value: ChainFamilyEnum.Solana, label: 'Solana (SVM)' },
  { value: ChainFamilyEnum.Aptos, label: 'Aptos' },
  { value: ChainFamilyEnum.Sui, label: 'Sui' },
  { value: ChainFamilyEnum.TON, label: 'TON' },
] as const

// Environment options for filter dropdown
const ENVIRONMENT_OPTIONS = [
  { value: 'all', label: 'All Networks' },
  { value: 'mainnet', label: 'Mainnet' },
  { value: 'testnet', label: 'Testnet' },
] as const

// Copy icon SVG
function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

// Check icon SVG (for copied state)
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

// External link icon
function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

// Copy button component with feedback
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = value
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [value])

  return (
    <button
      className={cn(styles.copyButton, copied && styles.copyButtonCopied)}
      onClick={() => void handleCopy()}
      aria-label={copied ? 'Copied!' : `Copy ${label}`}
      title={copied ? 'Copied!' : `Copy ${label}`}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}

// Badge component
function Badge({
  children,
  variant,
}: {
  children: React.ReactNode
  variant: 'family' | 'mainnet' | 'testnet' | 'supported' | 'unsupported'
}) {
  const variantClass = {
    family: styles.badgeFamily,
    mainnet: styles.badgeMainnet,
    testnet: styles.badgeTestnet,
    supported: styles.badgeSupported,
    unsupported: styles.badgeUnsupported,
  }[variant]

  return <span className={cn(styles.badge, variantClass)}>{children}</span>
}

// Truncate long strings (e.g., Solana chain IDs)
function truncateIfLong(value: string, maxLength = 12): string {
  if (value.length <= maxLength) return value
  const start = Math.ceil(maxLength / 2)
  const end = Math.floor(maxLength / 2) - 1
  return `${value.slice(0, start)}...${value.slice(-end)}`
}

// Table row component
function ChainTableRow({ chain }: { chain: ChainInfo }) {
  const chainIdStr = String(chain.chainId)
  const needsTruncation = chainIdStr.length > 12

  return (
    <tr className={styles.tableRow}>
      <td className={styles.tableCell}>
        <div className={styles.selectorCell}>
          <span className={styles.chainName}>{chain.name}</span>
          <CopyButton value={chain.name} label="chain" />
        </div>
      </td>
      <td className={styles.tableCell}>
        <span className={styles.displayName}>{chain.displayName}</span>
      </td>
      <td className={styles.tableCell}>
        <div className={styles.selectorCell}>
          <span className={styles.chainId} title={needsTruncation ? chainIdStr : undefined}>
            {truncateIfLong(chainIdStr)}
          </span>
          <CopyButton value={chainIdStr} label="chain ID" />
        </div>
      </td>
      <td className={styles.tableCell}>
        <div className={styles.selectorCell}>
          <span className={styles.selector} title={chain.chainSelector}>
            {chain.chainSelector}
          </span>
          <CopyButton value={chain.chainSelector} label="selector" />
        </div>
      </td>
      <td className={styles.tableCell}>
        <Badge variant="family">{chain.family}</Badge>
      </td>
      <td className={styles.tableCell}>
        <Badge variant={chain.environment}>{chain.environment}</Badge>
      </td>
      <td className={styles.tableCell}>
        <Badge variant={chain.supported ? 'supported' : 'unsupported'}>
          {chain.supported ? 'Supported' : 'Unsupported'}
        </Badge>
      </td>
    </tr>
  )
}

// Card component for mobile view
function ChainCard({ chain }: { chain: ChainInfo }) {
  const chainIdStr = String(chain.chainId)
  const needsTruncation = chainIdStr.length > 12

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.selectorCell}>
          <span className={styles.cardTitle}>{chain.name}</span>
          <CopyButton value={chain.name} label="chain" />
        </div>
        <div className={styles.cardBadges}>
          <Badge variant="family">{chain.family}</Badge>
          <Badge variant={chain.environment}>{chain.environment}</Badge>
        </div>
      </div>
      <div className={styles.cardRow}>
        <span className={styles.cardLabel}>Display Name</span>
        <span className={styles.cardValue}>{chain.displayName}</span>
      </div>
      <div className={styles.cardRow}>
        <span className={styles.cardLabel}>Chain ID</span>
        <div className={styles.selectorCell}>
          <span className={styles.cardValue} title={needsTruncation ? chainIdStr : undefined}>
            {truncateIfLong(chainIdStr)}
          </span>
          <CopyButton value={chainIdStr} label="chain ID" />
        </div>
      </div>
      <div className={styles.cardRow}>
        <span className={styles.cardLabel}>Selector</span>
        <div className={styles.selectorCell}>
          <span className={styles.cardValue} title={chain.chainSelector}>
            {chain.chainSelector.slice(0, 8)}...{chain.chainSelector.slice(-4)}
          </span>
          <CopyButton value={chain.chainSelector} label="selector" />
        </div>
      </div>
      <div className={styles.cardRow}>
        <span className={styles.cardLabel}>Status</span>
        <Badge variant={chain.supported ? 'supported' : 'unsupported'}>
          {chain.supported ? 'Supported' : 'Unsupported'}
        </Badge>
      </div>
    </div>
  )
}

export function ChainsExplorer({ className }: ChainsExplorerProps) {
  // Filter state with URL sync
  const { filters, setFilter, resetFilters, hasActiveFilters } = useFilters({
    syncToUrl: true,
  })

  // Search with debounce
  const search = useSearch({
    initialValue: filters.search,
    debounceMs: 300,
    onSearch: (value) => setFilter('search', value),
  })

  // Fetch chains data
  const { chains, isLoading, error, refetch } = useChains({
    fetchOnMount: true,
  })

  // Refetch when search changes (debounced)
  useEffect(() => {
    if (search.debouncedValue !== filters.search) {
      // Already handled by onSearch callback
      return
    }
    // Fetch with search term
    const env = filters.environment !== 'all' ? filters.environment : undefined
    void refetch(env, search.debouncedValue || undefined)
  }, [search.debouncedValue])

  // Refetch when environment filter changes
  useEffect(() => {
    const env = filters.environment !== 'all' ? filters.environment : undefined
    void refetch(env, filters.search || undefined)
  }, [filters.environment])

  // Filter and sort chains
  // - Family filter is client-side since API doesn't support it
  // - Sort alphabetically by chain name (internal ID) for consistency with CLI
  const filteredChains = useMemo(() => {
    let result = chains
    if (filters.family !== 'all') {
      result = result.filter((chain) => chain.family === filters.family)
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }, [chains, filters.family])

  return (
    <div className={cn(styles.container, className)}>
      {/* Header with search and filters */}
      <div className={styles.header}>
        <div className={styles.searchRow}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search chains by name, chain ID, or selector..."
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            aria-label="Search chains"
          />
        </div>

        <div className={styles.filterRow}>
          <select
            className={styles.filterSelect}
            value={filters.family}
            onChange={(e) => setFilter('family', e.target.value as typeof filters.family)}
            aria-label="Filter by family"
          >
            {FAMILY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            className={styles.filterSelect}
            value={filters.environment}
            onChange={(e) => setFilter('environment', e.target.value as typeof filters.environment)}
            aria-label="Filter by network"
          >
            {ENVIRONMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {hasActiveFilters && (
            <button
              className={styles.resetButton}
              onClick={resetFilters}
              aria-label="Clear filters"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Results info */}
      <div className={styles.resultsInfo}>
        <span className={styles.resultsCount} role="status" aria-live="polite">
          {isLoading ? 'Loading...' : `${filteredChains.length} chains found`}
        </span>
        <a
          href="https://docs.chain.link/ccip/directory"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.directoryLink}
        >
          View contract addresses <ExternalLinkIcon />
        </a>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className={styles.loading}>
          <div className={styles.spinner} aria-hidden="true" />
          <span>Loading chains...</span>
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Failed to load chains</div>
          <div>{error.message}</div>
          <button
            className={styles.retryButton}
            onClick={() => {
              const env = filters.environment !== 'all' ? filters.environment : undefined
              void refetch(env, filters.search || undefined)
            }}
          >
            Try Again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && filteredChains.length === 0 && (
        <div className={styles.empty}>
          {filters.family !== 'all' && chains.length > 0 ? (
            <>
              <div className={styles.emptyTitle}>{filters.family} chains not yet supported</div>
              <div>This chain family is coming soon to CCIP.</div>
            </>
          ) : (
            <>
              <div className={styles.emptyTitle}>No chains found</div>
              <div>Try adjusting your search or filters.</div>
            </>
          )}
          {hasActiveFilters && (
            <button
              className={styles.resetButton}
              onClick={resetFilters}
              style={{ marginTop: '16px' }}
            >
              Clear Filters
            </button>
          )}
        </div>
      )}

      {/* Table view (desktop) */}
      {!isLoading && !error && filteredChains.length > 0 && (
        <div className={styles.tableWrapper}>
          <table className={styles.table} aria-label="Supported chains">
            <thead className={styles.tableHeader}>
              <tr>
                <th className={styles.tableHeaderCell} scope="col">
                  Chain
                </th>
                <th className={styles.tableHeaderCell} scope="col">
                  Display Name
                </th>
                <th className={styles.tableHeaderCell} scope="col">
                  Chain ID
                </th>
                <th className={styles.tableHeaderCell} scope="col">
                  Selector
                </th>
                <th className={styles.tableHeaderCell} scope="col">
                  Family
                </th>
                <th className={styles.tableHeaderCell} scope="col">
                  Network
                </th>
                <th className={styles.tableHeaderCell} scope="col">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredChains.map((chain) => (
                <ChainTableRow key={chain.chainSelector} chain={chain} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Card view (mobile) */}
      {!isLoading && !error && filteredChains.length > 0 && (
        <div className={styles.cardGrid}>
          {filteredChains.map((chain) => (
            <ChainCard key={chain.chainSelector} chain={chain} />
          ))}
        </div>
      )}
    </div>
  )
}

export default ChainsExplorer
