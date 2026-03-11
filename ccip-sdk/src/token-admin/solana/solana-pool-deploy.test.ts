import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { type Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import { CCIPPoolDeployParamsInvalidError, CCIPWalletInvalidError } from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Mocks ──

const mockConnection = {
  getSignaturesForAddress: async () => [],
  getAccountInfo: async (pubkey: PublicKey) => {
    const key = pubkey.toBase58()
    // Return mint info for the token address (owned by SPL Token program)
    if (key === tokenAddress) {
      return {
        owner: TOKEN_PROGRAM_ID,
        data: Buffer.alloc(82),
        executable: false,
        lamports: 1_000_000,
      }
    }
    return null
  },
} as unknown as Connection

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

const dummyNetwork: NetworkInfo = {
  name: 'solana-devnet',
  family: ChainFamily.Solana,
  chainSelector: 1n,
  chainId: 'solana-devnet',
  networkType: NetworkType.Testnet,
}

// ── Helpers ──

function makeAdmin(): SolanaTokenAdmin {
  return new SolanaTokenAdmin(mockConnection, dummyNetwork, {
    logger: silentLogger,
    apiClient: null,
  })
}

const sender = Keypair.generate().publicKey.toBase58()
const tokenAddress = Keypair.generate().publicKey.toBase58()
const poolProgramId = Keypair.generate().publicKey.toBase58()

// =============================================================================
// SolanaTokenAdmin — deployPool
// =============================================================================

describe('SolanaTokenAdmin — deployPool', () => {
  // ===========================================================================
  // generateUnsignedDeployPool — Validation
  // ===========================================================================

  describe('generateUnsignedDeployPool', () => {
    const admin = makeAdmin()

    it('should reject invalid poolType', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployPool(sender, {
            poolType: 'invalid' as 'burn-mint',
            tokenAddress,
            localTokenDecimals: 9,
            poolProgramId,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPPoolDeployParamsInvalidError)
          assert.equal(err.code, 'POOL_DEPLOY_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolType')
          return true
        },
      )
    })

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployPool(sender, {
            poolType: 'burn-mint',
            tokenAddress: '',
            localTokenDecimals: 9,
            poolProgramId,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPPoolDeployParamsInvalidError)
          assert.equal(err.context.param, 'tokenAddress')
          return true
        },
      )
    })

    it('should reject empty poolProgramId', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployPool(sender, {
            poolType: 'burn-mint',
            tokenAddress,
            localTokenDecimals: 9,
            poolProgramId: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPPoolDeployParamsInvalidError)
          assert.equal(err.context.param, 'poolProgramId')
          return true
        },
      )
    })

    // =========================================================================
    // generateUnsignedDeployPool — Happy Path
    // =========================================================================

    it('should return UnsignedSolanaTx with correct family for burn-mint', async () => {
      const { unsigned } = await admin.generateUnsignedDeployPool(sender, {
        poolType: 'burn-mint',
        tokenAddress,
        localTokenDecimals: 9,
        poolProgramId,
      })

      assert.equal(unsigned.family, ChainFamily.Solana)
      // 2 instructions: pool initialize + create pool token ATA
      assert.equal(unsigned.instructions.length, 2)
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should return UnsignedSolanaTx with correct family for lock-release', async () => {
      const { unsigned } = await admin.generateUnsignedDeployPool(sender, {
        poolType: 'lock-release',
        tokenAddress,
        localTokenDecimals: 9,
        poolProgramId,
      })

      assert.equal(unsigned.family, ChainFamily.Solana)
      // 2 instructions: pool initialize + create pool token ATA
      assert.equal(unsigned.instructions.length, 2)
    })

    it('should return poolAddress as state PDA', async () => {
      const mint = new PublicKey(tokenAddress)
      const program = new PublicKey(poolProgramId)

      const [expectedStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('ccip_tokenpool_config'), mint.toBuffer()],
        program,
      )

      const { poolAddress } = await admin.generateUnsignedDeployPool(sender, {
        poolType: 'burn-mint',
        tokenAddress,
        localTokenDecimals: 9,
        poolProgramId,
      })

      assert.equal(poolAddress, expectedStatePda.toBase58())
    })

    it('should build instruction with correct programId', async () => {
      const { unsigned } = await admin.generateUnsignedDeployPool(sender, {
        poolType: 'burn-mint',
        tokenAddress,
        localTokenDecimals: 9,
        poolProgramId,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.programId.toBase58(), poolProgramId)
    })

    it('should build instruction with 7 accounts', async () => {
      const { unsigned } = await admin.generateUnsignedDeployPool(sender, {
        poolType: 'burn-mint',
        tokenAddress,
        localTokenDecimals: 9,
        poolProgramId,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys.length, 7)
    })

    it('should set authority as signer and writable', async () => {
      const { unsigned } = await admin.generateUnsignedDeployPool(sender, {
        poolType: 'burn-mint',
        tokenAddress,
        localTokenDecimals: 9,
        poolProgramId,
      })

      const ix = unsigned.instructions[0]!
      const authorityKey = ix.keys[2]!
      assert.equal(authorityKey.pubkey.toBase58(), sender)
      assert.equal(authorityKey.isSigner, true)
      assert.equal(authorityKey.isWritable, true)
    })

    it('should set state PDA as writable and not signer', async () => {
      const { unsigned, poolAddress } = await admin.generateUnsignedDeployPool(sender, {
        poolType: 'burn-mint',
        tokenAddress,
        localTokenDecimals: 9,
        poolProgramId,
      })

      const ix = unsigned.instructions[0]!
      const stateKey = ix.keys[0]!
      assert.equal(stateKey.pubkey.toBase58(), poolAddress)
      assert.equal(stateKey.isSigner, false)
      assert.equal(stateKey.isWritable, true)
    })

    it('should include SystemProgram as account', async () => {
      const { unsigned } = await admin.generateUnsignedDeployPool(sender, {
        poolType: 'burn-mint',
        tokenAddress,
        localTokenDecimals: 9,
        poolProgramId,
      })

      const ix = unsigned.instructions[0]!
      const systemKey = ix.keys[3]!
      assert.equal(systemKey.pubkey.toBase58(), SystemProgram.programId.toBase58())
    })

    it('should have 8-byte discriminator as instruction data', async () => {
      const { unsigned } = await admin.generateUnsignedDeployPool(sender, {
        poolType: 'burn-mint',
        tokenAddress,
        localTokenDecimals: 9,
        poolProgramId,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.data.length, 8)
    })
  })

  // ===========================================================================
  // deployPool — Wallet Validation
  // ===========================================================================

  describe('deployPool', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () =>
          admin.deployPool(
            {},
            { poolType: 'burn-mint', tokenAddress, localTokenDecimals: 9, poolProgramId },
          ),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () =>
          admin.deployPool(null, {
            poolType: 'burn-mint',
            tokenAddress,
            localTokenDecimals: 9,
            poolProgramId,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () =>
          admin.deployPool(undefined, {
            poolType: 'burn-mint',
            tokenAddress,
            localTokenDecimals: 9,
            poolProgramId,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
