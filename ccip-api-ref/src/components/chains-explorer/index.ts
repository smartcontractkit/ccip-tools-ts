/**
 * Chains Explorer
 *
 * Interactive chain explorer with search, filters, and copy functionality.
 *
 * @example
 * ```tsx
 * import { ChainsExplorer } from '../chains-explorer';
 *
 * // In a page:
 * <ChainsExplorer />
 * ```
 */

export { ChainsExplorer, default } from './ChainsExplorer.tsx'
export type { ChainFilters, ChainInfo, ChainsExplorerProps, Environment } from './types.ts'
export { useChains, useFilters, useSearch } from './hooks/index.ts'
