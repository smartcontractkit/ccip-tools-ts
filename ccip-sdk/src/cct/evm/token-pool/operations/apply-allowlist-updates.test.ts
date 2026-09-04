import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import {
  type ApplyAllowlistUpdatesParams,
  ApplyAllowlistUpdates,
} from './apply-allowlist-updates.ts'

const POOL = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

// Distinct fixtures per array: a swapped (removes, adds) pair must fail byte parity.
const ADDS = ['0x' + 'a1'.repeat(20), '0x' + 'a2'.repeat(20)]
const REMOVES = ['0x' + 'e1'.repeat(20)]

/** Independent of the SDK's cached interfaces — the reference the encoding is measured against. */
const REFERENCE = new Interface([
  'function applyAllowListUpdates(address[] removes, address[] adds)',
])
const DATA = REFERENCE.encodeFunctionData('applyAllowListUpdates', [REMOVES, ADDS])

/** Pool types reporting each ABI family, for the `typeAndVersion` the stub answers with. */
const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

const LEGACY_VERSIONS = [
  TokenPoolVersion.V1_5_0,
  TokenPoolVersion.V1_5_1,
  TokenPoolVersion.V1_6_1,
] as const

/**
 * EVMChain stub: reports `type version` from `typeAndVersion`, and answers the pool's `owner()`,
 * `getAllowListEnabled()` and `getAllowList()` `eth_call`s. Any other call reverts. `onCall`
 * records that RPC happened at all, so the validation tests can assert nothing was issued.
 *
 * `allowlist` defaults to {@link REMOVES}, the set the default params remove from — leaving
 * {@link ADDS} absent, so the default case is a real state change on both sides.
 */
function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V1_5_1,
  owner = OWNER,
  allowlistEnabled = true,
  allowlist = REMOVES,
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  owner?: string
  allowlistEnabled?: boolean
  allowlist?: string[]
  onCall?: () => void
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[family][version]
  const ownerSelector = iface.getFunction('owner')!.selector
  // v2.0.0 dropped the allowlist getters, so only look them up where they exist
  const allowlistEnabledSelector = iface.getFunction('getAllowListEnabled')?.selector
  const allowlistSelector = iface.getFunction('getAllowList')?.selector
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        onCall?.()
        const selector = data.slice(0, 10)
        if (selector === ownerSelector)
          return Promise.resolve(iface.encodeFunctionResult('owner', [owner]))
        if (selector === allowlistEnabledSelector)
          return Promise.resolve(
            iface.encodeFunctionResult('getAllowListEnabled', [allowlistEnabled]),
          )
        if (selector === allowlistSelector)
          return Promise.resolve(iface.encodeFunctionResult('getAllowList', [allowlist]))
        throw makeError('execution reverted', 'CALL_EXCEPTION', {
          action: 'call',
          data: '0x',
          reason: null,
          transaction: { to: null, data },
          invocation: null,
          revert: null,
        })
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      onCall?.()
      return Promise.resolve(parseTypeAndVersion(`${POOL_TYPE[family]} ${version}`))
    },
    nextNonce: async () => 0,
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

const op = new ApplyAllowlistUpdates()

function generate(chain: EVMChain, overrides: Partial<ApplyAllowlistUpdatesParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    removes: REMOVES,
    adds: ADDS,
    sender: OWNER,
    ...overrides,
  })
}

