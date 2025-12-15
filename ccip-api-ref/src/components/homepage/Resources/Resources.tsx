import Link from '@docusaurus/Link'
import React from 'react'

import styles from './Resources.module.css'

interface ResourceLinkProps {
  title: string
  description: string
  href: string
  external?: boolean
}

function ResourceLink({
  title,
  description,
  href,
  external,
}: ResourceLinkProps): React.JSX.Element {
  const linkProps = external ? { target: '_blank', rel: 'noopener noreferrer' } : {}

  return (
    <Link className={styles.link} to={href} {...linkProps}>
      <span className={styles.linkTitle}>{title}</span>
      <span className={styles.linkDescription}>{description}</span>
    </Link>
  )
}

/** Resources section with helpful links */
export function Resources(): React.JSX.Element {
  return (
    <section className={styles.resources}>
      <div className={styles.container}>
        <h2 className={styles.title}>Resources</h2>
        <div className={styles.grid}>
          <ResourceLink
            title="GitHub Repository"
            description="View source code, report issues, and contribute"
            href="https://github.com/smartcontractkit/ccip-tools-ts"
            external
          />
          <ResourceLink
            title="Chainlink Documentation"
            description="Learn about CCIP and cross-chain messaging"
            href="https://docs.chain.link/ccip"
            external
          />
          <ResourceLink
            title="Discord Community"
            description="Get help and connect with other developers"
            href="https://discord.gg/chainlink"
            external
          />
          <ResourceLink
            title="Release Notes"
            description="Stay updated with the latest features and fixes"
            href="https://github.com/smartcontractkit/ccip-tools-ts/releases"
            external
          />
        </div>
      </div>
    </section>
  )
}
