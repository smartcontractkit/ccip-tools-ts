#!/usr/bin/env node
/**
 * Runs `node --test` over a filtered subset of a workspace's test files.
 *
 * Test files are classified purely by filename suffix:
 *   *.integration.test.ts  → tag: integration
 *   *.e2e.test.ts          → tag: e2e
 *   *.fork.test.ts         → tag: fork
 *   anything else matching *.test.ts → unit
 *
 * This keeps plain `integration.test.ts` recognized exactly like
 * `logs.integration.test.ts` — the suffix is what matters, not the stem.
 *
 * Usage (npm workspace scripts run with cwd = the workspace root):
 *   node ../scripts/run-tests.mjs <dir>                # every *.test.ts under <dir>
 *   node ../scripts/run-tests.mjs <dir> --exclude integration,e2e,fork   # unit only
 *   node ../scripts/run-tests.mjs <dir> --tags integration,fork          # tagged only
 *   node ../scripts/run-tests.mjs <dir> --dry                            # print the selection, run nothing
 *
 * Exit code mirrors the node --test run (0 = all pass, 1 = any failure).
 */
import { spawn } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const TEST_FILE_RE = /\.test\.(?:ts|mts|cts)$/i
// Filename stem suffixes: a bare `integration.test.ts` classifies exactly like
// `logs.integration.test.ts`, while `fork.test.data.ts` (data helper) and names like
// `notintegration.test.ts` (no dot boundary) match nothing.
const TAG_SUFFIXES = {
  integration: 'integration.test.ts',
  e2e: 'e2e.test.ts',
  fork: 'fork.test.ts',
}

function tagsOf(filePath) {
  const name = filePath.split('/').at(-1) ?? ''
  const lower = name.toLowerCase()
  return Object.entries(TAG_SUFFIXES)
    .filter(([, suffix]) => lower === suffix || lower.endsWith('.' + suffix))
    .map(([tag]) => tag)
}

/** Recursively collect test files under dir, sorted for deterministic ordering. */
function collectTestFiles(dir, files = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collectTestFiles(full, files)
    } else if (TEST_FILE_RE.test(entry)) {
      files.push(full)
    }
  }
  return files
}

function parseArgs(argv) {
  const positional = []
  const flags = { exclude: new Set(), tags: new Set(), dry: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry') {
      flags.dry = true
    } else if (arg === '--exclude' || arg === '--tags') {
      for (const value of (argv[i + 1] ?? '').split(',').filter(Boolean)) {
        if (!(value in TAG_SUFFIXES)) {
          console.error(
            `[run-tests] unknown tag "${value}" — expected one of: ${Object.keys(TAG_SUFFIXES).join(', ')}`,
          )
          process.exit(1)
        }
        flags[arg.slice(2)].add(value)
      }
      i++
    } else {
      positional.push(arg)
    }
  }
  return { dir: positional[0], flags }
}

function main() {
  const { dir, flags } = parseArgs(process.argv.slice(2))
  if (!dir) {
    console.error('usage: node scripts/run-tests.mjs <dir> [--exclude a,b] [--tags a,b]')
    process.exit(1)
  }
  if (!statSync(dir).isDirectory()) {
    console.error(`[run-tests] not a directory: ${dir}`)
    process.exit(1)
  }

  const files = collectTestFiles(dir).filter((file) => {
    const tags = tagsOf(file)
    if (flags.tags.size > 0 && !tags.some((tag) => flags.tags.has(tag))) return false
    if (flags.exclude.size > 0 && tags.some((tag) => flags.exclude.has(tag))) return false
    return true
  })

  if (files.length === 0) {
    console.error('[run-tests] no test files matched')
    process.exit(flags.tags.size > 0 ? 1 : 0)
  }

  const relativeFiles = files.map((file) => relative(process.cwd(), file))
  console.error(`[run-tests] running ${relativeFiles.length} test file(s)`)
  for (const file of relativeFiles) console.error(`  ${file}`)
  if (flags.dry) process.exit(0)
  const child = spawn(process.execPath, ['--test', ...relativeFiles], {
    cwd: process.cwd(),
    stdio: 'inherit',
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      child.kill(signal)
    })
  }
  child.on('exit', (code) => {
    process.exit(code ?? 1)
  })
}

main()
