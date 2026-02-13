import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import React from 'react'

type PackageType = 'sdk' | 'cli'

interface PackageVersionProps {
  package: PackageType
}

/**
 * Displays the version of a package from customFields in docusaurus.config.ts
 * Versions are read from the respective package.json files at build time.
 */
export function PackageVersion({ package: pkg }: PackageVersionProps): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext()
  const { customFields } = siteConfig

  const version =
    pkg === 'sdk' ? (customFields?.sdkVersion as string) : (customFields?.cliVersion as string)

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- customFields may not have version
  return <span>{version ?? 'unknown'}</span>
}

export default PackageVersion
