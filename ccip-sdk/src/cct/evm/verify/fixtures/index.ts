/**
 * Lazy loader for the generated verification fixtures — the only place the ~335 KB source pool
 * is reached, and the only dynamic `import()` boundary in the subpath.
 *
 * Both specifiers are **string literals**. With a template literal, tsc injects
 * `__rewriteRelativeImportExtension` (this repo sets `rewriteRelativeImportExtensions`) and
 * bundlers enumerate the whole directory — measured: esbuild rewrites the call to a `__glob`
 * over every fixture module. It still works in Node, so the regression would be invisible until
 * a browser consumer bundled it. An eslint selector bans template-literal `import()` accordingly.
 *
 * @packageDocumentation
 */

import type { FixtureEntry, StandardJsonInput } from './types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { DeployableContract } from '../../deployable.ts'

/** One contract's complete, ready-to-submit verification input. */
export interface VerificationArtifact {
  /** The Standard-JSON input, reassembled from the deduplicated pool. */
  input: StandardJsonInput
  /** Fully-qualified Solidity name, `path/File.sol:Name`. */
  fqn: string
  /** Commit-qualified solc version, e.g. `v0.8.26+commit.8a97fa7a`. */
  compilerVersion: string
}

/**
 * Loads and rebuilds the Standard-JSON input for `contract`.
 *
 * @throws {@link CCTParamsInvalidError} if the manifest has no entry for `contract`, or if it
 * references a source unit missing from the pool (a corrupted or hand-edited fixture).
 */
export async function loadStandardJson(
  contract: DeployableContract,
): Promise<VerificationArtifact> {
  const [{ default: manifest }, { default: pool }] = await Promise.all([
    import('./V2_0_0/manifest.ts'),
    import('./V2_0_0/sources.ts'),
  ])

  const entry = manifest.contracts[contract] as FixtureEntry | undefined
  if (!entry)
    throw new CCTParamsInvalidError(
      'verifyDeployedContract',
      'contract',
      `no verification fixture for "${contract}"`,
    )

  // Explicit loop, not `Object.fromEntries`: under `noUncheckedIndexedAccess` the latter compiles
  // clean and silently infers `content: string | undefined`, which would submit a malformed
  // std-json instead of failing here.
  const sources: Record<string, { content: string }> = {}
  for (const unit of entry.sources) {
    const content = pool[unit]
    if (content === undefined)
      throw new CCTParamsInvalidError(
        'verifyDeployedContract',
        'contract',
        `fixture pool is missing source unit "${unit}" for ${contract}`,
      )
    sources[unit] = { content }
  }

  return {
    fqn: entry.fqn,
    compilerVersion: manifest.compilerVersion,
    input: {
      language: 'Solidity',
      sources,
      settings: {
        optimizer: { enabled: true, runs: entry.optimizerRuns },
        viaIR: manifest.viaIR,
        evmVersion: manifest.evmVersion,
        metadata: { bytecodeHash: manifest.bytecodeHash },
        remappings: entry.remappings,
        outputSelection: manifest.outputSelection,
      },
    },
  }
}
