/**
 * Canton Explicit Disclosures — public exports
 *
 * Provides two `DisclosureProvider` implementations:
 *   - `AcsDisclosureProvider`  direct Canton Ledger API ACS queries (package-ID agnostic)
 *   - `EdsDisclosureProvider`  Explicit Disclosure Service REST API (placeholder)
 *
 * Import the provider that matches your deployment:
 * ```ts
 * import { AcsDisclosureProvider } from '@chainlink/ccip-sdk/canton/explicit-disclosures'
 * ```
 */

export { AcsDisclosureProvider } from './acs.ts'
export { EdsDisclosureProvider } from './eds.ts'
export type {
  AcsDisclosureConfig,
  CCIPContractInstanceAddresses,
  DisclosedContract,
  DisclosureProvider,
  EdsDisclosureConfig,
  ExecutionDisclosures,
  SendDisclosures,
} from './types.ts'
export { executionDisclosuresToArray, sendDisclosuresToArray } from './types.ts'
