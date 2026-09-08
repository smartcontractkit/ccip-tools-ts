import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, MaxUint256, ZeroAddress, makeError } from 'ethers'

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
import { type TransferLiquidityParams, TransferLiquidity } from './transfer-liquidity.ts'

const POOL = '0x' + '11'.repeat(20)
const OLD_POOL = '0x' + '22'.repeat(20)
const OWNER = '0x' + '33'.repeat(20)
const NOT_THE_OWNER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const AMOUNT = 1_000000000000000000n

/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived interfaces.
 */
const IFACE = new Interface(['function transferLiquidity(address from, uint256 amount)'])
const dataFor = (from: string, amount: bigint) =>
  IFACE.encodeFunctionData('transferLiquidity', [from, amount])

/** The reads the op makes, in order, as `fn@address` (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

const REVERT = (to: string, data: string) =>
  makeError('execution reverted', 'CALL_EXCEPTION', {
    action: 'call',
    data: '0x',
    reason: null,
    transaction: { to, data },
    invocation: null,
    revert: null,
  })

/**
 * EVMChain stub: `typeAndVersion` reports the destination pool's type/version, and
 * `provider.call` answers per address — `owner()` on the destination pool, `getRebalancer()` on
 * the source pool. Every other pair reverts, which is what pins both which read goes where and
 * "no other RPC".
 */
