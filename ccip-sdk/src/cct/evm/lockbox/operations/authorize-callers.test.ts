import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress, getIcapAddress, makeError } from 'ethers'

import {
  CCIPExecTxRevertedError,
  CCIPTypeVersionInvalidError,
  CCIPWalletInvalidError,
} from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { AuthorizeLockboxCallers } from './authorize-callers.ts'

const SENDER = '0x' + '11'.repeat(20)
const LOCKBOX = '0x' + '66'.repeat(20)
const POOL = '0x' + '77'.repeat(20)
const OTHER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const NOT_THE_OWNER = '0x' + '99'.repeat(20)

/** Fresh `owner()` interface for the stubbed provider — never the SDK's cached one. */
const OWNER_IFACE = new Interface(['function owner() view returns (address)'])

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

/** What the stubbed chain was asked to do, in order, so the pre-flight's position is assertable. */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * Minimal EVMChain stub. The build path reads `typeAndVersion` on the lockbox, which defaults to
 * a deployed, supported `ERC20LockBox`, then `owner()` when a `sender` is known, which defaults
 * to `SENDER`. `readError` replaces the `typeAndVersion` read with a failure, standing in for an
 * address with no contract code (`BAD_DATA`) or a reverting read.
 */
function stubChain({
  type = 'ERC20LockBox',
  version = '2.0.0',
  owner = SENDER,
  readError,
  seen = newSeen(),
}: {
  type?: string
  version?: string
  owner?: string
  readError?: Error
  seen?: Seen
} = {}): EVMChain {
  return {
    provider: {
      call: ({ to, data }: { to: string; data: string }) => {
        const fn = OWNER_IFACE.getFunction(data.slice(0, 10))!.name
        seen.calls.push(`${fn}:${to}`)
        return Promise.resolve(OWNER_IFACE.encodeFunctionResult(fn, [owner]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    nextNonce: async () => 0,
    rollbackNonce: () => {},
    typeAndVersion: (address: string) => {
      seen.calls.push(`typeAndVersion:${address}`)
      if (readError) return Promise.reject(readError)
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

/** ethers' shape for a call whose target has no code: an empty return that cannot be decoded. */
const noCodeError = () =>
  makeError('could not decode result data', 'BAD_DATA', { value: '0x', info: {} })

/** Fake ethers Signer for a plain (non-deployment) tx; records broadcasts in `seen`. */
function fakeSigner(opts: { waitError?: Error; seen?: Seen; address?: string } = {}) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(opts.address ?? SENDER),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () => {
      opts.seen?.calls.push('sendTransaction')
      return Promise.resolve({
        hash: HASH,
        wait: () =>
          opts.waitError
            ? Promise.reject(opts.waitError)
            : Promise.resolve({ status: 1, contractAddress: null }),
      })
    },
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

  describe('lockbox pre-flight', () => {
    it('reads the lockbox typeAndVersion before building calldata', async () => {
      const seen = newSeen()
      await new AuthorizeLockboxCallers().generate(stubChain({ seen }), {
        lockbox: LOCKBOX,
        addedCallers: [POOL],
      })
      assert.deepEqual(seen.calls, [`typeAndVersion:${LOCKBOX}`])
    })

    it('rejects an address with no contract code', async () => {
      const readError = noCodeError()
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain({ readError }), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'authorizeLockboxCallers' &&
          err.context.param === 'lockbox' &&
          err.cause === readError,
      )
    })

    it('rejects a reverting typeAndVersion read, keeping it as the cause', async () => {
      const readError = makeError('execution reverted', 'CALL_EXCEPTION', {
        action: 'call',
        data: '0x',
        reason: null,
        transaction: { to: LOCKBOX, data: '0x' },
        invocation: null,
        revert: null,
      })
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain({ readError }), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'lockbox' &&
          err.cause === readError,
      )
    })

    it('propagates a transport failure unwrapped, rather than blaming the address', async () => {
      // a rate limit or a dead RPC says nothing about the lockbox; only CALL_EXCEPTION/BAD_DATA do
      const readError = makeError('request timeout', 'TIMEOUT', {
        operation: 'call',
        reason: 'timeout',
      })
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain({ readError }), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
          }),
        (err: unknown) => err === readError,
      )
    })

    it('rejects a contract whose typeAndVersion string is unparseable', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain({ type: 'garbage', version: 'x' }), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
          }),
        (err: unknown) => err instanceof CCIPTypeVersionInvalidError,
      )
    })

    it('rejects a deployed contract that is not an ERC20LockBox', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain({ type: 'LockReleaseTokenPool' }), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
          }),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === LOCKBOX &&
          err.context.expected === 'ERC20LockBox' &&
          err.context.actual === 'LockReleaseTokenPool',
      )
    })

    it('rejects an unsupported ERC20LockBox version', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain({ version: '3.0.0' }), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
          }),
        (err: unknown) =>
          err instanceof CCTContractVersionUnsupportedError &&
          err.context.contractType === 'ERC20LockBox' &&
          err.context.version === '3.0.0' &&
          err.context.address === LOCKBOX,
      )
    })
  })

  describe('owner pre-flight', () => {
    it('reads owner() after typeAndVersion, only when a sender is given', async () => {
      const seen = newSeen()
      await new AuthorizeLockboxCallers().generate(stubChain({ seen }), {
        lockbox: LOCKBOX,
        addedCallers: [POOL],
        sender: SENDER,
      })
      assert.deepEqual(seen.calls, [`typeAndVersion:${LOCKBOX}`, `owner:${LOCKBOX}`])
    })

    it('accepts the owner as sender regardless of address casing', async () => {
      const lower = '0x' + 'ab'.repeat(20)
      const unsigned = await new AuthorizeLockboxCallers().generate(
        stubChain({ owner: getAddress(lower) }),
        { lockbox: LOCKBOX, addedCallers: [POOL], sender: lower },
      )
      assert.equal(unsigned.transactions[0]!.from, lower)
    })

    it('rejects a sender that is not the lockbox owner', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().generate(stubChain(), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
            sender: NOT_THE_OWNER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'authorizeLockboxCallers' &&
          err.context.param === 'sender',
      )
    })

    it('does not read owner() when the lockbox check fails', async () => {
      const seen = newSeen()
      await assert.rejects(() =>
        new AuthorizeLockboxCallers().generate(stubChain({ type: 'Router', seen }), {
          lockbox: LOCKBOX,
          addedCallers: [POOL],
          sender: SENDER,
        }),
      )
      assert.deepEqual(seen.calls, [`typeAndVersion:${LOCKBOX}`])
    })
  })

  describe('execute', () => {
    it('checks the signing wallet against the lockbox owner', async () => {
      const seen = newSeen()
      await new AuthorizeLockboxCallers().execute(stubChain({ seen }), {
        lockbox: LOCKBOX,
        addedCallers: [POOL],
        wallet: fakeSigner({ seen }),
      })
      assert.deepEqual(seen.calls, [
        `typeAndVersion:${LOCKBOX}`,
        `owner:${LOCKBOX}`,
        'sendTransaction',
      ])
    })

    it('does not sign or broadcast when the wallet is not the lockbox owner', async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().execute(stubChain(), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
            wallet: fakeSigner({ seen, address: NOT_THE_OWNER }),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
      assert.deepEqual(seen.calls, [])
    })

    it('rejects a sender that differs from the signing wallet', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().execute(stubChain(), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
            sender: NOT_THE_OWNER,
            wallet: fakeSigner(),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('signs, submits, and returns the tx hash', async () => {
      const result = await new AuthorizeLockboxCallers().execute(stubChain(), {
        lockbox: LOCKBOX,
        addedCallers: [POOL],
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('accepts a sender matching the signing wallet', async () => {
      const result = await new AuthorizeLockboxCallers().execute(stubChain(), {
        lockbox: LOCKBOX,
        addedCallers: [POOL],
        sender: SENDER,
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a sender that differs from the signing wallet', async () => {
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().execute(stubChain(), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
            sender: OTHER,
            wallet: fakeSigner(),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'authorizeLockboxCallers' &&
          err.context.param === 'sender',
      )
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

    it('revokes a caller and returns the tx hash', async () => {
      const result = await new AuthorizeLockboxCallers().execute(stubChain(), {
        lockbox: LOCKBOX,
        removedCallers: [POOL],
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('does not sign or broadcast when the lockbox is not deployed', async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          new AuthorizeLockboxCallers().execute(stubChain({ readError: noCodeError() }), {
            lockbox: LOCKBOX,
            addedCallers: [POOL],
            wallet: fakeSigner({ seen }),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'lockbox',
      )
      assert.deepEqual(seen.calls, [])
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
