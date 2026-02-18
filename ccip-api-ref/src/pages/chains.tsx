/**
 * Chains Explorer Page
 *
 * Interactive explorer for CCIP-supported blockchains.
 * Allows searching, filtering, and copying chain selectors.
 */

import Layout from '@theme/Layout'
import React from 'react'

import styles from './chains.module.css'
import { ChainsExplorer } from '../components/chains-explorer/index.ts'

export default function ChainsPage(): React.JSX.Element {
  return (
    <Layout
      title="Supported Chains"
      description="Explore all blockchains supported by CCIP. Search by name, filter by family and network, and copy chain selectors."
    >
      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1 className={styles.title}>Supported Chains</h1>
            <p className={styles.subtitle}>
              Explore all blockchains supported by Chainlink CCIP. Search by name, chain ID, or
              selector. Filter by chain family and network type.
            </p>
          </header>

          <ChainsExplorer />
        </div>
      </main>
    </Layout>
  )
}
