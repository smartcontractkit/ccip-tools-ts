import Link from '@docusaurus/Link'
import React from 'react'

import styles from './DeprecationBanner.module.css'

export interface DeprecationBannerProps {
  /** The version being deprecated */
  version?: string
  /** The new version to migrate to */
  newVersion?: string
  /** Link to migration guide or new docs */
  migrationLink?: string
  /** Custom message */
  message?: string
}

/**
 * Deprecation banner for deprecated API versions
 * Displays a prominent warning to migrate to newer version
 */
export function DeprecationBanner({
  version = 'v1',
  newVersion = 'v2',
  migrationLink = '/api/',
  message,
}: DeprecationBannerProps): React.JSX.Element {
  const defaultMessage = `API ${version} is deprecated and will be removed in a future release. Please migrate to ${newVersion}.`

  return (
    <div className={styles.banner} role="alert">
      <div className={styles.content}>
        <span className={styles.icon}>&#9888;</span>
        <span className={styles.message}>{message || defaultMessage}</span>
        <Link to={migrationLink} className={styles.link}>
          View {newVersion} Documentation &rarr;
        </Link>
      </div>
    </div>
  )
}
