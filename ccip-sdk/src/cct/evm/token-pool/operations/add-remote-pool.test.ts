import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError, toBeHex, zeroPadValue } from 'ethers'

import type { TokenPoolRemote } from '../../../../chain.ts'
import {
  CCIPExecTxRevertedError,
  CCIPTokenPoolChainConfigNotFoundError,
  CCIPWalletInvalidError,
} from '../../../../errors/index.ts'
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
import { type AddRemotePoolParams, AddRemotePool } from './add-remote-pool.ts'

const POOL = '0x' + '11'.repeat(20)
const TOKEN = '0x' + '22'.repeat(20)
const ROUTER = '0x' + '33'.repeat(20)
const OWNER = '0x' + '44'.repeat(20)
const RMN_PROXY = '0x' + '55'.repeat(20)
const RATE_LIMIT_ADMIN = '0x' + '66'.repeat(20)
const LOCKBOX = '0x' + '77'.repeat(20)
const NOT_THE_OWNER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/** An EVM remote pool, as the caller passes it (hex bytes) and as the chain reader returns it. */
const REMOTE_POOL = '0x' + '99'.repeat(20)
/** Another remote pool, already registered on the lane in the duplicate tests. */
const OTHER_REMOTE_POOL = '0x' + 'aa'.repeat(20)

const SELECTOR = 5009297550715157269n // ethereum-mainnet
const SOLANA_SELECTOR = 16423721717087811551n // solana-devnet

/** Calldata built from a fresh Interface — never the SDK's cached one, or this proves nothing. */
const FRESH = new Interface([
  'function addRemotePool(uint64 remoteChainSelector, bytes remotePoolAddress)',
])
const expectedData = (remotePoolAddress = REMOTE_POOL, selector = SELECTOR) =>
  FRESH.encodeFunctionData('addRemotePool', [selector, remotePoolAddress])

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

type Calls = { typeAndVersion: number; remotes: Array<[string, bigint | undefined]>; calls: number }

/**
 * EVMChain stub: reports `type`/`version`, answers the owner-gate getters off the pool's own
 * Interface, and returns (or throws for) one lane's remotes.
 */
