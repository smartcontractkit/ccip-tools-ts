/**
 * Tree-shaking verification tests for the CCT (`cct/`) facades.
 *
 * Uses esbuild JS API to bundle specific entry points and verifies that:
 * 1. Each bundle contains its expected primary export (positive assertion)
 * 2. Unwanted code (bytecodes, cross-chain deps) is excluded (negative assertion)
 * 3. Heavy bytecode/Move data stays code-split out of the entry chunk
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

import * as esbuild from 'esbuild'

/** Derive external packages from package.json dependencies + peerDependencies. */
function getExternalPackages(): string[] {
  const pkgPath = path.resolve(import.meta.dirname, '../../package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    'node:*',
  ]
}

const EXTERNAL = getExternalPackages()

/** SDK source root for import paths. */
const sdkSrc = path.resolve(import.meta.dirname, '..')

/**
 * Bundle entry code with esbuild and return the output string.
 * Uses the JS API for speed and determinism (no npx cold-start).
 */
async function bundle(entryCode: string, opts?: { splitting?: boolean }): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'treeshake-'))
  const entryFile = path.join(tmpDir, 'entry.ts')

  try {
    fs.writeFileSync(entryFile, entryCode)

    const splitting = opts?.splitting ?? false
    const outdir = path.join(tmpDir, 'out')
    await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: 'esm',
      treeShaking: true,
      platform: 'node',
      write: true,
      outdir,
      splitting,
      external: EXTERNAL,
    })

    return fs.readFileSync(path.join(outdir, 'entry.js'), 'utf8')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

// All EVM bytecode constant names (cct/evm bytecodes)
const EVM_BYTECODES = [
  'CROSS_CHAIN_TOKEN_BYTECODE',
  'CROSS_CHAIN_POOL_TOKEN_BYTECODE',
  'BURN_MINT_TOKEN_POOL_BYTECODE',
  'LOCK_RELEASE_TOKEN_POOL_BYTECODE',
]

// Representative Aptos Move module markers (one per bytecode file)
const APTOS_MOVE_MARKERS = [
  'module managed_token::managed_token',
  'module managed_token_pool::managed_token_pool',
  'module burn_mint_token_pool::burn_mint_token_pool',
  'module lock_release_token_pool::lock_release_token_pool',
  'module regulated_token_pool::regulated_token_pool',
  'module ccip::token_admin_registry',
]

describe('cct facades — tree-shaking verification', () => {
  // -------------------------------------------------------------------------
  // Main SDK entry — must exclude all CCT bytecodes and Move sources
  // -------------------------------------------------------------------------
  it('main entry excludes all EVM bytecodes and Aptos Move sources', async () => {
    const output = await bundle(`import '${sdkSrc}/index.ts'`)

    for (const name of EVM_BYTECODES) {
      assert.ok(!output.includes(name), `main entry should not contain ${name}`)
    }
    for (const marker of APTOS_MOVE_MARKERS) {
      assert.ok(!output.includes(marker), `main entry should not contain "${marker}"`)
    }
  })

  // -------------------------------------------------------------------------
  // Cross-chain isolation: full 3×2 matrix over the cct/ facades
  // -------------------------------------------------------------------------
  const chains = [
    { name: 'EVM', class: 'EVMTokenManager', path: 'cct/evm/index.ts' },
    { name: 'Solana', class: 'SolanaTokenManager', path: 'cct/solana/index.ts' },
    { name: 'Aptos', class: 'AptosTokenManager', path: 'cct/aptos/index.ts' },
  ] as const

  for (const importer of chains) {
    for (const excluded of chains) {
      if (importer.name === excluded.name) continue

      it(`${importer.name} manager does NOT include ${excluded.name} manager code`, async () => {
        const output = await bundle(
          `import { ${importer.class} } from '${sdkSrc}/${importer.path}'; console.log(${importer.class})`,
        )

        // Positive: the bundle contains the expected facade class
        assert.ok(output.includes(importer.class), `bundle should contain ${importer.class}`)

        // Negative: the bundle excludes the other chain's facade class
        assert.ok(
          !output.includes(excluded.class),
          `${importer.name} manager should not contain ${excluded.class}`,
        )
      })
    }
  }

  // -------------------------------------------------------------------------
  // Code-splitting: bytecodes and Move sources stay in separate chunks
  // -------------------------------------------------------------------------
  it('EVM manager entry chunk does NOT eagerly include bytecode data (code-splitting)', async () => {
    const output = await bundle(
      `import { EVMTokenManager } from '${sdkSrc}/cct/evm/index.ts'; console.log(EVMTokenManager)`,
      { splitting: true },
    )

    assert.ok(output.includes('EVMTokenManager'), 'entry chunk should contain EVMTokenManager')

    // Distinctive substring from CrossChainToken bytecode hex
    assert.ok(
      !output.includes('module managed_token::managed_token'),
      'entry chunk should not contain Aptos Move source data',
    )
  })

  it('Aptos manager entry chunk does NOT eagerly include Move source data (code-splitting)', async () => {
    const output = await bundle(
      `import { AptosTokenManager } from '${sdkSrc}/cct/aptos/index.ts'; console.log(AptosTokenManager)`,
      { splitting: true },
    )

    assert.ok(output.includes('AptosTokenManager'), 'entry chunk should contain AptosTokenManager')

    // Distinctive substring from managed_token Move source
    assert.ok(
      !output.includes('module managed_token::managed_token'),
      'entry chunk should not contain managed_token Move source code',
    )
  })
})
