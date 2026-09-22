import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hexlify } from 'ethers'

import { CCIPError } from '../errors/index.ts'
import {
  INSTANCE_ADDRESS_LENGTH,
  InstanceAddress,
  RawInstanceAddress,
  addressesContains,
  addressesMatch,
  addressesMissing,
  parseInstanceAddress,
} from './addressCodec.ts'

const RAW = new RawInstanceAddress('myinstance', 'party')
const RAW_HEX = '0x1de8dc5eac0fc0963920530b6ada91adc253413ea1d55c2e32fa5f14fe16bef9'
const ZERO = new InstanceAddress(new Uint8Array(INSTANCE_ADDRESS_LENGTH))

describe('RawInstanceAddress', () => {
  it('joins instanceId and owner with @', () => {
    assert.equal(RAW.toString(), 'myinstance@party')
    assert.equal(String(RAW), 'myinstance@party')
    assert.equal(JSON.stringify(RAW), '"myinstance@party"')
  })

  it('exposes the parts', () => {
    assert.equal(RAW.instanceId, 'myinstance')
    assert.equal(RAW.owner, 'party')
  })

  it('parses valid addresses', () => {
    const parsed = RawInstanceAddress.fromString('myinstance@party')
    assert.equal(parsed.toString(), 'myinstance@party')
    assert.equal(parsed.instanceId, 'myinstance')
    assert.equal(parsed.owner, 'party')
  })

  it('rejects addresses with no or multiple @', () => {
    for (const invalid of ['noseparator', 'a@b@c']) {
      assert.throws(() => RawInstanceAddress.fromString(invalid), CCIPError)
    }
  })

  it('rejects empty parts', () => {
    for (const invalid of ['@owner', 'instance@', '']) {
      assert.throws(() => RawInstanceAddress.fromString(invalid), CCIPError)
      assert.throws(
        () => new RawInstanceAddress(invalid.split('@')[0] ?? '', invalid.split('@')[1] ?? ''),
        CCIPError,
      )
    }
  })

  it('returns the Daml unpack binding', () => {
    assert.deepEqual(RAW.binding(), { unpack: 'myinstance@party' })
  })
})

describe('RawInstanceAddress.fromHex', () => {
  const EXAMPLE_HEX =
    '0x636f6d6d697474656576657269666965722d766e6d6b64406363764f776e65723a3a3132323039366163636630613834666337643830643566636535656133313335333137613033656232326536326530643863646437353438383635663938346631316666'
  const EXAMPLE =
    'committeeverifier-vnmkd@ccvOwner::122096accf0a84fc7d80d5fce5ea3135317a03eb22e62e0d8cdd7548865f984f11ff'

  it('decodes UTF-8 hex to the raw address', () => {
    const parsed = RawInstanceAddress.fromHex(EXAMPLE_HEX)
    assert.equal(parsed.toString(), EXAMPLE)
    assert.equal(parsed.instanceId, 'committeeverifier-vnmkd')
    assert.equal(
      parsed.owner,
      'ccvOwner::122096accf0a84fc7d80d5fce5ea3135317a03eb22e62e0d8cdd7548865f984f11ff',
    )
  })

  it('round-trips a string through hex and back', () => {
    const hex = hexlify(new TextEncoder().encode('myinstance@party'))
    assert.equal(RawInstanceAddress.fromHex(hex).toString(), 'myinstance@party')
  })

  it('rejects invalid hex and invalid addresses', () => {
    for (const invalid of ['0xzz', '0x123', 'not hex']) {
      assert.throws(() => RawInstanceAddress.fromHex(invalid), CCIPError)
    }
    // valid UTF-8 hex, but no "@" in the decoded string
    assert.throws(() => RawInstanceAddress.fromHex('0x6e6f736570617261746f72'), CCIPError)
  })
})

describe('parseInstanceAddress', () => {
  const EXAMPLE_HEX =
    '0x636f6d6d697474656576657269666965722d766e6d6b64406363764f776e65723a3a3132323039366163636630613834666337643830643566636535656133313335333137613033656232326536326530643863646437353438383635663938346631316666'
  const EXAMPLE =
    'committeeverifier-vnmkd@ccvOwner::122096accf0a84fc7d80d5fce5ea3135317a03eb22e62e0d8cdd7548865f984f11ff'

  it('parses raw addresses', () => {
    const parsed = parseInstanceAddress('myinstance@party')
    assert.ok(parsed instanceof RawInstanceAddress)
    assert.equal(parsed.toString(), 'myinstance@party')
  })

  it('parses hex-encoded raw addresses', () => {
    const parsed = parseInstanceAddress(EXAMPLE_HEX)
    assert.ok(parsed instanceof RawInstanceAddress)
    assert.equal(parsed.toString(), EXAMPLE)
  })

  it('parses plain hex as a 32-byte InstanceAddress', () => {
    for (const hex of [RAW_HEX, RAW_HEX.slice(2)]) {
      const parsed = parseInstanceAddress(hex)
      assert.ok(parsed instanceof InstanceAddress)
      assert.equal(parsed.hex(), RAW_HEX)
    }
  })

  it('rejects invalid input', () => {
    for (const invalid of ['', 'no separator', '0xzz', '123']) {
      assert.throws(() => parseInstanceAddress(invalid), CCIPError)
    }
  })
})

describe('RawInstanceAddress.toInstanceAddress', () => {
  it('hashes the raw string with keccak256', () => {
    assert.equal(RAW.toInstanceAddress().hex(), RAW_HEX)
  })

  it('hashes another raw string consistently', () => {
    assert.equal(
      RawInstanceAddress.fromString('test@alice').toInstanceAddress().hex(),
      '0x84cd68a6fe04112b5a8921090b5c4c397d7c79ff67f8bda8113c44c7c8e78e93',
    )
  })
})