function stubChain({
  type = 'BurnMintTokenPool',
  version = TokenPoolVersion.V1_5_1,
  owner = OWNER,
  remotePools = [] as string[],
  remotesError,
  seen = { typeAndVersion: 0, remotes: [], calls: 0 },
}: {
  type?: TokenPoolType
  version?: TokenPoolVersion
  owner?: string
  remotePools?: string[]
  remotesError?: Error
  seen?: Calls
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[getTokenPoolFamily(type)][version]
  const responses = new Map(
    Object.entries(poolReads(version, type, owner)).map(([fn, values]) => [
      iface.getFunction(fn)!.selector,
      iface.encodeFunctionResult(fn, values),
    ]),
  )
  const remote: TokenPoolRemote = {
    remoteToken: TOKEN,
    remotePools,
    inboundRateLimiterState: null,
    outboundRateLimiterState: null,
  }
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
    getTokenPoolRemotes: (tokenPool: string, remoteChainSelector?: bigint) => {
      seen.remotes.push([tokenPool, remoteChainSelector])
      return remotesError ? Promise.reject(remotesError) : Promise.resolve({ 'a-network': remote })
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

const op = new AddRemotePool()

function generate(chain: EVMChain, overrides: Partial<AddRemotePoolParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    remoteChainSelector: SELECTOR,
    remotePoolAddress: REMOTE_POOL,
    sender: OWNER,
    ...overrides,
  })
}

/** Versions that declare `addRemotePool`, each with both ABI families. */
const SUPPORTED = [TokenPoolVersion.V1_5_1, TokenPoolVersion.V1_6_1, TokenPoolVersion.V2_0_0]
const TYPES: TokenPoolType[] = ['BurnMintTokenPool', 'LockReleaseTokenPool']

describe('AddRemotePool (cct/evm)', () => {
  describe('generate', () => {
    for (const version of SUPPORTED) {
      for (const type of TYPES) {
        it(`encodes addRemotePool(selector, bytes) for a ${type} ${version}`, async () => {
          const unsigned = await generate(stubChain({ type, version }))
          const tx = unsigned.transactions[0]!

          assert.equal(unsigned.family, ChainFamily.EVM)
          assert.equal(unsigned.transactions.length, 1)
          assert.equal(tx.to, POOL)
          assert.equal(tx.from, OWNER)
          assert.equal(tx.data, expectedData())
        })
      }
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
      const unsigned = await generate(stubChain({ remotePools: [] }), {
        remoteChainSelector: SOLANA_SELECTOR,
        remotePoolAddress,
      })
      assert.equal(unsigned.transactions[0]!.data, expectedData(remotePoolAddress, SOLANA_SELECTOR))
    })

    it('omits from, and skips the owner read, when sender is not supplied', async () => {
      const seen: Calls = { typeAndVersion: 0, remotes: [], calls: 0 }
      const unsigned = await generate(stubChain({ seen }), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(seen.calls, 0, 'no owner gate without a sender to compare')
    })

    it('scopes the remotes read to the one lane', async () => {
      const seen: Calls = { typeAndVersion: 0, remotes: [], calls: 0 }
      await generate(stubChain({ seen }))
      assert.deepEqual(seen.remotes, [[POOL, SELECTOR]])
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
        const seen: Calls = { typeAndVersion: 0, remotes: [], calls: 0 }
        await assert.rejects(
          () => generate(stubChain({ seen }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'addRemotePool' &&
            err.context.param === param,
        )
        assert.deepEqual([seen.typeAndVersion, seen.remotes.length, seen.calls], [0, 0, 0])
      })
    }
  })

  describe('version dispatch', () => {
    it('is unsupported on v1.5.0, which has no additive primitive', async () => {
      const seen: Calls = { typeAndVersion: 0, remotes: [], calls: 0 }
      await assert.rejects(
        () => generate(stubChain({ version: TokenPoolVersion.V1_5_0, seen })),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'addRemotePool' &&
          err.context.version === '1.5.0',
      )
      // the encoder is resolved off the single typeAndVersion read, before any further RPC
      assert.deepEqual([seen.typeAndVersion, seen.remotes.length, seen.calls], [1, 0, 0])
    })

    for (const version of SUPPORTED) {
      it(`encodes on v${version}`, async () => {
        const unsigned = await generate(stubChain({ version }))
        assert.equal(unsigned.transactions[0]!.data, expectedData())
      })
    }

    it('covers every known pool version', () => {
      assert.deepEqual(Object.values(TokenPoolVersion), [TokenPoolVersion.V1_5_0, ...SUPPORTED])
    })
  })

  describe('pre-transaction validation', () => {
    it('rejects a remote pool already registered on the lane', async () => {
      await assert.rejects(
        () => generate(stubChain({ remotePools: [OTHER_REMOTE_POOL, REMOTE_POOL] })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'addRemotePool' &&
          err.context.param === 'remotePoolAddress',
      )
    })

    it('rejects a duplicate given as left-padded 32-byte bytes', async () => {
      // the chain reader returns decoded 20-byte addresses; the caller may pass either form
      await assert.rejects(
        () =>
          generate(stubChain({ remotePools: [REMOTE_POOL] }), {
            remotePoolAddress: zeroPadValue(REMOTE_POOL, 32),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'remotePoolAddress',
      )
    })

    it('rejects a duplicate whose registered spelling differs only in case', async () => {
      await assert.rejects(
        () => generate(stubChain({ remotePools: [REMOTE_POOL.toUpperCase().replace('0X', '0x')] })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'remotePoolAddress',
      )
    })

    it('falls back to raw byte comparison when the remote family has no registered codec', async () => {
      // `decodeAddress` only knows the families whose chain module is loaded (EVM always is);
      // for anything else the undecoded hex is compared, so a duplicate is still caught
      const bytes = '0x' + 'cd'.repeat(32)
      await assert.rejects(
        () =>
          generate(stubChain({ remotePools: [bytes] }), {
            remoteChainSelector: SOLANA_SELECTOR,
            remotePoolAddress: bytes.toUpperCase().replace('0X', '0x'),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'remotePoolAddress',
      )
    })

    it('allows adding to a lane that holds other remote pools', async () => {
      const unsigned = await generate(stubChain({ remotePools: [OTHER_REMOTE_POOL] }))
      assert.equal(unsigned.transactions[0]!.data, expectedData())
    })

    it('treats an unconfigured lane as having no remote pools', async () => {
      const chain = stubChain({
        remotesError: new CCIPTokenPoolChainConfigNotFoundError(POOL, POOL, 'a-network'),
      })
      const unsigned = await generate(chain)
      assert.equal(unsigned.transactions[0]!.data, expectedData())
    })

    it('propagates any other remotes-read failure', async () => {
      const boom = new Error('rpc down')
      await assert.rejects(() => generate(stubChain({ remotesError: boom })), boom)
    })

    it('rejects a sender that is not the pool owner', async () => {
      await assert.rejects(
        () => generate(stubChain({ owner: NOT_THE_OWNER })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'addRemotePool' &&
          err.context.param === 'sender',
      )
    })
  })

  /**
   * Regression guard for the owner gate on a v2.0.0 `SiloedLockReleaseTokenPool`.
   *
   * A siloed pool escrows per remote chain (`getLockBox(uint64)`, no no-arg `getLockBox()`), but
   * it is a fully supported `TokenPoolType` and this op's calldata is perfectly valid against one.
   * The gate must therefore admit it on the strength of `owner()` alone, without depending on any
   * pool-shape detail that only the non-siloed variant reports.
   */
  describe('siloed lock/release pools', () => {
    const siloedPool = (owner = OWNER) =>
      stubChain({ type: 'SiloedLockReleaseTokenPool', version: TokenPoolVersion.V2_0_0, owner })

    it('builds for a siloed lock/release pool, which getTokenPoolState cannot read', async () => {
      const unsigned = await generate(siloedPool())
      const tx = unsigned.transactions[0]!

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      assert.equal(tx.to, POOL)
      assert.equal(tx.from, OWNER)
      assert.equal(tx.data, expectedData())
    })

    it('still rejects a sender that is not the siloed pool owner', async () => {
      await assert.rejects(
        () => generate(siloedPool(NOT_THE_OWNER)),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'addRemotePool' &&
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
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'addRemotePool',
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
          err.context.operation === 'addRemotePool' &&
          err.context.param === 'sender',
      )
    })
  })
})
