import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress, getIcapAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import {
  CCTContractTypeInvalidError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { type PoolStub, POOL, withPool } from '../pool.test.helpers.ts'
import { UpdateAdvancedPoolHooksAuthorizedCallers } from './update-authorized-callers.ts'

const SENDER = '0x' + '11'.repeat(20)
const HOOKS = '0x' + '66'.repeat(20)
const CALLER = '0x' + '77'.repeat(20) // the pool being authorized
const OTHER = '0x' + '88'.repeat(20)
const DUPLICATE_CALLER = '0x' + 'aa'.repeat(20)
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
 * Minimal EVMChain stub. The build path first resolves the hooks from {@link POOL} (its
 * `typeAndVersion`, then `getAdvancedPoolHooks()`, answered per `pool` and bound to {@link HOOKS}
 * by default), then reads `typeAndVersion` on the hooks, which defaults to a deployed, supported
 * `AdvancedPoolHooks`, then `owner()` when a `sender` is known, which defaults to `SENDER`.
 * `readError` replaces the hooks' `typeAndVersion` read with a failure, standing in for an address
 * with no contract code (`BAD_DATA`) or a reverting read. Every read lands in `seen`, in order.
 */
function stubChain({
  type = 'AdvancedPoolHooks',
  version = '2.0.0',
  owner = SENDER,
  readError,
  seen = newSeen(),
  pool = {},
}: {
  type?: string
  version?: string
  owner?: string
  readError?: Error
  seen?: Seen
  pool?: Partial<PoolStub>
} = {}): EVMChain {
  return withPool(
    {
      provider: {
        call: ({ to, data }: { to: string; data: string }) => {
          const fn = OWNER_IFACE.getFunction(data.slice(0, 10))!.name
          seen.calls.push(`${fn}:${to}`)
          return Promise.resolve(OWNER_IFACE.encodeFunctionResult(fn, [owner]))
        },
      },
      network: networkInfo('ethereum-testnet-sepolia-base-1'),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      nextNonce: async () => 0,
      rollbackNonce: () => {},
      typeAndVersion: (address: string) => {
        seen.calls.push(`typeAndVersion:${address}`)
        if (readError) return Promise.reject(readError)
        return Promise.resolve([type, version])
      },
    } as unknown as EVMChain,
    { hooks: HOOKS, onCall: (call) => seen.calls.push(call), ...pool },
  )
}

/** The reads that resolve {@link HOOKS} from {@link POOL}, ahead of any hooks read. */
const RESOLVE = [`typeAndVersion:${POOL}`, `getAdvancedPoolHooks:${POOL}`]

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

describe('UpdateAdvancedPoolHooksAuthorizedCallers (cct/evm advanced-pool-hooks operation)', () => {
  describe('generate (golden vectors)', () => {
    it("encodes an added caller as a call to the pool's bound hooks", async () => {
      const unsigned = await new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
        poolAddress: POOL,
        addedCallers: [CALLER],
        sender: SENDER,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, HOOKS)
      assert.equal(tx.from, SENDER)
      assert.ok(
        tx.data!.startsWith(SELECTOR),
        'data carries the applyAuthorizedCallerUpdates selector',
      )
      // addedCallers:[CALLER], removedCallers:[] — added array holds CALLER, removed is empty.
      assert.equal(tx.data, SELECTOR + W_TUPLE + OFF_40 + OFF_80 + LEN_1 + word(CALLER) + LEN_0)
    })

    it('encodes both added and removed callers', async () => {
      const unsigned = await new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
        poolAddress: POOL,
        addedCallers: [CALLER],
        removedCallers: [OTHER],
      })
      // CALLER sits in the added array, OTHER in the removed array — swapping them changes these bytes.
      assert.equal(
        unsigned.transactions[0]!.data,
        SELECTOR + W_TUPLE + OFF_40 + OFF_80 + LEN_1 + word(CALLER) + LEN_1 + word(OTHER),
      )
    })

    it('defaults omitted caller arrays to empty', async () => {
      const unsigned = await new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
        poolAddress: POOL,
        removedCallers: [OTHER],
      })
      // addedCallers omitted -> empty; OTHER lands in the removed array (removed offset is 0x60).
      assert.equal(
        unsigned.transactions[0]!.data,
        SELECTOR + W_TUPLE + OFF_40 + OFF_60 + LEN_0 + LEN_1 + word(OTHER),
      )
    })

    it('omits `from` when no sender is given', async () => {
      const unsigned = await new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
        poolAddress: POOL,
        addedCallers: [CALLER],
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })
  })

  describe('validation', () => {
    it('rejects an invalid pool address', async () => {
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
            poolAddress: 'nope',
            addedCallers: [CALLER],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'updateAdvancedPoolHooksAuthorizedCallers' &&
          err.context.param === 'poolAddress',
      )
    })

    it('rejects a zero pool address', async () => {
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
            poolAddress: ZeroAddress,
            addedCallers: [CALLER],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'updateAdvancedPoolHooksAuthorizedCallers' &&
          err.context.param === 'poolAddress',
      )
    })

    it('rejects the zero address written in ICAP form', async () => {
      // isAddress() accepts ICAP, and this never equals ZeroAddress literally
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
            poolAddress: getIcapAddress(ZeroAddress),
            addedCallers: [CALLER],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'poolAddress',
      )
    })

    it('rejects when no callers are supplied', async () => {
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
            poolAddress: POOL,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'addedCallers',
      )
    })

    it('rejects when both caller arrays are empty', async () => {
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
            poolAddress: POOL,
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
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
            poolAddress: POOL,
            addedCallers: [CALLER, 'nope'],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'addedCallers[1]',
      )
    })

    it('rejects an invalid removed caller address', async () => {
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
            poolAddress: POOL,
            removedCallers: ['nope'],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'removedCallers[0]',
      )
    })

    it('rejects duplicate callers, including differently cased addresses', async () => {
      for (const param of ['addedCallers', 'removedCallers'] as const) {
        await assert.rejects(
          () =>
            new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
              poolAddress: POOL,
              [param]: [DUPLICATE_CALLER, `0x${DUPLICATE_CALLER.slice(2).toUpperCase()}`],
            }),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })

    it('rejects the zero address as a caller', async () => {
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
            poolAddress: POOL,
            addedCallers: [ZeroAddress],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'addedCallers[0]',
      )
    })

    it('rejects an invalid sender', async () => {
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
            poolAddress: POOL,
            addedCallers: [CALLER],
            sender: 'nope',
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })
  })

  describe('pool resolution', () => {
    it('rejects a pre-v2.0.0 pool as unsupported, reading no binding and no hooks', async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(
            stubChain({ seen, pool: { typeAndVersion: 'BurnMintTokenPool 1.6.1' } }),
            { poolAddress: POOL, addedCallers: [CALLER], sender: SENDER },
          ),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'updateAdvancedPoolHooksAuthorizedCallers',
      )
      assert.deepEqual(seen.calls, [`typeAndVersion:${POOL}`])
    })

    it('rejects a pool with no hooks bound, reading nothing from the hooks', async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(
            stubChain({ seen, pool: { hooks: ZeroAddress } }),
            { poolAddress: POOL, addedCallers: [CALLER], sender: SENDER },
          ),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'poolAddress' &&
          err.message.includes('updateAdvancedPoolHooks'),
      )
      assert.deepEqual(seen.calls, RESOLVE)
    })
  })

  describe('hooks pre-flight', () => {
    it('resolves the hooks from the pool, then reads their typeAndVersion, before building calldata', async () => {
      const seen = newSeen()
      await new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain({ seen }), {
        poolAddress: POOL,
        addedCallers: [CALLER],
      })
      assert.deepEqual(seen.calls, [...RESOLVE, `typeAndVersion:${HOOKS}`])
    })

    it('rejects an address with no contract code', async () => {
      const readError = noCodeError()
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain({ readError }), {
            poolAddress: POOL,
            addedCallers: [CALLER],
          }),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === HOOKS &&
          err.context.actual === 'unknown' &&
          err.cause === readError,
      )
    })

    it('rejects a reverting typeAndVersion read, keeping it as the cause', async () => {
      const readError = makeError('execution reverted', 'CALL_EXCEPTION', {
        action: 'call',
        data: '0x',
        reason: null,
        transaction: { to: HOOKS, data: '0x' },
        invocation: null,
        revert: null,
      })
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain({ readError }), {
            poolAddress: POOL,
            addedCallers: [CALLER],
          }),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === HOOKS &&
          err.context.actual === 'unknown' &&
          err.cause === readError,
      )
    })

    it('wraps a transport failure as an unknown hooks contract', async () => {
      const readError = makeError('request timeout', 'TIMEOUT', {
        operation: 'call',
        reason: 'timeout',
      })
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain({ readError }), {
            poolAddress: POOL,
            addedCallers: [CALLER],
          }),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === HOOKS &&
          err.context.actual === 'unknown' &&
          err.cause === readError,
      )
    })

    it('rejects a deployed contract that is not an AdvancedPoolHooks', async () => {
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(
            stubChain({ type: 'LockReleaseTokenPool' }),
            {
              poolAddress: POOL,
              addedCallers: [CALLER],
            },
          ),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === HOOKS &&
          err.context.expected === 'AdvancedPoolHooks' &&
          err.context.actual === 'LockReleaseTokenPool',
      )
    })
  })

  describe('owner pre-flight', () => {
    it("reads the hooks' owner() after their typeAndVersion, only when a sender is given", async () => {
      const seen = newSeen()
      await new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain({ seen }), {
        poolAddress: POOL,
        addedCallers: [CALLER],
        sender: SENDER,
      })
      assert.deepEqual(seen.calls, [...RESOLVE, `typeAndVersion:${HOOKS}`, `owner:${HOOKS}`])
    })

    it('accepts the owner as sender regardless of address casing', async () => {
      const lower = '0x' + 'ab'.repeat(20)
      const unsigned = await new UpdateAdvancedPoolHooksAuthorizedCallers().generate(
        stubChain({ owner: getAddress(lower) }),
        { poolAddress: POOL, addedCallers: [CALLER], sender: lower },
      )
      assert.equal(unsigned.transactions[0]!.from, lower)
    })

    it('rejects a sender that is not the hooks owner', async () => {
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().generate(stubChain(), {
            poolAddress: POOL,
            addedCallers: [CALLER],
            sender: NOT_THE_OWNER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'updateAdvancedPoolHooksAuthorizedCallers' &&
          err.context.param === 'sender',
      )
    })

    it('does not read owner() when the hooks check fails', async () => {
      const seen = newSeen()
      await assert.rejects(() =>
        new UpdateAdvancedPoolHooksAuthorizedCallers().generate(
          stubChain({ type: 'Router', seen }),
          {
            poolAddress: POOL,
            addedCallers: [CALLER],
            sender: SENDER,
          },
        ),
      )
      assert.deepEqual(seen.calls, [...RESOLVE, `typeAndVersion:${HOOKS}`])
    })
  })

  describe('execute', () => {
    it('checks the signing wallet against the hooks owner', async () => {
      const seen = newSeen()
      await new UpdateAdvancedPoolHooksAuthorizedCallers().execute(stubChain({ seen }), {
        poolAddress: POOL,
        addedCallers: [CALLER],
        wallet: fakeSigner({ seen }),
      })
      assert.deepEqual(seen.calls, [
        ...RESOLVE,
        `typeAndVersion:${HOOKS}`,
        `owner:${HOOKS}`,
        'sendTransaction',
      ])
    })

    it('does not sign or broadcast when the wallet is not the hooks owner', async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().execute(stubChain(), {
            poolAddress: POOL,
            addedCallers: [CALLER],
            wallet: fakeSigner({ seen, address: NOT_THE_OWNER }),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
      assert.deepEqual(seen.calls, [])
    })

    it('rejects a sender that differs from the signing wallet', async () => {
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().execute(stubChain(), {
            poolAddress: POOL,
            addedCallers: [CALLER],
            sender: NOT_THE_OWNER,
            wallet: fakeSigner(),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('signs, submits, and returns the tx hash', async () => {
      const result = await new UpdateAdvancedPoolHooksAuthorizedCallers().execute(stubChain(), {
        poolAddress: POOL,
        addedCallers: [CALLER],
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('accepts a sender matching the signing wallet', async () => {
      const result = await new UpdateAdvancedPoolHooksAuthorizedCallers().execute(stubChain(), {
        poolAddress: POOL,
        addedCallers: [CALLER],
        sender: SENDER,
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('throws CCIPExecTxRevertedError when the tx reverts on-chain', async () => {
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().execute(stubChain(), {
            poolAddress: POOL,
            addedCallers: [CALLER],
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'updateAdvancedPoolHooksAuthorizedCallers',
      )
    })

    it('revokes a caller and returns the tx hash', async () => {
      const result = await new UpdateAdvancedPoolHooksAuthorizedCallers().execute(stubChain(), {
        poolAddress: POOL,
        removedCallers: [CALLER],
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('does not sign or broadcast when the bound hooks are not deployed', async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().execute(
            stubChain({ readError: noCodeError() }),
            {
              poolAddress: POOL,
              addedCallers: [CALLER],
              wallet: fakeSigner({ seen }),
            },
          ),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === HOOKS &&
          err.context.actual === 'unknown',
      )
      assert.deepEqual(seen.calls, [])
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () =>
          new UpdateAdvancedPoolHooksAuthorizedCallers().execute(stubChain(), {
            poolAddress: POOL,
            addedCallers: [CALLER],
            wallet: {},
          }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
