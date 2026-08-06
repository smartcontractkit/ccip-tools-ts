import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { promisify } from 'node:util'

import { verifyDeployedContract } from './index.ts'
import type { VerifyTarget } from './verify.ts'
import { CCTParamsInvalidError, CCTVerificationNotConfirmedError } from '../../errors.ts'

const TARGET: VerifyTarget = {
  contractAddress: '0x0000000000000000000000000000000000000001',
  verification: { contract: 'ERC20LockBox', encodedConstructorArgs: '0x1234' },
  hash: '0xdeadbeef',
}

/** An Etherscan envelope, which always arrives inside an HTTP 200. */
function envelope(result: unknown, status = '1'): Response {
  return new Response(
    JSON.stringify({ status, message: status === '1' ? 'OK' : 'NOTOK', result }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )
}

/** Records every request so a test can assert on what was actually sent. */
interface Recorded {
  urls: string[]
  bodies: string[]
}

/** Drives the Etherscan flow through a scripted sequence of `result` strings. */
function etherscanMock(
  script: { submit: string; submitStatus?: string; polls: string[] },
  rec: Recorded,
) {
  let poll = 0
  const impl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    rec.urls.push(url)
    if (typeof init?.body === 'string') rec.bodies.push(init.body)
    const action = new URL(url).searchParams.get('action')
    if (action === 'verifysourcecode')
      return Promise.resolve(envelope(script.submit, script.submitStatus ?? '1'))
    if (action === 'checkverifystatus')
      return Promise.resolve(envelope(script.polls[Math.min(poll++, script.polls.length - 1)]!))
    // Real shape: getsourcecode returns `result` as an ARRAY, not a JSON string.
    if (action === 'getsourcecode') return Promise.resolve(envelope([{ SourceCode: '' }]))
    throw new Error(`unexpected action ${action ?? 'null'}`)
  }
  return impl
}

void describe('verifyDeployedContract — routing and validation', () => {
  void it('rejects an unroutable chain before any network call', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    await assert.rejects(
      () =>
        verifyDeployedContract(TARGET, {
          chainId: 1234567,
          apiKey: 'k',
          fetch: etherscanMock({ submit: 'guid', polls: [] }, rec),
        }),
      CCTParamsInvalidError,
    )
    assert.equal(rec.urls.length, 0)
  })

  void it('rejects a keyed route with no apiKey before any network call', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    await assert.rejects(
      () =>
        verifyDeployedContract(TARGET, {
          chainId: 84532,
          fetch: etherscanMock({ submit: 'guid', polls: [] }, rec),
        }),
      (error: unknown) => {
        assert.ok(error instanceof CCTParamsInvalidError)
        assert.match(error.message, /sourcify/)
        return true
      },
    )
    assert.equal(rec.urls.length, 0)
  })
})

