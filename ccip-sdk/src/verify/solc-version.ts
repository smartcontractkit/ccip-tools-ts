/*
 * Resolve a short solc version ("0.8.26") to the long, commit-qualified form that
 * Etherscan requires: "v0.8.26+commit.8a97fa7a".
 *
 * WHY this matters:
 *  - Etherscan keys its compiler dropdown on the EXACT build, including the commit hash.
 *  - Foundry does this by looking the commit up in the official solc release list when the
 *    locally-known version has no build metadata (foundry-src crates/verify/src/etherscan/mod.rs
 *    ensure_solc_build_metadata / lookup_compiler_version).
 *  - Hardhat sidesteps the lookup because solc already recorded solcLongVersion in its
 *    build-info; but a standalone SDK has no build-info, so we resolve it like foundry does.
 *
 * The list lives at https://binaries.soliditylang.org/bin/list.json — a map of
 * releases (short to filename "soljson-v0.8.26+commit.8a97fa7a.js") plus a builds array
 * with explicit longVersion. We use releases (smallest, authoritative).
 */

import { CCIPContractVerificationError } from '../errors/index.ts'

const SOLC_LIST_URL = 'https://binaries.soliditylang.org/bin/list.json'

/*
 * Tiny offline fallback so the SDK resolves the bundled contracts' compiler version without a
 * network round-trip to the solc CDN. In the real SDK you'd cache list.json (it changes rarely)
 * or ship a pinned map for the compiler versions CCIP token contracts are built with.
 */
const PINNED_LONG_VERSIONS: Record<string, string> = {
  '0.8.26': 'v0.8.26+commit.8a97fa7a',
  '0.8.24': 'v0.8.24+commit.e11b9ed9',
  '0.8.19': 'v0.8.19+commit.7dd6d404',
}

/** Resolve a short solc version to the long commit-qualified form Etherscan requires. */
export async function resolveLongCompilerVersion(
  shortVersion: string,
  opts: { fetchImpl?: typeof fetch; allowNetwork?: boolean } = {},
): Promise<string> {
  // Already long? (contains a build hash) -> just ensure the leading "v".
  if (shortVersion.includes('+commit.')) {
    return shortVersion.startsWith('v') ? shortVersion : `v${shortVersion}`
  }

  const bare = shortVersion.replace(/^v/, '')

  const pinned = PINNED_LONG_VERSIONS[bare]
  if (pinned) return pinned

  if (opts.allowNetwork === false) {
    throw new CCIPContractVerificationError(
      `Unknown solc version "${bare}" and network lookup disabled. Add it to PINNED_LONG_VERSIONS or enable network.`,
    )
  }

  const fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const res = await fetchImpl(SOLC_LIST_URL)
  if (!res.ok)
    throw new CCIPContractVerificationError(
      `Failed to fetch solc list.json: ${res.status} ${res.statusText}`,
    )
  const list = (await res.json()) as { releases?: Record<string, string> }

  const filename = list.releases?.[bare]
  if (!filename)
    throw new CCIPContractVerificationError(`solc version "${bare}" not found in releases list`)

  // filename looks like "soljson-v0.8.26+commit.8a97fa7a.js"
  const match = /^soljson-(v\d+\.\d+\.\d+\+commit\.[0-9a-f]+)\.js$/.exec(filename)
  const longVersion = match?.[1]
  if (!longVersion)
    throw new CCIPContractVerificationError(`Unexpected solc release filename: ${filename}`)
  return longVersion
}
