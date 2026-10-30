import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress, getIcapAddress, id, makeError } from 'ethers'

import {
  CCIPExecTxRevertedError,
  CCIPTypeVersionInvalidError,
  CCIPWalletInvalidError,
} from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { TransferLockboxOwnership } from './transfer-lockbox-ownership.ts'

const SENDER = '0x' + '11'.repeat(20)
const LOCKBOX = '0x' + '66'.repeat(20)
const NEW_OWNER = '0x' + '77'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const NOT_THE_OWNER = '0x' + '99'.repeat(20)

/** Fresh `owner()` interface for the stubbed provider, never the SDK's cached one. */
const OWNER_IFACE = new Interface(['function owner() view returns (address)'])

// Derived from the signature, not the SDK's ABI, so ABI drift cannot mirror into the expectation.
const SELECTOR = id('transferOwnership(address)').slice(0, 10)
// 20-byte address left-padded to a 32-byte word.
const word = (addr: string) => '000000000000000000000000' + addr.slice(2)

/** Base Sepolia; the chain the stub manager is on. Every built tx must be pinned to it. */
const CHAIN_ID = Number(networkInfo('ethereum-testnet-sepolia-base-1').chainId)

/** What the stubbed chain was asked to do, in order, so the pre-flight's position is assertable. */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * Minimal EVMChain stub. The build path reads `typeAndVersion` on the lockbox, which defaults to
 * a deployed, supported `ERC20LockBox`, then `owner()`, which defaults to `SENDER`. `readError`
 * replaces the `typeAndVersion` read with a failure, standing in for an address with no contract
 * code (`BAD_DATA`) or a reverting read.
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

