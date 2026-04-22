import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type CCIPRequest, CCIPInteractiveRequiredError } from '@chainlink/ccip-sdk/src/index.ts'

import { selectRequest } from './utils.ts'
import type { GlobalOpts } from '../index.ts'

/** Minimal mock CCIPRequest for testing selectRequest behavior. */
function mockRequest(logIndex: number, messageId: string): CCIPRequest {
  return {
    log: { index: logIndex, transactionHash: '0x' + 'ab'.repeat(32) },
    tx: { hash: '0x' + 'ab'.repeat(32) },
    message: { messageId, sender: '0x1', receiver: '0x2', tokenAmounts: [] },
    lane: { sourceChainSelector: 1n, destChainSelector: 2n, onRamp: '0x3' },
  } as unknown as CCIPRequest
}

describe('selectRequest non-interactive behavior', () => {
  it('returns the single request without prompting', async () => {
    const requests = [mockRequest(0, '0xmsg1')]
    const result = await selectRequest(requests, 'test', { interactive: false })
    assert.equal(result.message.messageId, '0xmsg1')
  })

  it('returns the request matching logIndex', async () => {
    const requests = [mockRequest(0, '0xmsg1'), mockRequest(1, '0xmsg2')]
    const result = await selectRequest(requests, 'test', { logIndex: 1, interactive: false })
    assert.equal(result.message.messageId, '0xmsg2')
  })

  it('throws CCIPInteractiveRequiredError for multiple requests without logIndex', async () => {
    const requests = [mockRequest(0, '0xmsg1'), mockRequest(1, '0xmsg2')]
    await assert.rejects(
      () => selectRequest(requests, 'test', { interactive: false }),
      (err: unknown) => {
        assert.ok(err instanceof CCIPInteractiveRequiredError)
        assert.equal(err.code, 'INTERACTIVE_REQUIRED')
        assert.equal(err.context.count, 2)
        assert.deepEqual(err.context.logIndices, [0, 1])
        assert.deepEqual(err.context.messageIds, ['0xmsg1', '0xmsg2'])
        return true
      },
    )
  })
})

describe('CCIPInteractiveRequiredError', () => {
  it('has correct code and is not transient', () => {
    const err = new CCIPInteractiveRequiredError('Ledger wallet requires USB interaction', {
      recovery: 'Use a private key for non-interactive mode',
    })
    assert.equal(err.code, 'INTERACTIVE_REQUIRED')
    assert.equal(err.isTransient, false)
    assert.equal(err.recovery, 'Use a private key for non-interactive mode')
    assert.equal(err.name, 'CCIPInteractiveRequiredError')
  })

  it('uses default recovery when none provided', () => {
    const err = new CCIPInteractiveRequiredError('test')
    assert.ok(err.recovery)
    assert.match(err.recovery, /--no-interactive/)
  })

  it('preserves context fields', () => {
    const err = new CCIPInteractiveRequiredError('Multiple messages', {
      context: { count: 3, logIndices: [0, 1, 2], messageIds: ['a', 'b', 'c'] },
    })
    assert.equal(err.context.count, 3)
    assert.deepEqual(err.context.logIndices, [0, 1, 2])
  })
})

describe('preprocessArgv TTY auto-detection', () => {
  it('--interactive flag is defined in globalOpts', async () => {
    // Verify the flag exists by importing globalOpts type
    // This is a compile-time check — if the type doesn't include interactive, TS fails
    const _check: GlobalOpts['interactive'] extends boolean | undefined ? true : never = true
    assert.ok(_check)
  })
})