void describe('verifyDeployedContract — Etherscan v2', () => {
  void it('submits, polls through pending, and returns a populated explorerUrl', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    const result = await verifyDeployedContract(TARGET, {
      chainId: 84532,
      apiKey: 'secret-key',
      timeoutMs: 60_000,
      fetch: etherscanMock(
        { submit: 'guid-1', polls: ['Pending in queue', 'Pass - Verified'] },
        rec,
      ),
    })
    assert.equal(result.status, 'verified')
    assert.equal(result.verifier, 'etherscan-v2')
    assert.equal(
      result.explorerUrl,
      'https://sepolia.basescan.org/address/0x0000000000000000000000000000000000000001#code',
    )
  })

  void it('submits constructor args as bare hex under both field spellings', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    await verifyDeployedContract(TARGET, {
      chainId: 84532,
      apiKey: 'k',
      fetch: etherscanMock({ submit: 'guid', polls: ['Pass - Verified'] }, rec),
    })
    const body = new URLSearchParams(rec.bodies[0])
    assert.equal(body.get('constructorArguements'), '1234')
    assert.equal(body.get('constructorArguments'), '1234')
    assert.equal(body.get('codeformat'), 'solidity-standard-json-input')
    assert.equal(body.get('contractname'), 'contracts/pools/ERC20LockBox.sol:ERC20LockBox')
    assert.equal(body.get('compilerversion'), 'v0.8.26+commit.8a97fa7a')
  })

  void it('omits the constructor-args field entirely for a no-arg constructor', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    await verifyDeployedContract(
      { ...TARGET, verification: { contract: 'ERC20LockBox', encodedConstructorArgs: '0x' } },
      {
        chainId: 84532,
        apiKey: 'k',
        fetch: etherscanMock({ submit: 'g', polls: ['Pass - Verified'] }, rec),
      },
    )
    const body = new URLSearchParams(rec.bodies[0])
    assert.equal(body.get('constructorArguements'), null)
    assert.equal(body.get('constructorArguments'), null)
  })

  void it('maps a definitive rejection to failed, and narrows for the caller', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    const result = await verifyDeployedContract(TARGET, {
      chainId: 84532,
      apiKey: 'k',
      fetch: etherscanMock({ submit: 'g', polls: ['Fail - Unable to verify'] }, rec),
    })
    assert.equal(result.status, 'failed')
    assert.match(result.reason, /Fail - Unable to verify/)
  })

  void it('never reports an unrecognised terminal status as verified', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    await assert.rejects(
      () =>
        verifyDeployedContract(TARGET, {
          chainId: 84532,
          apiKey: 'k',
          fetch: etherscanMock({ submit: 'g', polls: ['Something nobody has seen before'] }, rec),
        }),
      /Something nobody has seen before/,
    )
  })

  void it('short-circuits when the explorer says it is already verified', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    const result = await verifyDeployedContract(TARGET, {
      chainId: 84532,
      apiKey: 'k',
      fetch: etherscanMock(
        { submit: 'Contract source code already verified', submitStatus: '0', polls: [] },
        rec,
      ),
    })
    assert.equal(result.status, 'already-verified')
    // Exactly one call: no pre-flight getsourcecode probe burning explorer quota.
    assert.equal(rec.urls.length, 1)
  })

  void it('retries a not-yet-indexed submission', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    let submits = 0
    const impl: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      rec.urls.push(url)
      if (typeof init?.body === 'string') rec.bodies.push(init.body)
      const action = new URL(url).searchParams.get('action')
      if (action === 'verifysourcecode')
        return Promise.resolve(
          ++submits < 2
            ? envelope('Unable to locate ContractCode at 0x…', '0')
            : envelope('guid-after-retry'),
        )
      return Promise.resolve(envelope('Pass - Verified'))
    }
    // The retry pause is clamped to the remaining budget, so a small budget keeps this fast
    // without an aborted signal — which would now (correctly) stop the loop instead.
    const result = await verifyDeployedContract(TARGET, {
      chainId: 84532,
      apiKey: 'k',
      timeoutMs: 200,
      fetch: impl,
    })
    assert.equal(result.status, 'verified')
    assert.equal(submits, 2)
  })

  void it('confirms once via getsourcecode before giving up on a lagging explorer', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    const impl: typeof fetch = (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      rec.urls.push(url)
      const action = new URL(url).searchParams.get('action')
      if (action === 'verifysourcecode') return Promise.resolve(envelope('guid'))
      if (action === 'checkverifystatus') return Promise.resolve(envelope('Pending in queue'))
      // Snowtrace-style: the status endpoint lags, but the source is verified. Array shape.
      return Promise.resolve(envelope([{ SourceCode: 'contract X {}' }]))
    }
    const result = await verifyDeployedContract(TARGET, {
      chainId: 43113,
      apiKey: 'k',
      timeoutMs: 0,
      fetch: impl,
    })
    assert.equal(result.status, 'verified')
    assert.ok(rec.urls.some((u) => u.includes('getsourcecode')))
  })

  void it('throws a transient not-confirmed error carrying the guid when the budget expires', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    await assert.rejects(
      () =>
        verifyDeployedContract(TARGET, {
          chainId: 84532,
          apiKey: 'k',
          timeoutMs: 0,
          fetch: etherscanMock({ submit: 'guid-pending', polls: ['Pending in queue'] }, rec),
        }),
      (error: unknown) => {
        assert.ok(error instanceof CCTVerificationNotConfirmedError)
        assert.equal(error.isTransient, true)
        assert.equal(error.retryAfterMs, 5000)
        assert.equal(error.context.guid, 'guid-pending')
        return true
      },
    )
  })

  void it('bounds the submit phase by timeoutMs instead of burning the full retry budget', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    const started = Date.now()
    await assert.rejects(
      () =>
        verifyDeployedContract(TARGET, {
          chainId: 84532,
          apiKey: 'k',
          timeoutMs: 50,
          fetch: etherscanMock(
            { submit: 'Unable to locate ContractCode at 0x…', submitStatus: '0', polls: [] },
            rec,
          ),
        }),
      // Transient: an unindexed contract is guaranteed to clear on its own.
      (error: unknown) => {
        assert.ok(error instanceof CCTVerificationNotConfirmedError)
        assert.equal(error.isTransient, true)
        return true
      },
    )
    assert.ok(Date.now() - started < 5_000, 'submit retries must respect the caller budget')
  })

  void it('stops on abort rather than spinning the poll loop', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)
    await assert.rejects(() =>
      verifyDeployedContract(TARGET, {
        chainId: 84532,
        apiKey: 'k',
        timeoutMs: 60_000,
        abort: controller.signal,
        fetch: etherscanMock({ submit: 'guid', polls: ['Pending in queue'] }, rec),
      }),
    )
    // A collapsed sleep would have issued thousands of polls in 30ms.
    assert.ok(rec.urls.length < 25, `expected paced polling, saw ${rec.urls.length} requests`)
  })

  void it('never leaks the API key to the logger', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    const logged: string[] = []
    const record = (...args: unknown[]) => logged.push(args.map(String).join(' '))
    await verifyDeployedContract(TARGET, {
      chainId: 84532,
      apiKey: 'super-secret-key',
      logger: { debug: record, info: record, warn: record, error: record },
      fetch: etherscanMock({ submit: 'g', polls: ['Pass - Verified'] }, rec),
    })
    assert.ok(!logged.join('\n').includes('super-secret-key'))
  })
})

