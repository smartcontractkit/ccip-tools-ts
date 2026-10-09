import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

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
  type ProvideSiloedLiquidityParams,
  ProvideSiloedLiquidity,
} from './provide-siloed-liquidity.ts'

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

/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived interfaces.
 */
const IFACE = new Interface([
  'function provideSiloedLiquidity(uint64 remoteChainSelector, uint256 amount)',
])
const dataFor = (selector: bigint, amount: bigint) =>
  IFACE.encodeFunctionData('provideSiloedLiquidity', [selector, amount])

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/** ERC-20 side of the funding pre-flight, answered off a fresh Interface. */
const ERC20 = new Interface([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
])

/**
 * EVMChain stub: `typeAndVersion` reports the requested pool type/version, and `provider.call`
 * answers the per-lane reads off the siloed 1.6.1 ABI, keyed by the decoded selector argument:
 * `isSiloed`, `getChainRebalancer` (the silo's on a siloed lane, the unsiloed one otherwise);
 * plus `getToken()` / `owner()`, then `balanceOf` / `allowance` on that token. Any other call
 * reverts, which is what pins "no other RPC".
 */
function stubChain({
  type = 'SiloedLockReleaseTokenPool',
  version = '1.6.1' as TokenPoolVersion,
  siloed = [SEL],
  siloRebalancer = SILO_REBALANCER,
  balance = AMOUNT,
  allowance = AMOUNT,
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  /** Lanes designated as silos. */
  siloed?: bigint[]
  /** The rebalancer of every silo. */
  siloRebalancer?: string
  /** The rebalancer's token balance; defaults to exactly the deposit. */
  balance?: bigint
  /** The rebalancer's approval to the pool; defaults to exactly the deposit. */
  allowance?: bigint
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.SiloedLockRelease['1.6.1']
  const pool = (fn: string, args: readonly unknown[]): unknown[] | undefined => {
    // only the per-lane getters take an argument; reading one off a no-arg call throws
    const isSiloed = args.length > 0 && siloed.includes(args[0] as bigint)
    switch (fn) {
      case 'isSiloed':
        return [isSiloed]
      case 'getChainRebalancer':
        return [isSiloed ? siloRebalancer : UNSILOED_REBALANCER]
      case 'getToken':
        return [TOKEN]
      case 'owner':
        return [OWNER]
    }
  }
  const erc20: Record<string, unknown[]> = { balanceOf: [balance], allowance: [allowance] }
  return {
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    provider: {
      call: ({ data }: { data: string }) => {
        const poolTx = iface.parseTransaction({ data })
        const poolAnswer = poolTx && pool(poolTx.name, poolTx.args)
        if (poolTx && poolAnswer) {
          seen.calls.push(poolTx.name)
          return Promise.resolve(iface.encodeFunctionResult(poolTx.name, poolAnswer))
        }
        const tokenFn = ERC20.getFunction(data.slice(0, 10))?.name
        if (tokenFn && erc20[tokenFn]) {
          seen.calls.push(tokenFn)
          return Promise.resolve(ERC20.encodeFunctionResult(tokenFn, erc20[tokenFn]))
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

const op = new ProvideSiloedLiquidity()

function generate(chain: EVMChain, overrides: Partial<ProvideSiloedLiquidityParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    remoteChainSelector: SEL,
    amount: AMOUNT,
    sender: SILO_REBALANCER,
    ...overrides,
  })
}

/** Versions that declare `provideSiloedLiquidity`; 2.0.0 moved escrow into per-lane lockboxes. */
const SUPPORTED = ['1.6.0', '1.6.1'] as const

describe('ProvideSiloedLiquidity (cct/evm)', () => {
  describe('generate', () => {
    for (const version of SUPPORTED) {
      it(`encodes provideSiloedLiquidity(selector, amount) at ${version}`, async () => {
        const unsigned = await generate(stubChain({ version }))
        const tx = unsigned.transactions[0]!

        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(unsigned.transactions.length, 1)
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

    it('reads the lane, then the silo rebalancer, then the funding, in that order', async () => {
      const seen = newSeen()
      await generate(stubChain({ seen }))
      assert.deepEqual(seen.calls, [
        'typeAndVersion',
        'isSiloed',
        'getChainRebalancer',
        'getToken',
        'balanceOf',
        'allowance',
      ])
    })

    it('omits from, and skips the rebalancer and funding reads, with no sender', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen }), { sender: undefined })

      assert.equal(unsigned.transactions[0]!.from, undefined)
      // the lane check is a property of the pool, not of the caller, so it still runs
      assert.deepEqual(seen.calls, ['typeAndVersion', 'isSiloed'])
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['poolAddress', 'not-an-address'],
      ['poolAddress', ZeroAddress],
      ['remoteChainSelector', 1 as never],
      ['remoteChainSelector', -1n],
      ['remoteChainSelector', 2n ** 64n],
      // 0 designates the unsiloed bucket, which the pool rejects with ChainNotSiloed
      ['remoteChainSelector', 0n],
      ['amount', 1 as never],
      ['amount', 2n ** 256n],
      // the pool reverts LiquidityAmountCannotBeZero
      ['amount', 0n],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${String(value)} before any RPC`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => generate(stubChain({ seen }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'provideSiloedLiquidity' &&
            err.context.param === param,
        )
        assert.deepEqual(seen.calls, [])
      })
    }

    it('points selector 0 at provideLiquidity', async () => {
      await assert.rejects(
        () => generate(stubChain(), { remoteChainSelector: 0n }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && /provideLiquidity/.test(err.message),
      )
    })
  })

  describe('version and family dispatch', () => {
    it('rejects a siloed 2.0.0 pool, which escrows through per-lane lockboxes', async () => {
      const seen = newSeen()
      await assert.rejects(
        () => generate(stubChain({ version: '2.0.0', seen })),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'provideSiloedLiquidity' &&
          err.context.version === '2.0.0',
      )
      assert.deepEqual(seen.calls, ['typeAndVersion'])
    })

    for (const [type, version] of [
      ['LockReleaseTokenPool', '1.6.1'],
      ['BurnMintTokenPool', '1.5.1'],
    ] as const) {
      it(`rejects a ${type}, which has no silos`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => generate(stubChain({ type, version, seen })),
          (err: unknown) =>
            err instanceof CCTContractTypeInvalidError &&
            err.context.address === POOL &&
            err.context.actual === type &&
            err.context.operation === 'provideSiloedLiquidity',
        )
        assert.deepEqual(seen.calls, ['typeAndVersion'])
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
            /updateSiloDesignations/.test(err.message),
        )
    })

    it('rejects the unsiloed rebalancer, which the silo does not accept', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: UNSILOED_REBALANCER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'provideSiloedLiquidity' &&
          err.context.param === 'sender' &&
          // names the silo rebalancer it read, so the caller can see which address it needed
          err.message.includes(SILO_REBALANCER),
      )
    })

    it('rejects the owner, which the pool does not accept either', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: OWNER }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('reports a revoked silo rebalancer as such, not as a mismatch', async () => {
      await assert.rejects(
        () => generate(stubChain({ siloRebalancer: ZeroAddress })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          /no rebalancer is set for silo/.test(err.message) &&
          /setSiloRebalancer/.test(err.message),
      )
    })

    it('rejects a deposit larger than the rebalancer holds', async () => {
      await assert.rejects(
        () => generate(stubChain({ balance: AMOUNT - 1n })),
        (err: unknown) =>
          err instanceof CCTTxFailedError &&
          err.context.operation === 'provideSiloedLiquidity' &&
          /holds 999999999999999999 of/.test(err.message),
      )
    })

    it('rejects a deposit the pool has not been approved for, naming approveToken', async () => {
      await assert.rejects(
        () => generate(stubChain({ allowance: 0n })),
        (err: unknown) =>
          err instanceof CCTTxFailedError &&
          /has approved 0 of/.test(err.message) &&
          err.message.includes(`spender: '${POOL}'`) &&
          /approveToken\(\{ tokenAddress:/.test(err.message),
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
          err.context.operation === 'provideSiloedLiquidity',
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
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(UNSILOED_REBALANCER) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          err.message.includes(SILO_REBALANCER),
      )
    })
  })
})
