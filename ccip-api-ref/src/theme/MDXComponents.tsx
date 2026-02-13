import MDXComponents from '@theme-original/MDXComponents'

import { CLIBuilder } from '../components/cli-builder/index.ts'
import { Badge, Callout, ChainBadge, ChainSupport, DeprecationBanner } from '../components/index.ts'
import { ChainType } from '../types/index.ts'

/**
 * Custom MDX components for CCIP API Reference
 *
 * These components are available globally in all MDX files without explicit imports.
 */
export default {
  // Spread default Docusaurus MDX components
  ...MDXComponents,

  // Custom components - available globally in MDX
  Badge,
  ChainBadge,
  ChainSupport,
  Callout,
  CLIBuilder,
  DeprecationBanner,

  // Export ChainType for use in MDX
  ChainType,
}
