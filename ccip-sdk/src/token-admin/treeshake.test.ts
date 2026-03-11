/**
 * Tree-shaking verification tests.
 *
 * Uses esbuild to bundle specific entry points and verifies that
 * unwanted code (bytecodes, cross-chain deps) is excluded.
 */

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

/** Shared esbuild external flags for node_modules we don't want to bundle. */
const EXTERNAL_FLAGS = [
  '--external:@aptos-labs/ts-sdk',
  '--external:@solana/web3.js',
  '--external:@solana/spl-token',
  '--external:@coral-xyz/anchor',
  '--external:@mysten/sui',
  '--external:@mysten/bcs',
  '--external:@ton/core',
  '--external:@ton/crypto',
  '--external:@ton/ton',
  '--external:ethers',
  '--external:got',
  '--external:abitype',
  '--external:viem',
  '--external:yaml',
  '--external:node:*',
]

/**
 * Bundle a virtual entry file with esbuild and return the output as a string.
 *
 * @param entryCode - TypeScript source to bundle
 * @param opts - Bundle options (set `splitting: true` for code-splitting)
 */
function bundle(entryCode: string, opts?: { splitting?: boolean }): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'treeshake-'))
  const entryFile = path.join(tmpDir, 'entry.ts')

  try {
    fs.writeFileSync(entryFile, entryCode)

    const splitting = opts?.splitting ?? false
    const outputFlags = splitting
      ? [`--outdir=${tmpDir}/out`, '--splitting']
      : [`--outfile=${path.join(tmpDir, 'out.js')}`]

    execSync(
      [
        'npx esbuild',
        entryFile,
        '--bundle',
        '--format=esm',
        '--tree-shaking=true',
        '--platform=node',
        ...outputFlags,
        ...EXTERNAL_FLAGS,
      ].join(' '),
      { stdio: 'pipe' },
    )

    // With splitting, read only the entry chunk (not code-split chunks)
    const outFile = splitting ? path.join(tmpDir, 'out', 'entry.js') : path.join(tmpDir, 'out.js')
    return fs.readFileSync(outFile, 'utf8')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

// Resolve the SDK source root for import paths
const sdkSrc = path.resolve(import.meta.dirname, '..')

describe('tree-shaking verification', () => {
  it('main entry does NOT include EVM bytecodes', () => {
    const output = bundle(`import '${sdkSrc}/index.ts'`)
    assert.ok(
      !output.includes('BURN_MINT_ERC20_BYTECODE'),
      'main entry should not contain EVM bytecodes',
    )
  })

  it('main entry does NOT include Aptos Move sources', () => {
    const output = bundle(`import '${sdkSrc}/index.ts'`)
    assert.ok(
      !output.includes('MANAGED_TOKEN_MOVE'),
      'main entry should not contain Aptos Move sources',
    )
  })

  it('EVM token-admin does NOT include Solana token-admin code', () => {
    const output = bundle(
      `import { EVMTokenAdmin } from '${sdkSrc}/token-admin/evm/index.ts'; console.log(EVMTokenAdmin)`,
    )
    assert.ok(
      !output.includes('SolanaTokenAdmin'),
      'EVM token-admin should not contain SolanaTokenAdmin',
    )
  })

  it('EVM token-admin does NOT include Aptos token-admin code', () => {
    const output = bundle(
      `import { EVMTokenAdmin } from '${sdkSrc}/token-admin/evm/index.ts'; console.log(EVMTokenAdmin)`,
    )
    assert.ok(
      !output.includes('AptosTokenAdmin'),
      'EVM token-admin should not contain AptosTokenAdmin',
    )
  })

  it('Solana token-admin does NOT include EVM token-admin code', () => {
    const output = bundle(
      `import { SolanaTokenAdmin } from '${sdkSrc}/token-admin/solana/index.ts'; console.log(SolanaTokenAdmin)`,
    )
    assert.ok(
      !output.includes('EVMTokenAdmin'),
      'Solana token-admin should not contain EVMTokenAdmin',
    )
  })

  it('Solana token-admin does NOT include Aptos token-admin code', () => {
    const output = bundle(
      `import { SolanaTokenAdmin } from '${sdkSrc}/token-admin/solana/index.ts'; console.log(SolanaTokenAdmin)`,
    )
    assert.ok(
      !output.includes('AptosTokenAdmin'),
      'Solana token-admin should not contain AptosTokenAdmin',
    )
  })

  it('EVM token-admin import does NOT eagerly include bytecode data (code-splitting)', () => {
    // With code-splitting, dynamic import() creates a separate chunk.
    // The entry chunk should NOT contain the actual heavy bytecode hex string.
    // We check for a distinctive 40-char substring from the BurnMintERC20 bytecode.
    const output = bundle(
      `import { EVMTokenAdmin } from '${sdkSrc}/token-admin/evm/index.ts'; console.log(EVMTokenAdmin)`,
      { splitting: true },
    )
    assert.ok(
      !output.includes('60c060405234801562000010575f80fd5b50'),
      'entry chunk should not contain the actual EVM bytecode hex data',
    )
  })

  it('Aptos token-admin import does NOT eagerly include Move source data (code-splitting)', () => {
    // Check for a distinctive substring from the managed_token Move source.
    const output = bundle(
      `import { AptosTokenAdmin } from '${sdkSrc}/token-admin/aptos/index.ts'; console.log(AptosTokenAdmin)`,
      { splitting: true },
    )
    assert.ok(
      !output.includes('module managed_token::managed_token'),
      'entry chunk should not contain the actual Move source code',
    )
  })
})