function stubChain({
  type = 'LockReleaseTokenPool',
  version = '1.5.0' as TokenPoolVersion,
  owner = OWNER,
  /** The source pool's rebalancer; defaults to the destination pool, the wiring this op needs. */
  sourceRebalancer = POOL as string | null,
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  owner?: string
  /** `null` stands in for a `from` that does not declare `getRebalancer()` at all. */
  sourceRebalancer?: string | null
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.LockRelease['1.5.1']
  return {
    provider: {
      call: ({ to, data }: { to: string; data: string }) => {
        const fn = iface.getFunction(data.slice(0, 10))?.name
        if (fn === 'owner' && to === POOL) {
          seen.calls.push(`owner@pool`)
          return Promise.resolve(iface.encodeFunctionResult(fn, [owner]))
        }
        if (fn === 'getRebalancer' && to === OLD_POOL && sourceRebalancer !== null) {
          seen.calls.push(`getRebalancer@from`)
          return Promise.resolve(iface.encodeFunctionResult(fn, [sourceRebalancer]))
        }
        throw REVERT(to, data)
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

const op = new TransferLiquidity()

function generate(chain: EVMChain, overrides: Partial<TransferLiquidityParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    from: OLD_POOL,
    amount: AMOUNT,
    sender: OWNER,
    ...overrides,
  })
}

/** Versions that declare `transferLiquidity`; 2.0.0 moved liquidity into the lockbox. */
const SUPPORTED = ['1.5.0', '1.5.1', '1.6.1'] as const

describe('TransferLiquidity (cct/evm)', () => {
  describe('generate', () => {
    for (const version of SUPPORTED) {
      it(`encodes transferLiquidity(from, amount) for a LockRelease ${version} pool`, async () => {
        const unsigned = await generate(stubChain({ version }))
        const tx = unsigned.transactions[0]!

        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(unsigned.transactions.length, 1)
        assert.equal(tx.to, POOL)
        assert.equal(tx.from, OWNER)
        assert.equal(tx.data, dataFor(OLD_POOL, AMOUNT))
      })
    }

    it('emits identical calldata at every supported version', async () => {
      const built = await Promise.all(SUPPORTED.map((version) => generate(stubChain({ version }))))
      const datas = built.map((unsigned) => unsigned.transactions[0]!.data)
      for (const data of datas) assert.equal(data, datas[0])
    })

    it('reads the rebalancer from the source pool and the owner from the destination', async () => {
      const seen = newSeen()
      await generate(stubChain({ seen }))
      assert.deepEqual(seen.calls, ['typeAndVersion', 'getRebalancer@from', 'owner@pool'])
    })

    it('omits from — and skips the owner read — when sender is not supplied', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen }), { sender: undefined })

      assert.equal(unsigned.transactions[0]!.from, undefined)
      // the source-pool wiring is still checked: it holds regardless of who signs
      assert.deepEqual(seen.calls, ['typeAndVersion', 'getRebalancer@from'])
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['poolAddress', 'not-an-address'],
      ['poolAddress', ZeroAddress],
      ['from', 'not-an-address'],
      ['from', ZeroAddress],
      ['amount', 1 as never],
      ['amount', -1n],
      ['amount', 2n ** 256n],
      ['amount', 0n],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${String(value)} before any RPC`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => generate(stubChain({ seen }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'transferLiquidity' &&
            err.context.param === param,
        )
        assert.deepEqual(seen.calls, [])
      })
    }

    it('rejects a self-transfer, which no pool authorizes', async () => {
      const seen = newSeen()
      await assert.rejects(
        () => generate(stubChain({ seen }), { from: POOL }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'from' &&
          /different pool/.test(err.message),
      )
      assert.deepEqual(seen.calls, [])
    })
  })

  describe('version and family dispatch', () => {
    it('rejects a 2.0.0 pool — liquidity moved into the ERC20LockBox', async () => {
      await assert.rejects(
        () => generate(stubChain({ version: '2.0.0' })),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'transferLiquidity' &&
          err.context.version === '2.0.0',
      )
    })

    it('rejects a BurnMint pool, which has no liquidity to migrate', async () => {
      await assert.rejects(
        () => generate(stubChain({ type: 'BurnMintTokenPool', version: '1.5.1' })),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError && err.context.actual === 'BurnMintTokenPool',
      )
    })

    it('rejects a siloed destination pool, which does not declare transferLiquidity', async () => {
      await assert.rejects(
        () => generate(stubChain({ type: 'SiloedLockReleaseTokenPool', version: '1.6.1' })),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === POOL &&
          err.context.actual === 'SiloedLockReleaseTokenPool' &&
          err.context.expected === 'LockReleaseTokenPool',
      )
    })

    it('accepts the MaxUint256 transfer-all sentinel at 1.6.1', async () => {
      const unsigned = await generate(stubChain({ version: '1.6.1' }), { amount: MaxUint256 })
      assert.equal(unsigned.transactions[0]!.data, dataFor(OLD_POOL, MaxUint256))
    })

    for (const version of ['1.5.0', '1.5.1'] as const) {
      it(`rejects the MaxUint256 sentinel at ${version}, which has no such branch`, async () => {
        await assert.rejects(
          () => generate(stubChain({ version }), { amount: MaxUint256 }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.param === 'amount' &&
            /v1\.6\.1/.test(err.message),
        )
      })
    }
  })

  describe('pre-transaction validation', () => {
    it('rejects a source pool whose rebalancer is not the destination pool', async () => {
      await assert.rejects(
        () => generate(stubChain({ sourceRebalancer: NOT_THE_OWNER })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferLiquidity' &&
          err.context.param === 'from' &&
          /must be the rebalancer of/.test(err.message) &&
          // names what it read, so the caller can see the wiring it has
          err.message.includes(NOT_THE_OWNER),
      )
    })

    it('rejects a source pool with no rebalancer set', async () => {
      await assert.rejects(
        () => generate(stubChain({ sourceRebalancer: ZeroAddress })),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'from',
      )
    })

    it('reports a source that does not answer getRebalancer() against `from`', async () => {
      await assert.rejects(
        () => generate(stubChain({ sourceRebalancer: null })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'from' &&
          /LockRelease pool/.test(err.message),
      )
    })

    it('rejects a sender that does not own the destination pool', async () => {
      await assert.rejects(
        () => generate(stubChain({ owner: NOT_THE_OWNER })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferLiquidity' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, from: OLD_POOL, amount: AMOUNT }

    it('signs and submits as the destination pool owner, resolving to the tx hash', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps an on-chain revert — e.g. InsufficientLiquidity — to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'transferLiquidity',
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

    it('rejects a wallet that does not own the destination pool', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(NOT_THE_OWNER) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          err.message.includes(OWNER),
      )
    })
  })
})
