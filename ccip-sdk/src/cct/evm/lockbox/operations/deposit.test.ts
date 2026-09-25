import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTParamsInvalidError,
  CCTTxFailedError,
} from '../../../errors.ts'
import { DepositToLockbox } from './deposit.ts'

const SENDER = '0x' + '11'.repeat(20)
const LOCKBOX = '0x' + '66'.repeat(20)
const TOKEN = '0x' + '77'.repeat(20)
const OTHER_TOKEN = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const AMOUNT = 1_000000000000000000n

// deposit(address,uint64,uint256) selector, per the vendored ABI (spec-pinned).
const SELECTOR = '0xa36a7fee'
/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived lockbox interface.
 */
const IFACE = new Interface([
  'function deposit(address token, uint64 remoteChainSelector, uint256 amount)',
])
const dataFor = (token: string, amount: bigint) =>
  IFACE.encodeFunctionData('deposit', [token, 0n, amount])
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

/** ERC-20 side of the funding pre-flight, likewise off a fresh Interface. */
const ERC20 = new Interface([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
])

/** What the stubbed chain was asked, in order, so each pre-flight's position is assertable. */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * EVMChain stub: `typeAndVersion` reports the requested lockbox type/version, and `provider.call`
 * answers every read this op can make — `getToken()` and `getAllAuthorizedCallers()` on the
 * lockbox, then `balanceOf` / `allowance` on the escrowed token. Any other selector reverts,
 * which is what pins "no other RPC". ERC-20 calls are recorded with their target, so "approved to
 * the lockbox, not to the pool" is assertable.
 */