describe('TransferLockboxOwnership (cct/evm lockbox operation)', () => {
  describe('generate (golden vectors)', () => {
    it('encodes transferOwnership(newOwner) as a call to the lockbox', async () => {
      const unsigned = await new TransferLockboxOwnership().generate(stubChain(), {
        lockbox: LOCKBOX,
        newOwner: NEW_OWNER,
        sender: SENDER,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, LOCKBOX)
      assert.equal(tx.from, SENDER)
      assert.equal(tx.chainId, CHAIN_ID, 'pinned to the manager chain')
      assert.equal(tx.data, SELECTOR + word(NEW_OWNER))
    })

    it('allows a zero newOwner, which retracts a pending proposal', async () => {
      const unsigned = await new TransferLockboxOwnership().generate(stubChain(), {
        lockbox: LOCKBOX,
        newOwner: ZeroAddress,
      })
      assert.equal(unsigned.transactions[0]!.data, SELECTOR + word(ZeroAddress))
    })

    it('omits `from` when no sender is given', async () => {
      const unsigned = await new TransferLockboxOwnership().generate(stubChain(), {
        lockbox: LOCKBOX,
        newOwner: NEW_OWNER,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })
  })

  describe('validation', () => {
    it('rejects an invalid lockbox address before any RPC, tagged with the operation', async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().generate(stubChain({ seen }), {
            lockbox: 'nope',
            newOwner: NEW_OWNER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferLockboxOwnership' &&
          err.context.param === 'lockbox',
      )
      assert.deepEqual(seen.calls, [])
    })

    it('rejects a zero-address lockbox, including in ICAP form', async () => {
      for (const lockbox of [ZeroAddress, getIcapAddress(ZeroAddress)])
        await assert.rejects(
          () =>
            new TransferLockboxOwnership().generate(stubChain(), { lockbox, newOwner: NEW_OWNER }),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'lockbox',
        )
    })

    it('rejects an invalid newOwner', async () => {
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().generate(stubChain(), {
            lockbox: LOCKBOX,
            newOwner: 'nope',
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'newOwner',
      )
    })

    it('rejects an invalid sender', async () => {
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().generate(stubChain(), {
            lockbox: LOCKBOX,
            newOwner: NEW_OWNER,
            sender: 'nope',
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects newOwner equal to sender before any RPC, regardless of casing', async () => {
      // Hex letters, so the two spellings really differ; SENDER is all digits.
      const lower = '0x' + 'ab'.repeat(20)
      const seen = newSeen()
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().generate(stubChain({ seen }), {
            lockbox: LOCKBOX,
            newOwner: getAddress(lower),
            sender: lower,
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'newOwner',
      )
      assert.deepEqual(seen.calls, [])
    })
  })

  describe('lockbox pre-flight', () => {
    it('reads typeAndVersion, then owner(), even without a sender', async () => {
      const seen = newSeen()
      await new TransferLockboxOwnership().generate(stubChain({ seen }), {
        lockbox: LOCKBOX,
        newOwner: NEW_OWNER,
      })
      assert.deepEqual(seen.calls, [`typeAndVersion:${LOCKBOX}`, `owner:${LOCKBOX}`])
    })

    it('rejects an address with no contract code, keeping the read as the cause', async () => {
      const readError = noCodeError()
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().generate(stubChain({ readError }), {
            lockbox: LOCKBOX,
            newOwner: NEW_OWNER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferLockboxOwnership' &&
          err.context.param === 'lockbox' &&
          err.cause === readError,
      )
    })

    it('propagates a transport failure unwrapped, rather than blaming the address', async () => {
      const readError = makeError('request timeout', 'TIMEOUT', {
        operation: 'call',
        reason: 'timeout',
      })
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().generate(stubChain({ readError }), {
            lockbox: LOCKBOX,
            newOwner: NEW_OWNER,
          }),
        (err: unknown) => err === readError,
      )
    })

    it('rejects a contract whose typeAndVersion string is unparseable', async () => {
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().generate(stubChain({ type: 'garbage', version: 'x' }), {
            lockbox: LOCKBOX,
            newOwner: NEW_OWNER,
          }),
        (err: unknown) => err instanceof CCIPTypeVersionInvalidError,
      )
    })

    it('rejects a pool address, without reading its owner', async () => {
      // a pool answers transferOwnership too, so without this the pool's ownership would move
      const seen = newSeen()
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().generate(
            stubChain({ type: 'LockReleaseTokenPool', seen }),
            { lockbox: LOCKBOX, newOwner: NEW_OWNER, sender: SENDER },
          ),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === LOCKBOX &&
          err.context.expected === 'ERC20LockBox' &&
          err.context.actual === 'LockReleaseTokenPool',
      )
      assert.deepEqual(seen.calls, [`typeAndVersion:${LOCKBOX}`])
    })

    it('rejects an unsupported ERC20LockBox version without reading its owner', async () => {
      const seen = newSeen()
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().generate(stubChain({ version: '3.0.0', seen }), {
            lockbox: LOCKBOX,
            newOwner: NEW_OWNER,
          }),
        (err: unknown) =>
          err instanceof CCTContractVersionUnsupportedError &&
          err.context.contractType === 'ERC20LockBox' &&
          err.context.version === '3.0.0',
      )
      assert.deepEqual(seen.calls, [`typeAndVersion:${LOCKBOX}`])
    })
  })

  describe('owner pre-flight', () => {
    it('accepts the owner as sender regardless of address casing', async () => {
      const lower = '0x' + 'ab'.repeat(20)
      const unsigned = await new TransferLockboxOwnership().generate(
        stubChain({ owner: getAddress(lower) }),
        { lockbox: LOCKBOX, newOwner: NEW_OWNER, sender: lower },
      )
      assert.equal(unsigned.transactions[0]!.from, lower)
    })

    it('rejects a sender that is not the lockbox owner', async () => {
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().generate(stubChain(), {
            lockbox: LOCKBOX,
            newOwner: NEW_OWNER,
            sender: NOT_THE_OWNER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferLockboxOwnership' &&
          err.context.param === 'sender',
      )
    })

    it('rejects newOwner equal to the on-chain owner when no sender is given', async () => {
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().generate(stubChain({ owner: NEW_OWNER }), {
            lockbox: LOCKBOX,
            newOwner: NEW_OWNER,
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'newOwner',
      )
    })
  })

  describe('execute', () => {
    it('checks the signing wallet against the lockbox owner, then broadcasts', async () => {
      const seen = newSeen()
      const result = await new TransferLockboxOwnership().execute(stubChain({ seen }), {
        lockbox: LOCKBOX,
        newOwner: NEW_OWNER,
        wallet: fakeSigner({ seen }),
      })
      assert.deepEqual(result, { hash: HASH })
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
          new TransferLockboxOwnership().execute(stubChain(), {
            lockbox: LOCKBOX,
            newOwner: NEW_OWNER,
            wallet: fakeSigner({ seen, address: NOT_THE_OWNER }),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
      assert.deepEqual(seen.calls, [])
    })

    it('rejects a newOwner equal to the signing wallet', async () => {
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().execute(stubChain(), {
            lockbox: LOCKBOX,
            newOwner: SENDER,
            wallet: fakeSigner(),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'newOwner',
      )
    })

    it('rejects a sender that differs from the signing wallet', async () => {
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().execute(stubChain(), {
            lockbox: LOCKBOX,
            newOwner: NEW_OWNER,
            sender: NOT_THE_OWNER,
            wallet: fakeSigner(),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('throws CCIPExecTxRevertedError when the tx reverts on-chain', async () => {
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().execute(stubChain(), {
            lockbox: LOCKBOX,
            newOwner: NEW_OWNER,
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'transferLockboxOwnership',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () =>
          new TransferLockboxOwnership().execute(stubChain(), {
            lockbox: LOCKBOX,
            newOwner: NEW_OWNER,
            wallet: {},
          }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
