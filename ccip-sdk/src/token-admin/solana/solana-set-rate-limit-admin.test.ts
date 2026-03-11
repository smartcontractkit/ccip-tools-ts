import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Connection, Keypair, PublicKey } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import {
  CCIPSetRateLimitAdminParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { SetRateLimitAdminParams } from '../types.ts'

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

const sender = Keypair.generate().publicKey.toBase58()
const mint = Keypair.generate().publicKey
const poolProgramId = Keypair.generate().publicKey

// Derive pool state PDA
const [poolStatePda] = PublicKey.findProgramAddressSync(
  [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
  poolProgramId,
)

function createMockConnection(): Connection {
  return {
    getSignaturesForAddress: async () => [],
    getAccountInfo: async (pubkey: PublicKey) => {
      if (pubkey.equals(poolStatePda)) {
        return {
          owner: poolProgramId,
          data: Buffer.alloc(0),
          lamports: 0,
          executable: false,
          rentEpoch: 0,
        }
      }
      return null
    },
  } as unknown as Connection
}

const validParams: SetRateLimitAdminParams = {
  poolAddress: poolStatePda.toBase58(),
  rateLimitAdmin: Keypair.generate().publicKey.toBase58(),
}

describe('SolanaTokenAdmin — setRateLimitAdmin', () => {
  // ===========================================================================
  // generateUnsignedSetRateLimitAdmin — Validation
  // ===========================================================================

  describe('generateUnsignedSetRateLimitAdmin — validation', () => {
    const mockConnection = createMockConnection()
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetRateLimitAdmin(sender, {
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetRateLimitAdminParamsInvalidError)
          assert.equal(err.code, 'SET_RATE_LIMIT_ADMIN_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty rateLimitAdmin', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetRateLimitAdmin(sender, {
            ...validParams,
            rateLimitAdmin: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetRateLimitAdminParamsInvalidError)
          assert.equal(err.context.param, 'rateLimitAdmin')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // setRateLimitAdmin — Wallet Validation
  // ===========================================================================

  // ===========================================================================
  // generateUnsignedSetRateLimitAdmin — Happy Path
  // ===========================================================================

  describe('generateUnsignedSetRateLimitAdmin — Happy Path', () => {
    function makeAdmin(): SolanaTokenAdmin {
      const mockConnection = createMockConnection()
      const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
        logger: silentLogger,
        apiClient: null,
      })
      // Override getTokenForTokenPool to bypass BorshCoder decode of on-chain data
      admin.getTokenForTokenPool = async () => mint.toBase58()
      return admin
    }

    it('should return correct family (Solana)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetRateLimitAdmin(sender, validParams)
      assert.equal(unsigned.family, ChainFamily.Solana)
    })

    it('should return 1 instruction with mainIndex 0', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetRateLimitAdmin(sender, validParams)
      assert.equal(unsigned.instructions.length, 1)
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should set programId to the pool program', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetRateLimitAdmin(sender, validParams)
      const ix = unsigned.instructions[0]!
      assert.equal(ix.programId.toBase58(), poolProgramId.toBase58())
    })

    it('should include authority (sender) as a signer', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetRateLimitAdmin(sender, validParams)
      const ix = unsigned.instructions[0]!
      const senderKey = new PublicKey(sender)
      const authorityAccount = ix.keys.find((k) => k.pubkey.equals(senderKey))
      assert.ok(authorityAccount, 'authority account should be present')
      assert.equal(authorityAccount.isSigner, true)
    })

    it('should include the state PDA as an account', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetRateLimitAdmin(sender, validParams)
      const ix = unsigned.instructions[0]!
      const stateAccount = ix.keys.find((k) => k.pubkey.equals(poolStatePda))
      assert.ok(stateAccount, 'state PDA should be present in accounts')
    })

    it('should return poolAddress matching the state PDA', async () => {
      const admin = makeAdmin()
      const { poolAddress } = await admin.generateUnsignedSetRateLimitAdmin(sender, validParams)
      assert.equal(poolAddress, poolStatePda.toBase58())
    })
  })

  // ===========================================================================
  // setRateLimitAdmin — Wallet Validation
  // ===========================================================================

  describe('setRateLimitAdmin — wallet validation', () => {
    const mockConnection = createMockConnection()
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.setRateLimitAdmin({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.setRateLimitAdmin(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
