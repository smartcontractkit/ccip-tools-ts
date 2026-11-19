/**
 * Unit tests for {@link CantonChain.submitCommands} retry reporting: a transient failure is
 * retryable only when the caller supplied the command ID, and a failure after the commit is
 * never reported as retryable.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CCIPError, CCIPErrorCode, CCIPTxOutcomeUnavailableError } from '../errors/index.ts'
import type { JsCommands } from './clients/ledger-api/client.ts'
import { CantonChain } from './index.ts'

const COMMANDS = { commands: [], commandId: 'cmd-1', actAs: ['party::1220ab'] } as JsCommands

function transientError() {
  return new CCIPError(CCIPErrorCode.CANTON_API_ERROR, 'timeout', {
    isTransient: true,
    context: { statusCode: 503 },
  })
}

function chainWith(opts: {
  request: () => Promise<unknown>
  getUpdateById?: () => Promise<unknown>
}): CantonChain {
  return Object.assign(Object.create(CantonChain.prototype), {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    provider: { request: opts.request },
    ledgerApiClient: { getUpdateById: opts.getUpdateById ?? (async () => ({})) },
    transactionUpdateFormat: () => ({}),
  })
}

describe('CantonChain.submitCommands retry reporting', () => {
  const failing = chainWith({
    request: async () => {
      throw transientError()
    },
  })

  it('makes a transient failure non-retryable when the ID was generated', async () => {
    await assert.rejects(
      () => failing.submitCommands(COMMANDS, 'test', { commandIdSupplied: false }),
      (err: unknown) => {
        assert.ok(CCIPError.isCCIPError(err))
        assert.equal(err.isTransient, false)
        assert.equal(err.context['commandId'], 'cmd-1')
        assert.equal(err.context['statusCode'], 503)
        return true
      },
    )
  })

  it('keeps a transient failure retryable when the ID was supplied', async () => {
    await assert.rejects(
      () => failing.submitCommands(COMMANDS, 'test', { commandIdSupplied: true }),
      (err: unknown) => {
        assert.ok(CCIPError.isCCIPError(err))
        assert.equal(err.isTransient, true)
        return true
      },
    )
  })

  it('leaves callers that do not pass the option unchanged', async () => {
    await assert.rejects(
      () => failing.submitCommands(COMMANDS, 'test'),
      (err: unknown) => {
        assert.ok(CCIPError.isCCIPError(err))
        assert.equal(err.isTransient, true)
        return true
      },
    )
  })

  it('reports a failed read-back after the commit as outcome unavailable, never retryable', async () => {
    const chain = chainWith({
      request: async () => ({ tx: { payload: { updateId: 'upd-1' } } }),
      getUpdateById: async () => {
        throw transientError()
      },
    })
    for (const commandIdSupplied of [false, true]) {
      await assert.rejects(
        () => chain.submitCommands(COMMANDS, 'test', { commandIdSupplied }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTxOutcomeUnavailableError)
          assert.equal(err.isTransient, false)
          assert.equal(err.context['updateId'], 'upd-1')
          return true
        },
      )
    }
  })
})
