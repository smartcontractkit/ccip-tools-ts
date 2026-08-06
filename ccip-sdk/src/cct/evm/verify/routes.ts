/**
 * Chain to block-explorer routing for contract verification.
 *
 * Deliberately a small hand-written table rather than generated data: the SDK has no
 * block-explorer host data anywhere (`NetworkInfo` carries no explorer field, `selectors.ts` has
 * none, and `explorer.ts` is the CCIP *message* explorer), and generating one from a third-party
 * chain-list endpoint would rot silently. An unlisted chain is never a hard blocker — the caller
 * passes `opts.route`.
 *
 * @packageDocumentation
 */

import { CCTParamsInvalidError } from '../../errors.ts'

/** Which explorer family serves a verification, and therefore which wire protocol is used. */
export type VerifierName = 'etherscan-v2' | 'sourcify'

/** Where to submit a verification, and where the resulting human-facing page lives. */
export interface ExplorerRoute {
  /** The explorer family — selects the submit/poll protocol. */
  verifier: VerifierName
  /** API base URL. */
  apiUrl: string
  /** Explorer base URL, used to build the `explorerUrl` returned on success. */
  explorerBase: string
}

/** The Etherscan v2 single endpoint; the target chain is selected by a `chainid` query param. */
export const ETHERSCAN_V2_API_URL = 'https://api.etherscan.io/v2/api'

/** Sourcify v2 server base — keyless, multi-chain. */
export const SOURCIFY_API_URL = 'https://sourcify.dev/server'

/** The keyless Sourcify route, shared by the `route: 'sourcify'` shorthand and unlisted chains. */
const SOURCIFY_ROUTE: ExplorerRoute = {
  verifier: 'sourcify',
  apiUrl: SOURCIFY_API_URL,
  // Sourcify needs no per-chain host: the human page is derived from chainId + address.
  explorerBase: SOURCIFY_API_URL,
}

/**
 * First-release routing table. Every row is served by the Etherscan v2 single endpoint, so the
 * only per-chain datum is the explorer host used to build `explorerUrl`. Chain ids are checked
 * against `selectors.ts` by a test.
 */
const ROUTES: Record<number, string> = {
  1: 'https://etherscan.io',
  11155111: 'https://sepolia.etherscan.io',
  10: 'https://optimistic.etherscan.io',
  11155420: 'https://sepolia-optimism.etherscan.io',
  56: 'https://bscscan.com',
  97: 'https://testnet.bscscan.com',
  137: 'https://polygonscan.com',
  80002: 'https://amoy.polygonscan.com',
  8453: 'https://basescan.org',
  84532: 'https://sepolia.basescan.org',
  42161: 'https://arbiscan.io',
  421614: 'https://sepolia.arbiscan.io',
  43114: 'https://snowtrace.io',
  43113: 'https://testnet.snowtrace.io',
}

/**
 * Resolves where to verify. An explicit `route` always wins — `'sourcify'` is shorthand for the
 * keyless Sourcify route, and an object is the escape hatch for chains not in the table.
 *
 * There is deliberately **no** implicit fallback: routing an unlisted chain to Sourcify because
 * no key was supplied would return `verified` while the explorer the caller actually looks at
 * still shows unverified source.
 *
 * @throws {@link CCTParamsInvalidError} if the chain is unlisted and no `route` was given.
 */
export function resolveRoute(chainId: number, route?: 'sourcify' | ExplorerRoute): ExplorerRoute {
  if (route === 'sourcify') return SOURCIFY_ROUTE
  if (route) return route

  const explorerBase = ROUTES[chainId]
  if (!explorerBase)
    throw new CCTParamsInvalidError(
      'verifyDeployedContract',
      'chainId',
      `no explorer route for chain ${chainId}; pass opts.route (an { verifier, apiUrl, explorerBase } object, or 'sourcify' for the keyless verifier)`,
    )

  return { verifier: 'etherscan-v2', apiUrl: ETHERSCAN_V2_API_URL, explorerBase }
}

/** The human-facing verified-contract page for a route. */
export function explorerUrlFor(route: ExplorerRoute, chainId: number, address: string): string {
  return route.verifier === 'sourcify'
    ? `${route.explorerBase}/repo-ui/${chainId}/${address}`
    : `${route.explorerBase}/address/${address}#code`
}
