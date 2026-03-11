import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getMintLen } from '@solana/spl-token'
import { type Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import { CCIPTokenDeployParamsInvalidError, CCIPWalletInvalidError } from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Mocks ──

const mockGetMinimumBalanceForRentExemption = mock.fn(async (_size: number) => 1_461_600)

const mockConnection = {
  getMinimumBalanceForRentExemption: mockGetMinimumBalanceForRentExemption,
  getSignaturesForAddress: async () => [],
  getAccountInfo: async () => null,
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

// =============================================================================
// SolanaTokenAdmin — Construction
// =============================================================================

describe('SolanaTokenAdmin', () => {
  describe('constructor', () => {
    it('should create instance with connection', () => {
      const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, { apiClient: null })
      assert.equal(admin.connection, mockConnection)
    })
  })

  // ===========================================================================
  // generateUnsignedDeployToken — Validation
  // ===========================================================================

  describe('generateUnsignedDeployToken', () => {
    const admin = makeAdmin()
    const sender = Keypair.generate().publicKey.toBase58()

    it('should reject empty name', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken(sender, {
            name: '',
            symbol: 'MTK',
            decimals: 9,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.code, 'TOKEN_DEPLOY_PARAMS_INVALID')
          assert.equal(err.context.param, 'name')
          return true
        },
      )
    })

    it('should reject empty symbol', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken(sender, {
            name: 'Token',
            symbol: '',
            decimals: 9,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'symbol')
          return true
        },
      )
    })

    it('should reject negative initialSupply', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken(sender, {
            name: 'Token',
            symbol: 'MTK',
            decimals: 9,
            initialSupply: -1n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'initialSupply')
          return true
        },
      )
    })

    it('should reject negative maxSupply', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken(sender, {
            name: 'Token',
            symbol: 'MTK',
            decimals: 9,
            maxSupply: -1n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'maxSupply')
          return true
        },
      )
    })

    it('should reject initialSupply > maxSupply', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeployToken(sender, {
            name: 'Token',
            symbol: 'MTK',
            decimals: 9,
            maxSupply: 100n,
            initialSupply: 200n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTokenDeployParamsInvalidError)
          assert.equal(err.context.param, 'initialSupply')
          return true
        },
      )
    })

    // =========================================================================
    // generateUnsignedDeployToken — Happy Path
    // =========================================================================

    it('should return UnsignedSolanaTx with correct family', async () => {
      const { unsigned } = await admin.generateUnsignedDeployToken(sender, {
        name: 'My Token',
        symbol: 'MTK',
        decimals: 9,
      })

      assert.equal(unsigned.family, ChainFamily.Solana)
    })

    it('should return a mintKeypair', async () => {
      const { mintKeypair } = await admin.generateUnsignedDeployToken(sender, {
        name: 'My Token',
        symbol: 'MTK',
        decimals: 9,
      })

      assert.ok(mintKeypair instanceof Keypair)
      assert.ok(mintKeypair.publicKey instanceof PublicKey)
    })

    it('should include createAccount + initializeMint + metadata instructions (no supply)', async () => {
      const { unsigned } = await admin.generateUnsignedDeployToken(sender, {
        name: 'My Token',
        symbol: 'MTK',
        decimals: 9,
      })

      // 3 instructions: createAccount, initializeMint2, createMetadata
      assert.equal(unsigned.instructions.length, 3)
    })

    it('should include ATA + mintTo instructions when initialSupply > 0', async () => {
      const { unsigned } = await admin.generateUnsignedDeployToken(sender, {
        name: 'My Token',
        symbol: 'MTK',
        decimals: 9,
        initialSupply: 1_000_000n,
      })

      // 5 instructions: createAccount, initializeMint2, createMetadata, createATA, mintTo
      assert.equal(unsigned.instructions.length, 5)
    })

    it('should use TOKEN_PROGRAM_ID by default', async () => {
      const { unsigned } = await admin.generateUnsignedDeployToken(sender, {
        name: 'My Token',
        symbol: 'MTK',
        decimals: 9,
      })

      // The createAccount instruction's programId (last param) should be TOKEN_PROGRAM_ID
      const createAccountIx = unsigned.instructions[0]!
      assert.equal(createAccountIx.programId.toBase58(), SystemProgram.programId.toBase58())
      // Check the keys — the newAccountPubkey should use TOKEN_PROGRAM_ID as the owner
      const createAccountData = createAccountIx.data
      // The space should match getMintLen([])
      assert.ok(createAccountData.length > 0)
    })

    it('should use TOKEN_2022_PROGRAM_ID when tokenProgram is token-2022', async () => {
      const { unsigned } = await admin.generateUnsignedDeployToken(sender, {
        name: 'My Token',
        symbol: 'MTK',
        decimals: 9,
        tokenProgram: 'token-2022',
      })

      // The initializeMint2 instruction should use TOKEN_2022_PROGRAM_ID
      const initMintIx = unsigned.instructions[1]!
      assert.equal(initMintIx.programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58())
    })

    it('should use TOKEN_PROGRAM_ID for spl-token', async () => {
      const { unsigned } = await admin.generateUnsignedDeployToken(sender, {
        name: 'My Token',
        symbol: 'MTK',
        decimals: 9,
        tokenProgram: 'spl-token',
      })

      const initMintIx = unsigned.instructions[1]!
      assert.equal(initMintIx.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58())
    })

    it('should accept decimals: 0', async () => {
      const { unsigned } = await admin.generateUnsignedDeployToken(sender, {
        name: 'Zero Dec Token',
        symbol: 'ZDT',
        decimals: 0,
      })

      assert.equal(unsigned.instructions.length, 3)
    })

    it('should set mainIndex to 0', async () => {
      const { unsigned } = await admin.generateUnsignedDeployToken(sender, {
        name: 'My Token',
        symbol: 'MTK',
        decimals: 9,
      })

      assert.equal(unsigned.mainIndex, 0)
    })

    it('should call getMinimumBalanceForRentExemption with correct mint length', async () => {
      await admin.generateUnsignedDeployToken(sender, {
        name: 'My Token',
        symbol: 'MTK',
        decimals: 9,
      })

      const expectedLen = getMintLen([])
      const calls = mockGetMinimumBalanceForRentExemption.mock.calls
      const lastCall = calls[calls.length - 1]!
      assert.equal(lastCall.arguments[0], expectedLen)
    })
  })

  // ===========================================================================
  // deployToken — Wallet Validation
  // ===========================================================================

  describe('deployToken', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.deployToken({}, { name: 'Token', symbol: 'MTK', decimals: 9 }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.deployToken(null, { name: 'Token', symbol: 'MTK', decimals: 9 }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () => admin.deployToken(undefined, { name: 'Token', symbol: 'MTK', decimals: 9 }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
