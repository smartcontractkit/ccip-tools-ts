import CodeBlock from '@theme/CodeBlock'
import React from 'react'

import styles from './QuickStart.module.css'

/** QuickStart section showing installation commands */
export function QuickStart(): React.JSX.Element {
  return (
    <section className={styles.quickStart}>
      <div className={styles.container}>
        <h2 className={styles.title}>Quick Start</h2>
        <p className={styles.description}>
          Get started with CCIP Tools in seconds. Install the SDK for programmatic access or the CLI
          for command-line operations.
        </p>
        <div className={styles.installCards}>
          <div className={styles.installCard}>
            <div className={styles.cardHeader}>
              <span className={styles.cardLabel}>SDK</span>
            </div>
            <CodeBlock language="bash">npm install @chainlink/ccip-sdk</CodeBlock>
          </div>
          <div className={styles.installCard}>
            <div className={styles.cardHeader}>
              <span className={styles.cardLabel}>CLI</span>
            </div>
            <CodeBlock language="bash">npm install -g @chainlink/ccip-cli</CodeBlock>
          </div>
        </div>
      </div>
    </section>
  )
}
