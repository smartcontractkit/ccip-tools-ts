/**
 * Shapes of the generated verification fixtures, and of the Standard-JSON input built from them.
 *
 * Hand-written (the fixture modules themselves are generated) so the JSDoc the repo's lint rules
 * require lives in reviewed code rather than in generated output.
 *
 * @packageDocumentation
 */

/**
 * The canonical Solidity "Standard JSON Input" — what solc consumes and what both Etherscan and
 * Sourcify accept. Typed to exactly the shape the generator emits, not to everything solc
 * tolerates: these are the settings that produced the vendored creation bytecode, and changing
 * any of them changes the bytecode.
 */
export interface StandardJsonInput {
  /** Always `'Solidity'` for the contracts this SDK deploys. */
  language: 'Solidity'
  /** Source-unit name to content, exactly as solc resolved them at build time. */
  sources: Record<string, { content: string }>
  /** The compiler settings that produced the deployed bytecode. */
  settings: {
    /** Optimizer configuration; `runs` varies per contract (see {@link FixtureEntry}). */
    optimizer: { enabled: boolean; runs: number }
    /** Whether the IR pipeline was used — true for the CCIP release profile. */
    viaIR: boolean
    /** Target EVM version, e.g. `'paris'`. */
    evmVersion: string
    /** Metadata settings; `bytecodeHash: 'none'` for the CCIP release profile. */
    metadata: { bytecodeHash: string }
    /** Only the remapping prefixes this contract's closure actually used. */
    remappings: string[]
    /** Minimal output selection. Bytecode-neutral, but solc emits nothing without it. */
    outputSelection: Record<string, Record<string, string[]>>
  }
}

/** How to rebuild and identify one contract's verification input. */
export interface FixtureEntry {
  /** Fully-qualified Solidity name, `path/File.sol:Name`, as both explorers expect it. */
  fqn: string
  /** Optimizer runs for this contract — 50 000 for pools, 80 000 for the token. */
  optimizerRuns: number
  /** Remapping prefixes this closure used. */
  remappings: string[]
  /** Source-unit names making up this contract's import closure, all keys into the pool. */
  sources: string[]
  /** keccak256 of the vendored creation bytecode, tying this fixture to that exact artifact. */
  bytecodeKeccak: string
}

/** Module-level provenance and the settings shared by every contract in one fixture version. */
export interface FixtureManifest {
  /** The `@chainlink/contracts-ccip` version these fixtures were assembled from. */
  contractsCcipVersion: string
  /** Commit-qualified solc version, e.g. `v0.8.26+commit.8a97fa7a`. */
  compilerVersion: string
  /** Target EVM version shared by every contract. */
  evmVersion: string
  /** Whether the IR pipeline was used. */
  viaIR: boolean
  /** Metadata bytecode-hash mode. */
  bytecodeHash: string
  /** The shared minimal output selection. */
  outputSelection: Record<string, Record<string, string[]>>
  /** Per-contract entries, keyed by `DeployableContract`. */
  contracts: Record<string, FixtureEntry>
}
