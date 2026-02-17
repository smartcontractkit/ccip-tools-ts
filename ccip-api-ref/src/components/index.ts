/**
 * CCIP API Reference - Component Library
 *
 * Architecture:
 * - primitives/  : Atomic UI elements (Badge, etc.)
 * - composed/    : Components built from primitives (ChainBadge, etc.)
 * - homepage/    : Homepage-specific sections
 */

// Primitives
export { Badge } from './primitives/index.ts'
export type { BadgeProps } from './primitives/index.ts'

// Composed components
export {
  Callout,
  ChainBadge,
  ChainSupport,
  DeprecationBanner,
  PackageVersion,
  RpcProviders,
} from './composed/index.ts'
export type {
  CalloutProps,
  CalloutType,
  ChainBadgeProps,
  ChainSupportProps,
  DeprecationBannerProps,
  RpcProvidersProps,
} from './composed/index.ts'
