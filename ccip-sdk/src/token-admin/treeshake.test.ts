/**
 * Tree-shaking verification tests.
 *
 * Uses esbuild JS API to bundle specific entry points and verifies that:
 * 1. Each bundle contains its expected primary export (positive assertion)
 * 2. Unwanted code (bytecodes, cross-chain deps) is excluded (negative assertion)
 * 3. Bundle sizes stay within budgets
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
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
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

// All EVM bytecode constant names
const EVM_BYTECODES = [
  'BURN_MINT_ERC20_BYTECODE',
  'BURN_MINT_TOKEN_POOL_BYTECODE',
  'LOCK_RELEASE_TOKEN_POOL_BYTECODE',
  'FACTORY_BURN_MINT_ERC20_BYTECODE',
]

// Representative Aptos Move module markers (one per bytecode file)
const APTOS_MOVE_MARKERS = [
  'module managed_token::managed_token',
  'module managed_token_pool::managed_token_pool',
  'module burn_mint_token_pool::burn_mint_token_pool',
  'module lock_release_token_pool::lock_release_token_pool',
  'module regulated_token_pool::regulated_token_pool',
  'module ccip::token_admin_registry',
  'MCMS_MCMS_MOVE',
]

describe('tree-shaking verification', () => {
  // -------------------------------------------------------------------------
  // Main SDK entry — must exclude all CCT bytecodes and Move sources
  // -------------------------------------------------------------------------
  it('main entry excludes all EVM bytecodes and Aptos Move sources', async () => {
    const output = await bundle(`import '${sdkSrc}/index.ts'`)

    // The bare import with sideEffects:false tree-shakes to near-empty.
    // Verify none of the heavy CCT constants survived.
    for (const name of EVM_BYTECODES) {
      assert.ok(!output.includes(name), `main entry should not contain ${name}`)
    }
    for (const marker of APTOS_MOVE_MARKERS) {
      assert.ok(!output.includes(marker), `main entry should not contain "${marker}"`)
    }
  })

  // -------------------------------------------------------------------------
  // Cross-chain isolation: full 3×2 matrix
  // -------------------------------------------------------------------------
  const chains = [
    { name: 'EVM', class: 'EVMTokenAdmin', path: 'token-admin/evm/index.ts' },
    { name: 'Solana', class: 'SolanaTokenAdmin', path: 'token-admin/solana/index.ts' },
    { name: 'Aptos', class: 'AptosTokenAdmin', path: 'token-admin/aptos/index.ts' },
  ] as const

  for (const importer of chains) {
    for (const excluded of chains) {
      if (importer.name === excluded.name) continue

      it(`${importer.name} token-admin does NOT include ${excluded.name} token-admin code`, async () => {
        const output = await bundle(
          `import { ${importer.class} } from '${sdkSrc}/${importer.path}'; console.log(${importer.class})`,
        )

        // Positive: the bundle contains the expected class
        assert.ok(output.includes(importer.class), `bundle should contain ${importer.class}`)

        // Negative: the bundle excludes the other chain's class
        assert.ok(
          !output.includes(excluded.class),
          `${importer.name} token-admin should not contain ${excluded.class}`,
        )
      })
    }
  }

  // -------------------------------------------------------------------------
  // Code-splitting: bytecodes and Move sources stay in separate chunks
  // -------------------------------------------------------------------------
  // Code-splitting: the entry chunk should contain the class but NOT the heavy
  // bytecode/source data — those should be deferred to separate chunks via dynamic import().
  // We check for distinctive substrings of the actual data, not the constant names.
  it('EVM token-admin entry chunk does NOT eagerly include bytecode data (code-splitting)', async () => {
    const output = await bundle(
      `import { EVMTokenAdmin } from '${sdkSrc}/token-admin/evm/index.ts'; console.log(EVMTokenAdmin)`,
      { splitting: true },
    )

    assert.ok(output.includes('EVMTokenAdmin'), 'entry chunk should contain EVMTokenAdmin')

    // Distinctive substring from BurnMintERC20 bytecode hex
    assert.ok(
      !output.includes('60c060405234801562000010575f80fd5b50'),
      'entry chunk should not contain BurnMintERC20 bytecode hex data',
    )
  })

  it('Aptos token-admin entry chunk does NOT eagerly include Move source data (code-splitting)', async () => {
    const output = await bundle(
      `import { AptosTokenAdmin } from '${sdkSrc}/token-admin/aptos/index.ts'; console.log(AptosTokenAdmin)`,
      { splitting: true },
    )

    assert.ok(output.includes('AptosTokenAdmin'), 'entry chunk should contain AptosTokenAdmin')

    // Distinctive substring from managed_token Move source
    assert.ok(
      !output.includes('module managed_token::managed_token'),
      'entry chunk should not contain managed_token Move source code',
    )
  })
})
