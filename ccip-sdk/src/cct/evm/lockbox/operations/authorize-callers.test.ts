import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, getIcapAddress, makeError } from 'ethers'

import { AuthorizeLockboxCallers } from './authorize-callers.ts'
import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const SENDER = '0x' + '11'.repeat(20)
const LOCKBOX = '0x' + '66'.repeat(20)
const POOL = '0x' + '77'.repeat(20)
const OTHER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

// applyAuthorizedCallerUpdates selector, per the vendored ABI (spec-pinned).
const SELECTOR = '0x91a2749a'
// Golden vectors: full literal calldata, hand-encoded from the ABI layout of
// applyAuthorizedCallerUpdates((address[] addedCallers, address[] removedCallers)) — a dynamic
// tuple of two dynamic address[] arrays. Pinning the whole byte string (rather than re-encoding
// through the SDK's own ABI) anchors every caller's position, so an added/removed swap or an
// ABI-ordering regression is caught instead of being mirrored into the expectation.
const W_TUPLE = '0000000000000000000000000000000000000000000000000000000000000020' // -> tuple
const OFF_40 = '0000000000000000000000000000000000000000000000000000000000000040'
const OFF_60 = '0000000000000000000000000000000000000000000000000000000000000060'
const OFF_80 = '0000000000000000000000000000000000000000000000000000000000000080'
const LEN_0 = '0000000000000000000000000000000000000000000000000000000000000000'
const LEN_1 = '0000000000000000000000000000000000000000000000000000000000000001'
// 20-byte address left-padded to a 32-byte word.
const word = (addr: string) => '000000000000000000000000' + addr.slice(2)

/** Minimal EVMChain stub — the build path ignores it; execute uses only these. */
function stubChain(): EVMChain {
  return {
    provider: {} as never,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    nextNonce: async () => 0,
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

/** Fake ethers Signer for a plain (non-deployment) tx. */
function fakeSigner(opts: { waitError?: Error } = {}) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(SENDER),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({
        hash: HASH,
        wait: () =>
          opts.waitError
            ? Promise.reject(opts.waitError)
            : Promise.resolve({ status: 1, contractAddress: null }),
      }),
  }
}

describe('AuthorizeLockboxCallers (cct/evm lockbox operation)', () => {
  describe('generate (golden vectors)', () => {
    it('encodes an added caller as a call to the lockbox', async () => {
      const unsigned = await new AuthorizeLockboxCallers().generate(stubChain(), {
        lockbox: LOCKBOX,
        addedCallers: [POOL],
        sender: SENDER,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, LOCKBOX)
      assert.equal(tx.from, SENDER)
      assert.ok(
        tx.data!.startsWith(SELECTOR),
        'data carries the applyAuthorizedCallerUpdates selector',
      )
      // addedCallers:[POOL], removedCallers:[] — added array holds POOL, removed is empty.
      assert.equal(tx.data, SELECTOR + W_TUPLE + OFF_40 + OFF_80 + LEN_1 + word(POOL) + LEN_0)
    })

    it('encodes both added and removed callers', async () => {
      const unsigned = await new AuthorizeLockboxCallers().generate(stubChain(), {
        lockbox: LOCKBOX,
        addedCallers: [POOL],
        removedCallers: [OTHER],
      })
      // POOL sits in the added array, OTHER in the removed array — swapping them changes these bytes.
      assert.equal(
        unsigned.transactions[0]!.data,
        SELECTOR + W_TUPLE + OFF_40 + OFF_80 + LEN_1 + word(POOL) + LEN_1 + word(OTHER),
      )
    })

    it('defaults omitted caller arrays to empty', async () => {
      const unsigned = await new AuthorizeLockboxCallers().generate(stubChain(), {
        lockbox: LOCKBOX,
        removedCallers: [OTHER],
      })
      // addedCallers omitted -> empty; OTHER lands in the removed array (removed offset is 0x60).
      assert.equal(
        unsigned.transactions[0]!.data,
        SELECTOR + W_TUPLE + OFF_40 + OFF_60 + LEN_0 + LEN_1 + word(OTHER),
      )
    })

    it('omits `from` when no sender is given', async () => {
      const unsigned = await new AuthorizeLockboxCallers().generate(stubChain(), {
        lockbox: LOCKBOX,
        addedCallers: [POOL],
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })
  })

  describe('validation', () => {
    it('rejects an invalid lockbox address', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain(), {
            lockbox: 'nope',
            addedCallers: [POOL],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'authorizeLockboxCallers' &&
          err.context.param === 'lockbox',
      )
    })

    it('rejects a zero-address lockbox', async () => {
      // a call to 0x0 hits no code, so it would mine as a successful no-op
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain(), {
            lockbox: ZeroAddress,
            addedCallers: [POOL],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'authorizeLockboxCallers' &&
          err.context.param === 'lockbox',
      )
    })

    it('rejects the zero address written in ICAP form', async () => {
      // isAddress() accepts ICAP, and this never equals ZeroAddress literally
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain(), {
            lockbox: getIcapAddress(ZeroAddress),
            addedCallers: [POOL],
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'lockbox',
      )
    })

    it('rejects when no callers are supplied', async () => {
      await assert.rejects(
        () => new AuthorizeLockboxCallers().generate(stubChain(), { lockbox: LOCKBOX }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'addedCallers',
      )
    })

    it('rejects when both caller arrays are empty', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain(), {
            lockbox: LOCKBOX,
            addedCallers: [],
            removedCallers: [],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'addedCallers',
      )
    })

    it('rejects an invalid added caller address', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain(), {
            lockbox: LOCKBOX,
            addedCallers: [POOL, 'nope'],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'addedCallers[1]',
      )
    })

    it('rejects an invalid removed caller address', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain(), {
            lockbox: LOCKBOX,
            removedCallers: ['nope'],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'removedCallers[0]',
      )
    })

    it('rejects the zero address as a caller', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain(), {
            lockbox: LOCKBOX,
            addedCallers: [ZeroAddress],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'addedCallers[0]',
      )
    })

    it('rejects an invalid sender', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain(), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
            sender: 'nope',
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await new AuthorizeLockboxCallers().execute(stubChain(), {
        lockbox: LOCKBOX,
        addedCallers: [POOL],
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('throws CCIPExecTxRevertedError when the tx reverts on-chain', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().execute(stubChain(), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'authorizeLockboxCallers',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().execute(stubChain(), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
            wallet: {},
          }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
