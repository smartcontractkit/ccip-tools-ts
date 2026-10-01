/**
 * Tests for the shared token-pool helpers (remote-address parsing/encoding,
 * pool-type resolution from template IDs).
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// registers the EVM, Solana and TON chain families the remote addresses are parsed as
import '../../../evm/index.ts'
import '../../../solana/index.ts'
import '../../../ton/index.ts'
import { CCTParamsInvalidError } from '../../errors.ts'
import {
  BURN_MINT_POOL_TEMPLATE_ID,
  LOCK_RELEASE_POOL_TEMPLATE_ID,
  RATE_LIMITER_TEMPLATE_ID,
  normalizeRemoteAddress,
  parseLaneRemoteAddresses,
  poolTypeOfTemplateId,
} from './shared.ts'

const EVM_SELECTOR = 16015286601757825753n // ethereum-testnet-sepolia
const SOLANA_SELECTOR = 16423721717087811551n // solana-devnet
const TON_SELECTOR = 1399300952838017768n // ton-testnet

const EVM_ADDRESS = '0x36e518336a67177cb102726c2dfa3d29b12f4c7b'
const EVM_STORED = '00000000000000000000000036e518336a67177cb102726c2dfa3d29b12f4c7b'
/** One Solana key, as base58 and as its 32 raw bytes. */
const SOLANA_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SOLANA_STORED = '6752055c20b3e9d8746656ddf73855507f87ab6d87523e4c76a7fa36096a99eb'

/** Asserts `fn` throws a {@link CCTParamsInvalidError} blaming `param`, with a reason matching `reason`. */
function throwsParam(fn: () => unknown, param: string, reason: RegExp) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof CCTParamsInvalidError)
    assert.equal(err.context.param, param)
    assert.match(String(err.context.reason), reason)
    return true
  })
}

describe('normalizeRemoteAddress', () => {
  describe('EVM remote: left-pads the 20 bytes to 32, as bare lower-case hex', () => {
    for (const [label, value] of [
      ['0x-prefixed', EVM_ADDRESS],
      ['unprefixed', EVM_ADDRESS.slice(2)],
      ['upper-case', '0x' + EVM_ADDRESS.slice(2).toUpperCase()],
      ['already left-padded to 32 bytes', '0x' + EVM_STORED],
      ['stored (bare padded hex)', EVM_STORED],
    ] as const) {
      it(`accepts the ${label} form`, () => {
        assert.equal(normalizeRemoteAddress(value, EVM_SELECTOR), EVM_STORED)
      })
    }
  })

  describe('Solana remote: the 32 key bytes as bare hex', () => {
    for (const [label, value] of [
      ['base58', SOLANA_ADDRESS],
      ['0x-prefixed hex', '0x' + SOLANA_STORED],
      ['stored (bare padded hex)', SOLANA_STORED],
    ] as const) {
      it(`accepts the ${label} form`, () => {
        assert.equal(normalizeRemoteAddress(value, SOLANA_SELECTOR), SOLANA_STORED)
      })
    }
  })

  it('rejects an address that is not of the remote family', () => {
    throwsParam(
      () => normalizeRemoteAddress(SOLANA_ADDRESS, EVM_SELECTOR),
      'address',
      /valid EVM address/,
    )
    throwsParam(
      () => normalizeRemoteAddress(EVM_ADDRESS, SOLANA_SELECTOR),
      'address',
      /valid SVM address/,
    )
  })

  it('rejects 32 bytes whose EVM padding is not zero', () => {
    throwsParam(
      () => normalizeRemoteAddress('0x' + '11'.repeat(12) + EVM_ADDRESS.slice(2), EVM_SELECTOR),
      'address',
      /valid EVM address/,
    )
  })

  it('rejects the zero address', () => {
    throwsParam(
      () => normalizeRemoteAddress('0x' + '00'.repeat(20), EVM_SELECTOR),
      'address',
      /zero/,
    )
  })

  it('rejects an unknown remote chain selector', () => {
    throwsParam(
      () => normalizeRemoteAddress(EVM_ADDRESS, 2n ** 63n),
      'address',
      /not a known chain selector/,
    )
  })

  it('rejects an address over the 32 bytes a pool stores', () => {
    // TON's CCIP address form is 36 bytes (4-byte workchain + 32-byte hash)
    throwsParam(
      () => normalizeRemoteAddress('0:' + 'ab'.repeat(32), TON_SELECTOR),
      'address',
      /36 bytes/,
    )
  })
})

