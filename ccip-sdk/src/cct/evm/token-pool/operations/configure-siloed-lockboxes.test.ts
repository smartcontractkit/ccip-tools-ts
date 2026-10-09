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
import { LOCKBOX_INTERFACE } from '../../lockbox/contracts.ts'
import { type LockboxConfig, type TokenPoolVersion, TOKEN_POOL_INTERFACES } from '../contracts.ts'
import {
  type ConfigureSiloedLockboxesParams,
  ConfigureSiloedLockboxes,
} from './configure-siloed-lockboxes.ts'

const POOL = getAddress('0x' + '11'.repeat(20))
const OWNER = getAddress('0x' + '33'.repeat(20))
const TOKEN = getAddress('0x' + '55'.repeat(20))
const OTHER_TOKEN = getAddress('0x' + '66'.repeat(20))
const LOCKBOX_A = getAddress('0x' + 'a1'.repeat(20))
const LOCKBOX_B = getAddress('0x' + 'b2'.repeat(20))
const HASH = '0x' + 'ab'.repeat(32)
const SEL_A = 16015286601757825753n
const SEL_B = 3478487238524512106n

/** Byte-parity oracle, independent of the SDK's cached, ABI-derived interfaces. */
const IFACE = new Interface([
  'function configureLockBoxes((uint64 remoteChainSelector, address lockBox)[] lockBoxConfigs)',
])
const dataFor = (configs: LockboxConfig[]) =>
  IFACE.encodeFunctionData('configureLockBoxes', [
    configs.map((c) => [c.remoteChainSelector, c.lockbox]),
  ])

/** The reads the op makes, in order: pool reads by name, lockbox reads as `name@lockbox`. */
type Seen = { calls: string[] }
const newSeen = (): Seen => ({ calls: [] })

const revert = (to: string, data: string) =>
  makeError('execution reverted', 'CALL_EXCEPTION', {
    action: 'call',
    data: '0x',
    reason: null,
    transaction: { to, data },
    invocation: null,
    revert: null,
  })

/**
 * EVMChain stub, dispatching on the call target. The pool answers `typeAndVersion`, `owner()`,
 * `getToken()` and `getAllLockBoxConfigs()` off the siloed 2.0.0 ABI; each lockbox in `lockboxes`
 * answers `typeAndVersion` with its entry and `getToken()` off the ERC20LockBox ABI. Anything else
 * (including `typeAndVersion` on an address not in `lockboxes`) reverts.
 */
