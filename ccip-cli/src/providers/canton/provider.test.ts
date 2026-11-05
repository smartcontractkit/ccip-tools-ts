/**
 * Unit tests for the CLI Canton `JsonRpcProvider` error mapping: non-2xx
 * Ledger API responses surface the Canton `JsCantonError` code/cause in the
 * CCIPError context (`cantonCode`), and transient statuses (429/5xx) are
 * marked retryable — the contract the CCT operations' DUPLICATE_COMMAND
 * detection relies on.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CCIPError } from '@chainlink/ccip-sdk/src/index.ts'

import { JsonRpcProvider } from './provider.ts'

const URL_BASE = 'https://ledger.example.com'
const PARTY = `party::1220${'ab'.repeat(32)}`

function errorResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } })
}

/** A provider whose requests always receive the given canned response. */
async function providerRespondingWith(response: Response | Error): Promise<JsonRpcProvider> {
  const fetchFn = (async () => {
    if (response instanceof Error) throw response
    return response
  }) as typeof fetch
  return JsonRpcProvider.fromUrl('canton:TestNet', URL_BASE, 'jwt', fetchFn, undefined, PARTY)
}

async function ledgerApi(provider: JsonRpcProvider): Promise<unknown> {
  return provider.request({
    method: 'ledgerApi',
    params: { requestMethod: 'get', resource: '/v2/state/ledger-end' },
  } as any)
}

describe('JsonRpcProvider Canton error mapping', () => {
  it('extracts cantonCode/cantonCause from a gRPC-style `{error: {…}}` body', async () => {
    const provider = await providerRespondingWith(
      errorResponse(
        409,
        JSON.stringify({
          error: { code: 'DUPLICATE_COMMAND', cause: 'command already committed' },
        }),
      ),
    )

    await assert.rejects(
      () => ledgerApi(provider),
      (err: unknown) => {
        assert.ok(CCIPError.isCCIPError(err))
        assert.equal(err.context['cantonCode'], 'DUPLICATE_COMMAND')
        assert.equal(err.context['cantonCause'], 'command already committed')
        assert.equal(err.context['statusCode'], 409)
        // Duplicates mean the original committed — terminal, not retryable.
        assert.equal(err.isTransient, false)
        return true
      },
    )
  })

  it('extracts cantonCode from a bare `{code, cause}` body', async () => {
    const provider = await providerRespondingWith(
      errorResponse(400, JSON.stringify({ code: 'PARTY_NOT_FOUND', cause: 'no such party' })),
    )

    await assert.rejects(
      () => ledgerApi(provider),
      (err: unknown) => {
        assert.ok(CCIPError.isCCIPError(err))
        assert.equal(err.context['cantonCode'], 'PARTY_NOT_FOUND')
        assert.equal(err.context['cantonCause'], 'no such party')
        assert.equal(err.isTransient, false)
        return true
      },
    )
  })

  it('marks 429 and 5xx responses transient', async () => {
    for (const status of [429, 500, 503]) {
      const provider = await providerRespondingWith(
        errorResponse(status, JSON.stringify({ error: { code: 'BACKOFF', cause: 'busy' } })),
      )
      await assert.rejects(
        () => ledgerApi(provider),
        (err: unknown) => {
          assert.ok(CCIPError.isCCIPError(err))
          assert.equal(err.isTransient, true, `status ${status} must be transient`)
          assert.ok(typeof err.retryAfterMs === 'number')
          return true
        },
      )
    }
  })

  it('keeps non-JSON error bodies in the message without cantonCode', async () => {
    const provider = await providerRespondingWith(errorResponse(404, 'not found'))

    await assert.rejects(
      () => ledgerApi(provider),
      (err: unknown) => {
        assert.ok(CCIPError.isCCIPError(err))
        assert.equal(err.context['cantonCode'], undefined)
        assert.match(err.message, /not found/)
        assert.equal(err.isTransient, false)
        return true
      },
    )
  })

  it('marks network-level failures transient', async () => {
    const provider = await providerRespondingWith(new TypeError('fetch failed'))

    await assert.rejects(
      () => ledgerApi(provider),
      (err: unknown) => {
        assert.ok(CCIPError.isCCIPError(err))
        assert.equal(err.isTransient, true)
        assert.equal(err.context['cantonCode'], undefined)
        return true
      },
    )
  })
})
