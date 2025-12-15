/**
 * ApiCopyButton
 *
 * Wrapper component that positions the CopyPageButton appropriately
 * for API documentation pages (which have a two-column layout).
 * Uses React Portal to render outside the OpenAPI container,
 * ensuring position:fixed works correctly.
 *
 * NOTE: Only renders on pages that don't have a TOC (table of contents).
 * Pages with TOC already get CopyPageButton via TOCItems wrapper.
 */

import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import styles from './ApiCopyButton.module.css'
import { CopyPageButton } from '../../components/copy-page/index.ts'

export function ApiCopyButton(): React.JSX.Element | null {
  const [mounted, setMounted] = useState(false)
  const [hasTOC, setHasTOC] = useState(false)

  useEffect(() => {
    setMounted(true)

    // Check if this page has a table of contents
    // If it does, TOCItems wrapper already adds CopyPageButton
    const tocElement = document.querySelector('.table-of-contents')
    const tocContainer = document.querySelector('.theme-doc-toc-desktop')
    setHasTOC(!!(tocElement || tocContainer))
  }, [])

  // Don't render during SSR - portal needs document.body
  if (!mounted) {
    return null
  }

  // Don't render if page already has TOC (CopyPageButton added via TOCItems)
  if (hasTOC) {
    return null
  }

  return createPortal(
    <div className={styles.apiCopyButtonContainer}>
      <CopyPageButton className={styles.apiCopyButton} />
    </div>,
    document.body,
  )
}
