import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, id, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { AcceptLockboxOwnership } from './accept-lockbox-ownership.ts'

const SENDER = '0x' + '11'.repeat(20)
const LOCKBOX = '0x' + '66'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

// Derived from the signature, not the SDK's ABI; no arguments, so it is the whole calldata.
const SELECTOR = id('acceptOwnership()').slice(0, 10)

/** Base Sepolia; the chain the stub manager is on. Every built tx must be pinned to it. */
const CHAIN_ID = Number(networkInfo('ethereum-testnet-sepolia-base-1').chainId)

/** What the stubbed chain was asked to do, in order, so the pre-flight's position is assertable. */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * Minimal EVMChain stub. The build path only reads `typeAndVersion` on the lockbox, which
 * defaults to a deployed, supported `ERC20LockBox`; any `eth_call` is recorded so a stray caller
 * read would show up. `readError` replaces the `typeAndVersion` read with a failure.
 */
function stubChain({
  type = 'ERC20LockBox',
  version = '2.0.0',
  readError,
  seen = newSeen(),
}: { type?: string; version?: string; readError?: Error; seen?: Seen } = {}): EVMChain {
  return {
    provider: {
      call: ({ to, data }: { to: string; data: string }) => {
        seen.calls.push(`call:${data.slice(0, 10)}:${to}`)
        return Promise.resolve('0x')
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: { chainId: CHAIN_ID },
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

describe('AcceptLockboxOwnership (cct/evm lockbox operation)', () => {
  describe('generate', () => {
    it('encodes acceptOwnership() as a call to the lockbox', async () => {
      const unsigned = await new AcceptLockboxOwnership().generate(stubChain(), {
        lockbox: LOCKBOX,
        sender: SENDER,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, LOCKBOX)
      assert.equal(tx.from, SENDER)
      assert.equal(tx.chainId, CHAIN_ID, 'pinned to the manager chain')
      assert.equal(tx.data, SELECTOR)
    })

    it('omits `from` when no sender is given', async () => {
      const unsigned = await new AcceptLockboxOwnership().generate(stubChain(), {
        lockbox: LOCKBOX,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })

    it('reads only typeAndVersion, since the pending owner has no getter', async () => {
      const seen = newSeen()
      await new AcceptLockboxOwnership().generate(stubChain({ seen }), {
        lockbox: LOCKBOX,
        sender: SENDER,
      })
      assert.deepEqual(seen.calls, [`typeAndVersion:${LOCKBOX}`])
    })
  })

  describe('validation', () => {
    it('rejects an invalid or zero lockbox address before any RPC', async () => {
      const seen = newSeen()
      for (const lockbox of ['nope', ZeroAddress])
        await assert.rejects(
          () => new AcceptLockboxOwnership().generate(stubChain({ seen }), { lockbox }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'acceptLockboxOwnership' &&
            err.context.param === 'lockbox',
        )
      assert.deepEqual(seen.calls, [])
    })

    it('rejects an invalid sender', async () => {
      await assert.rejects(
        () =>
          new AcceptLockboxOwnership().generate(stubChain(), { lockbox: LOCKBOX, sender: 'nope' }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })
  })

  describe('lockbox pre-flight', () => {
    it('rejects an address with no contract code, keeping the read as the cause', async () => {
      const readError = noCodeError()
      await assert.rejects(
        () => new AcceptLockboxOwnership().generate(stubChain({ readError }), { lockbox: LOCKBOX }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'lockbox' &&
          err.cause === readError,
      )
    })

    it('rejects a pool address rather than completing its pending transfer', async () => {
      await assert.rejects(
        () =>
          new AcceptLockboxOwnership().generate(stubChain({ type: 'LockReleaseTokenPool' }), {
            lockbox: LOCKBOX,
          }),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.expected === 'ERC20LockBox' &&
          err.context.actual === 'LockReleaseTokenPool',
      )
    })

    it('rejects an unsupported ERC20LockBox version', async () => {
      await assert.rejects(
        () =>
          new AcceptLockboxOwnership().generate(stubChain({ version: '3.0.0' }), {
            lockbox: LOCKBOX,
          }),
        (err: unknown) =>
          err instanceof CCTContractVersionUnsupportedError && err.context.version === '3.0.0',
      )
    })
  })

  describe('execute', () => {
    it('checks the lockbox, then signs, submits, and returns the tx hash', async () => {
      const seen = newSeen()
      const result = await new AcceptLockboxOwnership().execute(stubChain({ seen }), {
        lockbox: LOCKBOX,
        wallet: fakeSigner({ seen }),
      })
      assert.deepEqual(result, { hash: HASH })
      assert.deepEqual(seen.calls, [`typeAndVersion:${LOCKBOX}`, 'sendTransaction'])
    })

    it('does not sign or broadcast when the lockbox is not deployed', async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          new AcceptLockboxOwnership().execute(stubChain({ readError: noCodeError() }), {
            lockbox: LOCKBOX,
            wallet: fakeSigner({ seen }),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'lockbox',
      )
      assert.deepEqual(seen.calls, [])
    })

    it('throws CCIPExecTxRevertedError when the tx reverts on-chain', async () => {
      // e.g. MustBeProposedOwner: the wallet was not the proposed owner
      await assert.rejects(
        () =>
          new AcceptLockboxOwnership().execute(stubChain(), {
            lockbox: LOCKBOX,
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'acceptLockboxOwnership',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => new AcceptLockboxOwnership().execute(stubChain(), { lockbox: LOCKBOX, wallet: {} }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
