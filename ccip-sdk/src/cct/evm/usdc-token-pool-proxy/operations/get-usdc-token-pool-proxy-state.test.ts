import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, getAddress } from 'ethers'

import { CCTContractVersionUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { PROXY, stubProxyChain } from '../usdc-token-pool-proxy.test.helpers.ts'
import { GetUSDCTokenPoolProxyState } from './get-usdc-token-pool-proxy-state.ts'

// Lowercase on the wire on purpose: every address in the result must come back checksummed.
const OWNER = '0x' + 'a1'.repeat(20)
const TOKEN = '0x' + 'a2'.repeat(20)
const ROUTER = '0x' + 'a3'.repeat(20)
const VERIFIER = '0x' + 'a4'.repeat(20)
const POOLS = ['0x' + 'b1'.repeat(20), '0x' + 'b2'.repeat(20), ZeroAddress, '0x' + 'b4'.repeat(20)]
const FEE_AGGREGATOR = '0x' + 'a5'.repeat(20)

function answers(feeAggregator = FEE_AGGREGATOR) {
  return {
    owner: () => [OWNER],
    getStaticConfig: () => [TOKEN, ROUTER, VERIFIER],
    getPools: () => [POOLS],
    getFeeAggregator: () => [feeAggregator],
  }
}

const op = new GetUSDCTokenPoolProxyState()

describe('GetUSDCTokenPoolProxyState (cct/evm usdc-token-pool-proxy)', () => {
  describe('query', () => {
    it('reads the full proxy state, checksummed', async () => {
      const { chain } = stubProxyChain(answers())
      assert.deepEqual(await op.query(chain, { usdcTokenPoolProxy: PROXY }), {
        type: 'USDCTokenPoolProxy',
        version: '2.0.0',
        owner: getAddress(OWNER),
        token: getAddress(TOKEN),
        router: getAddress(ROUTER),
        cctpVerifier: getAddress(VERIFIER),
        pools: {
          cctpV1Pool: getAddress(POOLS[0]!),
          cctpV2Pool: getAddress(POOLS[1]!),
          cctpV2PoolWithCCV: ZeroAddress,
          siloedLockReleasePool: getAddress(POOLS[3]!),
        },
        feeAggregator: getAddress(FEE_AGGREGATOR),
      })
    })

    it('returns an unset fee aggregator as ZeroAddress rather than failing', async () => {
      const { chain } = stubProxyChain(answers(ZeroAddress))
      const state = await op.query(chain, { usdcTokenPoolProxy: PROXY })
      assert.equal(state.feeAggregator, ZeroAddress)
    })
  })

  describe('validation', () => {
    it('rejects a zero proxy address before the typeAndVersion probe', async () => {
      const stub = stubProxyChain(answers())
      await assert.rejects(
        () => op.query(stub.chain, { usdcTokenPoolProxy: ZeroAddress }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'usdcTokenPoolProxy',
      )
      assert.equal(stub.probed(), false)
    })

    it('rejects a 1.6.4 proxy before any getter decodes its layout', async () => {
      const stub = stubProxyChain(answers(), 'USDCTokenPoolProxy 1.6.4')
      await assert.rejects(
        () => op.query(stub.chain, { usdcTokenPoolProxy: PROXY }),
        CCTContractVersionUnsupportedError,
      )
      assert.deepEqual(stub.calls, [])
    })
  })
})
