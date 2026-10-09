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
} from '../../../errors.ts'
import { type TokenPoolVersion, TOKEN_POOL_INTERFACES } from '../contracts.ts'
import { type SetSiloRebalancerParams, SetSiloRebalancer } from './set-silo-rebalancer.ts'

const POOL = '0x' + '11'.repeat(20)
const SILO_REBALANCER = '0x' + '22'.repeat(20)
const OWNER = '0x' + '33'.repeat(20)
const NEW_REBALANCER = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
/** A siloed lane. */
const SEL = 16015286601757825753n
/** A supported lane that shares the unsiloed bucket. */
const UNSILOED_SEL = 3478487238524512106n

/** Byte-parity oracle, independent of the SDK's cached, ABI-derived interfaces. */
const IFACE = new Interface([
  'function setSiloRebalancer(uint64 remoteChainSelector, address newRebalancer)',
])
const dataFor = (selector: bigint, rebalancer: string) =>
  IFACE.encodeFunctionData('setSiloRebalancer', [selector, rebalancer])

/** The reads the op makes, in order, as decoded function names (`typeAndVersion` included). */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

/**
 * EVMChain stub: `typeAndVersion` reports the requested pool type/version, and `provider.call`
 * answers `isSiloed(selector)` and `owner()` off the siloed 1.6.1 ABI. Any other call reverts.
 */
function stubChain({
  type = 'SiloedLockReleaseTokenPool',
  version = '1.6.1' as TokenPoolVersion,
  siloed = [SEL],
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  siloed?: bigint[]
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.SiloedLockRelease['1.6.1']
  const pool = (fn: string, args: readonly unknown[]): unknown[] | undefined => {
    switch (fn) {
      case 'isSiloed':
        return [siloed.includes(args[0] as bigint)]
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

const op = new SetSiloRebalancer()

function generate(chain: EVMChain, overrides: Partial<SetSiloRebalancerParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    remoteChainSelector: SEL,
    rebalancer: NEW_REBALANCER,
    sender: OWNER,
    ...overrides,
  })
}

const SUPPORTED = ['1.6.0', '1.6.1'] as const

describe('SetSiloRebalancer (cct/evm)', () => {
  describe('generate', () => {
    for (const version of SUPPORTED) {
      it(`encodes setSiloRebalancer(selector, rebalancer) at ${version}`, async () => {
        const seen = newSeen()
        const unsigned = await generate(stubChain({ version, seen }))
        const tx = unsigned.transactions[0]!

        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(tx.to, POOL)
        assert.equal(tx.from, OWNER)
        assert.equal(tx.data, dataFor(SEL, NEW_REBALANCER))
        assert.deepEqual(seen.calls, ['typeAndVersion', 'isSiloed', 'owner'])
      })
    }

    it('emits identical calldata at every supported version', async () => {
      const built = await Promise.all(SUPPORTED.map((version) => generate(stubChain({ version }))))
      const [first, ...rest] = built.map((unsigned) => unsigned.transactions[0]!.data)
      for (const data of rest) assert.equal(data, first)
    })

    it('omits from, and skips the owner read, with no sender', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen }), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.deepEqual(seen.calls, ['typeAndVersion', 'isSiloed'])
    })

    it('encodes the zero address at 1.6.1, which leaves the silo with no rebalancer', async () => {
      const unsigned = await generate(stubChain({ version: '1.6.1' }), { rebalancer: ZeroAddress })
      assert.equal(unsigned.transactions[0]!.data, dataFor(SEL, ZeroAddress))
    })

    it('rejects the zero address at 1.6.0, which reverts ZeroAddressNotAllowed', async () => {
      const seen = newSeen()
      await assert.rejects(
        () => generate(stubChain({ version: '1.6.0', seen }), { rebalancer: ZeroAddress }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setSiloRebalancer' &&
          err.context.param === 'rebalancer' &&
          /ZeroAddressNotAllowed/.test(err.message),
      )
      // decided from the version alone
      assert.deepEqual(seen.calls, ['typeAndVersion'])
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['poolAddress', 'not-an-address'],
      ['poolAddress', ZeroAddress],
      ['remoteChainSelector', 1 as never],
      ['remoteChainSelector', 2n ** 64n],
      ['remoteChainSelector', 0n],
      ['rebalancer', 'not-an-address'],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${String(value)} before any RPC`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => generate(stubChain({ seen }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'setSiloRebalancer' &&
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
          err.context.operation === 'setSiloRebalancer' &&
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
      for (const sender of [OWNER, undefined])
        await assert.rejects(
          () => generate(stubChain(), { remoteChainSelector: UNSILOED_SEL, sender }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.param === 'remoteChainSelector' &&
            /ChainNotSiloed/.test(err.message),
        )
    })

    it('rejects a sender that is not the owner', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: NEW_REBALANCER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          err.message.includes(OWNER),
      )
    })

    it('rejects the current silo rebalancer, since the call is owner-only', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: SILO_REBALANCER }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, remoteChainSelector: SEL, rebalancer: NEW_REBALANCER }

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
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'setSiloRebalancer',
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
        () => op.execute(stubChain(), { ...params, sender: NEW_REBALANCER, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a wallet that is not the owner', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(SILO_REBALANCER) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          err.message.includes(OWNER),
      )
    })
  })
})
