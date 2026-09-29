import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { zeroPadValue } from 'ethers'

// registers the EVM and Solana chain families; Sui is deliberately left unloaded
import '../evm/index.ts'
import '../solana/index.ts'
import { CCTParamsInvalidError } from './errors.ts'
import { parseRemoteAddress, parseUniqueRemoteAddresses } from './remote-address.ts'

const EVM_SELECTOR = 5009297550715157269n // ethereum-mainnet
const SOLANA_SELECTOR = 16423721717087811551n // solana-devnet
const SUI_SELECTOR = 9762610643973837292n // sui-testnet
const UNKNOWN_SELECTOR = 2n ** 63n // neither a selector nor a chain ID

const EVM_ADDRESS = '0x1234567890AbcdEF1234567890aBcdef12345678'
/** One Solana key, as base58 and as its 32 raw bytes. */
const SOLANA_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SOLANA_ADDRESS_HEX = '0x6752055c20b3e9d8746656ddf73855507f87ab6d87523e4c76a7fa36096a99eb'

const parse = (value: unknown, selector: bigint) =>
  parseRemoteAddress('op', 'remotePoolAddress', value, selector)

function rejects(value: unknown, selector: bigint, reason: RegExp) {
  assert.throws(
    () => parse(value, selector),
    (err: unknown) =>
      err instanceof CCTParamsInvalidError &&
      err.context.operation === 'op' &&
      err.context.param === 'remotePoolAddress' &&
      reason.test(String(err.context.reason)),
  )
}

describe('parseRemoteAddress (cct)', () => {
  describe('EVM remote', () => {
    for (const [label, value] of [
      ['checksummed', EVM_ADDRESS],
      ['lower-case', EVM_ADDRESS.toLowerCase()],
      ['unprefixed', EVM_ADDRESS.slice(2)],
      ['left-padded to 32 bytes', zeroPadValue(EVM_ADDRESS, 32)],
    ] as const) {
      it(`parses the ${label} form to the checksummed address`, () => {
        assert.equal(parse(value, EVM_SELECTOR), EVM_ADDRESS)
      })
    }

    it('rejects 32 bytes whose padding is not zero', () => {
      rejects('0x' + '11'.repeat(12) + EVM_ADDRESS.slice(2), EVM_SELECTOR, /valid EVM address/)
    })

    it('rejects a Solana address', () => {
      rejects(SOLANA_ADDRESS, EVM_SELECTOR, /valid EVM address/)
    })
  })

  describe('Solana remote', () => {
    it('parses base58 as-is', () => {
      assert.equal(parse(SOLANA_ADDRESS, SOLANA_SELECTOR), SOLANA_ADDRESS)
    })

    it('parses the same key as 32-byte hex to base58', () => {
      assert.equal(parse(SOLANA_ADDRESS_HEX, SOLANA_SELECTOR), SOLANA_ADDRESS)
    })

    it('rejects a 20-byte EVM address', () => {
      rejects(EVM_ADDRESS, SOLANA_SELECTOR, /valid SVM address/)
    })
  })

  describe('rejects', () => {
    for (const value of ['0x', '0x00', '0x' + '00'.repeat(32)]) {
      it(`the zero address, spelled ${value}`, () => {
        rejects(value, EVM_SELECTOR, /zero address/)
      })
    }

    it('the all-zero Solana key', () => {
      rejects('11111111111111111111111111111111', SOLANA_SELECTOR, /zero address/)
    })

    for (const value of ['', 42, null, undefined]) {
      it(`a non-string or empty value (${String(value)})`, () => {
        rejects(value, EVM_SELECTOR, /must be a non-empty EVM address string/)
      })
    }

    it('a selector the SDK does not know, naming the upgrade', () => {
      rejects(EVM_ADDRESS, UNKNOWN_SELECTOR, /not a known chain selector.*upgrade the SDK/)
    })

    it('a chain ID in place of the selector, though networkInfo resolves it', () => {
      rejects(EVM_ADDRESS, 1n, /not a known chain selector.*not a chain ID/)
    })

    it('a family that is not registered, rather than falling back to raw bytes', () => {
      rejects('0x' + 'cd'.repeat(32), SUI_SELECTOR, /SUI chain family is not registered/)
    })
  })
})

describe('parseUniqueRemoteAddresses (cct)', () => {
  it('returns canonical addresses in input order, with indexed param paths', () => {
    const other = '0x' + '99'.repeat(20)
    assert.deepEqual(
      parseUniqueRemoteAddresses('op', 'pools', [other, EVM_ADDRESS.toLowerCase()], EVM_SELECTOR),
      [other, EVM_ADDRESS],
    )
    assert.throws(
      () => parseUniqueRemoteAddresses('op', 'pools', [EVM_ADDRESS, 'nope'], EVM_SELECTOR),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'pools[1]',
    )
  })

  it('rejects a hole in a sparse array', () => {
    assert.throws(
      // oxlint-disable-next-line no-sparse-arrays
      () => parseUniqueRemoteAddresses('op', 'pools', [, EVM_ADDRESS], EVM_SELECTOR),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'pools[0]',
    )
  })

  it('rejects two spellings of one address as duplicates', () => {
    assert.throws(
      () =>
        parseUniqueRemoteAddresses(
          'op',
          'pools',
          [SOLANA_ADDRESS, SOLANA_ADDRESS_HEX],
          SOLANA_SELECTOR,
        ),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.param === 'pools[1]' &&
        /duplicate/.test(String(err.context.reason)),
    )
    assert.throws(
      () =>
        parseUniqueRemoteAddresses(
          'op',
          'pools',
          [EVM_ADDRESS.toLowerCase(), zeroPadValue(EVM_ADDRESS, 32)],
          EVM_SELECTOR,
        ),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'pools[1]',
    )
  })
})
