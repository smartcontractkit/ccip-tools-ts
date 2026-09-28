import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, MaxUint256, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTParamsInvalidError,
  CCTTxFailedError,
} from '../../../errors.ts'
import { WithdrawFromLockbox } from './withdraw.ts'

const SENDER = '0x' + '11'.repeat(20)
const RECIPIENT = '0x' + '22'.repeat(20)
const LOCKBOX = '0x' + '66'.repeat(20)
const TOKEN = '0x' + '77'.repeat(20)
const OTHER_TOKEN = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const AMOUNT = 1_000000000000000000n

// withdraw(address,uint64,uint256,address) selector, per the vendored ABI (spec-pinned).
const SELECTOR = '0x74fd18ac'
/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived lockbox interface.
 */
const IFACE = new Interface([
  'function withdraw(address token, uint64 remoteChainSelector, uint256 amount, address recipient)',
])
const dataFor = (token: string, amount: bigint, recipient: string) =>
  IFACE.encodeFunctionData('withdraw', [token, 0n, amount, recipient])
/** 20-byte address left-padded to a 32-byte word. */
const word = (addr: string) => '000000000000000000000000' + addr.slice(2)
/** A bigint as a 32-byte word. */
const num = (v: bigint) => v.toString(16).padStart(64, '0')

/**
 * Lockbox reads, answered off a fresh Interface built from the signature literals, so the stub is
 * independent of the SDK's cached lockbox interface.
 */
const LOCKBOX_READS = new Interface([
  'function getToken() view returns (address)',
  'function getAllAuthorizedCallers() view returns (address[])',
])

/** The lockbox's own token balance, which is what a withdrawal pays out of. */
const ERC20 = new Interface(['function balanceOf(address account) view returns (uint256)'])

/** What the stubbed chain was asked, in order, so each pre-flight's position is assertable. */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * EVMChain stub: `typeAndVersion` reports the requested lockbox type/version, and `provider.call`
 * answers every read this op can make — `getToken()` and `getAllAuthorizedCallers()` on the
 * lockbox, then `balanceOf` on the escrowed token. Any other selector reverts, which is what pins
 * "no other RPC"; in particular an `allowance` read would, since a withdrawal needs none.
 */
