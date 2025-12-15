import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import React from 'react'

import styles from './Hero.module.css'

/** Hero section for the API reference homepage */
export function Hero(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext()

  return (
    <header className={styles.hero}>
      <div className={styles.container}>
        <h1 className={styles.title}>{siteConfig.title}</h1>
        <p className={styles.subtitle}>{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          {/* <Link className={styles.buttonPrimary} to="/api/">
            API Reference
          </Link>
          <Link className={styles.buttonPrimary} to="/sdk/">
            SDK Reference
          </Link>
          <Link className={styles.buttonPrimary} to="/cli/">
            CLI Reference
          </Link>
          <Link
            className={styles.buttonSecondary}
            to="https://github.com/smartcontractkit/ccip-tools-ts"
          >
            GitHub
          </Link> */}
        </div>
      </div>
    </header>
  )
}
