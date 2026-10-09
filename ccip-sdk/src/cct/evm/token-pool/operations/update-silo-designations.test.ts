import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { type TokenPoolVersion, TOKEN_POOL_INTERFACES } from '../contracts.ts'
import {
  type SiloConfigUpdate,
  type UpdateSiloDesignationsParams,
  UpdateSiloDesignations,
} from './update-silo-designations.ts'

const POOL = '0x' + '11'.repeat(20)
const OWNER = '0x' + '33'.repeat(20)
const REBALANCER_A = getAddress('0xabcdef0123456789abcdef0123456789abcdef01')
const REBALANCER_B = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
/** A lane that is currently a silo. */
const SILOED = 16015286601757825753n
/** Supported lanes that share the unsiloed bucket. */
const FREE_A = 3478487238524512106n
const FREE_B = 10344971235874465080n
/** A lane the pool does not support. */
const UNSUPPORTED = 5224473277236331295n

/** Byte-parity oracle, independent of the SDK's cached, ABI-derived interfaces. */
const IFACE = new Interface([
  'function updateSiloDesignations(uint64[] removes, (uint64 remoteChainSelector, address rebalancer)[] adds)',
])
const dataFor = (removes: bigint[], adds: SiloConfigUpdate[]) =>
  IFACE.encodeFunctionData('updateSiloDesignations', [
    removes,
    adds.map((a) => [a.remoteChainSelector, a.rebalancer]),
  ])

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * EVMChain stub: `typeAndVersion` reports the requested pool type/version, and `provider.call`
 * answers `isSiloed(selector)`, `isSupportedChain(selector)` and `owner()` off the siloed 1.6.1
 * ABI. Any other call reverts.
 */
