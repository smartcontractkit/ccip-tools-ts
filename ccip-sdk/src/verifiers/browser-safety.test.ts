import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Browser-safety guard for the CCV verifier capability.
 *
 * The SDK's verifier code must stay browser-safe: it may not depend on `@grpc/*`, and it may not do
 * a filesystem/`.proto` load at runtime (the schema ships as a committed protobufjs descriptor).
 * These are asserted mechanically so a regression fails CI rather than shipping a Node-only SDK.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SDK_SRC = join(HERE, '..')

/** Strip line and block comments so doc-comment mentions (e.g. "unlike loadSync") don't false-match. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Recursively list every shipped `.ts` file under `dir`: tests and `__mocks__` excluded, as in the build. */
function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__mocks__' && entry.name !== '__tests__') out.push(...tsFiles(full))
    } else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) out.push(full)
  }
  return out
}

describe('ccip-sdk browser-safety', () => {
  it('no ccip-sdk source imports @grpc/*', () => {
    const offenders: string[] = []
    for (const file of tsFiles(SDK_SRC)) {
      const src = stripComments(readFileSync(file, 'utf8'))
      if (/from ['"]@grpc\//.test(src) || /require\(['"]@grpc\//.test(src)) offenders.push(file)
    }
    assert.deepEqual(
      offenders,
      [],
      `@grpc/* must not be imported from ccip-sdk/src (browser-safe); offenders:\n${offenders.join('\n')}`,
    )
  })

  it('no ccip-sdk source does a runtime proto-loader / fs .proto load', () => {
    const offenders: string[] = []
    for (const file of tsFiles(SDK_SRC)) {
      const src = stripComments(readFileSync(file, 'utf8'))
      if (/@grpc\/proto-loader/.test(src) || /\bloadSync\s*\(/.test(src)) offenders.push(file)
    }
    assert.deepEqual(
      offenders,
      [],
      `the verifier schema must load from the committed descriptor, not a runtime .proto; offenders:\n${offenders.join('\n')}`,
    )
  })

  it('ccip-sdk package.json declares no @grpc dependency', () => {
    const pkg = JSON.parse(readFileSync(join(SDK_SRC, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const all = {
      ...pkg.dependencies,
      ...pkg.peerDependencies,
      ...pkg.devDependencies,
    }
    const grpc = Object.keys(all).filter((d) => d.startsWith('@grpc/'))
    assert.deepEqual(grpc, [], `ccip-sdk must not depend on @grpc/*; found: ${grpc.join(', ')}`)
  })
})