function stubChain({
  type = 'ERC20LockBox',
  version = '2.0.0',
  token = TOKEN,
  callers = [SENDER],
  balance = AMOUNT,
  allowance = AMOUNT,
  seen = newSeen(),
}: {
  type?: string
  version?: string
  /** The token the lockbox reports escrowing; defaults to the one being deposited. */
  token?: string
  /** The lockbox's authorized-caller set; defaults to just the sender. */
  callers?: string[]
  /** The depositor's token balance; defaults to exactly the deposit. */
  balance?: bigint
  /** The depositor's approval to the lockbox; defaults to exactly the deposit. */
  allowance?: bigint
  seen?: Seen
} = {}): EVMChain {
  const lockbox: Record<string, unknown[]> = {
    getToken: [token],
    getAllAuthorizedCallers: [callers],
  }
  const erc20: Record<string, unknown[]> = { balanceOf: [balance], allowance: [allowance] }
  return {
    provider: {
      call: ({ to, data }: { to: string; data: string }) => {
        const selector = data.slice(0, 10)
        const lockboxFn = LOCKBOX_READS.getFunction(selector)?.name
        if (lockboxFn && lockbox[lockboxFn]) {
          seen.calls.push(lockboxFn)
          return Promise.resolve(LOCKBOX_READS.encodeFunctionResult(lockboxFn, lockbox[lockboxFn]))
        }
        const tokenFn = ERC20.getFunction(selector)?.name
        if (tokenFn && erc20[tokenFn]) {
          seen.calls.push(`${tokenFn}@${to}`)
          return Promise.resolve(ERC20.encodeFunctionResult(tokenFn, erc20[tokenFn]))
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
}

describe('DepositToLockbox (cct/evm lockbox operation)', () => {
  describe('generate (golden vectors)', () => {
    it('encodes deposit as a call to the lockbox', async () => {
      const unsigned = await new DepositToLockbox().generate(stubChain(), {
        ...params,
        sender: SENDER,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, LOCKBOX)
      assert.equal(tx.from, SENDER)
      // deposit(token, remoteChainSelector, amount) — three static words, in that order, the
      // middle one the selector v2.0.0 ignores, which the SDK pins at zero
      assert.equal(tx.data, SELECTOR + word(TOKEN) + num(0n) + num(AMOUNT))
      assert.equal(tx.data, dataFor(TOKEN, AMOUNT))
    })

    it('omits `from` when no sender is given', async () => {
      const unsigned = await new DepositToLockbox().generate(stubChain(), params)
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })

    it('encodes the selector v2.0.0 ignores as zero, with no param for it', async () => {
      const unsigned = await new DepositToLockbox().generate(stubChain(), params)
      // the second word is the ignored uint64; pinned so a future param cannot silently change it
      assert.equal(unsigned.transactions[0]!.data!.slice(74, 138), num(0n))
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['lockbox', 'nope'],
      ['lockbox', ZeroAddress],
      ['token', 'nope'],
      ['token', ZeroAddress],
      ['sender', 'nope'],
    ] as const) {
      it(`rejects an invalid ${param} (${value})`, async () => {
        await assert.rejects(
          () => new DepositToLockbox().generate(stubChain(), { ...params, [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'depositToLockbox' &&
            err.context.param === param,
        )
      })
    }

    it('rejects a zero amount, which reverts TokenAmountCannotBeZero', async () => {
      await assert.rejects(
        () => new DepositToLockbox().generate(stubChain(), { ...params, amount: 0n }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'amount',
      )
    })

    it('validates params before any RPC', async () => {
      const seen = newSeen()
      await assert.rejects(() =>
        new DepositToLockbox().generate(stubChain({ seen }), { ...params, amount: 0n }),
      )
      assert.deepEqual(seen.calls, [])
    })
  })

  describe('pre-flight', () => {
    it('rejects a lockbox that escrows a different token', async () => {
      await assert.rejects(
        () =>
          new DepositToLockbox().generate(stubChain({ token: OTHER_TOKEN }), {
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
          new DepositToLockbox().generate(stubChain({ callers: [OTHER_TOKEN] }), {
            ...params,
            sender: SENDER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          err.message.includes('authorizeLockboxCallers'),
      )
    })

    it('names the empty caller set specifically, since no sender could satisfy it', async () => {
      await assert.rejects(
        () =>
          new DepositToLockbox().generate(stubChain({ callers: [] }), {
            ...params,
            sender: SENDER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.message.includes('no authorized callers'),
      )
    })

    it('accepts a sender listed among several callers, whatever its casing', async () => {
      const chain = stubChain({ callers: [OTHER_TOKEN, SENDER.toLowerCase()] })
      const unsigned = await new DepositToLockbox().generate(chain, { ...params, sender: SENDER })
      assert.equal(unsigned.transactions[0]!.to, LOCKBOX)
    })

    it('rejects a sender holding less than amount', async () => {
      await assert.rejects(
        () =>
          new DepositToLockbox().generate(stubChain({ balance: AMOUNT - 1n }), {
            ...params,
            sender: SENDER,
          }),
        (err: unknown) => err instanceof CCTTxFailedError && err.message.includes('holds'),
      )
    })

    it('rejects a sender that has not approved the lockbox for amount', async () => {
      await assert.rejects(
        () =>
          new DepositToLockbox().generate(stubChain({ allowance: AMOUNT - 1n }), {
            ...params,
            sender: SENDER,
          }),
        (err: unknown) => err instanceof CCTTxFailedError && err.message.includes('approveToken'),
      )
    })

    it('reads the allowance on the escrowed token, spender being the lockbox', async () => {
      const seen = newSeen()
      await new DepositToLockbox().generate(stubChain({ seen }), { ...params, sender: SENDER })
      assert.deepEqual(seen.calls, [
        'typeAndVersion',
        'getToken',
        'getAllAuthorizedCallers',
        `balanceOf@${TOKEN}`,
        `allowance@${TOKEN}`,
      ])
    })

    it('skips the caller and funding checks when no sender is known', async () => {
      const seen = newSeen()
      await new DepositToLockbox().generate(stubChain({ seen }), params)
      assert.deepEqual(seen.calls, ['typeAndVersion', 'getToken'])
    })

    it('rejects a lockbox address holding some other contract', async () => {
      await assert.rejects(
        () => new DepositToLockbox().generate(stubChain({ type: 'LockReleaseTokenPool' }), params),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError && err.context.expected === 'ERC20LockBox',
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await new DepositToLockbox().execute(stubChain(), {
        ...params,
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('defaults sender to the signing wallet, so the caller check always runs', async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          new DepositToLockbox().execute(stubChain({ callers: [], seen }), {
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
          new DepositToLockbox().execute(stubChain(), {
            ...params,
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'depositToLockbox',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => new DepositToLockbox().execute(stubChain(), { ...params, wallet: {} }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
