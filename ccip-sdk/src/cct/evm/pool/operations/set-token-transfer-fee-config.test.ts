import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface } from 'ethers'

import {
  type TokenTransferFeeConfigUpdate,
  SetTokenTransferFeeConfig,
} from './set-token-transfer-fee-config.ts'
import TokenPool_2_0_ABI from '../../../../evm/abi/TokenPool_2_0.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const POOL = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const SELECTOR = 14767482510784806043n

const UPDATE: TokenTransferFeeConfigUpdate = {
  remoteChainSelector: SELECTOR,
  config: {
    destGasOverhead: 90000,
    destBytesOverhead: 32,
    finalityFeeUSDCents: 10,
    fastFinalityFeeUSDCents: 50,
    finalityTransferFeeBps: 5,
    fastFinalityTransferFeeBps: 25,
    isEnabled: true,
  },
}

function stubChain(version: string): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve(['BurnMintTokenPool', version, `pool ${version}`]),
  } as unknown as EVMChain
}

describe('EVM cct setTokenTransferFeeConfig', () => {
  const op = new SetTokenTransferFeeConfig()

  it('encodes applyTokenTransferFeeConfigUpdates byte-identical on a v2.0 pool', async () => {
    const unsigned = await op.generate(stubChain('2.0.0'), {
      poolAddress: POOL,
      updates: [UPDATE],
      disable: [999n],
    })
    const iface = new Interface(TokenPool_2_0_ABI)
    const expected = iface.encodeFunctionData('applyTokenTransferFeeConfigUpdates', [
      [
        {
          destChainSelector: SELECTOR,
          tokenTransferFeeConfig: {
            destGasOverhead: 90000,
            destBytesOverhead: 32,
            finalityFeeUSDCents: 10,
            fastFinalityFeeUSDCents: 50,
            finalityTransferFeeBps: 5,
            fastFinalityTransferFeeBps: 25,
            isEnabled: true,
          },
        },
      ],
      [999n],
    ])
    assert.equal(unsigned.family, ChainFamily.EVM)
    assert.equal(unsigned.transactions.length, 1)
    assert.equal(unsigned.transactions[0]!.to, POOL)
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('supports disable-only (empty updates)', async () => {
    const unsigned = await op.generate(stubChain('2.0.0'), {
      poolAddress: POOL,
      updates: [],
      disable: [SELECTOR],
    })
    const iface = new Interface(TokenPool_2_0_ABI)
    const expected = iface.encodeFunctionData('applyTokenTransferFeeConfigUpdates', [
      [],
      [SELECTOR],
    ])
    assert.equal(unsigned.transactions[0]!.data, expected)
  })

  it('rejects a pre-v2.0 pool', async () => {
    await assert.rejects(
      () => op.generate(stubChain('1.6.1'), { poolAddress: POOL, updates: [UPDATE] }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })

  it('rejects an invalid pool address before RPC', async () => {
    await assert.rejects(
      () => op.generate(stubChain('2.0.0'), { poolAddress: 'nope', updates: [UPDATE] }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'poolAddress',
    )
  })

  it('rejects when neither updates nor disable are provided', async () => {
    await assert.rejects(
      () => op.generate(stubChain('2.0.0'), { poolAddress: POOL, updates: [] }),
      (e: unknown) => e instanceof CCTParamsInvalidError && e.context.param === 'updates',
    )
  })

  it('rejects an out-of-range uint32 field', async () => {
    await assert.rejects(
      () =>
        op.generate(stubChain('2.0.0'), {
          poolAddress: POOL,
          updates: [{ ...UPDATE, config: { ...UPDATE.config, destGasOverhead: 4_294_967_296 } }],
        }),
      (e: unknown) =>
        e instanceof CCTParamsInvalidError &&
        e.context.param === 'updates[0].config.destGasOverhead',
    )
  })
})
