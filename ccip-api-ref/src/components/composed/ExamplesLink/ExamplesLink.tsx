import Link from '@docusaurus/Link'
import React from 'react'

import { exampleRepos } from '../../../config/examples.config.ts'

/**
 * Renders a link to the first active example repo from the shared config.
 * Single source of truth: examples.config.ts drives homepage, sidebar, and info-grid.
 */
export function ExamplesLink(): React.JSX.Element {
  const repo = exampleRepos.find((r) => r.status === 'active')
  if (!repo) {
    return <span>—</span>
  }
  return (
    <Link to={repo.repoUrl} target="_blank" rel="noopener noreferrer">
      {repo.title}
    </Link>
  )
}
