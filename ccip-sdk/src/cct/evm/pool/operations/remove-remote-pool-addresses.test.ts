import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, hexlify, zeroPadValue } from 'ethers'

import { RemoveRemotePoolAddresses } from './remove-remote-pool-addresses.ts'
import TokenPool_1_6_ABI from '../../../../evm/abi/LockReleaseTokenPool_1_6_1.ts'
import TokenPool_2_0_ABI from '../../../../evm/abi/TokenPool_2_0.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCIPVersion } from '../../../../types.ts'
import { getAddressBytes } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const POOL = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const SELECTOR = 16015286601757825753n
const REMOTE_EVM = '0xd7BF0e3D34B4C4F7d5F3C4C6B2A1e0f9c8b7a6D5'
const REMOTE_EVM_2 = '0xaabbccddeeff00112233445566778899aabbccdd'
// Solana pool address in base58 (non-EVM native format).
const REMOTE_SOL = 'GaM2p1FfyE8YkfB1D3aXHjTr5Z8mQ4wYbNkPcVjRs2A'

const encodeRemote = (a: string) => zeroPadValue(hexlify(getAddressBytes(a)), 32)

function stubChain(version: CCIPVersion = CCIPVersion.V1_6): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve(['LockReleaseTokenPool', version, '', undefined]),
  } as unknown as EVMChain
}

describe('EVM cct removeRemotePoolAddresses', () => {
  const op = new RemoveRemotePoolAddresses()

  it('encodes removeRemotePool — byte-identical to a direct ethers encode (v1.6)', async () => {
    const unsigned = await op.generate(stubChain(), {
      poolAddress: POOL,
      remoteChainSelector: SELECTOR,
      remotePoolAddresses: [REMOTE_EVM],
    })
    const expected = new Interface(TokenPool_1_6_ABI).encodeFunctionData('removeRemotePool', [
      SELECTOR,
      encodeRemote(REMOTE_EVM),
    ])
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions.length, 1)
    assert.equal(unsigned.transactions[0]!.to, POOL)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('emits one byte-identical tx per address (incl. array + non-EVM native format)', async () => {
    const addrs = [REMOTE_EVM, REMOTE_EVM_2, REMOTE_SOL]
    const unsigned = await op.generate(stubChain(), {
      poolAddress: POOL,
      remoteChainSelector: SELECTOR,
      remotePoolAddresses: addrs,
    })
    assert.equal(unsigned.transactions.length, addrs.length)
    for (let i = 0; i < addrs.length; i++) {
      const expected = new Interface(TokenPool_1_6_ABI).encodeFunctionData('removeRemotePool', [
        SELECTOR,
        encodeRemote(addrs[i]!),
      ])
      assert.equal(unsigned.transactions[i]!.to, POOL)
      assert.equal(unsigned.transactions[i]!.data, expected)
    }
  })

  it('uses the v2.0 interface for v2.0 pools (identical selector, byte-parity)', async () => {
    const unsigned = await op.generate(stubChain(CCIPVersion.V2_0), {
      poolAddress: POOL,
      remoteChainSelector: SELECTOR,
      remotePoolAddresses: [REMOTE_EVM],
    })
    const expected = new Interface(TokenPool_2_0_ABI).encodeFunctionData('removeRemotePool', [
      SELECTOR,
      encodeRemote(REMOTE_EVM),
    ])
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('applies sender to from on the first tx', async () => {
    const unsigned = await op.generate(stubChain(), {
      poolAddress: POOL,
      remoteChainSelector: SELECTOR,
      remotePoolAddresses: [REMOTE_EVM],
      sender: POOL,
    })
    assert.equal(unsigned.transactions[0]!.from, POOL)
  })

  it('rejects an invalid pool address before RPC', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(), {
          poolAddress: 'nope',
          remoteChainSelector: SELECTOR,
          remotePoolAddresses: [REMOTE_EVM],
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })

  it('rejects a zero remoteChainSelector', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(), {
          poolAddress: POOL,
          remoteChainSelector: 0n,
          remotePoolAddresses: [REMOTE_EVM],
        }),
      (e: unknown) =>
        e instanceof CCTParamsInvalidError && e.context.param === 'remoteChainSelector',
    )
  })

  it('rejects an empty address list', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(), {
          poolAddress: POOL,
          remoteChainSelector: SELECTOR,
          remotePoolAddresses: [],
        }),
      (e: unknown) =>
        e instanceof CCTParamsInvalidError && e.context.param === 'remotePoolAddresses',
    )
  })

  it('rejects a blank entry within the address list', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(), {
          poolAddress: POOL,
          remoteChainSelector: SELECTOR,
          remotePoolAddresses: [REMOTE_EVM, '   '],
        }),
      (e: unknown) =>
        e instanceof CCTParamsInvalidError && e.context.param === 'remotePoolAddresses[1]',
    )
  })

  it('rejects v1.5 pools (no removeRemotePool)', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain(CCIPVersion.V1_5), {
          poolAddress: POOL,
          remoteChainSelector: SELECTOR,
          remotePoolAddresses: [REMOTE_EVM],
        }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })
})
