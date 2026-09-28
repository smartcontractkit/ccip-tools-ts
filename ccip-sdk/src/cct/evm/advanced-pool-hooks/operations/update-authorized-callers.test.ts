import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../../../errors.ts'
import ADVANCED_POOL_HOOKS_V2_0_0_ABI from '../../artifacts/abi/V2_0_0/advanced-pool-hooks.ts'
import {
  type UpdateAdvancedPoolHooksAuthorizedCallersParams,
  UpdateAdvancedPoolHooksAuthorizedCallers,
} from './update-authorized-callers.ts'

const HOOKS = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const NOT_OWNER = '0x' + '33'.repeat(20)
const CALLER = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const IFACE = new Interface(ADVANCED_POOL_HOOKS_V2_0_0_ABI)

function stubChain(owner = OWNER, onCall?: () => void, hooksType = 'AdvancedPoolHooks'): EVMChain {
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        onCall?.()
        assert.equal(data.slice(0, 10), IFACE.getFunction('owner')!.selector)
        return IFACE.encodeFunctionResult('owner', [owner])
      },
    },
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

const op = new UpdateAdvancedPoolHooksAuthorizedCallers()
const generate = (chain: EVMChain, overrides: Record<string, unknown> = {}) =>
  op.generate(chain, {
    advancedPoolHooks: HOOKS,
    addedCallers: [CALLER],
    sender: OWNER,
    ...overrides,
  } as UpdateAdvancedPoolHooksAuthorizedCallersParams)

describe('UpdateAdvancedPoolHooksAuthorizedCallers (cct/evm advanced-pool-hooks)', () => {
  describe('generate', () => {
    it('encodes additions and removals', async () => {
      const unsigned = await generate(stubChain(), { removedCallers: [NOT_OWNER] })
      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions[0]!.to, HOOKS)
      assert.equal(unsigned.transactions[0]!.from, OWNER)
      assert.equal(
        unsigned.transactions[0]!.data,
        IFACE.encodeFunctionData('applyAuthorizedCallerUpdates', [
          { addedCallers: [CALLER], removedCallers: [NOT_OWNER] },
        ]),
      )
    })

    it('skips owner() without a sender', async () => {
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
  })

  describe('validation', () => {
    for (const [overrides, param] of [
      [{ advancedPoolHooks: ZeroAddress }, 'advancedPoolHooks'],
      [{ addedCallers: [] }, 'addedCallers'],
      [{ addedCallers: CALLER }, 'addedCallers'],
      [{ addedCallers: [ZeroAddress] }, 'addedCallers[0]'],
      [{ addedCallers: [CALLER, CALLER] }, 'addedCallers'],
      [{ removedCallers: ['bad'] }, 'removedCallers[0]'],
      [{ removedCallers: [CALLER, CALLER] }, 'removedCallers'],
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
            err.context.operation === 'updateAdvancedPoolHooksAuthorizedCallers' &&
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
    it('signs and submits as the hooks owner', async () => {
      assert.deepEqual(
        await op.execute(stubChain(), {
          advancedPoolHooks: HOOKS,
          addedCallers: [CALLER],
          wallet: fakeSigner(),
        }),
        {
          hash: HASH,
        },
      )
    })

    it('maps on-chain reverts and rejects a non-signer wallet', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            advancedPoolHooks: HOOKS,
            addedCallers: [CALLER],
            wallet: fakeSigner(OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        CCIPExecTxRevertedError,
      )
      await assert.rejects(
        () =>
          op.execute(stubChain(), { advancedPoolHooks: HOOKS, addedCallers: [CALLER], wallet: {} }),
        CCIPWalletInvalidError,
      )
    })
  })
})