describe('InstanceAddress', () => {
  it('accepts exactly 32 bytes', () => {
    const addr = new InstanceAddress(new Uint8Array(32).fill(0xaa))
    assert.equal(addr.hex(), `0x${'aa'.repeat(32)}`)
  })

  it('rejects wrong byte lengths', () => {
    for (const length of [0, 20, 31, 33]) {
      assert.throws(() => new InstanceAddress(new Uint8Array(length)), CCIPError)
    }
  })

  it('does not expose the constructor argument bytes', () => {
    const bytes = new Uint8Array(32)
    const addr = new InstanceAddress(bytes)
    bytes.fill(0xff)
    assert.equal(addr.hex(), ZERO.hex())
  })
})

describe('InstanceAddress.fromBytes', () => {
  it('pads short inputs on the left with zeros', () => {
    assert.equal(InstanceAddress.fromBytes([0x12, 0x34]).hex(), `0x${'00'.repeat(30)}1234`)
  })

  it('round-trips bytes', () => {
    const addr = InstanceAddress.fromHex(RAW_HEX)
    assert.deepEqual(InstanceAddress.fromBytes(addr.bytes).hex(), RAW_HEX)
  })

  it('crops inputs longer than 32 bytes from the left', () => {
    const long = [...InstanceAddress.fromHex(RAW_HEX).bytes, 0xaa, 0xbb]
    assert.equal(InstanceAddress.fromBytes(long).hex(), `0x${RAW_HEX.slice(6)}aabb`)
  })
})

describe('InstanceAddress.fromHex', () => {
  it('accepts 0x-prefixed and bare hex', () => {
    assert.equal(InstanceAddress.fromHex(RAW_HEX).hex(), RAW_HEX)
    assert.equal(InstanceAddress.fromHex(RAW_HEX.slice(2)).hex(), RAW_HEX)
  })

  it('pads short hex on the left with zeros', () => {
    assert.equal(InstanceAddress.fromHex('0x1234').hex(), `0x${'00'.repeat(30)}1234`)
  })

  it('rejects invalid hex', () => {
    for (const invalid of ['', '0x', '0xzz', '123', `0x${'ab'.repeat(33)}`]) {
      assert.throws(() => InstanceAddress.fromHex(invalid), CCIPError)
    }
  })
})

describe('InstanceAddress.compare / equals', () => {
  const a = InstanceAddress.fromHex('0x1234')
  const b = InstanceAddress.fromHex('0x5678')

  it('orders addresses byte-wise', () => {
    assert.equal(a.compare(b), -1)
    assert.equal(b.compare(a), 1)
    assert.equal(a.compare(a), 0)
    assert.equal(a.compare(InstanceAddress.fromHex('0x1234')), 0)
  })

  it('compares equal values', () => {
    assert.equal(a.equals(b), false)
    assert.equal(a.equals(InstanceAddress.fromHex('0x1234')), true)
    assert.equal(ZERO.equals(InstanceAddress.fromHex('0x0000')), true)
  })
})

describe('addressesMatch / addressesContains / addressesMissing', () => {
  const A = new RawInstanceAddress('alpha', 'alice')
  const B = new RawInstanceAddress('beta', 'bob')
  const C = new RawInstanceAddress('gamma', 'carol')

  describe('addressesMatch', () => {
    it('returns true for equal lists in any order', () => {
      assert.equal(addressesMatch([A, B], [B, A]), true)
      assert.equal(addressesMatch([A], [A]), true)
    })

    it('uses set semantics, ignoring duplicates', () => {
      assert.equal(addressesMatch([A, A], [A]), true)
    })

    it('returns true for two empty lists', () => {
      assert.equal(addressesMatch([], []), true)
    })

    it('returns false when sizes differ', () => {
      assert.equal(addressesMatch([A], [A, B]), false)
      assert.equal(addressesMatch([A, B], [A]), false)
    })

    it('returns false for same-size lists with different addresses', () => {
      assert.equal(addressesMatch([A, B], [A, C]), false)
    })

    it('compares raw and hashed forms via their instance address', () => {
      assert.equal(addressesMatch([A], [A.toInstanceAddress()]), true)
      assert.equal(addressesMatch([A.toInstanceAddress()], [A]), true)
    })
  })

  describe('addressesContains', () => {
    it('returns true when want is a subset of got in any order', () => {
      assert.equal(addressesContains([A, B, C], [C, A]), true)
      assert.equal(addressesContains([A], [A]), true)
    })

    it('returns false when a wanted address is absent', () => {
      assert.equal(addressesContains([A, B], [A, C]), false)
      assert.equal(addressesContains([], [A]), false)
    })

    it('returns true for an empty want', () => {
      assert.equal(addressesContains([A], []), true)
    })

    it('treats raw addresses and their hashed forms as equal', () => {
      assert.equal(addressesContains([A.toInstanceAddress()], [A]), true)
      assert.equal(addressesContains([A], [B.toInstanceAddress()]), false)
    })
  })

  describe('addressesMissing', () => {
    it('returns the wanted addresses absent from got', () => {
      assert.deepEqual(addressesMissing([A], [A, B, C]), [B, C])
      assert.deepEqual(addressesMissing([], [A]), [A])
    })

    it('returns an empty array when everything is present', () => {
      assert.deepEqual(addressesMissing([A, B, C], [C, A]), [])
    })

    it('preserves the order and duplicates of want', () => {
      assert.deepEqual(addressesMissing([A], [C, B, C]), [C, B, C])
    })

    it('returns the original objects, comparing via instance address', () => {
      const missing = addressesMissing([A.toInstanceAddress()], [A, B])
      assert.deepEqual(missing, [B])
    })
  })
})
