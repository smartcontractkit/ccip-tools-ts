import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Connection, Keypair, PublicKey } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import {
  CCIPRemoveRemotePoolAddressesParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { RemoveRemotePoolAddressesParams } from '../types.ts'

// ── Constants ──

const CCIP_TOKENPOOL_CONFIG_SEED = 'ccip_tokenpool_config'

// ── Mocks ──

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

const dummyNetwork: NetworkInfo = {
  name: 'solana-devnet',
  family: ChainFamily.Solana,
  chainSelector: 1n,
  chainId: 'solana-devnet',
  networkType: NetworkType.Testnet,
}

const mint = Keypair.generate().publicKey
const poolProgramId = Keypair.generate().publicKey
const remoteChainSelector = 16015286601757825753n

// Derive pool state PDA
const [poolStatePda] = PublicKey.findProgramAddressSync(
  [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
  poolProgramId,
)

const validParams: RemoveRemotePoolAddressesParams = {
  poolAddress: poolStatePda.toBase58(),
  remoteChainSelector,
  remotePoolAddresses: ['0x1234567890abcdef1234567890abcdef12345678'],
}

// ── Test Suite ──

describe('SolanaTokenAdmin — removeRemotePoolAddresses', () => {
  // =============================================================================
  // Validation (via wallet method — validation runs before RPC calls)
  // =============================================================================

  describe('removeRemotePoolAddresses — validation', () => {
    const mockConnection = {
      getSignaturesForAddress: async () => [],
      getAccountInfo: async () => null,
    } as unknown as Connection
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    const mockWallet = {
      publicKey: Keypair.generate().publicKey,
      signTransaction: async (tx: unknown) => tx,
    }

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.removeRemotePoolAddresses(mockWallet, {
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRemoveRemotePoolAddressesParamsInvalidError)
          assert.equal(err.code, 'REMOVE_REMOTE_POOL_ADDRESSES_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.removeRemotePoolAddresses(mockWallet, {
            ...validParams,
            remoteChainSelector: 0n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRemoveRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remoteChainSelector')
          return true
        },
      )
    })

    it('should reject empty remotePoolAddresses array', async () => {
      await assert.rejects(
        () =>
          admin.removeRemotePoolAddresses(mockWallet, {
            ...validParams,
            remotePoolAddresses: [],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRemoveRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remotePoolAddresses')
          return true
        },
      )
    })

    it('should reject empty address in array', async () => {
      await assert.rejects(
        () =>
          admin.removeRemotePoolAddresses(mockWallet, {
            ...validParams,
            remotePoolAddresses: [''],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPRemoveRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remotePoolAddresses[0]')
          return true
        },
      )
    })
  })

  // =============================================================================
  // Wallet Validation
  // =============================================================================

  describe('removeRemotePoolAddresses — wallet validation', () => {
    const mockConnection = {
      getSignaturesForAddress: async () => [],
      getAccountInfo: async () => null,
    } as unknown as Connection
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject non-wallet', async () => {
      await assert.rejects(
        () => admin.removeRemotePoolAddresses({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.removeRemotePoolAddresses(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
