import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'

import { build } from 'esbuild'

import { ChainFamily } from './networks.ts'

// What an app's bundle keeps of the SDK depends on package.json's `sideEffects` and on chain classes
// registering themselves: bundle small apps against src/ as a consumer's bundler would, and run them.
// 'node' leaves dependencies external; 'browser' bundles them, from their `browser` builds.
async function bundleAndRun(app: string, platform: 'node' | 'browser' = 'node') {
  const { outputFiles, metafile } = await build({
    stdin: { contents: app, resolveDir: import.meta.dirname, sourcefile: 'app.ts', loader: 'ts' },
    bundle: true,
    write: false,
    metafile: true,
    logLevel: 'silent',
    platform,
    ...(platform === 'node'
      ? { format: 'esm', packages: 'external' }
      : { format: 'cjs', external: builtinModules.flatMap((m) => [m, `node:${m}`]) }),
  })
  // 'node' bundles import their external dependencies from here, as ESM on stdin; 'browser' ones
  // run from a file, since stdin CJS is a script where node's builtins (e.g. `util`) are globals
  let file
  if (platform === 'browser') {
    file = join(mkdtempSync(join(tmpdir(), 'ccip-bundle-')), 'app.cjs')
    writeFileSync(file, outputFiles[0]!.text)
  }
  const { stdout, stderr, status } = spawnSync(
    process.execPath,
    file ? [file] : ['--input-type=module', '-'],
    { input: file ? undefined : outputFiles[0]!.text, cwd: import.meta.dirname, encoding: 'utf8' },
  )
  if (file) rmSync(dirname(file), { recursive: true })
  assert.equal(status, 0, stderr)
  const bundled = Object.entries(Object.values(metafile.outputs)[0]!.inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([path]) => path)
  return {
    result: JSON.parse(stdout.trim().split('\n').at(-1)!) as Record<string, unknown>,
    bundled,
    chainModules: bundled.flatMap((path) => /\/(\w+)\/index\.ts$/.exec(path)?.[1] ?? []),
  }
}

const EVM_EXTRA_ARGS_V2 = `0x181dcf10${(200_000).toString(16).padStart(64, '0')}${'1'.padStart(64, '0')}`
const tryDecode = `(() => {
  try {
    return decodeExtraArgs('${EVM_EXTRA_ARGS_V2}')?._tag
  } catch (err) {
    return { name: err.name, recovery: err.recovery }
  }
})()`
const chainFamilies = Object.values(ChainFamily).filter((f) => f !== ChainFamily.Unknown)

describe('bundling', () => {
  it('bundles no chain family for utility-only imports, which fail with a recovery hint', async () => {
    const { result, chainModules } = await bundleAndRun(`
      import { decodeExtraArgs, supportedChains } from './index.ts'
      console.log(JSON.stringify({ registered: Object.keys(supportedChains), decoded: ${tryDecode} }))
    `)
    assert.deepEqual(result.registered, [])
    assert.equal((result.decoded as { name: string }).name, 'CCIPChainFamilyUnsupportedError')
    assert.match((result.decoded as { recovery: string }).recovery, /@chainlink\/ccip-sdk\/all/)
    assert.deepEqual(
      chainModules.filter((m) => m !== 'errors'),
      [],
    )
  })

  it('bundles and registers only the referenced chain classes', async () => {
    const { result, chainModules } = await bundleAndRun(`
      import { EVMChain, decodeExtraArgs, supportedChains } from './index.ts'
      console.log(JSON.stringify({ registered: Object.keys(supportedChains), decoded: ${tryDecode}, family: EVMChain.family }))
    `)
    assert.deepEqual(result, {
      registered: [ChainFamily.EVM],
      decoded: 'EVMExtraArgsV2',
      family: ChainFamily.EVM,
    })
    assert.ok(chainModules.includes('evm'))
    assert.ok(!chainModules.includes('solana'), chainModules.join())
  })

  it('registers every family for a side-effect-only all-chains import', async () => {
    const { result } = await bundleAndRun(`
      import './all-chains.ts'
      import { supportedChains } from './index.ts'
      console.log(JSON.stringify({ registered: Object.keys(supportedChains).sort() }))
    `)
    assert.deepEqual(result.registered, [...chainFamilies].sort())
  })

  it('keeps classes registered before all-chains is evaluated', async () => {
    const { result } = await bundleAndRun(`
      import { EVMChain, decodeAddress, supportedChains } from './index.ts'
      class MyEVMChain extends EVMChain {
        static override getAddress(bytes: string) {
          return 'my:' + super.getAddress(bytes)
        }
      }
      supportedChains.EVM = MyEVMChain
      const custom = { family: 'SVM' }
      supportedChains.SVM = custom as never
      await import('./all-chains.ts')
      console.log(JSON.stringify({
        evm: supportedChains.EVM === MyEVMChain,
        svm: supportedChains.SVM === custom,
        address: decodeAddress('0x' + '11'.repeat(20)),
        registered: Object.keys(supportedChains).length,
      }))
    `)
    assert.deepEqual(result, {
      evm: true,
      svm: true,
      address: `my:0x${'11'.repeat(20)}`,
      registered: chainFamilies.length,
    })
  })

  it('encodes Solana Borsh payloads over 1000B in browser bundles, with one Anchor build', async () => {
    const { result, bundled } = await bundleAndRun(
      `
      import { SolanaChain } from './index.ts'
      import { encodeSolanaOffchainTokenData } from './solana/offchain.ts'
      const encoded = encodeSolanaOffchainTokenData({
        _tag: 'usdc',
        message: '0x' + '01'.repeat(1200),
        attestation: '0x' + '02'.repeat(65),
      })
      console.log(JSON.stringify({ family: SolanaChain.family, length: (encoded.length - 2) / 2 }))
    `,
      'browser',
    )
    assert.deepEqual(result, { family: ChainFamily.Solana, length: 4 + 1200 + 4 + 65 })
    const anchorBuilds = new Set(
      bundled.flatMap((path) => /@coral-xyz\/anchor\/dist\/(\w+)\//.exec(path)?.[1] ?? []),
    )
    assert.deepEqual([...anchorBuilds], ['browser'])
  })
})
