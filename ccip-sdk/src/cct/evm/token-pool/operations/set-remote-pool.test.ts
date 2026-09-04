import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError, toBeHex } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import {
  type TokenPoolType,
  TOKEN_POOL_INTERFACES,
  TokenPoolVersion,
  getTokenPoolFamily,
} from '../contracts.ts'
import { type SetRemotePoolParams, SetRemotePool } from './set-remote-pool.ts'

const POOL = '0x' + '11'.repeat(20)
const TOKEN = '0x' + '22'.repeat(20)
const ROUTER = '0x' + '33'.repeat(20)
const OWNER = '0x' + '44'.repeat(20)
const RMN_PROXY = '0x' + '55'.repeat(20)
const RATE_LIMIT_ADMIN = '0x' + '66'.repeat(20)
const LOCKBOX = '0x' + '77'.repeat(20)
const NOT_THE_OWNER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/** The remote pool this lane is being pointed at. */
const REMOTE_POOL = '0x' + '99'.repeat(20)

const SELECTOR = 5009297550715157269n // ethereum-mainnet
const SOLANA_SELECTOR = 16423721717087811551n // solana-devnet

/** Calldata built from a fresh Interface — never the SDK's cached one, or this proves nothing. */
const FRESH = new Interface([
  'function setRemotePool(uint64 remoteChainSelector, bytes remotePoolAddress)',
])
const expectedData = (remotePoolAddress = REMOTE_POOL, selector = SELECTOR) =>
  FRESH.encodeFunctionData('setRemotePool', [selector, remotePoolAddress])

/** The `getTokenPoolState` getters the owner gate reads, per version generation. */
function poolReads(version: TokenPoolVersion, type: TokenPoolType, owner: string) {
  if (version !== TokenPoolVersion.V2_0_0)
    return {
      getToken: [TOKEN],
      owner: [owner],
      getRouter: [ROUTER],
      getRmnProxy: [RMN_PROXY],
      getRateLimitAdmin: [RATE_LIMIT_ADMIN],
      getSupportedChains: [[SELECTOR]],
    }
  return {
    getToken: [TOKEN],
    owner: [owner],
    getRmnProxy: [RMN_PROXY],
    getTokenDecimals: [18],
    getSupportedChains: [[SELECTOR]],
    getDynamicConfig: [ROUTER, RATE_LIMIT_ADMIN, RATE_LIMIT_ADMIN],
    getAllowedFinalityConfig: [toBeHex(0, 4)],
    ...(getTokenPoolFamily(type) === 'LockRelease' ? { getLockBox: [LOCKBOX] } : {}),
  }
}

type Calls = { typeAndVersion: number; remotes: number; calls: number }

/**
 * EVMChain stub: reports `type`/`version` and answers the owner-gate getters off the pool's own
 * Interface. `getTokenPoolRemotes` is wired only to prove this op never calls it — a wholesale
 * replace has no membership precondition to check.
 */
function stubChain({
  type = 'BurnMintTokenPool',
  version = TokenPoolVersion.V1_5_0,
  owner = OWNER,
  seen = { typeAndVersion: 0, remotes: 0, calls: 0 },
}: {
  type?: TokenPoolType
  version?: TokenPoolVersion
  owner?: string
  seen?: Calls
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[getTokenPoolFamily(type)][version]
  const responses = new Map(
    Object.entries(poolReads(version, type, owner)).map(([fn, values]) => [
      iface.getFunction(fn)!.selector,
      iface.encodeFunctionResult(fn, values),
    ]),
  )
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    provider: {
      call: ({ data }: { data: string }) => {
        seen.calls++
        const encoded = responses.get(data.slice(0, 10))
        if (!encoded)
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: null, data },
            invocation: null,
            revert: null,
          })
        return Promise.resolve(encoded)
      },
    },
    typeAndVersion: () => {
      seen.typeAndVersion++
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
    getTokenInfo: () => Promise.resolve({ decimals: 18, symbol: 'TKN', name: 'Token' }),
    getTokenPoolRemotes: () => {
      seen.remotes++
      return Promise.resolve({})
    },
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(waitError?: Error, address = OWNER) {
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

const op = new SetRemotePool()

function generate(chain: EVMChain, overrides: Partial<SetRemotePoolParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    remoteChainSelector: SELECTOR,
    remotePoolAddress: REMOTE_POOL,
    sender: OWNER,
    ...overrides,
  })
}

/** The versions that dropped `setRemotePool` from the ABI. */
const UNSUPPORTED = [TokenPoolVersion.V1_5_1, TokenPoolVersion.V1_6_1, TokenPoolVersion.V2_0_0]
const TYPES: TokenPoolType[] = ['BurnMintTokenPool', 'LockReleaseTokenPool']

