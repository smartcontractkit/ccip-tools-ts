import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import {
  CCTContractTypeInvalidError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import ADVANCED_POOL_HOOKS_V2_0_0_ABI from '../../artifacts/abi/V2_0_0/advanced-pool-hooks.ts'
import { type PoolStub, POOL, withPool } from '../pool.test.helpers.ts'
import {
  type ApplyCCVConfigUpdatesParams,
  ApplyCCVConfigUpdates,
} from './apply-ccv-config-updates.ts'

const HOOKS = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const NOT_OWNER = '0x' + '33'.repeat(20)
const CCV = '0x' + '44'.repeat(20)
const THRESHOLD_CCV = '0x' + '55'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const IFACE = new Interface(ADVANCED_POOL_HOOKS_V2_0_0_ABI)
const CONFIG = {
  remoteChainSelector: 1n,
  outboundCCVs: [ZeroAddress],
  thresholdOutboundCCVs: [CCV],
  inboundCCVs: [CCV],
  thresholdInboundCCVs: [THRESHOLD_CCV],
}

/**
 * {@link POOL} bound to {@link HOOKS} (see `pool`), which report `hooksType` and answer only
 * `owner()`; `onCall` records hooks calls only.
 */
function stubChain(
  owner = OWNER,
  onCall?: () => void,
  hooksType = 'AdvancedPoolHooks',
  pool: Partial<PoolStub> = {},
): EVMChain {
  return withPool(
    {
      provider: {
        call: async ({ to, data }: { to: string; data: string }) => {
          onCall?.()
          assert.equal(to.toLowerCase(), HOOKS)
          assert.equal(data.slice(0, 10), IFACE.getFunction('owner')!.selector)
          return IFACE.encodeFunctionResult('owner', [owner])
        },
      },
      network: networkInfo('ethereum-testnet-sepolia-base-1'),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      typeAndVersion: () => Promise.resolve([hooksType, '2.0.0']),
      nextNonce: async () => 0,
      rollbackNonce: () => {},
    } as unknown as EVMChain,
    { hooks: HOOKS, ...pool },
  )
}

function fakeSigner(address = OWNER, waitError?: Error) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(address),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({
        hash: HASH,
        wait: () => (waitError ? Promise.reject(waitError) : Promise.resolve({ status: 1 })),
      }),
  }
}

const op = new ApplyCCVConfigUpdates()
const generate = (chain: EVMChain, overrides: Record<string, unknown> = {}) =>
  op.generate(chain, {
    poolAddress: POOL,
    ccvConfigArgs: [CONFIG],
    sender: OWNER,
    ...overrides,
  } as ApplyCCVConfigUpdatesParams)

describe('ApplyCCVConfigUpdates (cct/evm advanced-pool-hooks)', () => {
  describe('generate', () => {
    it("encodes all four CCV lists to the pool's bound hooks, permitting a zero base CCV", async () => {
      const unsigned = await generate(stubChain())
      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions[0]!.to, HOOKS)
      assert.equal(unsigned.transactions[0]!.from, OWNER)
      assert.equal(
        unsigned.transactions[0]!.data,
        IFACE.encodeFunctionData('applyCCVConfigUpdates', [[CONFIG]]),
      )
    })

    it('omits from and skips owner() without a sender', async () => {
      let calls = 0
      const unsigned = await generate(
        stubChain(OWNER, () => (calls += 1)),
        { sender: undefined },
      )
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(calls, 0)
    })

    it('rejects a bound address that is not AdvancedPoolHooks', async () => {
      await assert.rejects(
        () => generate(stubChain(OWNER, undefined, 'BurnMintTokenPool')),
        CCTContractTypeInvalidError,
      )
    })

    it('rejects a pre-v2.0.0 pool as unsupported, never reaching the hooks', async () => {
      let calls = 0
      await assert.rejects(
        () =>
          generate(
            stubChain(OWNER, () => (calls += 1), undefined, {
              typeAndVersion: 'BurnMintTokenPool 1.6.1',
            }),
          ),
        CCTOperationUnsupportedError,
      )
      assert.equal(calls, 0)
    })

    it('rejects a pool with no hooks bound, never reaching the hooks', async () => {
      let calls = 0
      await assert.rejects(
        () => generate(stubChain(OWNER, () => (calls += 1), undefined, { hooks: ZeroAddress })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'applyCCVConfigUpdates' &&
          err.context.param === 'poolAddress',
      )
      assert.equal(calls, 0)
    })
  })

  describe('validation', () => {
    for (const [overrides, param] of [
      [{ poolAddress: ZeroAddress }, 'poolAddress'],
      [{ ccvConfigArgs: 'bad' }, 'ccvConfigArgs'],
      [
        { ccvConfigArgs: [{ ...CONFIG, remoteChainSelector: -1n }] },
        'ccvConfigArgs[0].remoteChainSelector',
      ],
      [
        { ccvConfigArgs: [{ ...CONFIG, outboundCCVs: [CCV, CCV] }] },
        'ccvConfigArgs[0].outboundCCVs[1]',
      ],
      [
        { ccvConfigArgs: [{ ...CONFIG, thresholdOutboundCCVs: [ZeroAddress] }] },
        'ccvConfigArgs[0].thresholdOutboundCCVs',
      ],
      [{ ccvConfigArgs: [{ ...CONFIG, inboundCCVs: [] }] }, 'ccvConfigArgs[0].inboundCCVs'],
      [{ sender: 'bad' }, 'sender'],
    ] as const) {
      it(`rejects ${param} before RPC`, async () => {
        let called = false
        await assert.rejects(
          () =>
            generate(
              stubChain(OWNER, () => (called = true), undefined, {
                onCall: () => (called = true),
              }),
              overrides,
            ),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'applyCCVConfigUpdates' &&
            err.context.param === param,
        )
        assert.equal(called, false)
      })
    }
  })

  describe('owner check', () => {
    it('rejects a sender that is not the hooks owner', async () => {
      await assert.rejects(
        () => generate(stubChain(NOT_OWNER)),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, ccvConfigArgs: [CONFIG] }

    it('signs and submits as the hooks owner', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps on-chain reverts', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        CCIPExecTxRevertedError,
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: {} }),
        CCIPWalletInvalidError,
      )
    })
  })
})
