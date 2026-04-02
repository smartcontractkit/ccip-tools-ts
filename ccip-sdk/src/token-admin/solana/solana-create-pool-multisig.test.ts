import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { type Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import {
  CCIPCreatePoolMultisigParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { derivePoolSignerPDA } from '../../solana/utils.ts'
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
const poolProgramId = Keypair.generate().publicKey.toBase58()
const additionalSigner1 = Keypair.generate().publicKey.toBase58()
const additionalSigner2 = Keypair.generate().publicKey.toBase58()

const validParams = {
  mint,
  poolProgramId,
  additionalSigners: [additionalSigner1],
  threshold: 1,
}

// =============================================================================
// SolanaTokenAdmin — createPoolMintAuthorityMultisig
// =============================================================================

describe('SolanaTokenAdmin — createPoolMintAuthorityMultisig', () => {
  // ===========================================================================
  // Validation
  // ===========================================================================

  describe('generateUnsignedCreatePoolMintAuthorityMultisig — Validation', () => {
    const admin = makeAdmin()

    it('should reject empty mint', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, {
            ...validParams,
            mint: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPCreatePoolMultisigParamsInvalidError)
          assert.equal(err.code, 'CREATE_POOL_MULTISIG_PARAMS_INVALID')
          assert.equal(err.context.param, 'mint')
          return true
        },
      )
    })

    it('should reject empty poolProgramId', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, {
            ...validParams,
            poolProgramId: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPCreatePoolMultisigParamsInvalidError)
          assert.equal(err.context.param, 'poolProgramId')
          return true
        },
      )
    })

    it('should reject empty additionalSigners array', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, {
            ...validParams,
            additionalSigners: [],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPCreatePoolMultisigParamsInvalidError)
          assert.equal(err.context.param, 'additionalSigners')
          return true
        },
      )
    })

    it('should reject additionalSigners with empty string', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, {
            ...validParams,
            additionalSigners: [''],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPCreatePoolMultisigParamsInvalidError)
          assert.equal(err.context.param, 'additionalSigners')
          return true
        },
      )
    })

    it('should reject threshold < 1', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, {
            ...validParams,
            threshold: 0,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPCreatePoolMultisigParamsInvalidError)
          assert.equal(err.context.param, 'threshold')
          return true
        },
      )
    })

    it('should reject non-integer threshold', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, {
            ...validParams,
            threshold: 1.5,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPCreatePoolMultisigParamsInvalidError)
          assert.equal(err.context.param, 'threshold')
          return true
        },
      )
    })

    it('should reject threshold > total signers', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, {
            ...validParams,
            additionalSigners: [additionalSigner1],
            threshold: 3, // 2 total signers (PDA + 1), threshold 3
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPCreatePoolMultisigParamsInvalidError)
          assert.equal(err.context.param, 'threshold')
          return true
        },
      )
    })

    it('should reject total signers > 11', async () => {
      // 11 additional + 1 PDA = 12 total
      const tooManySigners = Array.from({ length: 11 }, () =>
        Keypair.generate().publicKey.toBase58(),
      )
      await assert.rejects(
        () =>
          admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, {
            ...validParams,
            additionalSigners: tooManySigners,
            threshold: 1,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPCreatePoolMultisigParamsInvalidError)
          assert.equal(err.context.param, 'additionalSigners')
          return true
        },
      )
    })

    it('should reject when mint account not found on-chain', async () => {
      const admin = makeAdmin(mockConnectionNoMint)
      await assert.rejects(
        () => admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPCreatePoolMultisigParamsInvalidError)
          assert.equal(err.context.param, 'mint')
          assert.ok(err.message.includes('not found'))
          return true
        },
      )
    })

    it('should reject when mint owned by unknown program', async () => {
      const admin = makeAdmin(mockConnectionBadMint)
      await assert.rejects(
        () => admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPCreatePoolMultisigParamsInvalidError)
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

  describe('generateUnsignedCreatePoolMintAuthorityMultisig — Happy Path', () => {
    it('should return UnsignedSolanaTx with correct family', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreatePoolMintAuthorityMultisig(
        sender,
        validParams,
      )

      assert.equal(unsigned.family, ChainFamily.Solana)
    })

    it('should return 2 instructions (createAccount + initializeMultisig)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreatePoolMintAuthorityMultisig(
        sender,
        validParams,
      )

      assert.equal(unsigned.instructions.length, 2)
    })

    it('should have mainIndex = 1 (initializeMultisig)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreatePoolMintAuthorityMultisig(
        sender,
        validParams,
      )

      assert.equal(unsigned.mainIndex, 1)
    })

    it('should derive poolSignerPda correctly', async () => {
      const admin = makeAdmin()
      const mintPubkey = new PublicKey(mint)
      const poolProgram = new PublicKey(poolProgramId)
      const [expectedPda] = derivePoolSignerPDA(mintPubkey, poolProgram)

      const { result } = await admin.generateUnsignedCreatePoolMintAuthorityMultisig(
        sender,
        validParams,
      )

      assert.equal(result.poolSignerPda, expectedPda.toBase58())
    })

    it('should include poolSignerPda as first signer in allSigners', async () => {
      const admin = makeAdmin()
      const mintPubkey = new PublicKey(mint)
      const poolProgram = new PublicKey(poolProgramId)
      const [expectedPda] = derivePoolSignerPDA(mintPubkey, poolProgram)

      const { result } = await admin.generateUnsignedCreatePoolMintAuthorityMultisig(
        sender,
        validParams,
      )

      assert.equal(result.allSigners[0], expectedPda.toBase58())
      assert.equal(result.allSigners[1], additionalSigner1)
      assert.equal(result.allSigners.length, 2)
    })

    it('should return multisigKeypair when no seed is provided', async () => {
      const admin = makeAdmin()
      const { multisigKeypair, result } =
        await admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, validParams)

      assert.ok(multisigKeypair instanceof Keypair)
      assert.equal(result.multisigAddress, multisigKeypair.publicKey.toBase58())
    })

    it('should use createAccountWithSeed when seed is provided', async () => {
      const admin = makeAdmin()
      const seed = 'ccip-pool-multisig'
      const { unsigned, multisigKeypair, result } =
        await admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, {
          ...validParams,
          seed,
        })

      // No keypair when seed is used
      assert.equal(multisigKeypair, undefined)

      // Verify deterministic address
      const expectedAddress = await PublicKey.createWithSeed(
        new PublicKey(sender),
        seed,
        TOKEN_PROGRAM_ID,
      )
      assert.equal(result.multisigAddress, expectedAddress.toBase58())

      // First instruction should be createAccountWithSeed (SystemProgram)
      const createIx = unsigned.instructions[0]!
      assert.equal(createIx.programId.toBase58(), SystemProgram.programId.toBase58())
    })

    it('should produce deterministic address with same seed', async () => {
      const admin = makeAdmin()
      const seed = 'test-seed'

      const { result: r1 } = await admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, {
        ...validParams,
        seed,
      })
      const { result: r2 } = await admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, {
        ...validParams,
        seed,
      })

      assert.equal(r1.multisigAddress, r2.multisigAddress)
    })

    it('should auto-detect Token-2022 program', async () => {
      const admin = makeAdmin(mockConnectionWithMint(TOKEN_2022_PROGRAM_ID))
      const seed = 'test-2022'

      const { result } = await admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, {
        ...validParams,
        seed,
      })

      // Deterministic address should be derived with Token-2022 program
      const expectedAddress = await PublicKey.createWithSeed(
        new PublicKey(sender),
        seed,
        TOKEN_2022_PROGRAM_ID,
      )
      assert.equal(result.multisigAddress, expectedAddress.toBase58())
    })

    it('should support multiple additional signers', async () => {
      const admin = makeAdmin()
      const { result } = await admin.generateUnsignedCreatePoolMintAuthorityMultisig(sender, {
        ...validParams,
        additionalSigners: [additionalSigner1, additionalSigner2],
        threshold: 2,
      })

      assert.equal(result.allSigners.length, 3) // PDA + 2 additional
      assert.equal(result.allSigners[1], additionalSigner1)
      assert.equal(result.allSigners[2], additionalSigner2)
    })

    it('should use first instruction as SystemProgram.createAccount', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreatePoolMintAuthorityMultisig(
        sender,
        validParams,
      )

      const createIx = unsigned.instructions[0]!
      assert.equal(createIx.programId.toBase58(), SystemProgram.programId.toBase58())
    })

    it('should use second instruction as InitializeMultisig (SPL Token)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedCreatePoolMintAuthorityMultisig(
        sender,
        validParams,
      )

      const initIx = unsigned.instructions[1]!
      assert.equal(initIx.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58())
    })
  })

  // ===========================================================================
  // derivePoolSignerPDA utility
  // ===========================================================================

  describe('derivePoolSignerPDA', () => {
    it('should derive deterministic PDA from mint and poolProgramId', () => {
      const mintPk = new PublicKey(mint)
      const programPk = new PublicKey(poolProgramId)

      const [pda1] = derivePoolSignerPDA(mintPk, programPk)
      const [pda2] = derivePoolSignerPDA(mintPk, programPk)

      assert.equal(pda1.toBase58(), pda2.toBase58())
    })

    it('should produce different PDAs for different mints', () => {
      const mint1 = Keypair.generate().publicKey
      const mint2 = Keypair.generate().publicKey
      const programPk = new PublicKey(poolProgramId)

      const [pda1] = derivePoolSignerPDA(mint1, programPk)
      const [pda2] = derivePoolSignerPDA(mint2, programPk)

      assert.notEqual(pda1.toBase58(), pda2.toBase58())
    })

    it('should produce different PDAs for different pool programs', () => {
      const mintPk = new PublicKey(mint)
      const program1 = Keypair.generate().publicKey
      const program2 = Keypair.generate().publicKey

      const [pda1] = derivePoolSignerPDA(mintPk, program1)
      const [pda2] = derivePoolSignerPDA(mintPk, program2)

      assert.notEqual(pda1.toBase58(), pda2.toBase58())
    })

    it('should match expected seeds ["ccip_tokenpool_signer", mint]', () => {
      const mintPk = new PublicKey(mint)
      const programPk = new PublicKey(poolProgramId)

      const [pda] = derivePoolSignerPDA(mintPk, programPk)
      const [expected] = PublicKey.findProgramAddressSync(
        [Buffer.from('ccip_tokenpool_signer'), mintPk.toBuffer()],
        programPk,
      )

      assert.equal(pda.toBase58(), expected.toBase58())
    })
  })

  // ===========================================================================
  // createPoolMintAuthorityMultisig — Wallet Validation
  // ===========================================================================

  describe('createPoolMintAuthorityMultisig — Wallet Validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.createPoolMintAuthorityMultisig({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.createPoolMintAuthorityMultisig(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject string wallet', async () => {
      await assert.rejects(
        () => admin.createPoolMintAuthorityMultisig('not-a-wallet', validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
