import useBaseUrl from '@docusaurus/useBaseUrl'
import React from 'react'

import styles from './ChainBadge.module.css'
import { type ChainType, type Size, CHAIN_CONFIGS } from '../../../types/index.ts'
import { cn } from '../../../utils/index.ts'
import { Badge } from '../../primitives/Badge/index.ts'

export interface ChainBadgeProps {
  chain: ChainType
  size?: Size
  showLabel?: boolean
  className?: string
}

/**
 * ChainBadge displays a blockchain identifier with its icon
 * Uses copied SVG icons from main Chainlink documentation
 */
export function ChainBadge({
  chain,
  size = 'md',
  showLabel = true,
  className,
}: ChainBadgeProps): React.JSX.Element {
  const config = CHAIN_CONFIGS[chain]
  const iconUrl = useBaseUrl(config.icon)

  const icon = <img src={iconUrl} alt={`${config.label} icon`} className={styles.chainIcon} />

  return (
    <Badge variant="default" size={size} icon={icon} className={cn(styles.chainBadge, className)}>
      {showLabel && config.label}
    </Badge>
  )
}
