import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { type Connection, Keypair, PublicKey } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import { CCIPCreateTokenAltParamsInvalidError, CCIPWalletInvalidError } from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Mocks ──

const MOCK_POOL_PROGRAM_ID = Keypair.generate().publicKey
const MOCK_FEE_QUOTER = Keypair.generate().publicKey

/**
 * Mock connection for createTokenAlt tests.
 * - getAccountInfo dispatches based on the requested address:
 *   - mint address → returns account owned by the token program
 *   - pool address → returns account owned by the pool program
 *   - everything else → null
 * - getSlot returns a fixed slot
 * - _getRouterConfig is handled by mocking the router program account
 */
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
      // Pool address check: return account owned by pool program
      if (key === poolAddress && poolExists) {
        return {
          owner: poolProgramId,
          data: Buffer.alloc(300),
          executable: false,
          lamports: 1_000_000,
        }
      }
      // Mint address check: return account owned by token program
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
    getSlot: async () => 12345,
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

/**
 * Creates a SolanaTokenAdmin with a patched _getRouterConfig that returns
 * a mock feeQuoter instead of fetching from an actual router program.
 */
function makeAdmin(connection?: Connection): SolanaTokenAdmin {
  const admin = new SolanaTokenAdmin(connection ?? mockConnection(), dummyNetwork, {
    logger: silentLogger,
    apiClient: null,
  })
  // Patch _getRouterConfig to avoid real Anchor program fetch
  ;(
    admin as unknown as { _getRouterConfig: (r: string) => Promise<{ feeQuoter: PublicKey }> }
  )._getRouterConfig = async () => ({ feeQuoter: MOCK_FEE_QUOTER })
  return admin
}

const sender = Keypair.generate().publicKey.toBase58()
const tokenAddress = Keypair.generate().publicKey.toBase58()
const poolAddress = Keypair.generate().publicKey.toBase58()
const routerAddress = Keypair.generate().publicKey.toBase58()

const validParams = {
  tokenAddress,
  poolAddress,
  routerAddress,
}

// =============================================================================
// SolanaTokenAdmin — createTokenAlt
// =============================================================================

