import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getAddress } from 'ethers'

import '../index.ts' // register the chain families of decodeAddress
import type { GenericExtraArgsV3 } from '../extra-args.ts'
import { ChainFamily } from '../networks.ts'
import { decodeExtraArgsV3, encodeExtraArgsV3 } from './extra-args-v3.ts'

const empty: GenericExtraArgsV3 = {
  gasLimit: 200_000n,
  finality: 'finalized',
  ccvs: [],
  ccvArgs: [],
  executor: '',
  executorArgs: '0x',
  tokenReceiver: '',
  tokenArgs: '0x',
}

// canonical EVM test vector: gasLimit=200000, finality=12, 2 CCVs, executor, tokenReceiver, tokenArgs
const evmVector =
  '0xa69dd4aa00030d400000000c021497cb3391ea73689a81b6853deb104dd078538f6b0005617267733114a0b7e3c01fcd94560317638a6b01f81846dee14400056172677332149fca2fa95be0944a4ad731474dd3cdb1b704f9c60008657865634172677314c9f66ef22b2e26c2af10fcf8847ac4a920ab3eaa0009746f6b656e41726773'

describe('GenericExtraArgsV3 codec', () => {
  it('should round-trip the canonical EVM vector', () => {
    const decoded = decodeExtraArgsV3(evmVector, ChainFamily.EVM)
    assert.equal(decoded?.ccvs.length, 2)
    assert.equal(decoded.executor, getAddress('0x9fca2fa95be0944a4ad731474dd3cdb1b704f9c6'))
    assert.equal(decoded.tokenReceiver, getAddress('0xc9f66ef22b2e26c2af10fcf8847ac4a920ab3eaa'))
    assert.equal(encodeExtraArgsV3(decoded, ChainFamily.EVM), evmVector)
  })

  it('should round-trip Aptos 32-byte addresses and left-pad a shorter executor', () => {
    const args: GenericExtraArgsV3 = {
      ...empty,
      ccvs: ['0xc7e784eb798e4d5612700e967d8ad4d8ac5c7ec561278db54ae9925ad89cce6d', ''],
      ccvArgs: ['0x01', '0x'],
      executor: '0x97cb3391ea73689a81b6853deb104dd078538f6b',
      tokenReceiver: '0x1b03FB65877cdb7dAbdB73e72B11Ba1651aC7548',
      tokenArgs: '0x99',
    }
    const encoded = encodeExtraArgsV3(args, ChainFamily.Aptos)
    // executor: length 32, then 12 zero bytes and the 20-byte address
    assert.ok(encoded.includes(`20${'00'.repeat(12)}97cb3391ea73689a81b6853deb104dd078538f6b`))
    assert.deepEqual(decodeExtraArgsV3(encoded, ChainFamily.Aptos), {
      ...args,
      _tag: 'GenericExtraArgsV3',
    })
    // a 32-byte address does not decode as EVM
    assert.equal(decodeExtraArgsV3(encoded, ChainFamily.EVM), undefined)
  })

  it('should encode empty addresses with length 0', () => {
    const args = { ...empty, ccvs: ['', '0x'], ccvArgs: [], executor: '0x' }
    const encoded = encodeExtraArgsV3(args, ChainFamily.Aptos)
    assert.equal(encoded, '0xa69dd4aa00030d400000000002000000000000000000000000')
    assert.deepEqual(decodeExtraArgsV3(encoded, ChainFamily.Aptos)?.ccvs, ['', ''])
  })

  it('should return undefined for another tag or truncated data, and ignore trailing bytes', () => {
    const encoded = encodeExtraArgsV3(empty, ChainFamily.Aptos)
    assert.equal(decodeExtraArgsV3('0x181dcf10' + encoded.slice(10), ChainFamily.Aptos), undefined)
    assert.equal(decodeExtraArgsV3(encoded.slice(0, -2), ChainFamily.Aptos), undefined)
    assert.equal(decodeExtraArgsV3(encoded + 'ff', ChainFamily.Aptos)?.gasLimit, 200_000n)
  })

  it('should throw for a field that does not fit its length prefix', () => {
    const ccvs = Array<string>(256).fill('')
    assert.throws(() => encodeExtraArgsV3({ ...empty, ccvs }, ChainFamily.EVM), {
      code: 'NUMERIC_FAULT',
    })
    const tokenArgs = '0x' + '00'.repeat(65536)
    assert.throws(() => encodeExtraArgsV3({ ...empty, tokenArgs }, ChainFamily.Aptos), {
      code: 'NUMERIC_FAULT',
    })
  })
})
