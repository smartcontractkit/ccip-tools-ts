/**
 * ApiItem Theme Wrapper
 *
 * Wraps the default OpenAPI ApiItem component to add the CopyPageButton
 * for consistency with CLI documentation pages.
 */

import type { WrapperProps } from '@docusaurus/types'
import ApiItem from '@theme-original/ApiItem'
import type ApiItemType from '@theme/ApiItem'
import React from 'react'

import { CopyPageErrorBoundary } from '../../components/copy-page/index.ts'
import { ApiCopyButton } from './ApiCopyButton.tsx'

type Props = WrapperProps<typeof ApiItemType>

export default function ApiItemWrapper(props: Props): React.JSX.Element {
  return (
    <>
      <CopyPageErrorBoundary>
        <ApiCopyButton />
      </CopyPageErrorBoundary>
      <ApiItem {...props} />
    </>
  )
}
