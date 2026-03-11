import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { type Connection, Keypair, PublicKey } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import {
  CCIPCreatePoolTokenAccountParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Mocks ──

const MOCK_POOL_PROGRAM_ID = Keypair.generate().publicKey

function mockConnection(
  opts: {
    tokenProgramId?: PublicKey
    poolProgramId?: PublicKey
    mintExists?: boolean
    poolExists?: boolean
  } = {},
) {
  const {
    tokenProgramId = TOKEN_PROGRAM_ID,
    poolProgramId = MOCK_POOL_PROGRAM_ID,
    mintExists = true,
    poolExists = true,
  } = opts

  return {
    getSignaturesForAddress: async () => [],
    getAccountInfo: async (pubkey: PublicKey) => {
      const key = pubkey.toBase58()
      if (key === poolAddress && poolExists) {
        return {
          owner: poolProgramId,
          data: Buffer.alloc(300),
          executable: false,
          lamports: 1_000_000,
        }
      }
      if (key === tokenAddress && mintExists) {
        return {
          owner: tokenProgramId,
          data: Buffer.alloc(82),
          executable: false,
          lamports: 1_000_000,
        }
      }
      return null
    },
  } as unknown as Connection
}

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

const dummyNetwork: NetworkInfo = {
  name: 'solana-devnet',
  family: ChainFamily.Solana,
  chainSelector: 1n,
  chainId: 'solana-devnet',
  networkType: NetworkType.Testnet,
}

// ── Helpers ──

function makeAdmin(connection?: Connection): SolanaTokenAdmin {
  return new SolanaTokenAdmin(connection ?? mockConnection(), dummyNetwork, {
    logger: silentLogger,
    apiClient: null,
  })
}

const sender = Keypair.generate().publicKey.toBase58()
const tokenAddress = Keypair.generate().publicKey.toBase58()
const poolAddress = Keypair.generate().publicKey.toBase58()

const validParams = {
  tokenAddress,
  poolAddress,
}

// =============================================================================
// SolanaTokenAdmin — createPoolTokenAccount
// =============================================================================

describe('SolanaTokenAdmin — createPoolTokenAccount', () => {
  // ===========================================================================
  // Validation
  // ===========================================================================

  describe('generateUnsignedCreatePoolTokenAccount — Validation', () => {
    const admin = makeAdmin()

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreatePoolTokenAccount(sender, {
            ...validParams,
            tokenAddress: '',
          }),
        CCIPCreatePoolTokenAccountParamsInvalidError,
      )
    })

    it('should reject invalid tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreatePoolTokenAccount(sender, {
            ...validParams,
            tokenAddress: 'not-a-pubkey',
          }),
        CCIPCreatePoolTokenAccountParamsInvalidError,
      )
    })

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreatePoolTokenAccount(sender, {
            ...validParams,
            poolAddress: '',
          }),
        CCIPCreatePoolTokenAccountParamsInvalidError,
      )
    })

    it('should reject invalid poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreatePoolTokenAccount(sender, {
            ...validParams,
            poolAddress: 'not-a-pubkey',
          }),
        CCIPCreatePoolTokenAccountParamsInvalidError,
      )
    })

    it('should reject when pool state not found on-chain', async () => {
      const admin = makeAdmin(mockConnection({ poolExists: false }))
      await assert.rejects(
        () => admin.generateUnsignedCreatePoolTokenAccount(sender, validParams),
        CCIPCreatePoolTokenAccountParamsInvalidError,
      )
    })

    it('should reject when mint not found on-chain', async () => {
      const admin = makeAdmin(mockConnection({ mintExists: false }))
      await assert.rejects(
        () => admin.generateUnsignedCreatePoolTokenAccount(sender, validParams),
        CCIPCreatePoolTokenAccountParamsInvalidError,
      )
    })

    it('should reject when mint owned by unknown program', async () => {
      const admin = makeAdmin(
        mockConnection({ tokenProgramId: new PublicKey('11111111111111111111111111111111') }),
      )
      await assert.rejects(
        () => admin.generateUnsignedCreatePoolTokenAccount(sender, validParams),
        CCIPCreatePoolTokenAccountParamsInvalidError,
      )
    })
  })

  // ===========================================================================
  // Happy Path
  // ===========================================================================

  describe('generateUnsignedCreatePoolTokenAccount — Happy Path', () => {
    it('should return correct family (Solana)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreatePoolTokenAccount(sender, validParams)
      assert.equal(unsigned.family, ChainFamily.Solana)
    })

    it('should return exactly 1 instruction (idempotent ATA creation)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreatePoolTokenAccount(sender, validParams)
      assert.equal(unsigned.instructions.length, 1)
    })

    it('should return mainIndex 0', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreatePoolTokenAccount(sender, validParams)
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should return correct poolTokenAccount address', async () => {
      const admin = makeAdmin()
      const { result } = await admin.generateUnsignedCreatePoolTokenAccount(sender, validParams)

      // Derive expected ATA
      const mint = new PublicKey(tokenAddress)
      const [poolSignerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('ccip_tokenpool_signer'), mint.toBuffer()],
        MOCK_POOL_PROGRAM_ID,
      )
      const expectedAta = getAssociatedTokenAddressSync(mint, poolSignerPda, true, TOKEN_PROGRAM_ID)

      assert.equal(result.poolTokenAccount, expectedAta.toBase58())
    })

    it('should return correct poolSignerPda', async () => {
      const admin = makeAdmin()
      const { result } = await admin.generateUnsignedCreatePoolTokenAccount(sender, validParams)

      const mint = new PublicKey(tokenAddress)
      const [expectedPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('ccip_tokenpool_signer'), mint.toBuffer()],
        MOCK_POOL_PROGRAM_ID,
      )

      assert.equal(result.poolSignerPda, expectedPda.toBase58())
    })

    it('should work with Token-2022 mint', async () => {
      const admin = makeAdmin(mockConnection({ tokenProgramId: TOKEN_2022_PROGRAM_ID }))
      const { unsigned, result } = await admin.generateUnsignedCreatePoolTokenAccount(
        sender,
        validParams,
      )
      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.ok(result.poolTokenAccount)
      assert.ok(result.poolSignerPda)
    })

    it('should set payer as signer in the instruction', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreatePoolTokenAccount(sender, validParams)
      const ix = unsigned.instructions[0]!
      const payerKey = ix.keys.find((k) => k.pubkey.toBase58() === sender && k.isSigner)
      assert.ok(payerKey, 'payer should be a signer in the ATA creation instruction')
    })
  })

  // ===========================================================================
  // Wallet Validation
  // ===========================================================================

  describe('createPoolTokenAccount — Wallet Validation', () => {
    it('should reject non-wallet object', async () => {
      const admin = makeAdmin()
      await assert.rejects(
        () => admin.createPoolTokenAccount({}, validParams),
        CCIPWalletInvalidError,
      )
    })

    it('should reject null wallet', async () => {
      const admin = makeAdmin()
      await assert.rejects(
        () => admin.createPoolTokenAccount(null, validParams),
        CCIPWalletInvalidError,
      )
    })

    it('should reject string wallet', async () => {
      const admin = makeAdmin()
      await assert.rejects(
        () => admin.createPoolTokenAccount('not-a-wallet', validParams),
        CCIPWalletInvalidError,
      )
    })
  })
})
