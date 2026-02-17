/**
 * ChainSelect - Chain selector component for CLI Builder
 *
 * Specialized select for blockchain networks with grouped options
 * for mainnets and testnets. Uses Chainlink CCIP supported chains.
 */

import { type ChangeEvent, useCallback, useId, useMemo } from 'react'

import styles from './inputs.module.css'
import type { ArgumentDefinition, ChainOption } from '../../types/index.ts'

export interface ChainSelectProps {
  /** Chain option or argument definition */
  definition: ChainOption | ArgumentDefinition
  /** Currently selected chain identifier */
  value: string
  /** Change handler */
  onChange: (value: string) => void
  /** Validation error message */
  error?: string
  /** Whether the field is disabled */
  disabled?: boolean
}

/**
 * Chain groups for organized dropdown
 */
interface ChainGroup {
  label: string
  chains: Array<{ value: string; label: string }>
}

/**
 * CCIP-supported chains organized by network type
 * These match the chain selectors used by ccip-cli
 */
const CHAIN_GROUPS: ChainGroup[] = [
  {
    label: 'EVM Mainnets',
    chains: [
      { value: 'ethereum-mainnet-1', label: 'Ethereum Mainnet' },
      { value: 'arbitrum-mainnet-1', label: 'Arbitrum One' },
      { value: 'avalanche-mainnet-1', label: 'Avalanche C-Chain' },
      { value: 'base-mainnet-1', label: 'Base' },
      { value: 'bnb-mainnet-1', label: 'BNB Chain' },
      { value: 'optimism-mainnet-1', label: 'Optimism' },
      { value: 'polygon-mainnet-1', label: 'Polygon' },
    ],
  },
  {
    label: 'EVM Testnets',
    chains: [
      { value: 'ethereum-testnet-sepolia', label: 'Ethereum Sepolia' },
      { value: 'arbitrum-testnet-sepolia', label: 'Arbitrum Sepolia' },
      { value: 'avalanche-testnet-fuji', label: 'Avalanche Fuji' },
      { value: 'base-testnet-sepolia', label: 'Base Sepolia' },
      { value: 'bnb-testnet-1', label: 'BNB Testnet' },
      { value: 'optimism-testnet-sepolia', label: 'Optimism Sepolia' },
      { value: 'polygon-testnet-amoy', label: 'Polygon Amoy' },
    ],
  },
  {
    label: 'Solana',
    chains: [
      { value: 'solana-mainnet-1', label: 'Solana Mainnet' },
      { value: 'solana-testnet-devnet', label: 'Solana Devnet' },
    ],
  },
]

/**
 * Flatten chains for lookup
 */
const ALL_CHAINS = CHAIN_GROUPS.flatMap((g) => g.chains)

/**
 * Chain selector with grouped options
 *
 * @example
 * ```tsx
 * <ChainSelect
 *   definition={{ name: 'source', label: 'Source Chain', required: true }}
 *   value={values.source}
 *   onChange={(v) => handleChange('source', v)}
 * />
 * ```
 */
export function ChainSelect({
  definition,
  value,
  onChange,
  error,
  disabled = false,
}: ChainSelectProps) {
  const selectId = useId()
  const errorId = `${selectId}-error`
  const descriptionId = `${selectId}-description`

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      onChange(e.target.value)
    },
    [onChange],
  )

  // Filter chains if definition specifies allowed chains
  const filteredGroups = useMemo(() => {
    // Check if this is a ChainOption with allowedChains
    if (!('allowedChains' in definition) || !definition.allowedChains) {
      return CHAIN_GROUPS
    }

    const allowedChains = definition.allowedChains
    return CHAIN_GROUPS.map((group) => ({
      ...group,
      chains: group.chains.filter((chain) => {
        // Filter by chain type (evm, solana)
        if (allowedChains.includes('evm') && !chain.value.includes('solana')) {
          return true
        }
        if (allowedChains.includes('solana') && chain.value.includes('solana')) {
          return true
        }
        return false
      }),
    })).filter((group) => group.chains.length > 0)
  }, [definition])

  const hasError = Boolean(error)
  const isRequired = definition.required ?? false

  // Get selected chain label
  const selectedChain = ALL_CHAINS.find((c) => c.value === value)

  return (
    <div className={styles.inputWrapper}>
      <label htmlFor={selectId} className={styles.label}>
        {definition.label}
        {isRequired && <span className={styles.required}>*</span>}
      </label>

      <select
        id={selectId}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        className={`${styles.select} ${styles.chainSelect} ${hasError ? styles.inputError : ''}`}
        aria-invalid={hasError}
        aria-describedby={
          [error ? errorId : null, definition.description ? descriptionId : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
        aria-required={isRequired}
      >
        <option value="">Select a chain...</option>
        {filteredGroups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.chains.map((chain) => (
              <option key={chain.value} value={chain.value}>
                {chain.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {selectedChain && value && (
        <p className={styles.chainHint}>
          Chain ID: <code>{value}</code>
        </p>
      )}

      {definition.description && (
        <p id={descriptionId} className={styles.description}>
          {definition.description}
        </p>
      )}

      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