describe('ApplyAllowlistUpdates (cct/evm)', () => {
  describe('generate', () => {
    for (const version of LEGACY_VERSIONS) {
      for (const family of ['BurnMint', 'LockRelease'] as const) {
        it(`encodes applyAllowListUpdates(removes, adds) for a ${family} ${version} pool`, async () => {
          const unsigned = await generate(stubChain({ family, version }))
          const tx = unsigned.transactions[0]!

          assert.equal(unsigned.family, ChainFamily.EVM)
          assert.equal(unsigned.transactions.length, 1)
          assert.equal(tx.to, POOL)
          assert.equal(tx.from, OWNER)
          assert.equal(tx.data, DATA)
        })
      }

      it(`produces identical calldata for both ABI families at ${version}`, async () => {
        const [burnMint, lockRelease] = await Promise.all([
          generate(stubChain({ family: 'BurnMint', version })),
          generate(stubChain({ family: 'LockRelease', version })),
        ])
        assert.equal(burnMint.transactions[0]!.data, lockRelease.transactions[0]!.data)
      })
    }

    it('omits from, and skips the owner read, when sender is not supplied', async () => {
      let calls = 0
      const unsigned = await generate(stubChain({ onCall: () => calls++ }), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(unsigned.transactions[0]!.data, DATA)
      // typeAndVersion + the two allowlist reads — no owner() read without a sender to compare
      // it against; the allowlist pre-flight does not depend on the signer and still runs
      assert.equal(calls, 3)
    })

    it('encodes an empty removes array (adds only)', async () => {
      const unsigned = await generate(stubChain(), { removes: [] })
      assert.equal(
        unsigned.transactions[0]!.data,
        REFERENCE.encodeFunctionData('applyAllowListUpdates', [[], ADDS]),
      )
    })

    it('encodes an empty adds array (removes only)', async () => {
      const unsigned = await generate(stubChain(), { adds: [] })
      assert.equal(
        unsigned.transactions[0]!.data,
        REFERENCE.encodeFunctionData('applyAllowListUpdates', [REMOVES, []]),
      )
    })

    it('rejects a sender that is not the pool owner', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: '0x' + '99'.repeat(20) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'applyAllowlistUpdates' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('validation', () => {
    const cases: { name: string; param: string; params: Partial<ApplyAllowlistUpdatesParams> }[] = [
      { name: 'an invalid poolAddress', param: 'poolAddress', params: { poolAddress: 'nope' } },
      // a tx to `0x0` hits no code, so it would mine as a successful no-op rather than reverting
      { name: 'the zero poolAddress', param: 'poolAddress', params: { poolAddress: ZeroAddress } },
      // `.map` skips holes, so without the density guard a sparse array validated clean and the
      // hole reached ethers as `undefined`
      {
        name: 'a hole in adds',
        param: 'adds[1]',
        params: {
          adds: (() => {
            const sparse = [ADDS[0]!]
            sparse[2] = ADDS[1] ?? ZeroAddress
            return sparse
          })(),
        },
      },
      {
        name: 'a hole in removes',
        param: 'removes[1]',
        params: {
          removes: (() => {
            const sparse = [REMOVES[0]!]
            sparse[2] = REMOVES[0]!
            return sparse
          })(),
        },
      },
      {
        name: 'an invalid address inside adds',
        param: 'adds[1]',
        params: { adds: [ADDS[0]!, 'not-an-address'] },
      },
      {
        name: 'an invalid address inside removes',
        param: 'removes[0]',
        params: { removes: ['not-an-address'] },
      },
      {
        name: 'a missing removes',
        param: 'removes',
        params: { removes: undefined },
      },
      { name: 'a non-array adds', param: 'adds', params: { adds: 42 as unknown as string[] } },
      { name: 'both arrays empty', param: 'adds', params: { removes: [], adds: [] } },
      {
        name: 'duplicates within adds',
        param: 'adds',
        params: { adds: [ADDS[0]!, ADDS[0]!] },
      },
      {
        name: 'duplicates within removes, differing only in case',
        param: 'removes',
        params: { removes: [REMOVES[0]!, getAddress(REMOVES[0]!)] },
      },
      {
        name: 'an address present in both adds and removes',
        param: 'adds',
        params: { adds: [ADDS[0]!], removes: [ADDS[0]!] },
      },
      { name: 'an invalid sender', param: 'sender', params: { sender: 'not-an-address' } },
      // the pool `continue`s past a zero address in adds, and can therefore never hold one:
      // a silent no-op on either side, so it is rejected locally rather than encoded
      {
        name: 'the zero address inside adds',
        param: 'adds[0]',
        params: { adds: [ZeroAddress] },
      },
      {
        name: 'the zero address inside removes',
        param: 'removes[0]',
        params: { removes: [ZeroAddress] },
      },
    ]

    for (const { name, param, params } of cases) {
      it(`rejects ${name} before any RPC`, async () => {
        let calls = 0
        await assert.rejects(
          () => generate(stubChain({ onCall: () => calls++ }), params),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'applyAllowlistUpdates' &&
            err.context.param === param,
        )
        assert.equal(calls, 0)
      })
    }
  })

  describe('allowlist pre-flight', () => {
    it('rejects a pool deployed without an allowlist', async () => {
      await assert.rejects(
        () => generate(stubChain({ allowlistEnabled: false, allowlist: [] })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'applyAllowlistUpdates' &&
          err.context.param === 'poolAddress',
      )
    })

    it('rejects removing an address that is not currently allowlisted', async () => {
      // the pool's EnumerableSet.remove would return false and the tx would change nothing
      await assert.rejects(
        () => generate(stubChain({ allowlist: [ADDS[0]!] }), { adds: [] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'applyAllowlistUpdates' &&
          err.context.param === 'removes',
      )
    })

    it('rejects adding an address that is already allowlisted', async () => {
      await assert.rejects(
        () => generate(stubChain({ allowlist: [...REMOVES, ADDS[1]!] })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'applyAllowlistUpdates' &&
          err.context.param === 'adds',
      )
    })

    it('matches the on-chain allowlist case-insensitively', async () => {
      const unsigned = await generate(
        stubChain({ allowlist: REMOVES.map((address) => address.toLowerCase()) }),
      )
      assert.equal(unsigned.transactions[0]!.data, DATA)
    })

    it('accepts an empty allowlist when the feature is enabled (adds only)', async () => {
      const unsigned = await generate(stubChain({ allowlist: [] }), { removes: [] })
      assert.equal(
        unsigned.transactions[0]!.data,
        REFERENCE.encodeFunctionData('applyAllowListUpdates', [[], ADDS]),
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, removes: REMOVES, adds: ADDS }

    it('signs and submits, resolving to the tx hash', async () => {
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
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'applyAllowlistUpdates',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: {} }),
        CCIPWalletInvalidError,
      )
    })

    it('rejects a sender that diverges from the signing wallet', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            sender: '0x' + '99'.repeat(20),
            wallet: fakeSigner(),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a signing wallet that is not the pool owner', async () => {
      const notOwner = '0x' + '99'.repeat(20)
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(undefined, notOwner) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'applyAllowlistUpdates' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('version dispatch', () => {
    for (const version of LEGACY_VERSIONS) {
      it(`supports ${version}`, async () => {
        const unsigned = await generate(stubChain({ version }))
        assert.equal(unsigned.transactions[0]!.data, DATA)
      })
    }

    it('rejects 2.0.0, where the allowlist was removed from the contract', async () => {
      await assert.rejects(
        () => generate(stubChain({ version: TokenPoolVersion.V2_0_0 })),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'applyAllowlistUpdates' &&
          err.context.version === TokenPoolVersion.V2_0_0,
      )
    })

    it('covers every known TokenPoolVersion', () => {
      assert.deepEqual(Object.values(TokenPoolVersion), [
        ...LEGACY_VERSIONS,
        TokenPoolVersion.V2_0_0,
      ])
    })
  })
})
