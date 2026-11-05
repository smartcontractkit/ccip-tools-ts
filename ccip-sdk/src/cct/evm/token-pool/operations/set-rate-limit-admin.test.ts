import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import {
  type TokenPoolFamily,
  type TokenPoolType,
  TokenPoolVersion,
  getTokenPoolInterface,
} from '../contracts.ts'
import { type SetRateLimitAdminParams, SetRateLimitAdmin } from './set-rate-limit-admin.ts'

const POOL = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const CURRENT_ADMIN = '0x' + '33'.repeat(20)
const NEW_ADMIN = '0x' + '44'.repeat(20)
const ROUTER = '0x' + '55'.repeat(20)
const FEE_ADMIN = '0x' + '66'.repeat(20)
const NOT_THE_OWNER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived interfaces.
 */
const IFACE = new Interface(['function setRateLimitAdmin(address rateLimitAdmin)'])
const dataFor = (admin: string) => IFACE.encodeFunctionData('setRateLimitAdmin', [admin])
const IFACE_V2_0_0 = new Interface([
  'function setDynamicConfig(address router, address rateLimitAdmin, address feeAdmin)',
])
const dataForV2_0_0 = (router: string, rateLimitAdmin: string, feeAdmin: string) =>
  IFACE_V2_0_0.encodeFunctionData('setDynamicConfig', [router, rateLimitAdmin, feeAdmin])

/** Pool type reported by `typeAndVersion` for each ABI family. */
const POOL_TYPE: Record<TokenPoolFamily, TokenPoolType> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
  SiloedLockRelease: 'SiloedLockReleaseTokenPool',
}

/**
 * EVMChain stub: `typeAndVersion` reports the requested family/version, and `provider.call`
 * answers `owner()` and, on a 2.0.0 pool, `getDynamicConfig()` off the pool's own Interface.
 * Every other selector reverts, which is what pins "no other RPC".
 */
function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V1_5_0,
  owner = OWNER,
  dynamicConfig = [ROUTER, CURRENT_ADMIN, FEE_ADMIN],
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  owner?: string
  dynamicConfig?: [router: string, rateLimitAdmin: string, feeAdmin: string]
  onCall?: (selector?: string) => void
} = {}): EVMChain {
  const iface = getTokenPoolInterface(POOL_TYPE[family], version)
  const results: Record<string, unknown[]> = { owner: [owner] }
  if (iface.hasFunction('getDynamicConfig')) results.getDynamicConfig = dynamicConfig
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        onCall?.(data.slice(0, 10))
        const fn = Object.keys(results).find(
          (name) => iface.getFunction(name)!.selector === data.slice(0, 10),
        )
        if (!fn)
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: null, data },
            invocation: null,
            revert: null,
          })
        return iface.encodeFunctionResult(fn, results[fn]!)
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    typeAndVersion: () => {
      onCall?.()
      return Promise.resolve(parseTypeAndVersion(`${POOL_TYPE[family]} ${version}`))
    },
    nextNonce: async () => 0,
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

const op = new SetRateLimitAdmin()

function generate(chain: EVMChain, overrides: Partial<SetRateLimitAdminParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    newRateLimitAdmin: NEW_ADMIN,
    sender: OWNER,
    ...overrides,
  })
}

/** Versions that still declare `setRateLimitAdmin`; 2.0.0 folded it into `setDynamicConfig`. */
const SUPPORTED = [
  TokenPoolVersion.V1_5_0,
  TokenPoolVersion.V1_5_1,
  TokenPoolVersion.V1_6_1,
] as const

