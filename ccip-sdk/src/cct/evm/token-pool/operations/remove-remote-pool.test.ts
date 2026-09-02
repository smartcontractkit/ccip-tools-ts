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
import { type RemoveRemotePoolParams, RemoveRemotePool } from './remove-remote-pool.ts'

const POOL = '0x' + '11'.repeat(20)
const TOKEN = '0x' + '22'.repeat(20)
const ROUTER = '0x' + '33'.repeat(20)
const OWNER = '0x' + '44'.repeat(20)
const RMN_PROXY = '0x' + '55'.repeat(20)
const RATE_LIMIT_ADMIN = '0x' + '66'.repeat(20)
const LOCKBOX = '0x' + '77'.repeat(20)
const NOT_THE_OWNER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/** The remote pool being removed — registered on the lane in the default stub. */
const REMOTE_POOL = '0x' + '99'.repeat(20)
/** A remote pool that stays registered. */
const OTHER_REMOTE_POOL = '0x' + 'aa'.repeat(20)

const SELECTOR = 5009297550715157269n // ethereum-mainnet
const SOLANA_SELECTOR = 16423721717087811551n // solana-devnet

/** Calldata built from a fresh Interface — never the SDK's cached one, or this proves nothing. */
const FRESH = new Interface([
  'function removeRemotePool(uint64 remoteChainSelector, bytes remotePoolAddress)',
])
const expectedData = (remotePoolAddress = REMOTE_POOL, selector = SELECTOR) =>
  FRESH.encodeFunctionData('removeRemotePool', [selector, remotePoolAddress])

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
  remotePools = [REMOTE_POOL] as string[],
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

const op = new RemoveRemotePool()

function generate(chain: EVMChain, overrides: Partial<RemoveRemotePoolParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    remoteChainSelector: SELECTOR,
    remotePoolAddress: REMOTE_POOL,
    sender: OWNER,
    ...overrides,
  })
}

/** Versions that declare `removeRemotePool`, each with both ABI families. */
const SUPPORTED = [TokenPoolVersion.V1_5_1, TokenPoolVersion.V1_6_1, TokenPoolVersion.V2_0_0]
const TYPES: TokenPoolType[] = ['BurnMintTokenPool', 'LockReleaseTokenPool']

describe('RemoveRemotePool (cct/evm)', () => {
  describe('generate', () => {
    for (const version of SUPPORTED) {
      for (const type of TYPES) {
        it(`encodes removeRemotePool(selector, bytes) for a ${type} ${version}`, async () => {
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
      const unsigned = await generate(stubChain({ remotePools: [remotePoolAddress] }), {
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
            err.context.operation === 'removeRemotePool' &&
            err.context.param === param,
        )
        assert.deepEqual([seen.typeAndVersion, seen.remotes.length, seen.calls], [0, 0, 0])
      })
    }
  })

  describe('version dispatch', () => {
    it('is unsupported on v1.5.0, which has no removal primitive', async () => {
      const seen: Calls = { typeAndVersion: 0, remotes: [], calls: 0 }
      await assert.rejects(
        () => generate(stubChain({ version: TokenPoolVersion.V1_5_0, seen })),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'removeRemotePool' &&
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
    it('rejects a remote pool that is not registered on the lane', async () => {
      await assert.rejects(
        () => generate(stubChain({ remotePools: [OTHER_REMOTE_POOL] })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'removeRemotePool' &&
          err.context.param === 'remotePoolAddress',
      )
    })

    it('matches a registered pool given as left-padded 32-byte bytes', async () => {
      // the chain reader returns decoded 20-byte addresses; the caller may pass either form
      const unsigned = await generate(stubChain({ remotePools: [REMOTE_POOL] }), {
        remotePoolAddress: zeroPadValue(REMOTE_POOL, 32),
      })
      assert.equal(
        unsigned.transactions[0]!.data,
        expectedData(zeroPadValue(REMOTE_POOL, 32).toLowerCase()),
      )
    })

    it('matches a registered pool whose spelling differs only in case', async () => {
      const unsigned = await generate(
        stubChain({ remotePools: [REMOTE_POOL.toUpperCase().replace('0X', '0x')] }),
      )
      assert.equal(unsigned.transactions[0]!.data, expectedData())
    })

    it('falls back to raw byte comparison when the remote family has no registered codec', async () => {
      // `decodeAddress` only knows the families whose chain module is loaded (EVM always is);
      // for anything else the undecoded hex is compared
      const bytes = '0x' + 'cd'.repeat(32)
      const unsigned = await generate(stubChain({ remotePools: [bytes] }), {
        remoteChainSelector: SOLANA_SELECTOR,
        remotePoolAddress: bytes.toUpperCase().replace('0X', '0x'),
      })
      assert.equal(unsigned.transactions[0]!.data, expectedData(bytes, SOLANA_SELECTOR))
    })

    it('removes one of several registered pools', async () => {
      const unsigned = await generate(stubChain({ remotePools: [OTHER_REMOTE_POOL, REMOTE_POOL] }))
      assert.equal(unsigned.transactions[0]!.data, expectedData())
    })

    it('rejects removal on a lane that has no configuration at all', async () => {
      const chain = stubChain({
        remotesError: new CCIPTokenPoolChainConfigNotFoundError(POOL, POOL, 'a-network'),
      })
      await assert.rejects(
        () => generate(chain),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'remotePoolAddress',
      )
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
          err.context.operation === 'removeRemotePool' &&
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
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'removeRemotePool',
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
          err.context.operation === 'removeRemotePool' &&
          err.context.param === 'sender',
      )
    })
  })
})
