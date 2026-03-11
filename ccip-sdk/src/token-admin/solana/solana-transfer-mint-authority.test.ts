import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { type Connection, Keypair, PublicKey } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import {
  CCIPTransferMintAuthorityParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Mocks ──

/** Mock connection that returns a valid SPL Token mint for getAccountInfo. */
function mockConnectionWithMint(tokenProgramId: PublicKey = TOKEN_PROGRAM_ID) {
  return {
    getSignaturesForAddress: async () => [],
    getAccountInfo: async () => ({
      owner: tokenProgramId,
      data: Buffer.alloc(82),
      executable: false,
      lamports: 1_000_000,
    }),
    getMinimumBalanceForRentExemption: async () => 2_039_280,
  } as unknown as Connection
}

/** Mock connection where mint does not exist. */
const mockConnectionNoMint = {
  getSignaturesForAddress: async () => [],
  getAccountInfo: async () => null,
  getMinimumBalanceForRentExemption: async () => 2_039_280,
} as unknown as Connection

/** Mock connection where mint is owned by an unknown program. */
const mockConnectionBadMint = {
  getSignaturesForAddress: async () => [],
  getAccountInfo: async () => ({
    owner: new PublicKey('11111111111111111111111111111111'),
    data: Buffer.alloc(82),
    executable: false,
    lamports: 1_000_000,
  }),
  getMinimumBalanceForRentExemption: async () => 2_039_280,
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

function makeAdmin(connection?: Connection): SolanaTokenAdmin {
  return new SolanaTokenAdmin(connection ?? mockConnectionWithMint(), dummyNetwork, {
    logger: silentLogger,
    apiClient: null,
  })
}

const sender = Keypair.generate().publicKey.toBase58()
const mint = Keypair.generate().publicKey.toBase58()
const newMintAuthority = Keypair.generate().publicKey.toBase58()

const validParams = {
  mint,
  newMintAuthority,
}

// =============================================================================
// SolanaTokenAdmin — transferMintAuthority
// =============================================================================

describe('SolanaTokenAdmin — transferMintAuthority', () => {
  // ===========================================================================
  // Validation
  // ===========================================================================

  describe('generateUnsignedTransferMintAuthority — Validation', () => {
    const admin = makeAdmin()

    it('should reject empty mint', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedTransferMintAuthority(sender, {
            ...validParams,
            mint: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferMintAuthorityParamsInvalidError)
          assert.equal(err.code, 'TRANSFER_MINT_AUTHORITY_PARAMS_INVALID')
          assert.equal(err.context.param, 'mint')
          return true
        },
      )
    })

    it('should reject empty newMintAuthority', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedTransferMintAuthority(sender, {
            ...validParams,
            newMintAuthority: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferMintAuthorityParamsInvalidError)
          assert.equal(err.context.param, 'newMintAuthority')
          return true
        },
      )
    })

    it('should reject invalid mint public key', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedTransferMintAuthority(sender, {
            ...validParams,
            mint: 'not-a-valid-pubkey!!!',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferMintAuthorityParamsInvalidError)
          assert.equal(err.context.param, 'mint')
          return true
        },
      )
    })

    it('should reject invalid newMintAuthority public key', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedTransferMintAuthority(sender, {
            ...validParams,
            newMintAuthority: 'not-a-valid-pubkey!!!',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferMintAuthorityParamsInvalidError)
          assert.equal(err.context.param, 'newMintAuthority')
          return true
        },
      )
    })

    it('should reject when mint account not found on-chain', async () => {
      const admin = makeAdmin(mockConnectionNoMint)
      await assert.rejects(
        () => admin.generateUnsignedTransferMintAuthority(sender, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferMintAuthorityParamsInvalidError)
          assert.equal(err.context.param, 'mint')
          assert.ok(err.message.includes('not found'))
          return true
        },
      )
    })

    it('should reject when mint owned by unknown program', async () => {
      const admin = makeAdmin(mockConnectionBadMint)
      await assert.rejects(
        () => admin.generateUnsignedTransferMintAuthority(sender, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferMintAuthorityParamsInvalidError)
          assert.equal(err.context.param, 'mint')
          assert.ok(err.message.includes('expected SPL Token or Token-2022'))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // Happy Path
  // ===========================================================================

  describe('generateUnsignedTransferMintAuthority — Happy Path', () => {
    it('should return UnsignedSolanaTx with correct family', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedTransferMintAuthority(sender, validParams)

      assert.equal(unsigned.family, ChainFamily.Solana)
    })

    it('should return 1 instruction', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedTransferMintAuthority(sender, validParams)

      assert.equal(unsigned.instructions.length, 1)
    })

    it('should have mainIndex = 0', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedTransferMintAuthority(sender, validParams)

      assert.equal(unsigned.mainIndex, 0)
    })

    it('should use SPL Token program for instruction', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedTransferMintAuthority(sender, validParams)

      const ix = unsigned.instructions[0]!
      assert.equal(ix.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58())
    })

    it('should auto-detect Token-2022 program', async () => {
      const admin = makeAdmin(mockConnectionWithMint(TOKEN_2022_PROGRAM_ID))
      const { unsigned } = await admin.generateUnsignedTransferMintAuthority(sender, validParams)

      const ix = unsigned.instructions[0]!
      assert.equal(ix.programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58())
    })

    it('should include mint as first key in instruction', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedTransferMintAuthority(sender, validParams)

      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys[0]!.pubkey.toBase58(), mint)
      assert.ok(ix.keys[0]!.isWritable)
    })

    it('should include sender as second key (current authority)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedTransferMintAuthority(sender, validParams)

      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys[1]!.pubkey.toBase58(), sender)
      assert.ok(ix.keys[1]!.isSigner)
    })

    it('should return empty txHash in unsigned result', async () => {
      const admin = makeAdmin()
      const { result } = await admin.generateUnsignedTransferMintAuthority(sender, validParams)

      assert.equal(result.txHash, '')
    })
  })

  // ===========================================================================
  // transferMintAuthority — Wallet Validation
  // ===========================================================================

  describe('transferMintAuthority — Wallet Validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.transferMintAuthority({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.transferMintAuthority(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject string wallet', async () => {
      await assert.rejects(
        () => admin.transferMintAuthority('not-a-wallet', validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
