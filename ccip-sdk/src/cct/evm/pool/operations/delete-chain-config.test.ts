import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface } from 'ethers'

import { DeleteChainConfig } from './delete-chain-config.ts'
import TokenPool_1_6_ABI from '../../../../evm/abi/LockReleaseTokenPool_1_6_1.ts'
import TokenPool_2_0_ABI from '../../../../evm/abi/TokenPool_2_0.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const POOL = '0x1234567890AbcdEF1234567890aBcdef12345678'
const SELECTOR = 16015286601757825753n

/** Stub EVMChain whose `typeAndVersion` reports a fixed pool version. */
function chainFor(version: string): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: async (_addr: string) => ['LockReleaseTokenPool', version, `pool ${version}`],
  } as unknown as EVMChain
}

describe('EVM cct deleteChainConfig', () => {
  const op = new DeleteChainConfig()

  it('encodes a v1.6 removal — byte-identical to a direct ethers encode', async () => {
    const unsigned = await op.generate(chainFor('1.6.0'), {
      poolAddress: POOL,
      remoteChainSelector: SELECTOR,
    })
    const expected = new Interface(TokenPool_1_6_ABI).encodeFunctionData('applyChainUpdates', [
      [SELECTOR],
      [],
    ])
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions[0]!.to, POOL)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('selects the v2.0 ABI for a v2.0 pool', async () => {
    const unsigned = await op.generate(chainFor('2.0.0'), {
      poolAddress: POOL,
      remoteChainSelector: SELECTOR,
    })
    const expected = new Interface(TokenPool_2_0_ABI).encodeFunctionData('applyChainUpdates', [
      [SELECTOR],
      [],
    ])
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('applies sender to from', async () => {
    const unsigned = await op.generate(chainFor('1.6.0'), {
      poolAddress: POOL,
      remoteChainSelector: SELECTOR,
      sender: POOL,
    })
    assert.equal(unsigned.transactions[0]!.from, POOL)
  })

  it('rejects an empty pool address before RPC', async () => {
    await assert.rejects(
      () => op.generate(chainFor('1.6.0'), { poolAddress: '', remoteChainSelector: SELECTOR }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })

  it('rejects a zero remote chain selector', async () => {
    await assert.rejects(
      () => op.generate(chainFor('1.6.0'), { poolAddress: POOL, remoteChainSelector: 0n }),
      (e: unknown) =>
        e instanceof CCTParamsInvalidError && e.context.param === 'remoteChainSelector',
    )
  })
})
