import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { receiverFinalityMatches } from './receiver-finality.ts'

const WAIT_FOR_FINALITY = { tag: 'WaitForFinality', value: {} } as const
const WAIT_FOR_SAFE = { tag: 'WaitForSafe', value: {} } as const
const BLOCK_DEPTH_5 = { tag: 'BlockDepth', value: '5' } as const

describe('receiverFinalityMatches', () => {
  it('matches each receiver only with its own finality', () => {
    assert.equal(receiverFinalityMatches(WAIT_FOR_FINALITY, 'finalized'), true)
    assert.equal(receiverFinalityMatches(WAIT_FOR_SAFE, 'safe'), true)
    assert.equal(receiverFinalityMatches(BLOCK_DEPTH_5, 5), true)
  })

  it('does not match a safe receiver for other finalities', () => {
    assert.equal(receiverFinalityMatches(WAIT_FOR_SAFE, 'finalized'), false)
    assert.equal(receiverFinalityMatches(WAIT_FOR_SAFE, 5), false)
  })

  it('does not match other receivers for a safe message', () => {
    assert.equal(receiverFinalityMatches(WAIT_FOR_FINALITY, 'safe'), false)
    assert.equal(receiverFinalityMatches(BLOCK_DEPTH_5, 'safe'), false)
  })

  it('does not match a block depth receiver for another depth', () => {
    assert.equal(receiverFinalityMatches(BLOCK_DEPTH_5, 1), false)
  })
})
