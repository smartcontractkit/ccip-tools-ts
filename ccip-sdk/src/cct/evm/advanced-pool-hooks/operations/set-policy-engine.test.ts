import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../../../errors.ts'
import ADVANCED_POOL_HOOKS_V2_0_0_ABI from '../../artifacts/abi/V2_0_0/advanced-pool-hooks.ts'
import { type SetPolicyEngineParams, SetPolicyEngine } from './set-policy-engine.ts'

const HOOKS = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const NOT_OWNER = '0x' + '33'.repeat(20)
const POLICY_ENGINE = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const IFACE = new Interface(ADVANCED_POOL_HOOKS_V2_0_0_ABI)

function stubChain(
  owner = OWNER,
  onCall?: () => void,
  hooksType = 'AdvancedPoolHooks',
  policyEngineCode = '0x01',
): EVMChain {
  return {
    provider: {
      getCode: async () => policyEngineCode,
      call: async ({ data }: { data: string }) => {
        onCall?.()
        assert.equal(data.slice(0, 10), IFACE.getFunction('owner')!.selector)
        return IFACE.encodeFunctionResult('owner', [owner])
      },
    },
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve([hooksType, '2.0.0']),
    nextNonce: async () => 0,
    rollbackNonce: () => {},
  } as unknown as EVMChain
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

const op = new SetPolicyEngine()
const generate = (chain: EVMChain, overrides: Record<string, unknown> = {}) =>
  op.generate(chain, {
    advancedPoolHooks: HOOKS,
    newPolicyEngine: POLICY_ENGINE,
    sender: OWNER,
    ...overrides,
  } as SetPolicyEngineParams)

describe('SetPolicyEngine (cct/evm advanced-pool-hooks)', () => {
  describe('generate', () => {
    it('encodes setPolicyEngine', async () => {
      const unsigned = await generate(stubChain())
      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions[0]!.to, HOOKS)
      assert.equal(unsigned.transactions[0]!.from, OWNER)
      assert.equal(
        unsigned.transactions[0]!.data,
        IFACE.encodeFunctionData('setPolicyEngine', [POLICY_ENGINE]),
      )
    })

    it('permits zero to disable policy checks', async () => {
      const unsigned = await generate(stubChain(), { newPolicyEngine: ZeroAddress })
      assert.equal(
        unsigned.transactions[0]!.data,
        IFACE.encodeFunctionData('setPolicyEngine', [ZeroAddress]),
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

    it('rejects a target that is not AdvancedPoolHooks', async () => {
      await assert.rejects(
        () => generate(stubChain(OWNER, undefined, 'BurnMintTokenPool')),
        CCTContractTypeInvalidError,
      )
    })

    it('rejects a non-zero policy engine with no deployed code', async () => {
      await assert.rejects(
        () => generate(stubChain(OWNER, undefined, 'AdvancedPoolHooks', '0x')),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'newPolicyEngine',
      )
    })
  })

  describe('validation', () => {
    for (const [overrides, param] of [
      [{ advancedPoolHooks: ZeroAddress }, 'advancedPoolHooks'],
      [{ newPolicyEngine: 'bad' }, 'newPolicyEngine'],
      [{ sender: 'bad' }, 'sender'],
    ] as const) {
      it(`rejects ${param} before RPC`, async () => {
        let called = false
        await assert.rejects(
          () =>
            generate(
              stubChain(OWNER, () => (called = true)),
              overrides,
            ),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'setPolicyEngine' &&
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
    const params = { advancedPoolHooks: HOOKS, newPolicyEngine: POLICY_ENGINE }

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
