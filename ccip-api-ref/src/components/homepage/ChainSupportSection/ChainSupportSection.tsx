import React from 'react'

import styles from './ChainSupportSection.module.css'
import { SUPPORTED_CHAIN_FAMILIES } from '../../../types/index.ts'
import { ChainBadge } from '../../composed/ChainBadge/index.ts'

/** Chain support section showing all supported blockchains */
export function ChainSupportSection(): React.JSX.Element {
  return (
    <section className={styles.chainSupport}>
      <div className={styles.container}>
        <h2 className={styles.title}>Multi-Chain Support</h2>
        <p className={styles.description}>
          CCIP Tools provides unified APIs across multiple blockchain ecosystems, enabling seamless
          cross-chain development.
        </p>
        <div className={styles.chains}>
          {SUPPORTED_CHAIN_FAMILIES.map((chain) => (
            <ChainBadge key={chain} chain={chain} size="lg" showLabel />
          ))}
        </div>
      </div>
    </section>
  )
}
