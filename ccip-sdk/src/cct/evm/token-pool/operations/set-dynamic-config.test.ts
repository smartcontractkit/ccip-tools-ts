import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { type SetDynamicConfigParams, SetDynamicConfig } from './set-dynamic-config.ts'
import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'

const POOL = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const RATE_LIMIT_ADMIN = '0x' + '33'.repeat(20)
const FEE_ADMIN = '0x' + '44'.repeat(20)
const ROUTER = '0x' + '55'.repeat(20)
const NOT_THE_OWNER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived interfaces.
 */
const IFACE = new Interface([
  'function setDynamicConfig(address router, address rateLimitAdmin, address feeAdmin)',
])
const dataFor = (router: string, rateLimitAdmin: string, feeAdmin: string) =>
  IFACE.encodeFunctionData('setDynamicConfig', [router, rateLimitAdmin, feeAdmin])

const DATA = dataFor(ROUTER, RATE_LIMIT_ADMIN, FEE_ADMIN)

/** Pool type reported by `typeAndVersion` for each ABI family. */
const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

/**
 * EVMChain stub: `typeAndVersion` reports the requested family/version, and `provider.call`
 * answers `owner()` — the only read this op makes. Any other selector reverts, which is what
 * pins "no hidden `getDynamicConfig()` read".
 */
function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V2_0_0,
  owner = OWNER,
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  owner?: string
  onCall?: (selector?: string) => void
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[family][version]
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        onCall?.(data.slice(0, 10))
        if (data.slice(0, 10) !== iface.getFunction('owner')!.selector)
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: null, data },
            invocation: null,
            revert: null,
          })
        return iface.encodeFunctionResult('owner', [owner])
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

const op = new SetDynamicConfig()

function generate(chain: EVMChain, overrides: Partial<SetDynamicConfigParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    router: ROUTER,
    rateLimitAdmin: RATE_LIMIT_ADMIN,
    feeAdmin: FEE_ADMIN,
    sender: OWNER,
    ...overrides,
  })
}

/** Versions with no `setDynamicConfig` — the struct write landed in 2.0.0. */
const UNSUPPORTED = [
  TokenPoolVersion.V1_5_0,
  TokenPoolVersion.V1_5_1,
  TokenPoolVersion.V1_6_1,
] as const

describe('SetDynamicConfig (cct/evm)', () => {
  describe('generate', () => {
    for (const family of ['BurnMint', 'LockRelease'] as const) {
      it(`encodes setDynamicConfig(router, rateLimitAdmin, feeAdmin) for a ${family} 2.0.0 pool`, async () => {
        const unsigned = await generate(stubChain({ family }))
        const tx = unsigned.transactions[0]!

        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(unsigned.transactions.length, 1)
        assert.equal(tx.to, POOL)
        assert.equal(tx.from, OWNER)
        assert.equal(tx.data, DATA)
      })
    }

    it('emits identical calldata for both ABI families', async () => {
      const [burnMint, lockRelease] = await Promise.all([
        generate(stubChain({ family: 'BurnMint' })),
        generate(stubChain({ family: 'LockRelease' })),
      ])
      assert.equal(burnMint.transactions[0]!.data, lockRelease.transactions[0]!.data)
    })

    it('allows the zero address to clear either delegate role', async () => {
      const unsigned = await generate(stubChain(), {
        rateLimitAdmin: ZeroAddress,
        feeAdmin: ZeroAddress,
      })
      assert.equal(unsigned.transactions[0]!.data, dataFor(ROUTER, ZeroAddress, ZeroAddress))
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

    // the TOCTOU guard: all three fields come from the caller, so nothing is read back and
    // baked into the calldata between build time and (possibly much later) signing.
    it('never reads getDynamicConfig — the only call made is owner()', async () => {
      const iface = TOKEN_POOL_INTERFACES.BurnMint[TokenPoolVersion.V2_0_0]
      const selectors: (string | undefined)[] = []
      await generate(stubChain({ onCall: (selector) => selectors.push(selector) }))
      assert.deepEqual(selectors, [undefined, iface.getFunction('owner')!.selector])
      assert.ok(!selectors.includes(iface.getFunction('getDynamicConfig')!.selector))
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['poolAddress', 'not-an-address'],
      ['poolAddress', ZeroAddress],
      ['router', 'not-an-address'],
      ['router', ZeroAddress],
      ['rateLimitAdmin', 'not-an-address'],
      ['feeAdmin', 'not-an-address'],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${value} before any RPC`, async () => {
        let called = false
        await assert.rejects(
          () => generate(stubChain({ onCall: () => (called = true) }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'setDynamicConfig' &&
            err.context.param === param,
        )
        assert.equal(called, false)
      })
    }
  })

  describe('version dispatch', () => {
    it('supports 2.0.0', async () => {
      const unsigned = await generate(stubChain({ version: TokenPoolVersion.V2_0_0 }))
      assert.equal(unsigned.transactions[0]!.data, DATA)
    })

    // no `null` ceiling is registered below 2.0.0: floor-match walks downwards and finds
    // nothing at or below these versions, so they are unsupported for free.
    for (const version of UNSUPPORTED) {
      it(`rejects ${version} — setDynamicConfig landed in 2.0.0`, async () => {
        await assert.rejects(
          () => generate(stubChain({ version })),
          (err: unknown) =>
            err instanceof CCTOperationUnsupportedError &&
            err.context.operation === 'setDynamicConfig' &&
            err.context.version === version,
        )
      })
    }

    it('reports a pre-2.0.0 LockRelease pool unsupported too', async () => {
      await assert.rejects(
        () => generate(stubChain({ family: 'LockRelease', version: TokenPoolVersion.V1_6_1 })),
        CCTOperationUnsupportedError,
      )
    })
  })

  describe('pre-transaction validation', () => {
    it('rejects a sender that is not the pool owner', async () => {
      await assert.rejects(
        () => generate(stubChain({ owner: NOT_THE_OWNER })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setDynamicConfig' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    const params = {
      poolAddress: POOL,
      router: ROUTER,
      rateLimitAdmin: RATE_LIMIT_ADMIN,
      feeAdmin: FEE_ADMIN,
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
            wallet: fakeSigner(OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'setDynamicConfig',
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
        () => op.execute(stubChain(), { ...params, sender: FEE_ADMIN, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a wallet that is not the pool owner', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(FEE_ADMIN) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setDynamicConfig' &&
          err.context.param === 'sender' &&
          // names the owner it read, so the caller can see which address it needed
          err.message.includes(OWNER),
      )
    })
  })
})
