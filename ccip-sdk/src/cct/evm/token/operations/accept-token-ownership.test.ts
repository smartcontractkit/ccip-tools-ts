import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { type AcceptTokenOwnershipParams, AcceptTokenOwnership } from './accept-token-ownership.ts'

const TOKEN = '0x' + '11'.repeat(20)
const PROPOSED_OWNER = '0x' + '22'.repeat(20)
const SOMEONE_ELSE = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived interfaces.
 */
const EXPECTED = new Interface(['function acceptOwnership()']).encodeFunctionData(
  'acceptOwnership',
  [],
)

/**
 * EVMChain stub whose every read rejects: this op resolves no version and gates on no role, so
 * reaching either would be a bug, and `onCall` is what pins that.
 */
function stubChain({ onCall }: { onCall?: () => void } = {}): EVMChain {
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        onCall?.()
        throw makeError('execution reverted', 'CALL_EXCEPTION', {
          action: 'call',
          data: '0x',
          reason: null,
          transaction: { to: TOKEN, data },
          invocation: null,
          revert: null,
        })
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      onCall?.()
      return Promise.reject(new Error('typeAndVersion must not be read'))
    },
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(address = PROPOSED_OWNER, waitError?: Error) {
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

const op = new AcceptTokenOwnership()

function generate(chain: EVMChain, overrides: Partial<AcceptTokenOwnershipParams> = {}) {
  return op.generate(chain, { tokenAddress: TOKEN, sender: PROPOSED_OWNER, ...overrides })
}

describe('AcceptTokenOwnership (cct/evm)', () => {
  describe('generate', () => {
    it('encodes acceptOwnership(), identically for v1.5.1 and v1.6.2', async () => {
      const unsigned = await generate(stubChain())
      const tx = unsigned.transactions[0]!

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      assert.equal(tx.to, TOKEN)
      assert.equal(tx.from, PROPOSED_OWNER)
      assert.equal(tx.data, EXPECTED)
    })

    it('touches no RPC at all — nothing to resolve, and the pending owner has no getter', async () => {
      let calls = 0
      await generate(stubChain({ onCall: () => (calls += 1) }))
      assert.equal(calls, 0)
    })

    it('omits from when sender is not supplied', async () => {
      const unsigned = await generate(stubChain(), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(unsigned.transactions[0]!.data, EXPECTED)
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['tokenAddress', 'not-an-address'],
      ['tokenAddress', ZeroAddress],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${value}`, async () => {
        await assert.rejects(
          () => generate(stubChain(), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'acceptTokenOwnership' &&
            err.context.param === param,
        )
      })
    }
  })

  describe('execute', () => {
    const params = { tokenAddress: TOKEN }

    it('signs and submits as the proposed owner, resolving to the tx hash', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps an on-chain revert — e.g. Must be proposed owner — to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(PROPOSED_OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'acceptTokenOwnership',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: {} }),
        CCIPWalletInvalidError,
      )
    })

    it('rejects a sender that is not the executing wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, sender: SOMEONE_ELSE, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('accepts any signer — the proposed owner cannot be verified before broadcast', async () => {
      assert.deepEqual(
        await op.execute(stubChain(), { ...params, wallet: fakeSigner(SOMEONE_ELSE) }),
        { hash: HASH },
      )
    })
  })
})
