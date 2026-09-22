import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { JsCommands } from '../../canton/client/index.ts'
import { CantonChain } from '../../canton/index.ts'
import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'
import { CCTTxFailedError } from '../errors.ts'
import { type CantonExecuteParams, CantonOperation } from './operation.ts'

class NoopOperation extends CantonOperation<Record<string, never>> {
  readonly name = 'noop'
  protected async buildCommands(): Promise<JsCommands> {
    return { commands: [], commandId: 'noop-1', actAs: ['party::1220ab'] }
  }
}

function mockChain(submitAndWaitForTransaction: () => Promise<unknown>): CantonChain {
  // Real CantonChain instance (private fields make object-literal casts
  // impossible); Object.assign overrides only what the test exercises.
  return Object.assign(Object.create(CantonChain.prototype), {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    provider: { submitAndWaitForTransaction },
  })
}

describe('CantonOperation.execute error propagation', () => {
  const op = new NoopOperation()
  const wallet = { party: 'party::1220ab' }

  it('wraps a transient CCIPError as CCTTxFailedError, preserving isTransient/retryAfterMs', async () => {
    const chain = mockChain(async () => {
      throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, 'network blip', {
        isTransient: true,
        retryAfterMs: 3000,
      })
    })

    await assert.rejects(
      () => op.execute(chain, { wallet } as unknown as CantonExecuteParams<Record<string, never>>),
      (err: unknown) => {
        assert.ok(err instanceof CCTTxFailedError)
        assert.equal(err.isTransient, true)
        assert.equal(err.retryAfterMs, 3000)
        return true
      },
    )
  })

  it('does not mark a non-transient CCIPError as transient', async () => {
    const chain = mockChain(async () => {
      throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, 'validation failed')
    })

    await assert.rejects(
      () => op.execute(chain, { wallet } as unknown as CantonExecuteParams<Record<string, never>>),
      (err: unknown) => {
        assert.ok(err instanceof CCTTxFailedError)
        assert.equal(err.isTransient, false)
        return true
      },
    )
  })
})
