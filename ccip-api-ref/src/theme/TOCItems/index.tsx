/**
 * TOCItems Theme Wrapper
 *
 * Wraps the default Docusaurus TOCItems component to add the CopyPageButton
 * above the table of contents.
 */

import type { WrapperProps } from '@docusaurus/types'
import type TOCItemsType from '@theme/TOCItems'
import TOCItems from '@theme-original/TOCItems'
import React from 'react'

import { CopyPageButton } from '../../components/copy-page/index.ts'

type Props = WrapperProps<typeof TOCItemsType>

export default function TOCItemsWrapper(props: Props): React.JSX.Element {
  return (
    <>
      <CopyPageButton />
      <TOCItems {...props} />
    </>
  )
}
