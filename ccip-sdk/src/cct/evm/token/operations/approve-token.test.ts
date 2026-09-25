import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, MaxUint256, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { type ApproveTokenParams, ApproveToken } from './approve-token.ts'

const TOKEN = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const POOL = '0x' + '33'.repeat(20)
const OTHER = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const AMOUNT = 1_000000000000000000n

/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived interfaces.
 */
const IFACE = new Interface(['function approve(address spender, uint256 amount) returns (bool)'])
const dataFor = (spender: string, amount: bigint) =>
  IFACE.encodeFunctionData('approve', [spender, amount])

/** EVMChain stub whose every `eth_call` / `typeAndVersion` throws: this op must make none. */
function stubChain(seen: { calls: number } = { calls: 0 }): EVMChain {
  const fail = () => {
    seen.calls += 1
    throw new Error('approveToken must not touch the chain to build')
  }
  return {
    provider: { call: fail },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: fail,
    nextNonce: () => Promise.resolve(0),
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

const op = new ApproveToken()

function generate(chain: EVMChain, overrides: Partial<ApproveTokenParams> = {}) {
  return op.generate(chain, {
    tokenAddress: TOKEN,
    spender: POOL,
    amount: AMOUNT,
    sender: OWNER,
    ...overrides,
  })
}

describe('ApproveToken (cct/evm)', () => {
  describe('generate', () => {
    it('encodes approve(spender, amount) to the token', async () => {
      const unsigned = await generate(stubChain())
      const tx = unsigned.transactions[0]!

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      assert.equal(tx.to, TOKEN)
      assert.equal(tx.from, OWNER)
      assert.equal(tx.data, dataFor(POOL, AMOUNT))
    })

    it('builds without touching the chain — no version to resolve, nothing to read', async () => {
      const seen = { calls: 0 }
      await generate(stubChain(seen))
      assert.equal(seen.calls, 0)
    })

    it('accepts a zero amount, which revokes the allowance', async () => {
      const unsigned = await generate(stubChain(), { amount: 0n })
      assert.equal(unsigned.transactions[0]!.data, dataFor(POOL, 0n))
    })

    it('encodes the unlimited approval', async () => {
      const unsigned = await generate(stubChain(), { amount: MaxUint256 })
      assert.equal(unsigned.transactions[0]!.data, dataFor(POOL, MaxUint256))
    })

    it('omits from when sender is not supplied', async () => {
      const unsigned = await generate(stubChain(), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(unsigned.transactions[0]!.data, dataFor(POOL, AMOUNT))
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['tokenAddress', 'not-an-address'],
      ['tokenAddress', ZeroAddress],
      ['spender', 'not-an-address'],
      // OpenZeppelin's ERC-20 reverts ERC20InvalidSpender, so a zero spender is never meaningful
      ['spender', ZeroAddress],
      ['amount', 1 as never],
      ['amount', -1n],
      ['amount', 2n ** 256n],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${String(value)}`, async () => {
        await assert.rejects(
          () => generate(stubChain(), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'approveToken' &&
            err.context.param === param,
        )
      })
    }
  })

  describe('execute', () => {
    const params = { tokenAddress: TOKEN, spender: POOL, amount: AMOUNT }

    it('signs and submits, resolving to the tx hash', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('rejects a sender that is not the signing wallet — the allowance comes from the signer', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, sender: OTHER, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('maps an on-chain revert to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'approveToken',
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
