import React, { type ReactNode } from 'react'

import styles from './Badge.module.css'
import type { BadgeVariant, Size } from '../../../types/index.ts'
import { cn } from '../../../utils/index.ts'

export interface BadgeProps {
  variant?: BadgeVariant
  size?: Size
  icon?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * Badge primitive component for displaying labels, tags, and status indicators
 */
export function Badge({
  variant = 'default',
  size = 'md',
  icon,
  className,
  children,
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(styles.badge, styles[`badge--${variant}`], styles[`badge--${size}`], className)}
    >
      {icon && <span className={styles.icon}>{icon}</span>}
      {children}
    </span>
  )
}
