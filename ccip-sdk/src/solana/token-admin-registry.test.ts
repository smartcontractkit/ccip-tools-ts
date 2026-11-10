import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

import { CCIPDataFormatUnsupportedError } from '../errors/index.ts'
import { decodeTokenAdminRegistryConfig } from './token-admin-registry.ts'

const key = (byte: number) => new PublicKey(Uint8Array.from({ length: 32 }, () => byte))
const ADMINISTRATOR = key(1)
const MINT = key(2)

/** TokenAdminRegistry account of schema `version`, with trailing bytes `tail`. */
function registryData(version: number, ...tail: number[]): Buffer {
  return Buffer.concat([
    BorshAccountsCoder.accountDiscriminator('TokenAdminRegistry'),
    Buffer.from([version]),
    ADMINISTRATOR.toBuffer(),
    PublicKey.default.toBuffer(), // pending_administrator
    PublicKey.default.toBuffer(), // lookup_table
    Buffer.alloc(32), // writable_indexes
    MINT.toBuffer(),
    Buffer.from(tail),
  ])
}

describe('decodeTokenAdminRegistryConfig', () => {
  it('decodes v1 accounts, which predate account resolution', () => {
    const config = decodeTokenAdminRegistryConfig(registryData(1))
    assert.ok(config.mint.equals(MINT))
    assert.ok(config.administrator.equals(ADMINISTRATOR))
    assert.equal(config.accountResolution, 'NoResolution')
    assert.equal(config.supportsAutoDerivation, false)
    assert.equal(config.interfaceVersion, 1)
  })

  it('decodes the supports_auto_derivation flag of v2 accounts', () => {
    for (const [flag, accountResolution] of [
      [0, 'NoResolution'],
      [1, 'Standard'],
    ] as const) {
      const config = decodeTokenAdminRegistryConfig(registryData(2, flag))
      assert.ok(config.mint.equals(MINT))
      assert.equal(config.accountResolution, accountResolution)
      assert.equal(config.supportsAutoDerivation, flag === 1)
      assert.equal(config.interfaceVersion, 1)
    }
  })

  it('decodes the account resolution and pool interface version of v3 accounts', () => {
    for (const [resolution, accountResolution, interfaceVersion] of [
      [0, 'NoResolution', 1],
      [1, 'Standard', 2],
      [2, 'WithoutExtendedLookupTable', 2],
    ] as const) {
      const config = decodeTokenAdminRegistryConfig(
        registryData(3, resolution, 254, interfaceVersion),
      )
      assert.ok(config.mint.equals(MINT))
      assert.equal(config.accountResolution, accountResolution)
      assert.equal(config.supportsAutoDerivation, resolution !== 0)
      assert.equal(config.interfaceVersion, interfaceVersion)
    }
  })

  it('decodes the account resolution flags and pool interface version of v4 accounts', () => {
    // [account_resolution_enabled, skip_lookup_table_additional_entries, interface version]
    for (const [enabled, skip, interfaceVersion, accountResolution] of [
      [0, 0, 1, 'NoResolution'],
      [0, 1, 2, 'NoResolution'], // the skip flag only applies with resolution enabled
      [1, 0, 2, 'Standard'],
      [1, 1, 2, 'WithoutExtendedLookupTable'],
    ] as const) {
      const config = decodeTokenAdminRegistryConfig(
        registryData(4, enabled, 254, interfaceVersion, skip),
      )
      assert.ok(config.mint.equals(MINT))
      assert.equal(config.accountResolution, accountResolution)
      assert.equal(config.supportsAutoDerivation, enabled === 1)
      assert.equal(config.interfaceVersion, interfaceVersion)
    }
  })

  it('rejects unknown account resolutions', () => {
    assert.throws(
      () => decodeTokenAdminRegistryConfig(registryData(3, 3, 254, 2)),
      CCIPDataFormatUnsupportedError,
    )
  })

  it('rejects short or non-TokenAdminRegistry accounts', () => {
    assert.throws(
      () => decodeTokenAdminRegistryConfig(registryData(1).subarray(0, 168)),
      CCIPDataFormatUnsupportedError,
    )
    const data = registryData(3, 1, 254, 2)
    BorshAccountsCoder.accountDiscriminator('ChainConfig').copy(data)
    assert.throws(() => decodeTokenAdminRegistryConfig(data), CCIPDataFormatUnsupportedError)
  })
})