describe('SetRateLimitAdmin (cct/evm)', () => {
  describe('generate', () => {
    for (const version of SUPPORTED) {
      for (const family of ['BurnMint', 'LockRelease'] as const) {
        it(`encodes setRateLimitAdmin(admin) for a ${family} ${version} pool`, async () => {
          const unsigned = await generate(stubChain({ family, version }))
          const tx = unsigned.transactions[0]!

          assert.equal(unsigned.family, ChainFamily.EVM)
          assert.equal(unsigned.transactions.length, 1)
          assert.equal(tx.to, POOL)
          assert.equal(tx.from, OWNER)
          assert.equal(tx.data, dataFor(NEW_ADMIN))
        })
      }

      it(`emits identical calldata for both ABI families at ${version}`, async () => {
        const [burnMint, lockRelease] = await Promise.all([
          generate(stubChain({ family: 'BurnMint', version })),
          generate(stubChain({ family: 'LockRelease', version })),
        ])
        assert.equal(burnMint.transactions[0]!.data, lockRelease.transactions[0]!.data)
      })
    }

    it('allows the zero address to clear the rate-limit admin role', async () => {
      const unsigned = await generate(stubChain(), { newRateLimitAdmin: ZeroAddress })
      assert.equal(unsigned.transactions[0]!.data, dataFor(ZeroAddress))
    })

    it('omits from — and skips the owner read — when sender is not supplied', async () => {
      let calls = 0
      const unsigned = await generate(stubChain({ onCall: () => (calls += 1) }), {
        sender: undefined,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      // typeAndVersion only; no owner() round trip
      assert.equal(calls, 1)
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['poolAddress', 'not-an-address'],
      ['poolAddress', ZeroAddress],
      ['newRateLimitAdmin', 'not-an-address'],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${value} before any RPC`, async () => {
        let called = false
        await assert.rejects(
          () => generate(stubChain({ onCall: () => (called = true) }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'setRateLimitAdmin' &&
            err.context.param === param,
        )
        assert.equal(called, false)
      })
    }
  })

  describe('version dispatch', () => {
    for (const version of SUPPORTED) {
      it(`supports ${version}`, async () => {
        const unsigned = await generate(stubChain({ version }))
        assert.equal(unsigned.transactions[0]!.data, dataFor(NEW_ADMIN))
      })
    }

    it('never reads getDynamicConfig on a v1.x pool, which has no dynamic config', async () => {
      const selectors: (string | undefined)[] = []
      await generate(stubChain({ onCall: (selector) => selectors.push(selector) }))
      // typeAndVersion, then owner()
      assert.deepEqual(selectors, [
        undefined,
        getTokenPoolInterface('BurnMintTokenPool', TokenPoolVersion.V1_5_0).getFunction('owner')!
          .selector,
      ])
    })
  })

  describe('v2.0.0', () => {
    const V2 = TokenPoolVersion.V2_0_0
    const ifaceV2 = getTokenPoolInterface('BurnMintTokenPool', V2)

    for (const family of ['BurnMint', 'LockRelease', 'SiloedLockRelease'] as const) {
      // Distinct router, current admin and fee admin: writing back the current admin, or swapping
      // router and feeAdmin, must fail byte parity.
      it(`encodes setDynamicConfig(router, newRateLimitAdmin, feeAdmin) for a ${family} pool, keeping router and feeAdmin as read`, async () => {
        const unsigned = await generate(stubChain({ family, version: V2 }))
        const tx = unsigned.transactions[0]!

        assert.equal(unsigned.transactions.length, 1)
        assert.equal(tx.to, POOL)
        assert.equal(tx.from, OWNER)
        assert.equal(tx.data, dataForV2_0_0(ROUTER, NEW_ADMIN, FEE_ADMIN))
      })
    }

    it('allows the zero address to clear the role without clearing feeAdmin', async () => {
      const unsigned = await generate(stubChain({ version: V2 }), {
        newRateLimitAdmin: ZeroAddress,
      })
      assert.equal(unsigned.transactions[0]!.data, dataForV2_0_0(ROUTER, ZeroAddress, FEE_ADMIN))
    })

    it('keeps an unset feeAdmin unset rather than rejecting it', async () => {
      const unsigned = await generate(
        stubChain({ version: V2, dynamicConfig: [ROUTER, CURRENT_ADMIN, ZeroAddress] }),
      )
      assert.equal(unsigned.transactions[0]!.data, dataForV2_0_0(ROUTER, NEW_ADMIN, ZeroAddress))
    })

    it('reads getDynamicConfig and checks owner() when sender is supplied', async () => {
      const selectors: (string | undefined)[] = []
      await generate(stubChain({ version: V2, onCall: (selector) => selectors.push(selector) }))
      // typeAndVersion first; the two reads after it run in parallel, so their order is not pinned
      assert.equal(selectors.length, 3)
      assert.equal(selectors[0], undefined)
      assert.deepEqual(
        new Set(selectors.slice(1)),
        new Set([
          ifaceV2.getFunction('getDynamicConfig')!.selector,
          ifaceV2.getFunction('owner')!.selector,
        ]),
      )
    })

    it('reads getDynamicConfig but skips the owner read when sender is not supplied', async () => {
      const selectors: (string | undefined)[] = []
      const unsigned = await generate(
        stubChain({ version: V2, onCall: (selector) => selectors.push(selector) }),
        { sender: undefined },
      )
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.deepEqual(selectors, [undefined, ifaceV2.getFunction('getDynamicConfig')!.selector])
    })

    it('rejects a sender that is not the pool owner', async () => {
      await assert.rejects(
        () => generate(stubChain({ version: V2, owner: NOT_THE_OWNER })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setRateLimitAdmin' &&
          err.context.param === 'sender',
      )
    })

    it('rejects invalid params before the getDynamicConfig read', async () => {
      let called = false
      await assert.rejects(
        () =>
          generate(stubChain({ version: V2, onCall: () => (called = true) }), {
            newRateLimitAdmin: 'not-an-address',
          }),
        CCTParamsInvalidError,
      )
      assert.equal(called, false)
    })

    it('signs and submits as the owner, resolving to the tx hash', async () => {
      assert.deepEqual(
        await op.execute(stubChain({ version: V2 }), {
          poolAddress: POOL,
          newRateLimitAdmin: NEW_ADMIN,
          wallet: fakeSigner(),
        }),
        { hash: HASH },
      )
    })
  })

  describe('pre-transaction validation', () => {
    it('rejects a sender that is not the pool owner', async () => {
      await assert.rejects(
        () => generate(stubChain({ owner: NOT_THE_OWNER })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setRateLimitAdmin' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, newRateLimitAdmin: NEW_ADMIN }

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
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'setRateLimitAdmin',
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
        () => op.execute(stubChain(), { ...params, sender: NEW_ADMIN, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a wallet that is not the pool owner', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(NEW_ADMIN) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setRateLimitAdmin' &&
          err.context.param === 'sender' &&
          // names the owner it read, so the caller can see which address it needed
          err.message.includes(OWNER),
      )
    })
  })
})
