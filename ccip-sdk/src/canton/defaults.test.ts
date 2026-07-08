import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseCantonDecimalAmountUnits } from './amount.ts'
import {
  DEFAULT_CANTON_SEND_GAS_LIMIT,
  excludeHoldingCidForTokenTransfer,
  formatCantonLinkFeeToken,
  resolveCantonSendGasLimit,
  resolveFeeTransferFactoryAmount,
  resolveSenderInstanceId,
  selectFeeTokenHoldingCids,
  sumCantonHoldingAmounts,
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

  it('resolveFeeTransferFactoryAmount reads canton-config', () => {
    assert.equal(resolveFeeTransferFactoryAmount({ feeTransferFactoryAmount: '2.5' }), '2.5')
  })

  it('resolveSenderInstanceId reads canton-config', () => {
    assert.equal(
      resolveSenderInstanceId({ senderInstanceId: 'prod-ccipsender' }),
      'prod-ccipsender',
    )
  })

  it('formatCantonLinkFeeToken builds ccipParty::link-token', () => {
    const ccipParty =
      'ccipOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551'
    assert.equal(formatCantonLinkFeeToken(ccipParty), `${ccipParty}::link-token`)
  })

  it('selectFeeTokenHoldingCids prefers a single holding >= minAmount', () => {
    const holdings = [
      { contractId: 'a', amount: '0.001' },
      { contractId: 'b', amount: '1.5' },
    ]
    assert.deepEqual(selectFeeTokenHoldingCids(holdings, '1.0'), ['b'])
  })

  it('selectFeeTokenHoldingCids accumulates largest holdings until minAmount', () => {
    const holdings = [
      { contractId: 'a', amount: '0.001' },
      { contractId: 'b', amount: '0.999' },
      { contractId: 'c', amount: '0.998' },
      { contractId: 'd', amount: '0.001' },
    ]
    assert.deepEqual(selectFeeTokenHoldingCids(holdings, '1.0'), ['b', 'c'])
    assert.ok(sumCantonHoldingAmounts(holdings, ['c', 'b']) >= parseCantonDecimalAmountUnits('1.0'))
  })

  it('selectFeeTokenHoldingCids honors excludeContractIds', () => {
    const holdings = [
      { contractId: 'a', amount: '0.999' },
      { contractId: 'b', amount: '0.998' },
      { contractId: 'c', amount: '0.001' },
    ]
    assert.deepEqual(selectFeeTokenHoldingCids(holdings, '1.0', ['b']), ['a', 'c'])
  })

  it('excludeHoldingCidForTokenTransfer picks smallest sufficient holding', () => {
    const holdings = [
      { contractId: 'a', amount: '0.999' },
      { contractId: 'b', amount: '0.001' },
      { contractId: 'c', amount: '0.002' },
    ]
    assert.equal(excludeHoldingCidForTokenTransfer(holdings, '0.001'), 'b')
  })
})
