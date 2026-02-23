import type { WrapperProps } from '@docusaurus/types'
import type CodeBlockType from '@theme/CodeBlock'
import CodeBlock from '@theme-original/CodeBlock'
import React from 'react'

import styles from './CodeBlock.module.css'

type Props = WrapperProps<typeof CodeBlockType>

/** Language display names for common languages */
const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  ts: 'TypeScript',
  javascript: 'JavaScript',
  js: 'JavaScript',
  tsx: 'TSX',
  jsx: 'JSX',
  bash: 'Bash',
  shell: 'Shell',
  sh: 'Shell',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  markdown: 'Markdown',
  md: 'Markdown',
  python: 'Python',
  py: 'Python',
  rust: 'Rust',
  rs: 'Rust',
  go: 'Go',
  solidity: 'Solidity',
  sol: 'Solidity',
}

/** Extract language from className (e.g., "language-bash" becomes "bash") */
function extractLanguage(className?: string): string {
  if (!className) return ''
  const match = className.match(/language-(\w+)/)
  return match ? match[1] : ''
}

/** Enhanced CodeBlock wrapper with language badge */
export default function CodeBlockWrapper(props: Props): React.JSX.Element {
  // Language can come from props.language or from className (may be undefined at runtime from markdown)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- props.language may be undefined at runtime from markdown
  const language = props.language ?? extractLanguage(props.className as string) ?? ''
  const languageLabel = LANGUAGE_LABELS[language.toLowerCase()] ?? language.toUpperCase()
  const showBadge = language && language !== 'text' && language !== ''

  return (
    <div className={styles.codeBlockContainer}>
      {showBadge && <span className={styles.languageBadge}>{languageLabel}</span>}
      <CodeBlock {...props} />
    </div>
  )
}
