import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, JsonRpcProvider, ZeroAddress } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import {
  CCIPSetAllowedFinalityConfigFailedError,
  CCIPSetAllowedFinalityConfigParamsInvalidError,
  CCIPSetFeeAdminFailedError,
  CCIPSetFeeAdminParamsInvalidError,
  CCIPSetTokenTransferFeeConfigFailedError,
  CCIPSetTokenTransferFeeConfigParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import TokenPool_2_0_ABI from '../../evm/abi/TokenPool_2_0.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../networks.ts'
import { CCIPVersion } from '../../types.ts'
import type {
  SetAllowedFinalityConfigParams,
  SetFeeAdminParams,
  SetTokenTransferFeeConfigParams,
} from '../types.ts'

// ── Helpers ──

const dummyNetwork: NetworkInfo = {
  name: 'test',
  family: ChainFamily.EVM,
  chainSelector: 1n,
  chainId: 1,
  networkType: NetworkType.Testnet,
}

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

const POOL = '0x1234567890abcdef1234567890abcdef12345678'
const SELECTOR = 14767482510784806043n // avalanche-testnet-fuji
const iface20 = new Interface(TokenPool_2_0_ABI)

function makeAdmin(provider: JsonRpcProvider): EVMTokenAdmin {
  return new EVMTokenAdmin(provider, dummyNetwork, { logger: silentLogger, apiClient: null })
}

/** Creates an admin with mocked typeAndVersion to avoid RPC calls. */
function makeAdminWithVersion(provider: JsonRpcProvider, version: string): EVMTokenAdmin {
  const admin = makeAdmin(provider)
  admin.typeAndVersion = async () => ['TokenPool', version, `TokenPool ${version}`]
  return admin
}

// =============================================================================
// setTokenTransferFeeConfig
// =============================================================================

const validFeeParams: SetTokenTransferFeeConfigParams = {
  poolAddress: POOL,
  updates: [
    {
      remoteChainSelector: SELECTOR,
      config: {
        destGasOverhead: 90000,
        destBytesOverhead: 32,
        finalityFeeUSDCents: 10,
        fastFinalityFeeUSDCents: 50,
        finalityTransferFeeBps: 5,
        fastFinalityTransferFeeBps: 25,
        isEnabled: true,
      },
    },
  ],
  disable: [],
}

describe('EVMTokenAdmin — setTokenTransferFeeConfig', () => {
  describe('validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V2_0)

    it.after(() => provider.destroy())

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetTokenTransferFeeConfig({ ...validFeeParams, poolAddress: '' }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetTokenTransferFeeConfigParamsInvalidError)
          assert.equal(err.code, 'SET_TOKEN_TRANSFER_FEE_CONFIG_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty updates and empty disable', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetTokenTransferFeeConfig({
            poolAddress: POOL,
            updates: [],
            disable: [],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetTokenTransferFeeConfigParamsInvalidError)
          assert.equal(err.context.param, 'updates')
          return true
        },
      )
    })

    it('should reject zero remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetTokenTransferFeeConfig({
            ...validFeeParams,
            updates: [{ ...validFeeParams.updates[0]!, remoteChainSelector: 0n }],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetTokenTransferFeeConfigParamsInvalidError)
          assert.equal(err.context.param, 'updates[0].remoteChainSelector')
          return true
        },
      )
    })

    it('should reject out-of-range uint16 bps field', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetTokenTransferFeeConfig({
            ...validFeeParams,
            updates: [
              {
                ...validFeeParams.updates[0]!,
                config: { ...validFeeParams.updates[0]!.config, finalityTransferFeeBps: 70000 },
              },
            ],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetTokenTransferFeeConfigParamsInvalidError)
          assert.equal(err.context.param, 'updates[0].config.finalityTransferFeeBps')
          return true
        },
      )
    })
  })

  describe('happy path (v2.0)', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V2_0)

    it.after(() => provider.destroy())

    it('should encode applyTokenTransferFeeConfigUpdates with decoded args', async () => {
      const unsigned = await admin.generateUnsignedSetTokenTransferFeeConfig(validFeeParams)

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, POOL)

      const selector = iface20.getFunction('applyTokenTransferFeeConfigUpdates')!.selector
      assert.ok((tx.data as string).startsWith(selector))

      const [args, disable] = iface20.decodeFunctionData(
        'applyTokenTransferFeeConfigUpdates',
        tx.data as string,
      )
      assert.equal(args.length, 1)
      assert.equal(disable.length, 0)
      assert.equal(args[0].destChainSelector, SELECTOR)
      const cfg = args[0].tokenTransferFeeConfig
      assert.equal(cfg.destGasOverhead, 90000n)
      assert.equal(cfg.destBytesOverhead, 32n)
      assert.equal(cfg.finalityFeeUSDCents, 10n)
      assert.equal(cfg.fastFinalityFeeUSDCents, 50n)
      assert.equal(cfg.finalityTransferFeeBps, 5n)
      assert.equal(cfg.fastFinalityTransferFeeBps, 25n)
      assert.equal(cfg.isEnabled, true)
    })

    it('should encode disable-only updates into the second array arg', async () => {
      const unsigned = await admin.generateUnsignedSetTokenTransferFeeConfig({
        poolAddress: POOL,
        updates: [],
        disable: [SELECTOR],
      })

      assert.equal(unsigned.transactions.length, 1)
      const [args, disable] = iface20.decodeFunctionData(
        'applyTokenTransferFeeConfigUpdates',
        unsigned.transactions[0]!.data as string,
      )
      assert.equal(args.length, 0)
      assert.equal(disable.length, 1)
      assert.equal(disable[0], SELECTOR)
    })
  })

  describe('version gating', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V1_6)

    it.after(() => provider.destroy())

    it('should throw v2.0-only on a v1.6 pool', async () => {
      await assert.rejects(
        () => admin.generateUnsignedSetTokenTransferFeeConfig(validFeeParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetTokenTransferFeeConfigFailedError)
          assert.match(err.message, /v2\.0\+/)
          return true
        },
      )
    })
  })

  describe('wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject non-signer wallet', async () => {
      await assert.rejects(
        () => admin.setTokenTransferFeeConfig({}, validFeeParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})

// =============================================================================
// setAllowedFinalityConfig
// =============================================================================

describe('EVMTokenAdmin — setAllowedFinalityConfig', () => {
  /** Decodes the bytes4 allowedFinality arg from an unsigned setAllowedFinalityConfig tx. */
  async function encodeFor(
    admin: EVMTokenAdmin,
    finality: SetAllowedFinalityConfigParams['finality'],
  ): Promise<string> {
    const unsigned = await admin.generateUnsignedSetAllowedFinalityConfig({
      poolAddress: POOL,
      finality,
    })
    const tx = unsigned.transactions[0]!
    const selector = iface20.getFunction('setAllowedFinalityConfig')!.selector
    assert.ok((tx.data as string).startsWith(selector))
    const [allowedFinality] = iface20.decodeFunctionData(
      'setAllowedFinalityConfig',
      tx.data as string,
    )
    return allowedFinality as string
  }

  describe('happy path (v2.0) — bytes4 encoding', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V2_0)

    it.after(() => provider.destroy())

    it('should encode "finalized" as 0x00000000', async () => {
      assert.equal(await encodeFor(admin, 'finalized'), '0x00000000')
    })

    it('should encode "safe" with the safe flag set (0x00010000)', async () => {
      assert.equal(await encodeFor(admin, 'safe'), '0x00010000')
    })

    it('should encode a block depth as the depth value (0x00000005)', async () => {
      assert.equal(await encodeFor(admin, 5), '0x00000005')
    })
  })

  describe('validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V2_0)

    it.after(() => provider.destroy())

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetAllowedFinalityConfig({
            poolAddress: '',
            finality: 'finalized',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetAllowedFinalityConfigParamsInvalidError)
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject an out-of-range block depth', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetAllowedFinalityConfig({ poolAddress: POOL, finality: 70000 }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetAllowedFinalityConfigParamsInvalidError)
          assert.equal(err.context.param, 'finality')
          return true
        },
      )
    })
  })

  describe('version gating', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V1_6)

    it.after(() => provider.destroy())

    it('should throw v2.0-only on a v1.6 pool', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetAllowedFinalityConfig({
            poolAddress: POOL,
            finality: 'finalized',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetAllowedFinalityConfigFailedError)
          assert.match(err.message, /v2\.0\+/)
          return true
        },
      )
    })
  })
})

