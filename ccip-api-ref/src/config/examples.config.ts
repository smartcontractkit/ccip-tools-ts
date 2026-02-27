/**
 * Configuration for example repositories displayed on the documentation site.
 *
 * To add a new example:
 * 1. Add an entry to the `exampleRepos` array
 * 2. The component will automatically render it
 *
 * This approach scales to multiple repos (official + community) with zero maintenance.
 */

/** Difficulty levels for examples */
export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced'

/** Who maintains the example */
export type Maintainer = 'chainlink' | 'community'

/** Example status */
export type ExampleStatus = 'active' | 'coming-soon' | 'archived'

/** Example repository configuration */
export interface ExampleRepo {
  /** Unique identifier */
  id: string
  /** Display title */
  title: string
  /** Short description (one line) */
  description: string
  /** GitHub repository URL */
  repoUrl: string
  /** Difficulty level(s) */
  difficulty: DifficultyLevel[]
  /** Technology tags */
  tags: string[]
  /** Who maintains this example */
  maintainer: Maintainer
  /** Current status */
  status: ExampleStatus
}

/** All example repositories */
export const exampleRepos: ExampleRepo[] = [
  {
    id: 'ccip-sdk-examples',
    title: 'SDK Starter Projects',
    description: 'Official examples: Node.js scripts, React bridge, cross-chain dApp',
    repoUrl: 'https://github.com/smartcontractkit/ccip-sdk-examples',
    difficulty: ['beginner', 'intermediate'],
    tags: ['Node.js', 'React', 'TypeScript'],
    maintainer: 'chainlink',
    status: 'active',
  },
]
