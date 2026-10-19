import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, getAddress, id, isError } from 'ethers'

import { CCTContractVersionUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import {
  type ProxyAnswer,
  PROXY,
  revertWith,
  stubProxyChain,
} from '../usdc-token-pool-proxy.test.helpers.ts'
import {
  type GetUSDCTokenPoolProxyRequiredCCVsParams,
  GetUSDCTokenPoolProxyRequiredCCVs,
} from './get-usdc-token-pool-proxy-required-ccvs.ts'

const SELECTOR = 5009297550715157269n // ethereum-mainnet
/** Lowercase on the wire on purpose: the result must come back checksummed. */
const VERIFIER = '0x' + 'a4'.repeat(20)

const op = new GetUSDCTokenPoolProxyRequiredCCVs()

/** Records the decoded `getRequiredCCVs` args and answers `ccvs`. */
function recording(ccvs: string[]): { answer: ProxyAnswer; args: () => readonly unknown[] } {
  let seen: readonly unknown[] = []
  return {
    answer: (args) => {
      seen = args
      return [ccvs]
    },
    args: () => seen,
  }
}

describe('GetUSDCTokenPoolProxyRequiredCCVs (cct/evm usdc-token-pool-proxy)', () => {
  describe('query', () => {
    it('sends outbound as direction 0 with empty extraData and neutral token, amount and finality', async () => {
      const rec = recording([VERIFIER])
      const { chain } = stubProxyChain({ getRequiredCCVs: rec.answer })
      const ccvs = await op.query(chain, {
        usdcTokenPoolProxy: PROXY,
        remoteChainSelector: SELECTOR,
        direction: 'outbound',
      })
      assert.deepEqual(ccvs, [getAddress(VERIFIER)])
      assert.deepEqual([...rec.args()], [ZeroAddress, SELECTOR, 0n, '0x00000000', '0x', 0n])
    })

    // the proxy reads the inbound mechanism from these tags, not the lane; USDCSourcePoolDataCodec
    // defines each as bytes4(keccak256(preimage)), derived here rather than copied
    for (const [inboundMechanism, tag] of [
      ['CCV', id('CCTP_V2_CCV').slice(0, 10)],
      ['LOCK_RELEASE', id('NO_CCTP_USE_LOCK_RELEASE').slice(0, 10)],
    ] as const) {
      it(`sends inbound ${inboundMechanism} as direction 1 with tag ${tag}`, async () => {
        const rec = recording([VERIFIER])
        const { chain } = stubProxyChain({ getRequiredCCVs: rec.answer })
        await op.query(chain, {
          usdcTokenPoolProxy: PROXY,
          remoteChainSelector: SELECTOR,
          direction: 'inbound',
          inboundMechanism,
        })
        assert.equal(rec.args()[4], tag)
        assert.equal(rec.args()[5], 1n)
      })
    }

    it('passes [ZeroAddress] through, the default-CCVs answer', async () => {
      const { chain } = stubProxyChain({ getRequiredCCVs: () => [[ZeroAddress]] })
      assert.deepEqual(
        await op.query(chain, {
          usdcTokenPoolProxy: PROXY,
          remoteChainSelector: SELECTOR,
          direction: 'inbound',
          inboundMechanism: 'LOCK_RELEASE',
        }),
        [ZeroAddress],
      )
    })

    it('reports a NoLockOrBurnMechanismSet revert as a bad remoteChainSelector', async () => {
      const { chain } = stubProxyChain({
        getRequiredCCVs: revertWith('NoLockOrBurnMechanismSet', [SELECTOR]),
      })
      await assert.rejects(
        () =>
          op.query(chain, {
            usdcTokenPoolProxy: PROXY,
            remoteChainSelector: SELECTOR,
            direction: 'outbound',
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'getUSDCTokenPoolProxyRequiredCCVs' &&
          err.context.param === 'remoteChainSelector' &&
          isError(err.cause, 'CALL_EXCEPTION'),
      )
    })

    it('lets any other revert propagate untouched', async () => {
      const { chain } = stubProxyChain({
        getRequiredCCVs: revertWith('InvalidMessageVersion', ['0x12345678']),
      })
      await assert.rejects(
        () =>
          op.query(chain, {
            usdcTokenPoolProxy: PROXY,
            remoteChainSelector: SELECTOR,
            direction: 'inbound',
            inboundMechanism: 'CCV',
          }),
        (err: unknown) =>
          isError(err, 'CALL_EXCEPTION') && err.revert?.name === 'InvalidMessageVersion',
      )
    })
  })

  describe('validation', () => {
    // CCTP_V2 is a real mechanism, but the proxy reverts InvalidMessageVersion on its inbound tag
    for (const [label, overrides, param] of [
      ['a zero proxy address', { usdcTokenPoolProxy: ZeroAddress }, 'usdcTokenPoolProxy'],
      ['a malformed proxy address', { usdcTokenPoolProxy: 'nope' }, 'usdcTokenPoolProxy'],
      ['selector -1', { remoteChainSelector: -1n }, 'remoteChainSelector'],
      ['selector 2^64', { remoteChainSelector: 2n ** 64n }, 'remoteChainSelector'],
      ['an unknown direction', { direction: 'sideways' }, 'direction'],
      ['inbound with no inboundMechanism', { direction: 'inbound' }, 'inboundMechanism'],
      [
        'outbound with an inboundMechanism',
        { direction: 'outbound', inboundMechanism: 'CCV' },
        'inboundMechanism',
      ],
      [
        'an inbound mechanism the proxy reverts on',
        { direction: 'inbound', inboundMechanism: 'CCTP_V2' },
        'inboundMechanism',
      ],
    ] as const) {
      it(`rejects ${label} before the typeAndVersion probe`, async () => {
        const stub = stubProxyChain({})
        await assert.rejects(
          () =>
            op.query(stub.chain, {
              usdcTokenPoolProxy: PROXY,
              remoteChainSelector: SELECTOR,
              ...overrides,
            } as unknown as GetUSDCTokenPoolProxyRequiredCCVsParams),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
        assert.equal(stub.probed(), false)
      })
    }

    it('rejects a 1.6.4 proxy before getRequiredCCVs decodes its layout', async () => {
      const stub = stubProxyChain(
        {
          getRequiredCCVs: () => {
            throw new Error('must not be called')
          },
        },
        'USDCTokenPoolProxy 1.6.4',
      )
      await assert.rejects(
        () =>
          op.query(stub.chain, {
            usdcTokenPoolProxy: PROXY,
            remoteChainSelector: SELECTOR,
            direction: 'outbound',
          }),
        CCTContractVersionUnsupportedError,
      )
      assert.deepEqual(stub.calls, [])
    })
  })
})
