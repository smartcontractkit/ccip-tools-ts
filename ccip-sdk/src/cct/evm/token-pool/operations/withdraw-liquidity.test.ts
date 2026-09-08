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
  CCTTxFailedError,
} from '../../../errors.ts'
import { type TokenPoolVersion, TOKEN_POOL_INTERFACES } from '../contracts.ts'
import { type WithdrawLiquidityParams, WithdrawLiquidity } from './withdraw-liquidity.ts'

const POOL = '0x' + '11'.repeat(20)
const REBALANCER = '0x' + '22'.repeat(20)
const OWNER = '0x' + '33'.repeat(20)
const TOKEN = '0x' + '55'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const AMOUNT = 1_000000000000000000n

/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived interfaces.
 */
const IFACE = new Interface(['function withdrawLiquidity(uint256 amount)'])
const dataFor = (amount: bigint) => IFACE.encodeFunctionData('withdrawLiquidity', [amount])

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** ERC-20 side of the pool-balance pre-flight, answered off a fresh Interface. */
const ERC20 = new Interface(['function balanceOf(address account) view returns (uint256)'])

/**
 * EVMChain stub: `typeAndVersion` reports the requested pool type/version, and `provider.call`
 * answers the reads this op makes — `getRebalancer()` and `getToken()` on the pool, then
 * `balanceOf` on that token. Any other selector reverts, which is what pins "no other RPC".
 */