function stubChain({
  type = 'SiloedLockReleaseTokenPool',
  version = '1.6.1' as TokenPoolVersion,
  siloed = [SILOED],
  supported = [SILOED, FREE_A, FREE_B],
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  siloed?: bigint[]
  supported?: bigint[]
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.SiloedLockRelease['1.6.1']
  const pool = (fn: string, args: readonly unknown[]): unknown[] | undefined => {
    switch (fn) {
      case 'isSiloed':
        return [siloed.includes(args[0] as bigint)]
      case 'isSupportedChain':
        return [supported.includes(args[0] as bigint)]
      case 'owner':
        return [OWNER]
    }
  }
  return {
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    provider: {
      call: ({ data }: { data: string }) => {
        const poolTx = iface.parseTransaction({ data })
        const answer = poolTx && pool(poolTx.name, poolTx.args)
        if (poolTx && answer) {
          seen.calls.push(poolTx.name)
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

const op = new UpdateSiloDesignations()

const ADD_A: SiloConfigUpdate = { remoteChainSelector: FREE_A, rebalancer: REBALANCER_A }
const ADD_B: SiloConfigUpdate = { remoteChainSelector: FREE_B, rebalancer: REBALANCER_B }

function generate(chain: EVMChain, overrides: Partial<UpdateSiloDesignationsParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    removes: [SILOED],
    adds: [ADD_A],
    sender: OWNER,
    ...overrides,
  })
}

const SUPPORTED = ['1.6.0', '1.6.1'] as const

/** `[first, <hole>, last]`: a hole `.map` would skip, so only the density guard catches it. */
function sparse<T>(first: T, last: T): T[] {
  const arr = [first]
  arr[2] = last
  return arr
}

describe('UpdateSiloDesignations (cct/evm)', () => {
  describe('generate', () => {
    for (const version of SUPPORTED) {
      it(`encodes updateSiloDesignations(removes, adds) at ${version}`, async () => {
        const unsigned = await generate(stubChain({ version }))
        const tx = unsigned.transactions[0]!

        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(tx.to, POOL)
        assert.equal(tx.from, OWNER)
        assert.equal(tx.data, dataFor([SILOED], [ADD_A]))
      })
    }

    it('emits identical calldata at every supported version', async () => {
      const built = await Promise.all(SUPPORTED.map((version) => generate(stubChain({ version }))))
      const [first, ...rest] = built.map((unsigned) => unsigned.transactions[0]!.data)
      for (const data of rest) assert.equal(data, first)
    })

    it('encodes removes only', async () => {
      const unsigned = await generate(stubChain(), { adds: [] })
      assert.equal(unsigned.transactions[0]!.data, dataFor([SILOED], []))
    })

    it('encodes adds only, several at once', async () => {
      const unsigned = await generate(stubChain(), { removes: [], adds: [ADD_A, ADD_B] })
      assert.equal(unsigned.transactions[0]!.data, dataFor([], [ADD_A, ADD_B]))
    })

    it('encodes removes FIRST, the ABI order', async () => {
      const unsigned = await generate(stubChain())
      const [removes, adds] = IFACE.decodeFunctionData(
        'updateSiloDesignations',
        unsigned.transactions[0]!.data!,
      )
      assert.deepEqual([...removes], [SILOED])
      assert.equal(adds[0][0], FREE_A)
      assert.equal(adds[0][1], REBALANCER_A)
    })

    it('accepts a lowercase rebalancer and encodes the same address', async () => {
      const lower = { ...ADD_A, rebalancer: REBALANCER_A.toLowerCase() }
      const unsigned = await generate(stubChain(), { adds: [lower] })
      assert.equal(unsigned.transactions[0]!.data, dataFor([SILOED], [ADD_A]))
    })

    it('reads the owner, then every lane it touches', async () => {
      const seen = newSeen()
      await generate(stubChain({ seen }))
      assert.equal(seen.calls[0], 'typeAndVersion')
      assert.equal(seen.calls[1], 'owner')
      assert.deepEqual(
        seen.calls.slice(2).sort(),
        ['isSiloed', 'isSiloed', 'isSupportedChain'].sort(),
      )
    })

    it('omits from, and skips the owner read, with no sender', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen }), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.ok(!seen.calls.includes('owner'))
      // the lane state checks do not depend on the signer, so they still run
      assert.ok(seen.calls.includes('isSiloed'))
    })
  })

  describe('validation', () => {
    for (const [name, overrides, param] of [
      ['a malformed poolAddress', { poolAddress: 'nope' }, 'poolAddress'],
      ['a zero poolAddress', { poolAddress: ZeroAddress }, 'poolAddress'],
      ['both arrays empty', { removes: [], adds: [] }, 'adds'],
      ['removes that is not an array', { removes: 1 as never }, 'removes'],
      ['adds that is not an array', { adds: 'x' as never }, 'adds'],
      ['a removes entry that is not a uint64', { removes: [-1n] }, 'removes[0]'],
      ['a duplicate removes entry', { removes: [SILOED, SILOED] }, 'removes[1]'],
      ['an adds entry that is not an object', { adds: [1 as never] }, 'adds[0]'],
      [
        'an adds selector of 0',
        { adds: [{ ...ADD_A, remoteChainSelector: 0n }] },
        'adds[0].remoteChainSelector',
      ],
      [
        'an adds selector that is not a uint64',
        { adds: [{ ...ADD_A, remoteChainSelector: 2n ** 64n }] },
        'adds[0].remoteChainSelector',
      ],
      [
        'a duplicate adds selector',
        { adds: [ADD_A, { ...ADD_B, remoteChainSelector: FREE_A }] },
        'adds[1].remoteChainSelector',
      ],
      [
        'a zero rebalancer',
        { adds: [{ ...ADD_A, rebalancer: ZeroAddress }] },
        'adds[0].rebalancer',
      ],
      [
        'a malformed rebalancer',
        { adds: [{ ...ADD_A, rebalancer: 'nope' }] },
        'adds[0].rebalancer',
      ],
      [
        'a selector in both arrays',
        { removes: [SILOED], adds: [{ ...ADD_A, remoteChainSelector: SILOED }] },
        'adds[0].remoteChainSelector',
      ],
      ['a sparse adds array', { adds: sparse(ADD_A, ADD_B) }, 'adds[1]'],
    ] as const) {
      it(`rejects ${name} before any RPC`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => generate(stubChain({ seen }), overrides as Partial<UpdateSiloDesignationsParams>),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'updateSiloDesignations' &&
            err.context.param === param,
        )
        assert.deepEqual(seen.calls, [])
      })
    }

    it('points a selector in both arrays at setSiloRebalancer', async () => {
      await assert.rejects(
        () => generate(stubChain(), { adds: [{ ...ADD_A, remoteChainSelector: SILOED }] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && /setSiloRebalancer/.test(err.message),
      )
    })
  })

  describe('version and family dispatch', () => {
    it('rejects a siloed 2.0.0 pool', async () => {
      await assert.rejects(
        () => generate(stubChain({ version: '2.0.0' })),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'updateSiloDesignations' &&
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
    it('rejects removing a lane that is not siloed', async () => {
      await assert.rejects(
        () => generate(stubChain(), { removes: [SILOED, FREE_B], adds: [] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'removes[1]' &&
          /ChainNotSiloed/.test(err.message),
      )
    })

    it('rejects adding a lane that is already siloed, pointing at setSiloRebalancer', async () => {
      await assert.rejects(
        () =>
          generate(stubChain(), {
            removes: [],
            adds: [ADD_A, { ...ADD_B, remoteChainSelector: SILOED }],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'adds[1].remoteChainSelector' &&
          /InvalidChainSelector/.test(err.message) &&
          /setSiloRebalancer/.test(err.message),
      )
    })

    it('rejects adding a lane the pool does not support, pointing at applyChainUpdates', async () => {
      await assert.rejects(
        () => generate(stubChain(), { adds: [{ ...ADD_A, remoteChainSelector: UNSUPPORTED }] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'adds[0].remoteChainSelector' &&
          /applyChainUpdates/.test(err.message),
      )
    })

    it('rejects a sender that is not the owner', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: REBALANCER_B }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          err.message.includes(OWNER),
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, removes: [SILOED], adds: [ADD_A] }

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
          err.context.operation === 'updateSiloDesignations',
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
        () => op.execute(stubChain(), { ...params, sender: REBALANCER_B, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a wallet that is not the owner', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(REBALANCER_B) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          err.message.includes(OWNER),
      )
    })
  })
})
