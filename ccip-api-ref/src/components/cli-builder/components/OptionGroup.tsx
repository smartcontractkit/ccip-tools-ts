/**
 * OptionGroup - Visual grouping for related CLI options
 *
 * Groups related options together with a heading for better
 * organization and scannability.
 */

import type { ReactNode } from 'react'

import styles from './CLIBuilder.module.css'

export interface OptionGroupProps {
  /** Group label/heading */
  label: string
  /** Group description (optional) */
  description?: string
  /** Child input components */
  children: ReactNode
  /** Whether the group is collapsed by default */
  defaultCollapsed?: boolean
  /** Additional CSS class */
  className?: string
}

/**
 * Option group container with heading
 *
 * @example
 * ```tsx
 * <OptionGroup label="Message Options" description="Configure the CCIP message">
 *   <StringInput ... />
 *   <StringInput ... />
 * </OptionGroup>
 * ```
 */
export function OptionGroup({ label, description, children, className }: OptionGroupProps) {
  return (
    <fieldset className={`${styles.optionGroup} ${className ?? ''}`}>
      <legend className={styles.groupLegend}>{label}</legend>
      {description && <p className={styles.groupDescription}>{description}</p>}
      <div className={styles.groupContent}>{children}</div>
    </fieldset>
  )
}

/**
 * Group labels for organizing options
 */
export const GROUP_LABELS: Record<string, { label: string; description?: string }> = {
  arguments: {
    label: 'Required Arguments',
    description: 'These values are required to build the command',
  },
  message: {
    label: 'Message Options',
    description: 'Configure the CCIP message payload',
  },
  gas: {
    label: 'Gas & Execution',
    description: 'Control gas limits and execution behavior',
  },
  solana: {
    label: 'Solana Options',
    description: 'Options specific to Solana chains',
  },
  wallet: {
    label: 'Wallet & Transaction',
    description: 'Configure wallet and transaction settings',
  },
  output: {
    label: 'Output Options',
    description: 'Control command output format',
  },
  rpc: {
    label: 'RPC Configuration',
    description: 'Configure blockchain RPC connections',
  },
  query: {
    label: 'Query Options',
    description: 'Parameters for querying on-chain data',
  },
}