function stubChain({
  type = 'LockReleaseTokenPool',
  version = '1.5.0' as TokenPoolVersion,
  rebalancer = REBALANCER,
  poolBalance = AMOUNT,
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  rebalancer?: string
  /** Liquidity the pool holds; defaults to exactly the withdrawal. */
  poolBalance?: bigint
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.LockRelease['1.5.1']
  const pool: Record<string, unknown[]> = {
    getRebalancer: [rebalancer],
    getToken: [TOKEN],
  }
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        const selector = data.slice(0, 10)
        const poolFn = iface.getFunction(selector)?.name
        if (poolFn && pool[poolFn]) {
          seen.calls.push(poolFn)
          return Promise.resolve(iface.encodeFunctionResult(poolFn, pool[poolFn]))
        }
        if (ERC20.getFunction(selector)?.name === 'balanceOf') {
          seen.calls.push('balanceOf')
          return Promise.resolve(ERC20.encodeFunctionResult('balanceOf', [poolBalance]))
        }
        throw makeError('execution reverted', 'CALL_EXCEPTION', {
          action: 'call',
          data: '0x',
          reason: null,
          transaction: { to: POOL, data },
          invocation: null,
          revert: null,
        })
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

function fakeSigner(address = REBALANCER, waitError?: Error) {
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

const op = new WithdrawLiquidity()

function generate(chain: EVMChain, overrides: Partial<WithdrawLiquidityParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    amount: AMOUNT,
    sender: REBALANCER,
    ...overrides,
  })
}

/** Versions that declare `withdrawLiquidity`; 2.0.0 moved liquidity into the lockbox. */
const SUPPORTED = ['1.5.0', '1.5.1', '1.6.1'] as const

describe('WithdrawLiquidity (cct/evm)', () => {
  describe('generate', () => {
    for (const version of SUPPORTED) {
      it(`encodes withdrawLiquidity(amount) for a LockRelease ${version} pool`, async () => {
        const unsigned = await generate(stubChain({ version }))
        const tx = unsigned.transactions[0]!

        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(unsigned.transactions.length, 1)
        assert.equal(tx.to, POOL)
        assert.equal(tx.from, REBALANCER)
        assert.equal(tx.data, dataFor(AMOUNT))
      })
    }

    it('emits identical calldata at every supported version', async () => {
      const built = await Promise.all(SUPPORTED.map((version) => generate(stubChain({ version }))))
      const datas = built.map((unsigned) => unsigned.transactions[0]!.data)
      for (const data of datas) assert.equal(data, datas[0])
    })

    it('encodes the full uint256 range', async () => {
      const amount = 2n ** 256n - 1n
      // funded to match: the withdrawal is now pre-flighted against the pool's balance
      const unsigned = await generate(stubChain({ poolBalance: amount }), { amount })
      assert.equal(unsigned.transactions[0]!.data, dataFor(amount))
    })

    it('accepts a siloed pool, whose unsiloed bucket takes the same call', async () => {
      const unsigned = await generate(
        stubChain({ type: 'SiloedLockReleaseTokenPool', version: '1.6.1' }),
      )
      assert.equal(unsigned.transactions[0]!.data, dataFor(AMOUNT))
    })

    it('omits from — and skips the rebalancer read — when sender is not supplied', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen }), { sender: undefined })

      assert.equal(unsigned.transactions[0]!.from, undefined)
      // no rebalancer read (nothing to compare against), but the pool balance still holds
      assert.deepEqual(seen.calls, ['typeAndVersion', 'getToken', 'balanceOf'])
    })

    it('pre-flights the rebalancer, then the pool balance', async () => {
      const seen = newSeen()
      await generate(stubChain({ seen }))
      assert.deepEqual(seen.calls, ['typeAndVersion', 'getRebalancer', 'getToken', 'balanceOf'])
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['poolAddress', 'not-an-address'],
      ['poolAddress', ZeroAddress],
      ['amount', 1 as never],
      ['amount', -1n],
      ['amount', 2n ** 256n],
      // a withdrawal of nothing: a siloed pool reverts on it, every other pool mines a no-op
      ['amount', 0n],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${String(value)} before any RPC`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => generate(stubChain({ seen }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'withdrawLiquidity' &&
            err.context.param === param,
        )
        assert.deepEqual(seen.calls, [])
      })
    }
  })

  describe('version and family dispatch', () => {
    it('rejects a 2.0.0 pool — liquidity moved into the ERC20LockBox', async () => {
      await assert.rejects(
        () => generate(stubChain({ version: '2.0.0' })),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'withdrawLiquidity' &&
          err.context.version === '2.0.0',
      )
    })

    it('rejects a BurnMint pool, which has no liquidity to manage', async () => {
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
    it('rejects a sender that is not the pool rebalancer', async () => {
      await assert.rejects(
        () => generate(stubChain({ rebalancer: OWNER })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'withdrawLiquidity' &&
          err.context.param === 'sender' &&
          // names the rebalancer it read, so the caller can see which address it needed
          err.message.includes(OWNER),
      )
    })

    it('rejects a withdrawal larger than the pool holds', async () => {
      await assert.rejects(
        () => generate(stubChain({ poolBalance: AMOUNT - 1n })),
        (err: unknown) =>
          err instanceof CCTTxFailedError &&
          err.context.operation === 'withdrawLiquidity' &&
          /holds 999999999999999999 of/.test(err.message) &&
          err.message.includes(TOKEN) &&
          /InsufficientLiquidity/.test(err.message),
      )
    })

    it('accepts a withdrawal below the pool balance', async () => {
      const unsigned = await generate(stubChain({ poolBalance: AMOUNT * 5n }))
      assert.equal(unsigned.transactions[0]!.data, dataFor(AMOUNT))
    })

    it('reports an unconfigured rebalancer as such, not as a mismatch', async () => {
      await assert.rejects(
        () => generate(stubChain({ rebalancer: ZeroAddress })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && /no rebalancer is configured/.test(err.message),
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, amount: AMOUNT }

    it('signs and submits as the rebalancer, resolving to the tx hash', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps an on-chain revert — e.g. InsufficientLiquidity — to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(REBALANCER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'withdrawLiquidity',
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
        () => op.execute(stubChain(), { ...params, sender: OWNER, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a wallet that is not the pool rebalancer', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(OWNER) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'withdrawLiquidity' &&
          err.context.param === 'sender',
      )
    })
  })
})
