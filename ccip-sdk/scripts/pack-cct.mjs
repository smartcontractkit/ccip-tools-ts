import { cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = new URL('..', import.meta.url)
const stage = await mkdtemp(join(tmpdir(), 'ccip-sdk-cct-'))
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

manifest.exports['./cct/evm'] = {
  types: './dist/cct/evm/index.d.ts',
  default: './dist/cct/evm/index.js',
}
manifest.exports['./cct/solana'] = {
  types: './dist/cct/solana/index.d.ts',
  default: './dist/cct/solana/index.js',
}
manifest.files = manifest.files.filter((file) => file !== '!dist/cct/**')

try {
  await Promise.all([
    cp(new URL('dist', root), join(stage, 'dist'), { recursive: true }),
    cp(new URL('src', root), join(stage, 'src'), { recursive: true }),
    cp(new URL('tsconfig.json', root), join(stage, 'tsconfig.json')),
    cp(new URL('../README.md', root), join(stage, 'README.md')),
    cp(new URL('../LICENSE', root), join(stage, 'LICENSE')),
  ])
  await writeFile(join(stage, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['pack', '--ignore-scripts', '--json'],
    {
      cwd: stage,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  if (result.status) process.exitCode = result.status
  else {
    const [{ filename }] = JSON.parse(result.stdout)
    await rename(join(stage, filename), join(root.pathname, filename))
    console.log(filename)
  }
} finally {
  await rm(stage, { recursive: true, force: true })
}
