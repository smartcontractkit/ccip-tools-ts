import useBaseUrl from '@docusaurus/useBaseUrl'
import React from 'react'

import styles from './Callout.module.css'
import { cn } from '../../../utils/index.ts'

export type CalloutType = 'info' | 'note' | 'tip' | 'warning' | 'danger'

export interface CalloutProps {
  /** Type of callout - determines color and icon */
  type?: CalloutType
  /** Optional title displayed above content */
  title?: string
  /** Content to display in the callout */
  children: React.ReactNode
  /** Additional CSS class */
  className?: string
}

/**
 * Callout configuration - icons from Chainlink main docs
 */
const CALLOUT_CONFIG: Record<CalloutType, { icon: string; defaultTitle: string }> = {
  info: { icon: '/assets/alert/info-icon.svg', defaultTitle: 'Info' },
  note: { icon: '/assets/alert/info-icon.svg', defaultTitle: 'Note' },
  tip: { icon: '/assets/alert/info-icon.svg', defaultTitle: 'Tip' },
  warning: { icon: '/assets/alert/alert-icon.svg', defaultTitle: 'Warning' },
  danger: { icon: '/assets/alert/danger-icon.svg', defaultTitle: 'Danger' },
}

/**
 * Callout component for highlighting important information
 * Styled to match Chainlink documentation design system
 *
 * @example
 * ```tsx
 * <Callout type="warning" title="Gas Limit">
 *   Setting `--gas-limit 0` uses the ramp default (~200k).
 * </Callout>
 * ```
 */
export function Callout({
  type = 'info',
  title,
  children,
  className,
}: CalloutProps): React.JSX.Element {
  const config = CALLOUT_CONFIG[type]
  const displayTitle = title || config.defaultTitle
  const iconUrl = useBaseUrl(config.icon)

  return (
    <div className={cn(styles.callout, styles[type], className)} role="alert">
      <div className={styles.header}>
        <img src={iconUrl} alt="" className={styles.icon} aria-hidden="true" />
        <span className={styles.title}>{displayTitle}</span>
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  )
}