describe('SolanaTokenAdmin — createTokenAlt', () => {
  // ===========================================================================
  // Validation
  // ===========================================================================

  describe('generateUnsignedCreateTokenAlt — Validation', () => {
    const admin = makeAdmin()

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreateTokenAlt(sender, {
            ...validParams,
            tokenAddress: '',
          }),
        CCIPCreateTokenAltParamsInvalidError,
      )
    })

    it('should reject invalid tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreateTokenAlt(sender, {
            ...validParams,
            tokenAddress: 'not-a-pubkey',
          }),
        CCIPCreateTokenAltParamsInvalidError,
      )
    })

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreateTokenAlt(sender, {
            ...validParams,
            poolAddress: '',
          }),
        CCIPCreateTokenAltParamsInvalidError,
      )
    })

    it('should reject invalid poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreateTokenAlt(sender, {
            ...validParams,
            poolAddress: 'not-a-pubkey',
          }),
        CCIPCreateTokenAltParamsInvalidError,
      )
    })

    it('should reject empty routerAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreateTokenAlt(sender, {
            ...validParams,
            routerAddress: '',
          }),
        CCIPCreateTokenAltParamsInvalidError,
      )
    })

    it('should reject invalid routerAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreateTokenAlt(sender, {
            ...validParams,
            routerAddress: 'not-a-pubkey',
          }),
        CCIPCreateTokenAltParamsInvalidError,
      )
    })

    it('should reject empty authority when provided', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreateTokenAlt(sender, {
            ...validParams,
            authority: '',
          }),
        CCIPCreateTokenAltParamsInvalidError,
      )
    })

    it('should reject invalid authority', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreateTokenAlt(sender, {
            ...validParams,
            authority: 'not-a-pubkey',
          }),
        CCIPCreateTokenAltParamsInvalidError,
      )
    })

    it('should reject too many additionalAddresses', async () => {
      const tooMany = Array.from({ length: 247 }, () => Keypair.generate().publicKey.toBase58())
      await assert.rejects(
        () =>
          admin.generateUnsignedCreateTokenAlt(sender, {
            ...validParams,
            additionalAddresses: tooMany,
          }),
        CCIPCreateTokenAltParamsInvalidError,
      )
    })

    it('should reject invalid additionalAddresses entry', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreateTokenAlt(sender, {
            ...validParams,
            additionalAddresses: ['not-a-pubkey'],
          }),
        CCIPCreateTokenAltParamsInvalidError,
      )
    })

    it('should reject when pool state not found on-chain', async () => {
      const admin = makeAdmin(mockConnection({ poolExists: false }))
      await assert.rejects(
        () => admin.generateUnsignedCreateTokenAlt(sender, validParams),
        CCIPCreateTokenAltParamsInvalidError,
      )
    })

    it('should reject when mint not found on-chain', async () => {
      const admin = makeAdmin(mockConnection({ mintExists: false }))
      await assert.rejects(
        () => admin.generateUnsignedCreateTokenAlt(sender, validParams),
        CCIPCreateTokenAltParamsInvalidError,
      )
    })

    it('should reject when mint owned by unknown program', async () => {
      const admin = makeAdmin(
        mockConnection({ tokenProgramId: new PublicKey('11111111111111111111111111111111') }),
      )
      await assert.rejects(
        () => admin.generateUnsignedCreateTokenAlt(sender, validParams),
        CCIPCreateTokenAltParamsInvalidError,
      )
    })
  })

  // ===========================================================================
  // Happy Path
  // ===========================================================================

  describe('generateUnsignedCreateTokenAlt — Happy Path', () => {
    it('should return correct family (Solana)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreateTokenAlt(sender, validParams)
      assert.equal(unsigned.family, ChainFamily.Solana)
    })

    it('should return create + extend instructions (10 base, no additional)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreateTokenAlt(sender, validParams)
      // 10 addresses → 1 create + 1 extend (chunk size 30)
      assert.equal(unsigned.instructions.length, 2)
    })

    it('should return mainIndex 0', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreateTokenAlt(sender, validParams)
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should return lookupTableAddress in result', async () => {
      const admin = makeAdmin()
      const { result } = await admin.generateUnsignedCreateTokenAlt(sender, validParams)
      assert.ok(result.lookupTableAddress)
      // Should be a valid base58 pubkey
      new PublicKey(result.lookupTableAddress)
    })

    it('should include additional addresses when provided', async () => {
      const extra1 = Keypair.generate().publicKey.toBase58()
      const extra2 = Keypair.generate().publicKey.toBase58()
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreateTokenAlt(sender, {
        ...validParams,
        additionalAddresses: [extra1, extra2],
      })
      // 12 addresses → 1 create + 1 extend (chunk size 30)
      assert.equal(unsigned.instructions.length, 2)
    })

    it('should chunk addresses when exceeding 30', async () => {
      const extras = Array.from({ length: 25 }, () => Keypair.generate().publicKey.toBase58())
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreateTokenAlt(sender, {
        ...validParams,
        additionalAddresses: extras,
      })
      // 35 total addresses → 1 create + 2 extend (30 + 5)
      assert.equal(unsigned.instructions.length, 3)
    })

    it('should work with Token-2022 mint', async () => {
      const admin = makeAdmin(mockConnection({ tokenProgramId: TOKEN_2022_PROGRAM_ID }))
      const { unsigned, result } = await admin.generateUnsignedCreateTokenAlt(sender, validParams)
      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.ok(result.lookupTableAddress)
    })

    it('should use custom authority when provided', async () => {
      const customAuthority = Keypair.generate().publicKey.toBase58()
      const admin = makeAdmin()
      // Should not throw — authority is valid
      const { result } = await admin.generateUnsignedCreateTokenAlt(sender, {
        ...validParams,
        authority: customAuthority,
      })
      assert.ok(result.lookupTableAddress)
    })
  })

  // ===========================================================================
  // Wallet Validation
  // ===========================================================================

  describe('createTokenAlt — Wallet Validation', () => {
    it('should reject non-wallet object', async () => {
      const admin = makeAdmin()
      await assert.rejects(() => admin.createTokenAlt({}, validParams), CCIPWalletInvalidError)
    })

    it('should reject null wallet', async () => {
      const admin = makeAdmin()
      await assert.rejects(() => admin.createTokenAlt(null, validParams), CCIPWalletInvalidError)
    })

    it('should reject string wallet', async () => {
      const admin = makeAdmin()
      await assert.rejects(
        () => admin.createTokenAlt('not-a-wallet', validParams),
        CCIPWalletInvalidError,
      )
    })
  })
})
