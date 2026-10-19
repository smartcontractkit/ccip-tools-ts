import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, getAddress, isError, zeroPadValue } from 'ethers'

// registers the EVM and Solana chain families; Aptos is deliberately left unloaded
import '../../../../evm/index.ts'
import '../../../../solana/index.ts'
import { networkInfo } from '../../../../networks.ts'
import { CCTContractVersionUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { PROXY, revertWith, stubProxyChain } from '../usdc-token-pool-proxy.test.helpers.ts'
import { GetUSDCTokenPoolProxyRemotePools } from './get-usdc-token-pool-proxy-remote-pools.ts'

const SELECTOR = 5009297550715157269n // ethereum-mainnet
const SOLANA_SELECTOR = 16423721717087811551n // solana-devnet
const APTOS_SELECTOR = 4741433654826277614n // aptos-mainnet
/** An EVM remote pool, lowercase, as the child pool stores it: left-padded to 32 bytes. */
const EVM_REMOTE_POOL = '0x' + 'c1'.repeat(20)
/** A Solana remote pool, as base58 and as the 32 raw bytes the pool stores. */
const SOLANA_REMOTE_POOL = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SOLANA_REMOTE_POOL_BYTES =
  '0x6752055c20b3e9d8746656ddf73855507f87ab6d87523e4c76a7fa36096a99eb'

const op = new GetUSDCTokenPoolProxyRemotePools()

describe('GetUSDCTokenPoolProxyRemotePools (cct/evm usdc-token-pool-proxy)', () => {
  describe('query', () => {
    it('decodes a 32-byte padded EVM remote pool to a checksummed address', async () => {
      const { chain } = stubProxyChain({
        getRemotePools: () => [[zeroPadValue(EVM_REMOTE_POOL, 32)]],
      })
      assert.deepEqual(
        await op.query(chain, { usdcTokenPoolProxy: PROXY, remoteChainSelector: SELECTOR }),
        [getAddress(EVM_REMOTE_POOL)],
      )
    })

    it('decodes a Solana lane in base58, the format taken from the selector', async () => {
      let selector: unknown
      const { chain } = stubProxyChain({
        getRemotePools: (args) => {
          selector = args[0]
          return [[SOLANA_REMOTE_POOL_BYTES]]
        },
      })
      assert.deepEqual(
        await op.query(chain, { usdcTokenPoolProxy: PROXY, remoteChainSelector: SOLANA_SELECTOR }),
        [SOLANA_REMOTE_POOL],
      )
      assert.equal(selector, SOLANA_SELECTOR)
    })

    // a lane with no mechanism, or one whose mechanism has no child pool, has no remote pools to
    // read; the proxy's revert is the answer
    for (const [name, args, detail] of [
      ['InvalidLockOrBurnMechanism', [0], 'no lock-or-burn mechanism'],
      ['MustSetPoolForMechanism', [SELECTOR, 4], 'routes to CCV'],
    ] as const) {
      it(`reports a ${name} revert as a bad remoteChainSelector`, async () => {
        const { chain } = stubProxyChain({ getRemotePools: revertWith(name, args) })
        await assert.rejects(
          () => op.query(chain, { usdcTokenPoolProxy: PROXY, remoteChainSelector: SELECTOR }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'getUSDCTokenPoolProxyRemotePools' &&
            err.context.param === 'remoteChainSelector' &&
            err.message.includes(detail) &&
            isError(err.cause, 'CALL_EXCEPTION'),
        )
      })
    }

    it('lets any other revert propagate untouched', async () => {
      const { chain } = stubProxyChain({
        getRemotePools: revertWith('InvalidMessageVersion', ['0x12345678']),
      })
      await assert.rejects(
        () => op.query(chain, { usdcTokenPoolProxy: PROXY, remoteChainSelector: SELECTOR }),
        (err: unknown) =>
          isError(err, 'CALL_EXCEPTION') && err.revert?.name === 'InvalidMessageVersion',
      )
    })
  })

  describe('validation', () => {
    const ETHEREUM_CHAIN_ID = BigInt(networkInfo(SELECTOR).chainId)
    for (const [label, remoteChainSelector, reason] of [
      ['an unknown selector', 1234n, 'not a known chain selector'],
      ['a chain ID passed as a selector', ETHEREUM_CHAIN_ID, 'not a known chain selector'],
      ['a selector whose family is not registered', APTOS_SELECTOR, 'not registered'],
    ] as const) {
      it(`rejects ${label} before the typeAndVersion probe, since the address format is unknown`, async () => {
        const stub = stubProxyChain({})
        await assert.rejects(
          () => op.query(stub.chain, { usdcTokenPoolProxy: PROXY, remoteChainSelector }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.param === 'remoteChainSelector' &&
            err.message.includes(reason),
        )
        assert.equal(stub.probed(), false)
      })
    }

    for (const [label, usdcTokenPoolProxy] of [
      ['a zero proxy address', ZeroAddress],
      ['a malformed proxy address', 'nope'],
    ] as const) {
      it(`rejects ${label} before the typeAndVersion probe`, async () => {
        const stub = stubProxyChain({})
        await assert.rejects(
          () => op.query(stub.chain, { usdcTokenPoolProxy, remoteChainSelector: SELECTOR }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError && err.context.param === 'usdcTokenPoolProxy',
        )
        assert.equal(stub.probed(), false)
      })
    }

    it('rejects a 1.6.4 proxy before getRemotePools decodes its layout', async () => {
      const stub = stubProxyChain(
        {
          getRemotePools: () => {
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
