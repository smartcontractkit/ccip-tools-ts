import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_CANTON_SEND_GAS_LIMIT,
  formatCantonLinkFeeToken,
  resolveCantonSendGasLimit,
} from './defaults.ts'

describe('canton defaults resolvers', () => {
  it('resolveCantonSendGasLimit prefers explicit extraArgs', () => {
    assert.equal(resolveCantonSendGasLimit(99n, false), 99n)
  })

  it('resolveCantonSendGasLimit uses 0 for token-only sends', () => {
    assert.equal(resolveCantonSendGasLimit(undefined, true), 0n)
  })

  it('resolveCantonSendGasLimit reads canton-config defaultSendGasLimit', () => {
    assert.equal(
      resolveCantonSendGasLimit(undefined, false, { defaultSendGasLimit: 75_000 }),
      75_000n,
    )
  })

  it('resolveCantonSendGasLimit falls back to SDK default', () => {
    assert.equal(resolveCantonSendGasLimit(undefined, false), DEFAULT_CANTON_SEND_GAS_LIMIT)
  })

  it('formatCantonLinkFeeToken builds link-token@ccipParty', () => {
    const ccipParty =
      'ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551'
    assert.equal(formatCantonLinkFeeToken(ccipParty), `link-token@${ccipParty}`)
  })
})
