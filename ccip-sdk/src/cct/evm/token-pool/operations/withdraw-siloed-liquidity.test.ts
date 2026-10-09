import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, isError, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
  CCTTxFailedError,
} from '../../../errors.ts'
import { type TokenPoolVersion, TOKEN_POOL_INTERFACES } from '../contracts.ts'
import {
  type WithdrawSiloedLiquidityParams,
  WithdrawSiloedLiquidity,
} from './withdraw-siloed-liquidity.ts'

const POOL = '0x' + '11'.repeat(20)
const SILO_REBALANCER = '0x' + '22'.repeat(20)
const OWNER = '0x' + '33'.repeat(20)
const UNSILOED_REBALANCER = '0x' + '44'.repeat(20)
const TOKEN = '0x' + '55'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const AMOUNT = 1_000000000000000000n
/** A siloed lane. */
const SEL = 16015286601757825753n
/** A supported lane that shares the unsiloed bucket. */
const UNSILOED_SEL = 3478487238524512106n

/** Byte-parity oracle, independent of the SDK's cached, ABI-derived interfaces. */
const IFACE = new Interface([
  'function withdrawSiloedLiquidity(uint64 remoteChainSelector, uint256 amount)',
])
const dataFor = (selector: bigint, amount: bigint) =>
  IFACE.encodeFunctionData('withdrawSiloedLiquidity', [selector, amount])

/** The pool reads the stub answers. */
const HANDLED = ['isSiloed', 'getChainRebalancer', 'getAvailableTokens', 'getToken', 'owner']

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * EVMChain stub: `typeAndVersion` reports the requested pool type/version, and `provider.call`
 * answers the per-lane reads off the siloed 1.6.1 ABI, keyed by the decoded selector argument.
 * `getAvailableTokens` reverts `InvalidChainSelector` for an unsupported lane, as the pool does
 * (or `revert`, to stand in for any other failure of that read).
 * Any other call reverts, which is what pins "no other RPC".
 */
