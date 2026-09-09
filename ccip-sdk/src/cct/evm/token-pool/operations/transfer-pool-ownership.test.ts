import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import {
  type TransferPoolOwnershipParams,
  TransferPoolOwnership,
} from './transfer-pool-ownership.ts'

const POOL = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const NEW_OWNER = '0x' + '44'.repeat(20)
const NOT_THE_OWNER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived interfaces.
 */
const IFACE = new Interface(['function transferOwnership(address to)'])
const dataFor = (to: string) => IFACE.encodeFunctionData('transferOwnership', [to])

/** Pool type reported by `typeAndVersion` for each ABI family. */
const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

/**
 * EVMChain stub: `typeAndVersion` reports the requested family/version, and `provider.call`
 * answers `owner()` (the only read this op makes) off the pool's own Interface. Every other
 * selector reverts, which is what pins "no other RPC".
 */
function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V1_5_0,
  owner = OWNER,
  type,
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  owner?: string
  /** Overrides the reported pool type, to exercise an address that is not a pool at all. */
  type?: string
  onCall?: () => void
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[family][version]
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        onCall?.()
        if (data.slice(0, 10) !== iface.getFunction('owner')!.selector)
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: POOL, data },
            invocation: null,
            revert: null,
          })
        return Promise.resolve(iface.encodeFunctionResult('owner', [owner]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      onCall?.()
      return Promise.resolve(parseTypeAndVersion(`${type ?? POOL_TYPE[family]} ${version}`))
    },
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

const op = new TransferPoolOwnership()

function generate(chain: EVMChain, overrides: Partial<TransferPoolOwnershipParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    newOwner: NEW_OWNER,
    sender: OWNER,
    ...overrides,
  })
}

/** Every pool version: `transferOwnership(address)` survived unchanged into 2.0.0. */
const VERSIONS = Object.values(TokenPoolVersion)

describe('TransferPoolOwnership (cct/evm)', () => {
  describe('generate', () => {
    for (const version of VERSIONS) {
      for (const family of ['BurnMint', 'LockRelease'] as const) {
        it(`encodes transferOwnership(newOwner) for a ${family} ${version} pool`, async () => {
          const unsigned = await generate(stubChain({ family, version }))
          const tx = unsigned.transactions[0]!

          assert.equal(unsigned.family, ChainFamily.EVM)
          assert.equal(unsigned.transactions.length, 1)
          assert.equal(tx.to, POOL)
          assert.equal(tx.from, OWNER)
          assert.equal(tx.data, dataFor(NEW_OWNER))
        })
      }
    }

    it('allows the zero address, which retracts a pending transfer', async () => {
      const unsigned = await generate(stubChain(), { newOwner: ZeroAddress })
      assert.equal(unsigned.transactions[0]!.data, dataFor(ZeroAddress))
    })

    it('omits from — and skips the owner read — when sender is not supplied', async () => {
      let calls = 0
      const unsigned = await generate(stubChain({ onCall: () => (calls += 1) }), {
        sender: undefined,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      // typeAndVersion only; no owner() round trip
      assert.equal(calls, 1)
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['poolAddress', 'not-an-address'],
      ['poolAddress', ZeroAddress],
      ['newOwner', 'not-an-address'],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${value} before any RPC`, async () => {
        let called = false
        await assert.rejects(
          () => generate(stubChain({ onCall: () => (called = true) }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'transferPoolOwnership' &&
            err.context.param === param,
        )
        assert.equal(called, false)
      })
    }

    it('rejects a self-transfer before any RPC — the pool would revert CannotTransferToSelf', async () => {
      let called = false
      await assert.rejects(
        () =>
          generate(stubChain({ onCall: () => (called = true) }), {
            newOwner: OWNER,
            sender: OWNER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferPoolOwnership' &&
          err.context.param === 'newOwner' &&
          /CannotTransferToSelf/.test(err.message),
      )
      assert.equal(called, false)
    })

    it('cannot check the self-transfer without a sender, so it builds', async () => {
      const unsigned = await generate(stubChain(), { newOwner: OWNER, sender: undefined })
      assert.equal(unsigned.transactions[0]!.data, dataFor(OWNER))
    })
  })

  describe('type dispatch', () => {
    it('rejects an address whose typeAndVersion is not a supported pool', async () => {
      await assert.rejects(
        () => generate(stubChain({ type: 'NotATokenPool' })),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError && err.context.actual === 'NotATokenPool',
      )
    })
  })

  describe('pre-transaction validation', () => {
    it('rejects a sender that is not the pool owner', async () => {
      await assert.rejects(
        () => generate(stubChain({ owner: NOT_THE_OWNER })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferPoolOwnership' &&
          err.context.param === 'sender' &&
          // names the owner it read, so the caller can see which address it needed
          err.message.includes(NOT_THE_OWNER),
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, newOwner: NEW_OWNER }

    it('signs and submits as the owner, resolving to the tx hash', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps an on-chain revert to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'transferPoolOwnership',
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
        () => op.execute(stubChain(), { ...params, sender: NEW_OWNER, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a wallet that is not the pool owner', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(NOT_THE_OWNER) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferPoolOwnership' &&
          err.context.param === 'sender',
      )
    })

    it('rejects transferring to the executing wallet itself', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { poolAddress: POOL, newOwner: OWNER, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'newOwner',
      )
    })
  })
})
