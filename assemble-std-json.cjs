/**
 * Assembles the Solidity Standard-JSON verification inputs for the CCT deployable contracts,
 * from the pinned `@chainlink/contracts-ccip` devDependency.
 *
 * This is the single source of truth for `ccip-sdk/src/cct/evm/verify/fixtures/`. It is a
 * *library*: `std-json-fixtures.mjs` calls it to write the fixtures (`--write`), to diff them
 * against what is checked in (the drift guard), and to recompile them (`--compile`).
 *
 * Why not a `// generate:` block, like the vendored ABI/bytecode modules? `generate.cjs` finds a
 * block's end marker with a whole-line substring test — `['//','generate','end'].every(...)` — and
 * the ~335 KB emitted payload line inevitably contains all three (`//` from Solidity comments,
 * `generate` from "generated", `end` from tokens like `sender`). The payload becomes its own end
 * marker, the splice removes the wrong span, and `generate.cjs` exits 0 either way.
 *
 * CJS (not ESM) so `require()` resolution matches the vendored-artifact generators, and `.cjs` so
 * `tsc --noEmit` never sees it.
 */

const { existsSync, readFileSync } = require('node:fs')
const { dirname, join, posix } = require('node:path')

const PKG = dirname(require.resolve('@chainlink/contracts-ccip/package.json'))
const REPO = __dirname

/**
 * The contracts the SDK can deploy today, and therefore the exact set it must be able to verify.
 * Keys must stay in sync with `DeployableContract` in `ccip-sdk/src/cct/evm/deployable.ts` — the
 * generated manifest closes over that union with `satisfies`, so a mismatch is a compile error.
 */
const TARGETS = {
  CrossChainToken: { unit: 'contracts/tokens/CrossChainToken.sol', bin: 'cross_chain_token.bin' },
  ERC20LockBox: { unit: 'contracts/pools/ERC20LockBox.sol', bin: 'erc20_lock_box.bin' },
  BurnMintTokenPool: {
    unit: 'contracts/pools/BurnMintTokenPool.sol',
    bin: 'burn_mint_token_pool.bin',
  },
  BurnFromMintTokenPool: {
    unit: 'contracts/pools/BurnFromMintTokenPool.sol',
    bin: 'burn_from_mint_token_pool.bin',
  },
  BurnWithFromMintTokenPool: {
    unit: 'contracts/pools/BurnWithFromMintTokenPool.sol',
    bin: 'burn_with_from_mint_token_pool.bin',
  },
  LockReleaseTokenPool: {
    unit: 'contracts/pools/LockReleaseTokenPool.sol',
    bin: 'lock_release_token_pool.bin',
  },
}

/**
 * Per-contract optimizer-runs overrides, mirroring `@chainlink/contracts-ccip/scripts/compile_all`
 * (`OPTIMIZE_RUNS_TOKEN_POOL=50000`, `OPTIMIZE_RUNS_LARGE_POOL=17000`). Everything under
 * `contracts/pools/` builds at 50 000 except these, which build at 17 000. Anything outside
 * `contracts/pools/` uses the profile default. `ERC20LockBox` IS under `contracts/pools/`, so it
 * takes 50 000 — not the default.
 */
const LARGE_POOLS = new Set([
  'SiloedLockReleaseTokenPool',
  'SiloedUSDCTokenPool',
  'CrossChainPoolToken',
  'LombardTokenPool',
  'MockE2ELBTCTokenPool',
])

