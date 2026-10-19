import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress } from 'ethers'

import { CCTContractVersionUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { PROXY, stubProxyChain } from '../usdc-token-pool-proxy.test.helpers.ts'
import { GetLockOrBurnMechanism } from './get-lock-or-burn-mechanism.ts'

// Ethereum mainnet selector, so a wrong-width encoding cannot round-trip by accident.
const SELECTOR = 5009297550715157269n

const op = new GetLockOrBurnMechanism()

describe('GetLockOrBurnMechanism (cct/evm usdc-token-pool-proxy)', () => {
  describe('query', () => {
    // ordinals from `enum LockOrBurnMechanism` in USDCTokenPoolProxy.sol
    const testCases = [
      [0, 'INVALID_MECHANISM'],
      [1, 'CCTP_V1'],
      [2, 'CCTP_V2'],
      [3, 'LOCK_RELEASE'],
      [4, 'CCV'],
    ] as const
    for (const [ordinal, mechanism] of testCases) {
      it(`maps ordinal ${ordinal} to ${mechanism}`, async () => {
        const { chain } = stubProxyChain({ getLockOrBurnMechanism: () => [ordinal] })
        assert.equal(
          await op.query(chain, { usdcTokenPoolProxy: PROXY, remoteChainSelector: SELECTOR }),
          mechanism,
        )
      })
    }

    it('passes the selector as the uint64 argument', async () => {
      let selector: unknown
      const { chain } = stubProxyChain({
        getLockOrBurnMechanism: (args) => {
          selector = args[0]
          return [4]
        },
      })
      await op.query(chain, { usdcTokenPoolProxy: PROXY, remoteChainSelector: SELECTOR })
      assert.equal(selector, SELECTOR)
    })
  })

  describe('validation', () => {
    for (const [label, overrides, param] of [
      ['selector -1', { remoteChainSelector: -1n }, 'remoteChainSelector'],
      ['selector 2^64', { remoteChainSelector: 2n ** 64n }, 'remoteChainSelector'],
      ['a zero proxy address', { usdcTokenPoolProxy: ZeroAddress }, 'usdcTokenPoolProxy'],
      ['a malformed proxy address', { usdcTokenPoolProxy: 'nope' }, 'usdcTokenPoolProxy'],
    ] as const) {
      it(`rejects ${label} before the typeAndVersion probe`, async () => {
        const stub = stubProxyChain({})
        await assert.rejects(
          () =>
            op.query(stub.chain, {
              usdcTokenPoolProxy: PROXY,
              remoteChainSelector: SELECTOR,
              ...overrides,
            }),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
        assert.equal(stub.probed(), false)
      })
    }

    it('rejects a 1.6.4 proxy before getLockOrBurnMechanism decodes its layout', async () => {
      const stub = stubProxyChain(
        {
          getLockOrBurnMechanism: () => {
            throw new Error('must not be called')
          },
        },
        'USDCTokenPoolProxy 1.6.4',
      )
      await assert.rejects(
        () => op.query(stub.chain, { usdcTokenPoolProxy: PROXY, remoteChainSelector: SELECTOR }),
        CCTContractVersionUnsupportedError,
      )
      assert.deepEqual(stub.calls, [])
    })
  })
})
