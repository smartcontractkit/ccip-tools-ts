import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Connection, Keypair, PublicKey } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import {
  CCIPAcceptOwnershipParamsInvalidError,
  CCIPTransferOwnershipParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { AcceptOwnershipParams, TransferOwnershipParams } from '../types.ts'

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
const newOwner = Keypair.generate().publicKey.toBase58()

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

const validTransferParams: TransferOwnershipParams = {
  poolAddress: poolStatePda.toBase58(),
  newOwner,
}

const validAcceptParams: AcceptOwnershipParams = {
  poolAddress: poolStatePda.toBase58(),
}

// =============================================================================
// SolanaTokenAdmin — transferOwnership
// =============================================================================

describe('SolanaTokenAdmin — transferOwnership', () => {
  // ===========================================================================
  // Validation
  // ===========================================================================

  describe('generateUnsignedTransferOwnership — validation', () => {
    const mockConnection = createMockConnection()
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedTransferOwnership(sender, {
            ...validTransferParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferOwnershipParamsInvalidError)
          assert.equal(err.code, 'TRANSFER_OWNERSHIP_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty newOwner', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedTransferOwnership(sender, {
            ...validTransferParams,
            newOwner: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferOwnershipParamsInvalidError)
          assert.equal(err.context.param, 'newOwner')
          return true
        },
      )
    })

    it('should reject invalid newOwner pubkey', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedTransferOwnership(sender, {
            ...validTransferParams,
            newOwner: 'not-a-pubkey',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferOwnershipParamsInvalidError)
          assert.equal(err.context.param, 'newOwner')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // Happy Path
  // ===========================================================================

  describe('generateUnsignedTransferOwnership — Happy Path', () => {
    function makeAdmin(): SolanaTokenAdmin {
      const mockConnection = createMockConnection()
      const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
        logger: silentLogger,
        apiClient: null,
      })
      admin.getTokenForTokenPool = async () => mint.toBase58()
      return admin
    }

    it('should return correct family (Solana)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedTransferOwnership(
        sender,
        validTransferParams,
      )
      assert.equal(unsigned.family, ChainFamily.Solana)
    })

    it('should return 1 instruction with mainIndex 0', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedTransferOwnership(
        sender,
        validTransferParams,
      )
      assert.equal(unsigned.instructions.length, 1)
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should have 3 accounts (state, mint, authority)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedTransferOwnership(
        sender,
        validTransferParams,
      )
      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys.length, 3)

      // Account 0: state PDA (writable, not signer)
      assert.equal(ix.keys[0]!.pubkey.toBase58(), poolStatePda.toBase58())
      assert.equal(ix.keys[0]!.isWritable, true)
      assert.equal(ix.keys[0]!.isSigner, false)

      // Account 1: mint (read-only, not signer)
      assert.equal(ix.keys[1]!.pubkey.toBase58(), mint.toBase58())
      assert.equal(ix.keys[1]!.isWritable, false)
      assert.equal(ix.keys[1]!.isSigner, false)

      // Account 2: authority (signer)
      assert.equal(ix.keys[2]!.pubkey.toBase58(), sender)
      assert.equal(ix.keys[2]!.isSigner, true)
    })

    it('should set programId to the pool program', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedTransferOwnership(
        sender,
        validTransferParams,
      )
      const ix = unsigned.instructions[0]!
      assert.equal(ix.programId.toBase58(), poolProgramId.toBase58())
    })
  })

  // ===========================================================================
  // Wallet Validation
  // ===========================================================================

  describe('transferOwnership — wallet validation', () => {
    const mockConnection = createMockConnection()
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.transferOwnership({}, validTransferParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.transferOwnership(null, validTransferParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})

// =============================================================================
// SolanaTokenAdmin — acceptOwnership
// =============================================================================

describe('SolanaTokenAdmin — acceptOwnership', () => {
  // ===========================================================================
  // Validation
  // ===========================================================================

  describe('generateUnsignedAcceptOwnership — validation', () => {
    const mockConnection = createMockConnection()
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAcceptOwnership(sender, {
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAcceptOwnershipParamsInvalidError)
          assert.equal(err.code, 'ACCEPT_OWNERSHIP_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // Happy Path
  // ===========================================================================

  describe('generateUnsignedAcceptOwnership — Happy Path', () => {
    function makeAdmin(): SolanaTokenAdmin {
      const mockConnection = createMockConnection()
      const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
        logger: silentLogger,
        apiClient: null,
      })
      admin.getTokenForTokenPool = async () => mint.toBase58()
      return admin
    }

    it('should return correct family (Solana)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedAcceptOwnership(sender, validAcceptParams)
      assert.equal(unsigned.family, ChainFamily.Solana)
    })

    it('should return 1 instruction with mainIndex 0', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedAcceptOwnership(sender, validAcceptParams)
      assert.equal(unsigned.instructions.length, 1)
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should have 3 accounts (state, mint, authority)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedAcceptOwnership(sender, validAcceptParams)
      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys.length, 3)

      // Account 0: state PDA (writable, not signer)
      assert.equal(ix.keys[0]!.pubkey.toBase58(), poolStatePda.toBase58())
      assert.equal(ix.keys[0]!.isWritable, true)

      // Account 1: mint (read-only, not signer)
      assert.equal(ix.keys[1]!.pubkey.toBase58(), mint.toBase58())
      assert.equal(ix.keys[1]!.isWritable, false)

      // Account 2: authority (signer)
      assert.equal(ix.keys[2]!.pubkey.toBase58(), sender)
      assert.equal(ix.keys[2]!.isSigner, true)
    })

    it('should set programId to the pool program', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedAcceptOwnership(sender, validAcceptParams)
      const ix = unsigned.instructions[0]!
      assert.equal(ix.programId.toBase58(), poolProgramId.toBase58())
    })
  })

  // ===========================================================================
  // Wallet Validation
  // ===========================================================================

  describe('acceptOwnership — wallet validation', () => {
    const mockConnection = createMockConnection()
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.acceptOwnership({}, validAcceptParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.acceptOwnership(null, validAcceptParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