/** Reads one `key = value` out of a `foundry.toml` profile section, throwing if absent. */
function tomlValue(toml, profile, key) {
  const section = new RegExp(`\\[profile\\.${profile}\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(toml)
  if (!section) throw new Error(`foundry.toml: no [profile.${profile}] section`)
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'm').exec(section[1])
  if (!match) throw new Error(`foundry.toml: [profile.${profile}] has no "${key}"`)
  return match[1].replace(/^['"]|['"]$/g, '')
}

/**
 * The compiler settings the release build used, read from the package's own `foundry.toml`
 * (`[profile.default]` + the `ccip-compile` release profile) rather than hardcoded here.
 */
function readBuildSettings() {
  const toml = readFileSync(join(PKG, 'foundry.toml'), 'utf8')
  return {
    solcVersion: tomlValue(toml, 'default', 'solc_version'),
    evmVersion: tomlValue(toml, 'default', 'evm_version'),
    bytecodeHash: tomlValue(toml, 'default', 'bytecode_hash'),
    defaultRuns: Number(tomlValue(toml, 'ccip-compile', 'optimizer_runs').replace(/_/g, '')),
    viaIR: tomlValue(toml, 'ccip-compile', 'via_ir') === 'true',
  }
}

/** Remapping prefixes from the package's `remappings.txt`, longest-prefix first. */
function readRemappings() {
  return readFileSync(join(PKG, 'remappings.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1)]
    })
    .sort((a, b) => b[0].length - a[0].length)
}

/** Import specifiers in a Solidity source, with comments stripped first. */
function findImports(source) {
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const re = /import\s+(?:[^"';]*?\bfrom\s*)?["']([^"']+)["']/g
  const out = []
  let m
  while ((m = re.exec(bare))) out.push(m[1])
  return out
}

/** Maps a source-unit name to a file on disk: package-local first, then repo-root node_modules. */
function unitToDisk(unit) {
  for (const base of [PKG, REPO]) {
    const path = join(base, unit)
    if (existsSync(path)) return path
  }
  return null
}

/** Optimizer runs for one entry unit, mirroring `scripts/compile_all`'s `getOptimizations`. */
function optimizerRunsFor(unit, defaultRuns) {
  const name = posix.basename(unit, '.sol')
  if (unit.startsWith('contracts/pools/')) return LARGE_POOLS.has(name) ? 17_000 : 50_000
  if (!unit.startsWith('contracts/')) throw new Error(`cannot resolve optimizer runs for ${unit}`)
  return defaultRuns
}

/**
 * Walks one contract's transitive import graph, adding every source unit to the shared `pool`.
 *
 * Throws on a content collision for a repeated key. Within a single run this is unreachable —
 * content is `readFileSync(unitToDisk(unit))`, a pure function of the unit path — so the throw
 * exists as a cross-version invariant: a pool must never be shared across version directories.
 */
function walkClosure(entryUnit, remappings, pool) {
  const used = new Set()
  const units = new Set()
  const stack = [entryUnit]

  const toUnit = (spec, importer) => {
    if (spec.startsWith('.')) return posix.normalize(posix.join(posix.dirname(importer), spec))
    for (const [prefix, target] of remappings) {
      if (spec.startsWith(prefix)) {
        used.add(prefix)
        return target + spec.slice(prefix.length)
      }
    }
    return spec.startsWith('node_modules/') ? spec : `node_modules/${spec}`
  }

  while (stack.length) {
    const unit = stack.pop()
    if (units.has(unit)) continue
    const disk = unitToDisk(unit)
    if (!disk) throw new Error(`cannot resolve source unit "${unit}" (from ${entryUnit})`)
    const content = readFileSync(disk, 'utf8')
    const existing = pool.get(unit)
    if (existing !== undefined && existing !== content)
      throw new Error(`source content collision for "${unit}" — pools must not span versions`)
    pool.set(unit, content)
    units.add(unit)
    for (const spec of findImports(content)) stack.push(toUnit(spec, unit))
  }

  // Only the prefixes this closure actually applied. The shipped remappings.txt also maps
  // `forge-std/` to a path that does not exist here; emitting it verbatim would ship a dangling
  // remapping.
  return {
    units: [...units].sort(),
    remappings: remappings.filter(([p]) => used.has(p)).map(([p, t]) => `${p}=${t}`),
  }
}

/** The `outputSelection` submitted for every contract. Minimal, and bytecode-neutral. */
const OUTPUT_SELECTION = { '*': { '*': ['abi', 'evm.bytecode.object'] } }

/**
 * Assembles the deduplicated source pool and the per-contract manifest for every deployable
 * contract. Pure: reads the pinned package, touches nothing else.
 */
function assembleAll() {
  const settings = readBuildSettings()
  const remappings = readRemappings()
  const pool = new Map()
  const contracts = {}

  for (const [name, { unit, bin }] of Object.entries(TARGETS)) {
    const closure = walkClosure(unit, remappings, pool)
    const bytecode = readFileSync(join(PKG, 'bytecode/v2_0_0', bin), 'utf8').trim()
    contracts[name] = {
      fqn: `${unit}:${name}`,
      optimizerRuns: optimizerRunsFor(unit, settings.defaultRuns),
      remappings: closure.remappings,
      sources: closure.units,
      bytecodeKeccak: keccak256(bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`),
    }
  }

  return {
    contractsCcipVersion: require('@chainlink/contracts-ccip/package.json').version,
    compilerVersion: longSolcVersion(settings.solcVersion),
    evmVersion: settings.evmVersion,
    viaIR: settings.viaIR,
    bytecodeHash: settings.bytecodeHash,
    outputSelection: OUTPUT_SELECTION,
    contracts,
    pool,
  }
}

/**
 * The commit-qualified compiler version explorers require, taken from the installed `solc` so it
 * cannot drift from the compiler Tier 3 verifies with. Asserts it matches `foundry.toml`.
 */
function longSolcVersion(expected) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- root tooling, not SDK code
  const raw = require('solc').version() // "0.8.26+commit.8a97fa7a.Emscripten.clang"
  const match = /^(\d+\.\d+\.\d+\+commit\.[0-9a-f]+)/.exec(raw)
  if (!match) throw new Error(`unexpected solc version string: ${raw}`)
  if (!match[1].startsWith(`${expected}+`))
    throw new Error(
      `installed solc ${match[1]} does not match foundry.toml solc_version ${expected}`,
    )
  return `v${match[1]}`
}

/** keccak256 of a UTF-8 string, as a 0x-prefixed hex digest. */
function keccak256(text) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- root tooling, not SDK code
  const { keccak256: hash, toUtf8Bytes } = require('ethers')
  return hash(toUtf8Bytes(text))
}

module.exports = { TARGETS, OUTPUT_SELECTION, assembleAll }