function stubChain({
  type = 'SiloedLockReleaseTokenPool',
  version = '1.6.1' as TokenPoolVersion,
  siloed = [SEL],
  supported = [SEL, UNSILOED_SEL],
  siloRebalancer = SILO_REBALANCER,
  available = AMOUNT,
  unsiloed = 0n,
  revert = 'InvalidChainSelector',
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  /** Lanes designated as silos. */
  siloed?: bigint[]
  /** Lanes in the pool's supported-chain set. */
  supported?: bigint[]
  /** The rebalancer of every silo. */
  siloRebalancer?: string
  /** What every silo holds; defaults to exactly the withdrawal. */
  available?: bigint
  /** The shared unsiloed bucket. */
  unsiloed?: bigint
  /** The pool error `getAvailableTokens` reverts with on an unsupported lane. */
  revert?: string
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.SiloedLockRelease['1.6.1']
  const pool = (fn: string, args: readonly unknown[], data: string): unknown[] | undefined => {
    // only the per-lane getters take an argument; reading one off a no-arg call throws
    const selector = (args.length > 0 ? args[0] : undefined) as bigint
    const isSiloed = siloed.includes(selector)
    switch (fn) {
      case 'isSiloed':
        return [isSiloed]
      case 'getChainRebalancer':
        return [isSiloed ? siloRebalancer : UNSILOED_REBALANCER]
      case 'getAvailableTokens':
        if (!supported.includes(selector))
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: iface.encodeErrorResult(revert, [selector]),
            reason: null,
            transaction: { to: POOL, data },
            invocation: null,
            revert: null,
          })
        return [isSiloed ? available : unsiloed]
      case 'getToken':
        return [TOKEN]
      case 'owner':
        return [OWNER]
    }
  }
  return {
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    provider: {
      call: ({ data }: { data: string }) => {
        const poolTx = iface.parseTransaction({ data })
        if (poolTx && HANDLED.includes(poolTx.name)) {
          // recorded before answering, so a read the pool reverts still shows as attempted
          seen.calls.push(poolTx.name)
          const answer = pool(poolTx.name, poolTx.args, data)!
          return Promise.resolve(iface.encodeFunctionResult(poolTx.name, answer))
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

function fakeSigner(address = SILO_REBALANCER, waitError?: Error) {
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

const op = new WithdrawSiloedLiquidity()

function generate(chain: EVMChain, overrides: Partial<WithdrawSiloedLiquidityParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    remoteChainSelector: SEL,
    amount: AMOUNT,
    sender: SILO_REBALANCER,
    ...overrides,
  })
}

const SUPPORTED = ['1.6.0', '1.6.1'] as const

describe('WithdrawSiloedLiquidity (cct/evm)', () => {
  describe('generate', () => {
    for (const version of SUPPORTED) {
      it(`encodes withdrawSiloedLiquidity(selector, amount) at ${version}`, async () => {
        const unsigned = await generate(stubChain({ version }))
        const tx = unsigned.transactions[0]!

        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(tx.to, POOL)
        assert.equal(tx.from, SILO_REBALANCER)
        assert.equal(tx.data, dataFor(SEL, AMOUNT))
      })
    }

    it('emits identical calldata at every supported version', async () => {
      const built = await Promise.all(SUPPORTED.map((version) => generate(stubChain({ version }))))
      const [first, ...rest] = built.map((unsigned) => unsigned.transactions[0]!.data)
      for (const data of rest) assert.equal(data, first)
    })

    it('reads the lane, the silo rebalancer, then the silo liquidity', async () => {
      const seen = newSeen()
      await generate(stubChain({ seen }))
      assert.deepEqual(seen.calls, [
        'typeAndVersion',
        'isSiloed',
        'getChainRebalancer',
        'getToken',
        'getAvailableTokens',
      ])
    })

    it('omits from, and skips the rebalancer read, with no sender', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen }), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.deepEqual(seen.calls, ['typeAndVersion', 'isSiloed', 'getToken', 'getAvailableTokens'])
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['poolAddress', 'not-an-address'],
      ['poolAddress', ZeroAddress],
      ['remoteChainSelector', 1 as never],
      ['remoteChainSelector', 2n ** 64n],
      ['remoteChainSelector', 0n],
      ['amount', -1n],
      ['amount', 0n],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${String(value)} before any RPC`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => generate(stubChain({ seen }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'withdrawSiloedLiquidity' &&
            err.context.param === param,
        )
        assert.deepEqual(seen.calls, [])
      })
    }
  })

  describe('version and family dispatch', () => {
    it('rejects a siloed 2.0.0 pool', async () => {
      await assert.rejects(
        () => generate(stubChain({ version: '2.0.0' })),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'withdrawSiloedLiquidity' &&
          err.context.version === '2.0.0',
      )
    })

    for (const [type, version] of [
      ['LockReleaseTokenPool', '1.6.1'],
      ['BurnMintTokenPool', '1.5.1'],
    ] as const) {
      it(`rejects a ${type}`, async () => {
        await assert.rejects(
          () => generate(stubChain({ type, version })),
          (err: unknown) =>
            err instanceof CCTContractTypeInvalidError && err.context.actual === type,
        )
      })
    }
  })

  describe('pre-transaction validation', () => {
    it('rejects a lane that is not siloed, even with no sender', async () => {
      for (const sender of [SILO_REBALANCER, undefined])
        await assert.rejects(
          () => generate(stubChain(), { remoteChainSelector: UNSILOED_SEL, sender }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.param === 'remoteChainSelector' &&
            /ChainNotSiloed/.test(err.message) &&
            /withdrawLiquidity/.test(err.message),
        )
    })

    it('rejects a sender that is not the silo rebalancer', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: UNSILOED_REBALANCER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          err.message.includes(SILO_REBALANCER),
      )
    })

    it('rejects a withdrawal larger than the silo holds, whatever the unsiloed bucket holds', async () => {
      await assert.rejects(
        () => generate(stubChain({ available: AMOUNT - 1n, unsiloed: AMOUNT * 10n })),
        (err: unknown) =>
          err instanceof CCTTxFailedError &&
          err.context.operation === 'withdrawSiloedLiquidity' &&
          err.message.includes(`silo ${SEL}`) &&
          /holds 999999999999999999 of/.test(err.message) &&
          /InsufficientLiquidity/.test(err.message),
      )
    })

    it('accepts a withdrawal the silo covers', async () => {
      const unsigned = await generate(stubChain({ available: AMOUNT * 2n }))
      assert.equal(unsigned.transactions[0]!.data, dataFor(SEL, AMOUNT))
    })

    it('builds anyway when the siloed lane is no longer supported, so its balance is unreadable', async () => {
      // the pool's getAvailableTokens reverts InvalidChainSelector there, but the withdrawal works
      const seen = newSeen()
      const unsigned = await generate(stubChain({ supported: [], seen }))
      assert.equal(unsigned.transactions[0]!.data, dataFor(SEL, AMOUNT))
      // attempted, reverted, and skipped rather than reported
      assert.ok(seen.calls.includes('getAvailableTokens'))
    })

    it('propagates any other failure of the balance read rather than skipping it', async () => {
      await assert.rejects(
        () => generate(stubChain({ supported: [], revert: 'ChainNotAllowed' })),
        (err: unknown) =>
          isError(err, 'CALL_EXCEPTION') &&
          !(err instanceof CCTParamsInvalidError) &&
          !(err instanceof CCTTxFailedError),
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, remoteChainSelector: SEL, amount: AMOUNT }

    it('signs and submits as the silo rebalancer, resolving to the tx hash', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps an on-chain revert to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(SILO_REBALANCER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'withdrawSiloedLiquidity',
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

    it('rejects a wallet that is not the silo rebalancer', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(OWNER) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          err.message.includes(SILO_REBALANCER),
      )
    })
  })
})