describe('parseLaneRemoteAddresses', () => {
  const lane = (
    remotePools: unknown[],
    remoteTokenAddress: unknown,
    remoteChainSelector = EVM_SELECTOR,
  ) =>
    ({ remoteChainSelector, remotePools, remoteTokenAddress }) as {
      remoteChainSelector: bigint
      remotePools: string[]
      remoteTokenAddress: string
    }

  it('canonicalizes the token and every pool, keeping other lane fields', () => {
    const parsed = parseLaneRemoteAddresses('op', 'chainsToAdd[0]', {
      ...lane([SOLANA_STORED], '0x' + SOLANA_STORED, SOLANA_SELECTOR),
      extra: 1,
    })
    assert.deepEqual(parsed, {
      remoteChainSelector: SOLANA_SELECTOR,
      remotePools: [SOLANA_ADDRESS],
      remoteTokenAddress: SOLANA_ADDRESS,
      extra: 1,
    })
  })

  it('blames the offending pool by index', () => {
    throwsParam(
      () =>
        parseLaneRemoteAddresses(
          'op',
          'chainsToAdd[1]',
          lane([EVM_ADDRESS, 'not-an-address'], EVM_ADDRESS),
        ),
      'chainsToAdd[1].remotePools[1]',
      /valid EVM address/,
    )
  })

  it('blames an invalid token address', () => {
    throwsParam(
      () => parseLaneRemoteAddresses('op', 'lanes[0]', lane([EVM_ADDRESS], SOLANA_ADDRESS)),
      'lanes[0].remoteTokenAddress',
      /valid EVM address/,
    )
  })

  it('rejects two spellings of one pool as duplicates', () => {
    throwsParam(
      () =>
        parseLaneRemoteAddresses(
          'op',
          'chainsToAdd[0]',
          lane([EVM_ADDRESS, EVM_ADDRESS.toUpperCase().replace('0X', '0x')], EVM_ADDRESS),
        ),
      'chainsToAdd[0].remotePools[1]',
      /duplicate/,
    )
  })

  it('rejects a non-array remotePools', () => {
    throwsParam(
      () =>
        parseLaneRemoteAddresses('op', 'chainsToAdd[0]', {
          ...lane([], EVM_ADDRESS),
          remotePools: EVM_ADDRESS as unknown as string[],
        }),
      'chainsToAdd[0].remotePools',
      /array/,
    )
  })
})

describe('poolTypeOfTemplateId', () => {
  it('resolves the symbolic template IDs', () => {
    assert.equal(poolTypeOfTemplateId(BURN_MINT_POOL_TEMPLATE_ID), 'burnMint')
    assert.equal(poolTypeOfTemplateId(LOCK_RELEASE_POOL_TEMPLATE_ID), 'lockRelease')
  })

  it('resolves the concrete package-ID form the ACS returns', () => {
    assert.equal(
      poolTypeOfTemplateId('deadbeef:CCIP.Registry.BurnMintTokenPoolV2:BurnMintTokenPool'),
      'burnMint',
    )
    assert.equal(
      poolTypeOfTemplateId('cafebabe:CCIP.Registry.LockReleaseTokenPoolV2:LockReleaseTokenPool'),
      'lockRelease',
    )
  })

  it('returns undefined for other templates, including the pre-registry pool family', () => {
    assert.equal(poolTypeOfTemplateId(RATE_LIMITER_TEMPLATE_ID), undefined)
    assert.equal(poolTypeOfTemplateId('pkg:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool'), undefined)
  })
})
