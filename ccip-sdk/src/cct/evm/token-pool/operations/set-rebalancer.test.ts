import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { type TokenPoolVersion, TOKEN_POOL_INTERFACES } from '../contracts.ts'
import { type SetRebalancerParams, SetRebalancer } from './set-rebalancer.ts'

const POOL = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const REBALANCER = '0x' + '44'.repeat(20)
const NOT_THE_OWNER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived interfaces.
 */
const IFACE = new Interface(['function setRebalancer(address rebalancer)'])
const dataFor = (rebalancer: string) => IFACE.encodeFunctionData('setRebalancer', [rebalancer])

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * EVMChain stub: `typeAndVersion` reports the requested pool type/version, and `provider.call`
 * answers `owner()` — the only read this op makes — off the LockRelease interface. Every other
 * selector reverts, which is what pins "no other RPC".
 */
function stubChain({
  type = 'LockReleaseTokenPool',
  version = '1.5.0' as TokenPoolVersion,
  owner = OWNER,
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  owner?: string
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.LockRelease['1.5.1']
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        const fn = iface.getFunction(data.slice(0, 10))?.name
        if (fn !== 'owner')
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: POOL, data },
            invocation: null,
            revert: null,
          })
        seen.calls.push(fn)
        return Promise.resolve(iface.encodeFunctionResult(fn, [owner]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
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

const op = new SetRebalancer()

function generate(chain: EVMChain, overrides: Partial<SetRebalancerParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    rebalancer: REBALANCER,
    sender: OWNER,
    ...overrides,
  })
}

/** Versions that declare `setRebalancer`; 2.0.0 moved liquidity into the lockbox. */
const SUPPORTED = ['1.5.0', '1.5.1', '1.6.1'] as const

describe('SetRebalancer (cct/evm)', () => {
  describe('generate', () => {
    for (const version of SUPPORTED) {
      it(`encodes setRebalancer(rebalancer) for a LockRelease ${version} pool`, async () => {
        const unsigned = await generate(stubChain({ version }))
        const tx = unsigned.transactions[0]!

        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(unsigned.transactions.length, 1)
        assert.equal(tx.to, POOL)
        assert.equal(tx.from, OWNER)
        assert.equal(tx.data, dataFor(REBALANCER))
      })
    }

    it('emits identical calldata at every supported version', async () => {
      const built = await Promise.all(SUPPORTED.map((version) => generate(stubChain({ version }))))
      const datas = built.map((unsigned) => unsigned.transactions[0]!.data)
      for (const data of datas) assert.equal(data, datas[0])
    })

    it('allows the zero address, which revokes the role', async () => {
      const unsigned = await generate(stubChain(), { rebalancer: ZeroAddress })
      assert.equal(unsigned.transactions[0]!.data, dataFor(ZeroAddress))
    })

    it('accepts a siloed pool, where this sets the unsiloed rebalancer', async () => {
      const unsigned = await generate(
        stubChain({ type: 'SiloedLockReleaseTokenPool', version: '1.6.1' }),
      )
      assert.equal(unsigned.transactions[0]!.data, dataFor(REBALANCER))
    })

    it('omits from — and skips the owner read — when sender is not supplied', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen }), { sender: undefined })

      assert.equal(unsigned.transactions[0]!.from, undefined)
      // typeAndVersion only; no owner() round trip
      assert.deepEqual(seen.calls, ['typeAndVersion'])
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['poolAddress', 'not-an-address'],
      ['poolAddress', ZeroAddress],
      ['rebalancer', 'not-an-address'],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${value} before any RPC`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => generate(stubChain({ seen }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'setRebalancer' &&
            err.context.param === param,
        )
        assert.deepEqual(seen.calls, [])
      })
    }
  })

  describe('version and family dispatch', () => {
    it('rejects a 2.0.0 pool — liquidity is authorized on the lockbox instead', async () => {
      await assert.rejects(
        () => generate(stubChain({ version: '2.0.0' })),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'setRebalancer' &&
          err.context.version === '2.0.0',
      )
    })

    it('rejects a BurnMint pool, which has no rebalancer', async () => {
      await assert.rejects(
        () => generate(stubChain({ type: 'BurnMintTokenPool', version: '1.5.1' })),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === POOL &&
          err.context.actual === 'BurnMintTokenPool',
      )
    })
  })

  describe('pre-transaction validation', () => {
    it('rejects a sender that is not the pool owner', async () => {
      await assert.rejects(
        () => generate(stubChain({ owner: NOT_THE_OWNER })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setRebalancer' &&
          err.context.param === 'sender',
      )
    })

    it('rejects the incumbent rebalancer, which cannot reassign its own role', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: REBALANCER }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, rebalancer: REBALANCER }

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
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'setRebalancer',
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
        () => op.execute(stubChain(), { ...params, sender: NOT_THE_OWNER, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a wallet that is not the pool owner', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(NOT_THE_OWNER) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setRebalancer' &&
          err.context.param === 'sender' &&
          // names the owner it read, so the caller can see which address it needed
          err.message.includes(OWNER),
      )
    })
  })
})
