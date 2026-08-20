import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { type SetPoolParams, SetPool } from './set-pool.ts'
import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const TOKEN = '0x' + '11'.repeat(20)
const POOL = '0x' + '22'.repeat(20)
const ADDRESS = '0x' + '33'.repeat(20)
const TAR = '0x' + '44'.repeat(20)
const SENDER = '0x' + '55'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

const DATA = new Interface([
  'function setPool(address localToken, address pool)',
]).encodeFunctionData('setPool', [TOKEN, POOL])

function stubChain(onAddress?: (address: string) => void): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    getTokenAdminRegistryFor: (address: string) => {
      onAddress?.(address)
      return Promise.resolve(TAR)
    },
    nextNonce: async () => 0,
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(waitError?: Error) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(SENDER),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({
        hash: HASH,
        wait: () => (waitError ? Promise.reject(waitError) : Promise.resolve({ status: 1 })),
      }),
  }
}

const op = new SetPool()

function generate(chain: EVMChain, overrides: Partial<SetPoolParams> = {}) {
  return op.generate(chain, {
    tokenAddress: TOKEN,
    poolAddress: POOL,
    address: ADDRESS,
    sender: SENDER,
    ...overrides,
  })
}

describe('SetPool (cct/evm)', () => {
  describe('generate', () => {
    it('encodes setPool(token, pool) to the discovered TAR', async () => {
      const unsigned = await generate(stubChain())
      const tx = unsigned.transactions[0]!

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      assert.equal(tx.to, TAR)
      assert.equal(tx.from, SENDER)
      assert.equal(tx.data, DATA)
    })

    it('discovers the TAR from address', async () => {
      let seen: string | undefined
      await generate(stubChain((address) => (seen = address)))
      assert.equal(seen, ADDRESS)
    })

    it('omits from when sender is not supplied', async () => {
      const unsigned = await generate(stubChain(), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })

    it('allows the zero pool address to delist a token', async () => {
      const unsigned = await generate(stubChain(), { poolAddress: ZeroAddress })
      assert.equal(
        unsigned.transactions[0]!.data,
        new Interface(['function setPool(address localToken, address pool)']).encodeFunctionData(
          'setPool',
          [TOKEN, ZeroAddress],
        ),
      )
    })
  })

  describe('validation', () => {
    for (const param of ['tokenAddress', 'poolAddress', 'address', 'sender'] as const) {
      it(`rejects an invalid ${param} before TAR discovery`, async () => {
        let called = false
        await assert.rejects(
          () =>
            generate(
              stubChain(() => (called = true)),
              { [param]: 'not-an-address' },
            ),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'setPool' &&
            err.context.param === param,
        )
        assert.equal(called, false)
      })
    }
  })

  describe('execute', () => {
    it('signs and submits, resolving to the tx hash', async () => {
      assert.deepEqual(
        await op.execute(stubChain(), {
          tokenAddress: TOKEN,
          poolAddress: POOL,
          address: ADDRESS,
          wallet: fakeSigner(),
        }),
        { hash: HASH },
      )
    })

    it('maps an on-chain revert to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            tokenAddress: TOKEN,
            poolAddress: POOL,
            address: ADDRESS,
            wallet: fakeSigner(makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'setPool',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            tokenAddress: TOKEN,
            poolAddress: POOL,
            address: ADDRESS,
            wallet: {},
          }),
        CCIPWalletInvalidError,
      )
    })
  })
})