function stubChain({
  type = 'SiloedLockReleaseTokenPool',
  version = '2.0.0' as TokenPoolVersion,
  configured = [],
  lockboxes = {
    [LOCKBOX_A]: { typeAndVersion: 'ERC20LockBox 2.0.0', token: TOKEN },
    [LOCKBOX_B]: { typeAndVersion: 'ERC20LockBox 2.0.0', token: TOKEN },
  },
  seen = newSeen(),
}: {
  type?: string
  version?: TokenPoolVersion
  /** The pool's current lane → lockbox mapping. */
  configured?: LockboxConfig[]
  lockboxes?: Record<string, { typeAndVersion: string; token: string }>
  seen?: Seen
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES.SiloedLockRelease['2.0.0']
  const pool: Record<string, unknown[]> = {
    owner: [OWNER],
    getToken: [TOKEN],
    getAllLockBoxConfigs: [configured.map((c) => [c.remoteChainSelector, c.lockbox])],
  }
  const lockboxAt = (address: string) => lockboxes[getAddress(address)]
  return {
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    provider: {
      call: ({ to, data }: { to: string; data: string }) => {
        const box = lockboxAt(to)
        if (box) {
          const fn = LOCKBOX_INTERFACE.getFunction(data.slice(0, 10))?.name
          if (fn !== 'getToken') throw revert(to, data)
          seen.calls.push(`getToken@${getAddress(to)}`)
          return Promise.resolve(LOCKBOX_INTERFACE.encodeFunctionResult(fn, [box.token]))
        }
        const fn = iface.getFunction(data.slice(0, 10))?.name
        if (getAddress(to) !== POOL || !fn || !pool[fn]) throw revert(to, data)
        seen.calls.push(fn)
        return Promise.resolve(iface.encodeFunctionResult(fn, pool[fn]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: (address: string) => {
      if (getAddress(address) === POOL) {
        seen.calls.push('typeAndVersion')
        return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
      }
      seen.calls.push(`typeAndVersion@${getAddress(address)}`)
      const box = lockboxAt(address)
      if (!box) return Promise.reject(revert(address, '0x'))
      return Promise.resolve(parseTypeAndVersion(box.typeAndVersion))
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

const op = new ConfigureSiloedLockboxes()

const CONFIG_A: LockboxConfig = { remoteChainSelector: SEL_A, lockbox: LOCKBOX_A }
const CONFIG_B: LockboxConfig = { remoteChainSelector: SEL_B, lockbox: LOCKBOX_B }

function generate(chain: EVMChain, overrides: Partial<ConfigureSiloedLockboxesParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    lockboxConfigs: [CONFIG_A],
    sender: OWNER,
    ...overrides,
  })
}

describe('ConfigureSiloedLockboxes (cct/evm)', () => {
  describe('generate', () => {
    it('encodes configureLockBoxes for one lane', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen }))
      const tx = unsigned.transactions[0]!

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      assert.equal(tx.to, POOL)
      assert.equal(tx.from, OWNER)
      assert.equal(tx.data, dataFor([CONFIG_A]))
      assert.deepEqual(seen.calls, [
        'typeAndVersion',
        'owner',
        'getToken',
        'getAllLockBoxConfigs',
        `typeAndVersion@${LOCKBOX_A}`,
        `getToken@${LOCKBOX_A}`,
      ])
    })

    it('encodes several lanes, in the order given', async () => {
      const unsigned = await generate(stubChain(), { lockboxConfigs: [CONFIG_B, CONFIG_A] })
      assert.equal(unsigned.transactions[0]!.data, dataFor([CONFIG_B, CONFIG_A]))
    })

    it('checks a lockbox shared by two lanes once', async () => {
      const seen = newSeen()
      const shared = [CONFIG_A, { remoteChainSelector: SEL_B, lockbox: LOCKBOX_A }]
      const unsigned = await generate(stubChain({ seen }), { lockboxConfigs: shared })
      assert.equal(unsigned.transactions[0]!.data, dataFor(shared))
      assert.equal(seen.calls.filter((c) => c === `typeAndVersion@${LOCKBOX_A}`).length, 1)
      assert.equal(seen.calls.filter((c) => c === `getToken@${LOCKBOX_A}`).length, 1)
    })

    it('accepts a lowercase lockbox and encodes the same address', async () => {
      const lower = { ...CONFIG_A, lockbox: LOCKBOX_A.toLowerCase() }
      const unsigned = await generate(stubChain(), { lockboxConfigs: [lower] })
      assert.equal(unsigned.transactions[0]!.data, dataFor([CONFIG_A]))
    })

    it('omits from, and skips the owner read, with no sender', async () => {
      const seen = newSeen()
      const unsigned = await generate(stubChain({ seen }), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.ok(!seen.calls.includes('owner'))
      // the lockbox checks do not depend on the signer, so they still run
      assert.ok(seen.calls.includes(`getToken@${LOCKBOX_A}`))
    })

    it('accepts remapping a lane to a different lockbox', async () => {
      const unsigned = await generate(stubChain({ configured: [CONFIG_A] }), {
        lockboxConfigs: [{ remoteChainSelector: SEL_A, lockbox: LOCKBOX_B }],
      })
      assert.equal(
        unsigned.transactions[0]!.data,
        dataFor([{ remoteChainSelector: SEL_A, lockbox: LOCKBOX_B }]),
      )
    })
  })

  describe('validation', () => {
    for (const [name, overrides, param] of [
      ['a malformed poolAddress', { poolAddress: 'nope' }, 'poolAddress'],
      ['a zero poolAddress', { poolAddress: ZeroAddress }, 'poolAddress'],
      ['an empty array', { lockboxConfigs: [] }, 'lockboxConfigs'],
      ['a non-array', { lockboxConfigs: 1 as never }, 'lockboxConfigs'],
      ['an entry that is not an object', { lockboxConfigs: [1 as never] }, 'lockboxConfigs[0]'],
      [
        'a selector of 0',
        { lockboxConfigs: [{ ...CONFIG_A, remoteChainSelector: 0n }] },
        'lockboxConfigs[0].remoteChainSelector',
      ],
      [
        'a selector that is not a uint64',
        { lockboxConfigs: [{ ...CONFIG_A, remoteChainSelector: -1n }] },
        'lockboxConfigs[0].remoteChainSelector',
      ],
      [
        'a duplicate selector',
        { lockboxConfigs: [CONFIG_A, { ...CONFIG_B, remoteChainSelector: SEL_A }] },
        'lockboxConfigs[1].remoteChainSelector',
      ],
      [
        'a zero lockbox',
        { lockboxConfigs: [{ ...CONFIG_A, lockbox: ZeroAddress }] },
        'lockboxConfigs[0].lockbox',
      ],
      [
        'a malformed lockbox',
        { lockboxConfigs: [{ ...CONFIG_A, lockbox: 'nope' }] },
        'lockboxConfigs[0].lockbox',
      ],
    ] as const) {
      it(`rejects ${name} before any RPC`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => generate(stubChain({ seen }), overrides as Partial<ConfigureSiloedLockboxesParams>),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'configureSiloedLockboxes' &&
            err.context.param === param,
        )
        assert.deepEqual(seen.calls, [])
      })
    }
  })

  describe('version and family dispatch', () => {
    for (const version of ['1.6.0', '1.6.1'] as const)
      it(`rejects a siloed ${version} pool, which holds silos itself`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => generate(stubChain({ version, seen })),
          (err: unknown) =>
            err instanceof CCTOperationUnsupportedError &&
            err.context.operation === 'configureSiloedLockboxes' &&
            err.context.version === version,
        )
        assert.deepEqual(seen.calls, ['typeAndVersion'])
      })

    it('rejects a non-siloed 2.0.0 LockRelease pool, whose one lockbox is fixed', async () => {
      await assert.rejects(
        () => generate(stubChain({ type: 'LockReleaseTokenPool' })),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.actual === 'LockReleaseTokenPool' &&
          err.context.operation === 'configureSiloedLockboxes',
      )
    })
  })

  describe('pre-transaction validation', () => {
    it('rejects a lockbox address that is some other contract', async () => {
      const lockboxes = {
        [LOCKBOX_A]: { typeAndVersion: 'SiloedLockReleaseTokenPool 2.0.0', token: TOKEN },
      }
      await assert.rejects(
        () => generate(stubChain({ lockboxes })),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === LOCKBOX_A &&
          err.context.expected === 'ERC20LockBox',
      )
    })

    it('rejects a lockbox address with no contract behind it, naming its entry', async () => {
      const lockboxes = {
        [LOCKBOX_A]: { typeAndVersion: 'ERC20LockBox 2.0.0', token: TOKEN },
      }
      await assert.rejects(
        () => generate(stubChain({ lockboxes }), { lockboxConfigs: [CONFIG_A, CONFIG_B] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'lockboxConfigs[1].lockbox' &&
          err.context.operation === 'configureSiloedLockboxes' &&
          err.message.includes(LOCKBOX_B) &&
          /typeAndVersion\(\)/.test(err.message),
      )
    })

    it('rejects a lockbox escrowing a different token', async () => {
      const lockboxes = {
        [LOCKBOX_A]: { typeAndVersion: 'ERC20LockBox 2.0.0', token: TOKEN },
        [LOCKBOX_B]: { typeAndVersion: 'ERC20LockBox 2.0.0', token: OTHER_TOKEN },
      }
      await assert.rejects(
        () => generate(stubChain({ lockboxes }), { lockboxConfigs: [CONFIG_A, CONFIG_B] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'lockboxConfigs[1].lockbox' &&
          err.message.includes(OTHER_TOKEN) &&
          err.message.includes(TOKEN) &&
          /InvalidToken/.test(err.message),
      )
    })

    it('rejects a lane already bound to the same lockbox, a no-op', async () => {
      await assert.rejects(
        () =>
          generate(stubChain({ configured: [CONFIG_A] }), { lockboxConfigs: [CONFIG_B, CONFIG_A] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'lockboxConfigs[1]' &&
          /no-op/.test(err.message),
      )
    })

    it('rejects a sender that is not the owner', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: LOCKBOX_B }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          err.message.includes(OWNER),
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, lockboxConfigs: [CONFIG_A] }

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
          err.context.operation === 'configureSiloedLockboxes',
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
        () => op.execute(stubChain(), { ...params, sender: LOCKBOX_B, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a wallet that is not the owner', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(LOCKBOX_B) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          err.message.includes(OWNER),
      )
    })
  })
})