// =============================================================================
// setFeeAdmin
// =============================================================================

const EXISTING_ROUTER = '0x00000000000000000000000000000000000000aa'
const EXISTING_RATE_LIMIT_ADMIN = '0x00000000000000000000000000000000000000bb'
const NEW_FEE_ADMIN = '0x00000000000000000000000000000000000000cc'

/** Mocks provider.call so getDynamicConfig returns [router, rateLimitAdmin, feeAdmin]. */
function mockDynamicConfig(provider: JsonRpcProvider): void {
  provider.call = async () =>
    iface20.encodeFunctionResult('getDynamicConfig', [
      EXISTING_ROUTER,
      EXISTING_RATE_LIMIT_ADMIN,
      ZeroAddress,
    ])
}

describe('EVMTokenAdmin — setFeeAdmin', () => {
  describe('happy path (v2.0)', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V2_0)
    mockDynamicConfig(provider)

    it.after(() => provider.destroy())

    it('should preserve router/rateLimitAdmin and set only feeAdmin', async () => {
      const params: SetFeeAdminParams = { poolAddress: POOL, feeAdmin: NEW_FEE_ADMIN }
      const unsigned = await admin.generateUnsignedSetFeeAdmin(params)

      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, POOL)

      const selector = iface20.getFunction('setDynamicConfig')!.selector
      assert.ok((tx.data as string).startsWith(selector))

      const [router, rateLimitAdmin, feeAdmin] = iface20.decodeFunctionData(
        'setDynamicConfig',
        tx.data as string,
      )
      assert.equal((router as string).toLowerCase(), EXISTING_ROUTER.toLowerCase())
      assert.equal(
        (rateLimitAdmin as string).toLowerCase(),
        EXISTING_RATE_LIMIT_ADMIN.toLowerCase(),
      )
      assert.equal((feeAdmin as string).toLowerCase(), NEW_FEE_ADMIN.toLowerCase())
    })
  })

  describe('validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V2_0)

    it.after(() => provider.destroy())

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () => admin.generateUnsignedSetFeeAdmin({ poolAddress: '', feeAdmin: NEW_FEE_ADMIN }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetFeeAdminParamsInvalidError)
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty feeAdmin', async () => {
      await assert.rejects(
        () => admin.generateUnsignedSetFeeAdmin({ poolAddress: POOL, feeAdmin: '' }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetFeeAdminParamsInvalidError)
          assert.equal(err.context.param, 'feeAdmin')
          return true
        },
      )
    })
  })

  describe('version gating', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdminWithVersion(provider, CCIPVersion.V1_6)

    it.after(() => provider.destroy())

    it('should throw v2.0-only on a v1.6 pool', async () => {
      await assert.rejects(
        () => admin.generateUnsignedSetFeeAdmin({ poolAddress: POOL, feeAdmin: NEW_FEE_ADMIN }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetFeeAdminFailedError)
          assert.match(err.message, /v2\.0\+/)
          return true
        },
      )
    })
  })

  describe('wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject non-signer wallet', async () => {
      await assert.rejects(
        () => admin.setFeeAdmin(null, { poolAddress: POOL, feeAdmin: NEW_FEE_ADMIN }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