function stubChain({
  type = 'ERC20LockBox',
  version = '2.0.0',
  token = TOKEN,
  callers = [SENDER],
  balance = AMOUNT,
  seen = newSeen(),
}: {
  type?: string
  version?: string
  /** The token the lockbox reports escrowing; defaults to the one being withdrawn. */
  token?: string
  /** The lockbox's authorized-caller set; defaults to just the sender. */
  callers?: string[]
  /** The lockbox's balance of the escrowed token; defaults to exactly the withdrawal. */
  balance?: bigint
  seen?: Seen
} = {}): EVMChain {
  const lockbox: Record<string, unknown[]> = {
    getToken: [token],
    getAllAuthorizedCallers: [callers],
  }
  return {
    provider: {
      call: ({ to, data }: { to: string; data: string }) => {
        const selector = data.slice(0, 10)
        const lockboxFn = LOCKBOX_READS.getFunction(selector)?.name
        if (lockboxFn && lockbox[lockboxFn]) {
          seen.calls.push(lockboxFn)
          return Promise.resolve(LOCKBOX_READS.encodeFunctionResult(lockboxFn, lockbox[lockboxFn]))
        }
        if (ERC20.getFunction(selector)?.name === 'balanceOf') {
          seen.calls.push(`balanceOf@${to}`)
          return Promise.resolve(ERC20.encodeFunctionResult('balanceOf', [balance]))
        }
        throw makeError('execution reverted', 'CALL_EXCEPTION', {
          action: 'call',
          data: '0x',
          reason: null,
          transaction: { to, data },
          invocation: null,
          revert: null,
        })
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

/** Fake ethers Signer for a plain (non-deployment) tx; records broadcasts in `seen`. */
function fakeSigner(opts: { waitError?: Error; seen?: Seen } = {}) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(SENDER),
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

const params = {
  lockbox: LOCKBOX,
  token: TOKEN,
  amount: AMOUNT,
  recipient: RECIPIENT,
}

describe('WithdrawFromLockbox (cct/evm lockbox operation)', () => {
  describe('generate (golden vectors)', () => {
    it('encodes withdraw as a call to the lockbox', async () => {
      const unsigned = await new WithdrawFromLockbox().generate(stubChain(), {
        ...params,
        sender: SENDER,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, LOCKBOX)
      assert.equal(tx.from, SENDER)
      // withdraw(token, remoteChainSelector, amount, recipient) — four static words, in order,
      // the second the selector v2.0.0 ignores, which the SDK pins at zero
      assert.equal(tx.data, SELECTOR + word(TOKEN) + num(0n) + num(AMOUNT) + word(RECIPIENT))
      assert.equal(tx.data, dataFor(TOKEN, AMOUNT, RECIPIENT))
    })

    it('sends to a recipient other than the caller', async () => {
      const unsigned = await new WithdrawFromLockbox().generate(stubChain(), {
        ...params,
        recipient: SENDER,
        sender: SENDER,
      })
      assert.equal(unsigned.transactions[0]!.data, dataFor(TOKEN, AMOUNT, SENDER))
    })

    it('omits `from` when no sender is given', async () => {
      const unsigned = await new WithdrawFromLockbox().generate(stubChain(), params)
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['lockbox', 'nope'],
      ['lockbox', ZeroAddress],
      ['token', 'nope'],
      ['token', ZeroAddress],
      ['recipient', 'nope'],
      ['recipient', ZeroAddress],
      ['sender', 'nope'],
    ] as const) {
      it(`rejects an invalid ${param} (${value})`, async () => {
        await assert.rejects(
          () => new WithdrawFromLockbox().generate(stubChain(), { ...params, [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'withdrawFromLockbox' &&
            err.context.param === param,
        )
      })
    }

    it('rejects a zero amount, which reverts TokenAmountCannotBeZero', async () => {
      await assert.rejects(
        () => new WithdrawFromLockbox().generate(stubChain(), { ...params, amount: 0n }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'amount',
      )
    })

    it('validates params before any RPC', async () => {
      const seen = newSeen()
      await assert.rejects(() =>
        new WithdrawFromLockbox().generate(stubChain({ seen }), { ...params, amount: 0n }),
      )
      assert.deepEqual(seen.calls, [])
    })
  })

  describe('drain sentinel', () => {
    it('accepts MaxUint256, which the lockbox reads as "the whole balance"', async () => {
      const unsigned = await new WithdrawFromLockbox().generate(stubChain({ balance: 0n }), {
        ...params,
        amount: MaxUint256,
        sender: SENDER,
      })
      assert.equal(unsigned.transactions[0]!.data, dataFor(TOKEN, MaxUint256, RECIPIENT))
    })

    it('skips the balance check for MaxUint256, which can never be short', async () => {
      const seen = newSeen()
      await new WithdrawFromLockbox().generate(stubChain({ balance: 0n, seen }), {
        ...params,
        amount: MaxUint256,
        sender: SENDER,
      })
      assert.deepEqual(seen.calls, ['typeAndVersion', 'getToken', 'getAllAuthorizedCallers'])
    })
  })

  describe('pre-flight', () => {
    it('rejects a lockbox that escrows a different token', async () => {
      await assert.rejects(
        () =>
          new WithdrawFromLockbox().generate(stubChain({ token: OTHER_TOKEN }), {
            ...params,
            sender: SENDER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'token' &&
          err.message.includes(OTHER_TOKEN),
      )
    })

    it('rejects a sender that is not an authorized caller', async () => {
      await assert.rejects(
        () =>
          new WithdrawFromLockbox().generate(stubChain({ callers: [OTHER_TOKEN] }), {
            ...params,
            sender: SENDER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          err.message.includes('authorizeLockboxCallers'),
      )
    })

    it('rejects a withdrawal larger than the lockbox holds', async () => {
      await assert.rejects(
        () =>
          new WithdrawFromLockbox().generate(stubChain({ balance: AMOUNT - 1n }), {
            ...params,
            sender: SENDER,
          }),
        (err: unknown) =>
          err instanceof CCTTxFailedError && err.message.includes('InsufficientBalance'),
      )
    })

    it('checks the lockbox balance even without a sender, being a lockbox property', async () => {
      const seen = newSeen()
      await new WithdrawFromLockbox().generate(stubChain({ seen }), params)
      assert.deepEqual(seen.calls, ['typeAndVersion', 'getToken', `balanceOf@${TOKEN}`])
    })

    it('rejects a lockbox address holding some other contract', async () => {
      await assert.rejects(
        () =>
          new WithdrawFromLockbox().generate(stubChain({ type: 'LockReleaseTokenPool' }), params),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError && err.context.expected === 'ERC20LockBox',
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await new WithdrawFromLockbox().execute(stubChain(), {
        ...params,
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('defaults sender to the signing wallet, so the caller check always runs', async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          new WithdrawFromLockbox().execute(stubChain({ callers: [], seen }), {
            ...params,
            wallet: fakeSigner({ seen }),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
      assert.ok(!seen.calls.includes('sendTransaction'), 'nothing was broadcast')
    })

    it('throws CCIPExecTxRevertedError when the tx reverts on-chain', async () => {
      await assert.rejects(
        () =>
          new WithdrawFromLockbox().execute(stubChain(), {
            ...params,
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'withdrawFromLockbox',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => new WithdrawFromLockbox().execute(stubChain(), { ...params, wallet: {} }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
