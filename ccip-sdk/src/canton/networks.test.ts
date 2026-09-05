/**
 * Unit tests for the per-network well-known CCIP contract registry
 * ({@link CANTON_NETWORKS} / {@link getCantonNetworkConfig}).
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CANTON_NETWORKS, getCantonNetworkConfig } from './networks.ts'

const RAW_ADDRESS = /^[^@]+@[^@]+::1220[0-9a-f]{64}$/
const PARTY_ID = /^[^@]+::1220[0-9a-f]{64}$/

describe('getCantonNetworkConfig', () => {
  it('returns the registered config for canton:TestNet', () => {
    const config = getCantonNetworkConfig('canton:TestNet')
    assert.ok(config)
    assert.match(config.ccipOwner, PARTY_ID)
    assert.equal(typeof config.tokenAdminRegistry, 'string')
    assert.equal(typeof config.feeQuoter, 'string')
    assert.equal(typeof config.rmnRemote, 'string')
    assert.equal(typeof config.ledgerUrl, 'string')
  })

  it('returns undefined for networks without a registered deployment', () => {
    assert.equal(getCantonNetworkConfig('canton:LocalNet'), undefined)
    assert.equal(getCantonNetworkConfig('canton:DevNet'), undefined)
    assert.equal(getCantonNetworkConfig('canton:MainNet'), undefined)
    assert.equal(getCantonNetworkConfig('canton:Nowhere'), undefined)
  })

  it('stores raw instance addresses (instanceId@party::1220<fingerprint>), not hashed 0x forms', () => {
    for (const [chainId, config] of Object.entries(CANTON_NETWORKS)) {
      for (const field of ['tokenAdminRegistry', 'feeQuoter', 'rmnRemote'] as const) {
        assert.match(config[field], RAW_ADDRESS, `${chainId}.${field}: ${config[field]}`)
      }
    }
  })
})
