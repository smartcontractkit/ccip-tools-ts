import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { dataLength } from 'ethers'

import { CCTParamsInvalidError } from '../../errors.ts'
import {
  buildPermissionedSalt,
  deriveEntropy,
  guardSalt,
  parseSalt,
  predictCreateXAddress,
} from './salt.ts'

const DEPLOYER = '0x1111111111111111111111111111111111111111'
const BASE_SEPOLIA = 84532n

const flagged = (flag: string, entropy: string) => DEPLOYER + flag + entropy.repeat(11)
const zeroSender = (flag: string, entropy: string) =>
  '0x' + '00'.repeat(20) + flag + entropy.repeat(11)

describe('parseSalt', () => {
  it('reads the four modes CreateX accepts', () => {
    assert.equal(parseSalt(flagged('00', '11'), DEPLOYER).kind, 'permissioned')
    assert.equal(parseSalt(flagged('01', '22'), DEPLOYER).kind, 'permissionedChainScoped')
    assert.equal(parseSalt(zeroSender('01', '33'), DEPLOYER).kind, 'chainScoped')
    assert.equal(
      parseSalt('0x' + 'ab'.repeat(20) + '00' + '44'.repeat(11), DEPLOYER).kind,
      'random',
    )
  })

  it('treats a salt permissioned to someone else as random, because that is what CreateX does', () => {
    // The sender bytes only mean "permissioned" when they match msg.sender. For anyone else the
    // salt is unguarded, which is exactly why a predicted address is deployer-specific.
    assert.equal(parseSalt(flagged('00', '11'), '0x' + '99'.repeat(20)).kind, 'random')
  })

  it('rejects the two shapes CreateX reverts InvalidSalt on', () => {
    assert.equal(parseSalt(flagged('02', '11'), DEPLOYER).kind, 'invalid')
    assert.equal(parseSalt(zeroSender('02', '11'), DEPLOYER).kind, 'invalid')
  })
})

describe('guardSalt', () => {
  // Cross-checked against the deployed CreateX on Base Sepolia by eth_call-ing deployCreate2 and
  // comparing the returned address; all four branches matched. These pin that result.
  it('matches the on-chain guard for a permissioned salt', () => {
    assert.equal(
      guardSalt(
        'test',
        buildPermissionedSalt('test', DEPLOYER, '0x' + '11'.repeat(11)),
        DEPLOYER,
        BASE_SEPOLIA,
      ),
      '0x9ad1e57f5fcded6b746760b70532640138875ea290ba207fc9099382eb05b469',
    )
  })

  it('produces a different guarded salt per chain only when the chain-scoped flag is set', () => {
    const permissioned = buildPermissionedSalt('test', DEPLOYER, '0x' + '11'.repeat(11))
    assert.equal(
      guardSalt('test', permissioned, DEPLOYER, 1n),
      guardSalt('test', permissioned, DEPLOYER, BASE_SEPOLIA),
    )
    const chainScoped = flagged('01', '22')
    assert.notEqual(
      guardSalt('test', chainScoped, DEPLOYER, 1n),
      guardSalt('test', chainScoped, DEPLOYER, BASE_SEPOLIA),
    )
  })

  it('rejects a salt that is not 32 bytes', () => {
    assert.throws(() => guardSalt('test', '0x1234', DEPLOYER, BASE_SEPOLIA), CCTParamsInvalidError)
  })

  it('rejects a salt CreateX would revert on', () => {
    assert.throws(
      () => guardSalt('test', flagged('02', '11'), DEPLOYER, BASE_SEPOLIA),
      CCTParamsInvalidError,
    )
  })
})

describe('buildPermissionedSalt', () => {
  it('lays out deployer(20) || 0x00 || entropy(11)', () => {
    const salt = buildPermissionedSalt('test', DEPLOYER, '0x' + '11'.repeat(11))
    assert.equal(salt, '0x1111111111111111111111111111111111111111001111111111111111111111')
    assert.equal(parseSalt(salt, DEPLOYER).kind, 'permissioned')
  })

  it('rejects entropy that is not 11 bytes', () => {
    assert.throws(() => buildPermissionedSalt('test', DEPLOYER, '0x1234'), CCTParamsInvalidError)
  })

  it('rejects malformed entropy as a CCT error, not a raw ethers one', () => {
    for (const bad of ['not-hex', '0xzz', '0x' + '1'.repeat(21), '']) {
      assert.throws(
        () => buildPermissionedSalt('test', DEPLOYER, bad),
        CCTParamsInvalidError,
        `entropy ${JSON.stringify(bad)}`,
      )
    }
  })
})

describe('predictCreateXAddress', () => {
  // The live cross-check against the deployed factory lives in createx.integration.test.ts.
  it('binds the address to the deployer, not just the salt', () => {
    const initCode = '0x60806040'
    const salt = buildPermissionedSalt('test', DEPLOYER, '0x' + '11'.repeat(11))
    const other = '0x' + '99'.repeat(20)
    assert.notEqual(
      predictCreateXAddress('test', { salt, initCode, deployer: DEPLOYER, chainId: BASE_SEPOLIA }),
      predictCreateXAddress('test', { salt, initCode, deployer: other, chainId: BASE_SEPOLIA }),
    )
  })

  it('is stable across chains for a permissioned salt', () => {
    const initCode = '0x60806040'
    const salt = buildPermissionedSalt('test', DEPLOYER, '0x' + '11'.repeat(11))
    assert.equal(
      predictCreateXAddress('test', { salt, initCode, deployer: DEPLOYER, chainId: 1n }),
      predictCreateXAddress('test', { salt, initCode, deployer: DEPLOYER, chainId: BASE_SEPOLIA }),
    )
  })
})

describe('deriveEntropy', () => {
  const parts = ['cct-sdk', 'BurnMintTokenPool', '2.0.0', '0xabc', '16015286601757825753']

  it('produces exactly the 11 bytes a salt needs', () => {
    const entropy = deriveEntropy(parts)
    assert.equal(dataLength(entropy), 11)
    assert.doesNotThrow(() => buildPermissionedSalt('test', DEPLOYER, entropy))
  })

  it('is deterministic, which is what makes an address reproducible across chains', () => {
    assert.equal(deriveEntropy(parts), deriveEntropy([...parts]))
  })

  it('separates parts so different inputs cannot collide by concatenation', () => {
    assert.notEqual(deriveEntropy(['ab', 'c']), deriveEntropy(['a', 'bc']))
  })
})
