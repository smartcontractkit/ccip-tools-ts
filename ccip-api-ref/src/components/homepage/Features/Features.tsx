import Link from '@docusaurus/Link'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import React from 'react'

import styles from './Features.module.css'

interface FeatureCardProps {
  title: string
  description: string
  link: string
  linkText: string
  icon: React.ReactNode
  version?: string
}

/** Icon components for feature cards */
const SdkIcon = (): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={styles.cardIcon}
  >
    <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
  </svg>
)

const CliIcon = (): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={styles.cardIcon}
  >
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M6 9l3 3-3 3M12 15h6" />
  </svg>
)

const ApiIcon = (): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={styles.cardIcon}
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
)

function FeatureCard({
  title,
  description,
  link,
  linkText,
  icon,
  version,
}: FeatureCardProps): React.JSX.Element {
  return (
    <div className={styles.card}>
      <Link className={styles.cardLink} to={link}>
        <div className={styles.cardIconWrapper}>{icon}</div>
        <h3 className={styles.cardTitle}>
          {title}
          {version && <span className={styles.versionBadge}>{version}</span>}
        </h3>
        <p className={styles.cardDescription}>{description}</p>
        {linkText} →
      </Link>
    </div>
  )
}

/** Features section showcasing SDK, CLI, and API capabilities */
export function Features(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext()
  const { customFields } = siteConfig
  const sdkVersion = customFields?.sdkVersion as string | undefined
  const cliVersion = customFields?.cliVersion as string | undefined

  return (
    <section className={styles.features}>
      <div className={styles.container}>
        <div className={styles.grid}>
          <FeatureCard
            icon={<ApiIcon />}
            title="API Reference"
            description="REST API documentation for the CCIP API service with endpoint details, request/response schemas, and usage examples."
            link="/api/"
            linkText="Explore API"
            version="v2"
          />
          <FeatureCard
            icon={<SdkIcon />}
            title="SDK Reference"
            description="Full TypeScript SDK documentation with type definitions, examples, and multi-chain support for EVM, Solana, Aptos, and Sui."
            link="/sdk/"
            linkText="Explore SDK"
            version={sdkVersion ? `v${sdkVersion}` : undefined}
          />
          <FeatureCard
            icon={<CliIcon />}
            title="CLI Reference"
            description="Command-line interface documentation for CCIP operations including tracking requests, querying lanes, and manual execution."
            link="/cli/"
            linkText="Explore CLI"
            version={cliVersion ? `v${cliVersion}` : undefined}
          />
        </div>
      </div>
    </section>
  )
}
