import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { id as keccak256Utf8 } from 'ethers'

import {
  ccvAddressesMatch,
  damlRequiredCcvsList,
  decodeCantonVerifierDestAddress,
  missingTokenPoolRequiredCcvs,
  normalizeCantonCcvList,
  receiverRequiredCcvConfigured,
  receiverRequiresConfiguredCcvs,
  resolveEdsCcvAddress,
  resolveExecuteCcvAddress,
  resolveSenderRequiredCcvs,
} from './ccv-addresses.ts'

const EXECUTE_CCV_RAW =
  'committeeverifier-tqkny@ccvOwner::1220e382f4e57b0815e6be737006e381e6b7de448e06bd033ece6df498017879f551'
const EXECUTE_CCV_HEX = keccak256Utf8(EXECUTE_CCV_RAW)

describe('canton/ccv-addresses', () => {
  it('normalizeCantonCcvList trims and drops empty entries', () => {
    assert.deepEqual(normalizeCantonCcvList([' 0xabc ', '', '0xdef']), ['0xabc', '0xdef'])
  })

  it('ccvAddressesMatch links raw unpack form to hashed InstanceAddress', () => {
    assert.equal(ccvAddressesMatch(EXECUTE_CCV_RAW, EXECUTE_CCV_HEX), true)
  })

  it('receiverRequiresConfiguredCcvs matches when any configured CCV overlaps', () => {
    assert.equal(receiverRequiresConfiguredCcvs([EXECUTE_CCV_RAW], [EXECUTE_CCV_HEX]), true)
    assert.equal(
      receiverRequiresConfiguredCcvs(
        [EXECUTE_CCV_RAW],
        ['0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'],
      ),
      false,
    )
  })

  it('resolveEdsCcvAddress keeps indexer dest when it matches configured ccvs', () => {
    assert.equal(resolveEdsCcvAddress(EXECUTE_CCV_HEX, [EXECUTE_CCV_HEX]), EXECUTE_CCV_HEX)
  })

  it('resolveEdsCcvAddress falls back to first configured CCV when indexer dest differs', () => {
    assert.equal(
      resolveEdsCcvAddress('committeeverifier-tqkny@ccvOwner::1220e382…', [EXECUTE_CCV_HEX]),
      EXECUTE_CCV_HEX,
    )
  })

  it('missingTokenPoolRequiredCcvs accepts configured execute CCV for token pool requirement', () => {
    const sepoliaResolver = '0x8f3ee3c77D2B27c32306a89D367654F959Db223D'
    assert.deepEqual(
      missingTokenPoolRequiredCcvs([EXECUTE_CCV_RAW], [sepoliaResolver], [EXECUTE_CCV_HEX]),
      [],
    )
  })

  it('missingTokenPoolRequiredCcvs reports uncovered required CCVs', () => {
    assert.deepEqual(
      missingTokenPoolRequiredCcvs(
        [EXECUTE_CCV_RAW],
        ['0x8f3ee3c77D2B27c32306a89D367654F959Db223D'],
        [],
      ),
      [EXECUTE_CCV_RAW],
    )
  })

  it('resolveSenderRequiredCcvs prefers explicit CLI ccvRawAddresses', () => {
    const cli = ['0xcli']
    assert.deepEqual(resolveSenderRequiredCcvs(cli, [EXECUTE_CCV_HEX]), cli)
  })

  it('resolveSenderRequiredCcvs falls back to configured ccvs when CLI omits ccvRawAddresses', () => {
    assert.deepEqual(resolveSenderRequiredCcvs(undefined, [EXECUTE_CCV_HEX]), [EXECUTE_CCV_HEX])
  })

  it('resolveSenderRequiredCcvs honors explicit empty CLI ccvRawAddresses', () => {
    assert.deepEqual(resolveSenderRequiredCcvs([], [EXECUTE_CCV_HEX]), [])
  })

  it('decodeCantonVerifierDestAddress decodes hex-encoded indexer dest addresses', () => {
    const hexEncoded = Buffer.from(EXECUTE_CCV_RAW, 'utf8').toString('hex')
    assert.equal(decodeCantonVerifierDestAddress(`0x${hexEncoded}`), EXECUTE_CCV_RAW)
    assert.equal(decodeCantonVerifierDestAddress(EXECUTE_CCV_RAW), EXECUTE_CCV_RAW)
  })

  it('resolveExecuteCcvAddress hashes raw unpack to InstanceAddress hex', () => {
    assert.equal(resolveExecuteCcvAddress(EXECUTE_CCV_RAW), EXECUTE_CCV_HEX)
    const hexEncoded = Buffer.from(EXECUTE_CCV_RAW, 'utf8').toString('hex')
    assert.equal(resolveExecuteCcvAddress(`0x${hexEncoded}`), EXECUTE_CCV_HEX)
  })

  it('resolveExecuteCcvAddress does not apply canton-config ccvs override', () => {
    const hexEncoded = Buffer.from(EXECUTE_CCV_RAW, 'utf8').toString('hex')
    assert.notEqual(
      resolveExecuteCcvAddress(`0x${hexEncoded}`),
      resolveEdsCcvAddress(`0x${hexEncoded}`, [
        '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      ]),
    )
  })

  it('receiverRequiredCcvConfigured matches raw unpack on receiver', () => {
    assert.equal(receiverRequiredCcvConfigured([EXECUTE_CCV_RAW], EXECUTE_CCV_RAW), true)
    assert.equal(receiverRequiredCcvConfigured([], EXECUTE_CCV_RAW), false)
  })

  it('damlRequiredCcvsList decodes hex-encoded attestation addresses', () => {
    const hexEncoded = Buffer.from(EXECUTE_CCV_RAW, 'utf8').toString('hex')
    assert.deepEqual(damlRequiredCcvsList([`0x${hexEncoded}`]), [{ unpack: EXECUTE_CCV_RAW }])
  })
})