void describe('verifyDeployedContract — Sourcify', () => {
  /** Drives the keyless Sourcify flow. */
  function sourcifyMock(job: Record<string, unknown>, rec: Recorded) {
    const impl: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      rec.urls.push(url)
      if (typeof init?.body === 'string') rec.bodies.push(init.body)
      const body = /\/v2\/verify\/\d+\//.test(url)
        ? { verificationId: 'job-1' }
        : { isJobCompleted: true, ...job }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    return impl
  }

  void it('verifies without an API key and threads the creation tx hash', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    const result = await verifyDeployedContract(TARGET, {
      chainId: 84532,
      route: 'sourcify',
      fetch: sourcifyMock({ contract: { match: 'match' } }, rec),
    })
    assert.equal(result.status, 'verified')
    assert.equal(result.verifier, 'sourcify')
    const submitted = JSON.parse(rec.bodies[0]!) as Record<string, unknown>
    assert.equal(submitted.creationTransactionHash, '0xdeadbeef')
    assert.equal(submitted.contractIdentifier, 'contracts/pools/ERC20LockBox.sol:ERC20LockBox')
    assert.equal(submitted.compilerVersion, 'v0.8.26+commit.8a97fa7a')
  })

  void it('omits the creation tx hash when the target has none', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    const { hash: _hash, ...noHash } = TARGET
    await verifyDeployedContract(noHash, {
      chainId: 84532,
      route: 'sourcify',
      fetch: sourcifyMock({ contract: { match: 'exact_match' } }, rec),
    })
    const submitted = JSON.parse(rec.bodies[0]!) as Record<string, unknown>
    assert.ok(!('creationTransactionHash' in submitted))
  })

  void it('accepts a creation-only match', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    const result = await verifyDeployedContract(TARGET, {
      chainId: 84532,
      route: 'sourcify',
      fetch: sourcifyMock({ contract: { match: null, creationMatch: 'match' } }, rec),
    })
    assert.equal(result.status, 'verified')
  })

  void it('reports no match as failed rather than throwing', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    const result = await verifyDeployedContract(TARGET, {
      chainId: 84532,
      route: 'sourcify',
      fetch: sourcifyMock({ contract: { match: null }, error: { customCode: 'no_match' } }, rec),
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.reason, 'no_match')
  })

  void it('never falls back to another verifier after a failure', async () => {
    const rec: Recorded = { urls: [], bodies: [] }
    await verifyDeployedContract(TARGET, {
      chainId: 84532,
      route: 'sourcify',
      fetch: sourcifyMock({ contract: { match: null } }, rec),
    })
    assert.ok(rec.urls.every((url) => url.includes('sourcify')))
  })
})

void describe('verifyDeployedContract — process liveness', () => {
  // A polling loop backed by an unref'd timer lets Node drain its event loop and exit mid-
  // verification: the promise never settles and the caller gets neither a result nor an error.
  // node:test holds its own ref'd handles, so this is only observable from a child process.
  void it('keeps the process alive while polling', async () => {
    const probe = join(tmpdir(), `cct-verify-liveness-${process.pid}.mjs`)
    const moduleUrl = new URL('./index.ts', import.meta.url).href
    await writeFile(
      probe,
      `
      const { verifyDeployedContract } = await import(${JSON.stringify(moduleUrl)})
      const body = (result) =>
        Promise.resolve(new Response(JSON.stringify({ status: '1', message: 'OK', result }),
          { status: 200, headers: { 'content-type': 'application/json' } }))
      const impl = (input) =>
        new URL(String(input)).searchParams.get('action') === 'verifysourcecode'
          ? body('guid') : body('Pending in queue')
      let settled = false
      process.on('exit', () => { if (!settled) { console.log('EXITED_WITHOUT_SETTLING'); } })
      try {
        await verifyDeployedContract(
          { contractAddress: '0x1', verification: { contract: 'ERC20LockBox', encodedConstructorArgs: '0x' } },
          { chainId: 84532, apiKey: 'k', timeoutMs: 400, fetch: impl },
        )
      } catch { /* the budget expiring is the expected outcome */ }
      settled = true
      console.log('SETTLED')
      `,
      'utf8',
    )
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['--experimental-strip-types', '--no-warnings', probe],
        { timeout: 30_000 },
      )
      assert.match(stdout, /SETTLED/)
      assert.doesNotMatch(stdout, /EXITED_WITHOUT_SETTLING/)
    } finally {
      await rm(probe, { force: true })
    }
  })
})
