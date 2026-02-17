import React from 'react'

import styles from './ChainSupport.module.css'
import { type ChainType, type Size, SUPPORTED_CHAIN_FAMILIES } from '../../../types/index.ts'
import { cn } from '../../../utils/index.ts'
import { ChainBadge } from '../ChainBadge/index.ts'

export interface ChainSupportProps {
  /** List of supported chains to display (defaults to SUPPORTED_CHAIN_FAMILIES) */
  chains?: ChainType[]
  /** Size of the chain badges */
  size?: Size
  /** Show chain labels (default: true) */
  showLabels?: boolean
  /** Additional CSS class */
  className?: string
}

/**
 * ChainSupport displays multiple chain badges in a row
 * Used at the top of command pages to show chain compatibility
 */
export function ChainSupport({
  chains = SUPPORTED_CHAIN_FAMILIES as ChainType[],
  size = 'sm',
  showLabels = true,
  className,
}: ChainSupportProps): React.JSX.Element {
  return (
    <div className={cn(styles.chainSupport, className)}>
      <span className={styles.label}>Supported chain families:</span>
      <div className={styles.badges}>
        {chains.map((chain) => (
          <ChainBadge key={chain} chain={chain} size={size} showLabel={showLabels} />
        ))}
      </div>
    </div>
  )
}
