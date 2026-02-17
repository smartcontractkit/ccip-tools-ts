import Link from '@docusaurus/Link'
import React from 'react'

import styles from './ExamplesShowcase.module.css'
import {
  type DifficultyLevel,
  type ExampleRepo,
  exampleRepos,
} from '../../../config/examples.config.ts'

/** GitHub icon */
function GitHubIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={styles.githubIcon}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

/** Map difficulty to CSS class */
const difficultyClassMap: Record<DifficultyLevel, string> = {
  beginner: styles.difficultyBeginner,
  intermediate: styles.difficultyIntermediate,
  advanced: styles.difficultyAdvanced,
}

/** Capitalize first letter */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/** Example card component */
function ExampleCard({ repo }: { repo: ExampleRepo }): React.JSX.Element {
  const isComingSoon = repo.status === 'coming-soon'

  return (
    <Link
      to={repo.repoUrl}
      className={`${styles.card} ${isComingSoon ? styles.cardComingSoon : ''}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{repo.title}</h3>
        <span
          className={`${styles.maintainerBadge} ${
            repo.maintainer === 'chainlink'
              ? styles.maintainerChainlink
              : styles.maintainerCommunity
          }`}
        >
          {repo.maintainer === 'chainlink' ? 'Official' : 'Community'}
        </span>
      </div>

      <p className={styles.cardDescription}>{repo.description}</p>

      <div className={styles.badges}>
        {repo.difficulty.map((level) => (
          <span key={level} className={`${styles.difficultyBadge} ${difficultyClassMap[level]}`}>
            {capitalize(level)}
          </span>
        ))}
        {repo.tags.map((tag) => (
          <span key={tag} className={styles.techBadge}>
            {tag}
          </span>
        ))}
      </div>

      <div className={styles.cardFooter}>
        <GitHubIcon />
        <span>View on GitHub</span>
      </div>
    </Link>
  )
}

/** Props for ExamplesShowcase */
interface ExamplesShowcaseProps {
  /** Filter by maintainer */
  maintainer?: 'chainlink' | 'community'
  /** Maximum items to show */
  maxItems?: number
}

/** Examples showcase section for the homepage */
export function ExamplesShowcase({
  maintainer,
  maxItems,
}: ExamplesShowcaseProps = {}): React.JSX.Element {
  let repos = exampleRepos.filter((repo) => repo.status !== 'archived')

  if (maintainer) {
    repos = repos.filter((repo) => repo.maintainer === maintainer)
  }

  if (maxItems) {
    repos = repos.slice(0, maxItems)
  }

  return (
    <section className={styles.examplesShowcase}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h2 className={styles.title}>Examples</h2>
          <p className={styles.subtitle}>
            Explore working code examples to accelerate your CCIP integration
          </p>
        </div>

        <div className={styles.grid}>
          {repos.map((repo) => (
            <ExampleCard key={repo.id} repo={repo} />
          ))}
        </div>
      </div>
    </section>
  )
}