describe('SetRemotePool (cct/evm)', () => {
  describe('generate', () => {
    for (const type of TYPES) {
      it(`encodes setRemotePool(selector, bytes) for a ${type} 1.5.0`, async () => {
        const unsigned = await generate(stubChain({ type }))
        const tx = unsigned.transactions[0]!

        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(unsigned.transactions.length, 1)
        assert.equal(tx.to, POOL)
        assert.equal(tx.from, OWNER)
        assert.equal(tx.data, expectedData())
      })
    }

    it('produces identical calldata for both ABI families', async () => {
      const [burnMint, lockRelease] = await Promise.all(
        TYPES.map(async (type) => (await generate(stubChain({ type }))).transactions[0]!.data),
      )
      assert.equal(burnMint, lockRelease)
      assert.equal(burnMint, expectedData())
    })

    it('accepts a remotePoolAddress without the 0x prefix', async () => {
      const unsigned = await generate(stubChain(), {
        remotePoolAddress: REMOTE_POOL.slice(2).toUpperCase(),
      })
      assert.equal(unsigned.transactions[0]!.data, expectedData())
    })

    it('encodes a 32-byte non-EVM remote pool address as-is', async () => {
      const remotePoolAddress = '0x' + 'cd'.repeat(32)
      const unsigned = await generate(stubChain(), {
        remoteChainSelector: SOLANA_SELECTOR,
        remotePoolAddress,
      })
      assert.equal(unsigned.transactions[0]!.data, expectedData(remotePoolAddress, SOLANA_SELECTOR))
    })

    it('omits from, and skips the owner read, when sender is not supplied', async () => {
      const seen: Calls = { typeAndVersion: 0, remotes: 0, calls: 0 }
      const unsigned = await generate(stubChain({ seen }), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(seen.calls, 0, 'no owner gate without a sender to compare')
    })

    it('never reads the lane: a wholesale replace has no membership precondition', async () => {
      const seen: Calls = { typeAndVersion: 0, remotes: 0, calls: 0 }
      await generate(stubChain({ seen }))
      assert.equal(seen.remotes, 0)
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['poolAddress', 'not-an-address'],
      // a tx to `0x0` hits no code, so it mines as a successful no-op instead of reverting
      ['poolAddress', ZeroAddress],
      ['sender', 'not-an-address'],
      ['remoteChainSelector', 1 as never],
      ['remoteChainSelector', -1n],
      ['remoteChainSelector', 2n ** 64n],
      ['remotePoolAddress', ''],
      ['remotePoolAddress', '0x'],
      ['remotePoolAddress', '0xabc'],
      ['remotePoolAddress', '0xzz'],
      ['remotePoolAddress', 42 as never],
    ] as const) {
      it(`rejects ${param} = ${String(value)} before any RPC`, async () => {
        const seen: Calls = { typeAndVersion: 0, remotes: 0, calls: 0 }
        await assert.rejects(
          () => generate(stubChain({ seen }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'setRemotePool' &&
            err.context.param === param,
        )
        assert.deepEqual([seen.typeAndVersion, seen.remotes, seen.calls], [0, 0, 0])
      })
    }
  })

  describe('version dispatch', () => {
    it('encodes on v1.5.0, the only version that declares setRemotePool', async () => {
      const unsigned = await generate(stubChain({ version: TokenPoolVersion.V1_5_0 }))
      assert.equal(unsigned.transactions[0]!.data, expectedData())
    })

    for (const version of UNSUPPORTED) {
      it(`is unsupported on v${version}, which dropped the function`, async () => {
        // the null ceiling at v1.5.1 is what stops the floor-match from inheriting the v1.5.0
        // encoder here and emitting calldata for a selector these pools do not implement
        const seen: Calls = { typeAndVersion: 0, remotes: 0, calls: 0 }
        await assert.rejects(
          () => generate(stubChain({ version, seen })),
          (err: unknown) =>
            err instanceof CCTOperationUnsupportedError &&
            err.context.operation === 'setRemotePool' &&
            err.context.version === version,
        )
        assert.deepEqual([seen.typeAndVersion, seen.remotes, seen.calls], [1, 0, 0])
      })
    }

    it('covers every known pool version', () => {
      assert.deepEqual(Object.values(TokenPoolVersion), [TokenPoolVersion.V1_5_0, ...UNSUPPORTED])
    })

    it('has no setRemotePool in any post-1.5.0 vendored ABI', () => {
      for (const version of UNSUPPORTED) {
        for (const family of ['BurnMint', 'LockRelease'] as const) {
          assert.equal(
            TOKEN_POOL_INTERFACES[family][version].getFunction('setRemotePool'),
            null,
            `${family} ${version}`,
          )
        }
      }
    })
  })

  describe('pre-transaction validation', () => {
    it('rejects a sender that is not the pool owner', async () => {
      await assert.rejects(
        () => generate(stubChain({ owner: NOT_THE_OWNER })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setRemotePool' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    const params = {
      poolAddress: POOL,
      remoteChainSelector: SELECTOR,
      remotePoolAddress: REMOTE_POOL,
    }

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
            wallet: fakeSigner(makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'setRemotePool',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: {} }),
        CCIPWalletInvalidError,
      )
    })

    it('rejects a sender that is not the signing wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, sender: NOT_THE_OWNER, wallet: fakeSigner() }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setRemotePool' &&
          err.context.param === 'sender',
      )
    })
  })
})
