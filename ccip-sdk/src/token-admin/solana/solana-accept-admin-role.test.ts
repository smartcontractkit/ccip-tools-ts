import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Connection, Keypair, PublicKey } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import {
  CCIPAcceptAdminRoleParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Mocks ──

const mockConnection = {
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

const sender = Keypair.generate().publicKey.toBase58()
const tokenAddress = Keypair.generate().publicKey.toBase58()
const routerAddress = Keypair.generate().publicKey.toBase58()

// =============================================================================
// SolanaTokenAdmin — acceptAdminRole
// =============================================================================

describe('SolanaTokenAdmin — acceptAdminRole', () => {
  // ===========================================================================
  // generateUnsignedAcceptAdminRole — Validation
  // ===========================================================================

  describe('generateUnsignedAcceptAdminRole — validation', () => {
    const admin = makeAdmin()

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAcceptAdminRole(sender, {
            tokenAddress: '',
            routerAddress,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAcceptAdminRoleParamsInvalidError)
          assert.equal(err.code, 'ACCEPT_ADMIN_ROLE_PARAMS_INVALID')
          assert.equal(err.context.param, 'tokenAddress')
          return true
        },
      )
    })

    it('should reject empty routerAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAcceptAdminRole(sender, {
            tokenAddress,
            routerAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAcceptAdminRoleParamsInvalidError)
          assert.equal(err.context.param, 'routerAddress')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // generateUnsignedAcceptAdminRole — Happy Path
  // ===========================================================================

  describe('generateUnsignedAcceptAdminRole — happy path', () => {
    const admin = makeAdmin()

    it('should return UnsignedSolanaTx with correct family', async () => {
      const { unsigned } = await admin.generateUnsignedAcceptAdminRole(sender, {
        tokenAddress,
        routerAddress,
      })

      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.instructions.length, 1)
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should build instruction with correct programId (routerAddress)', async () => {
      const { unsigned } = await admin.generateUnsignedAcceptAdminRole(sender, {
        tokenAddress,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.programId.toBase58(), routerAddress)
    })

    it('should build instruction with 4 accounts', async () => {
      const { unsigned } = await admin.generateUnsignedAcceptAdminRole(sender, {
        tokenAddress,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys.length, 4)
    })

    it('should have config PDA as first account (read-only)', async () => {
      const routerPubkey = new PublicKey(routerAddress)
      const [expectedConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from('config')],
        routerPubkey,
      )

      const { unsigned } = await admin.generateUnsignedAcceptAdminRole(sender, {
        tokenAddress,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys[0]!.pubkey.toBase58(), expectedConfig.toBase58())
      assert.equal(ix.keys[0]!.isSigner, false)
      assert.equal(ix.keys[0]!.isWritable, false)
    })

    it('should have token admin registry PDA as second account (writable)', async () => {
      const routerPubkey = new PublicKey(routerAddress)
      const mint = new PublicKey(tokenAddress)
      const [expectedTarPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('token_admin_registry'), mint.toBuffer()],
        routerPubkey,
      )

      const { unsigned } = await admin.generateUnsignedAcceptAdminRole(sender, {
        tokenAddress,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys[1]!.pubkey.toBase58(), expectedTarPda.toBase58())
      assert.equal(ix.keys[1]!.isSigner, false)
      assert.equal(ix.keys[1]!.isWritable, true)
    })

    it('should have mint as third account (read-only)', async () => {
      const { unsigned } = await admin.generateUnsignedAcceptAdminRole(sender, {
        tokenAddress,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys[2]!.pubkey.toBase58(), tokenAddress)
      assert.equal(ix.keys[2]!.isSigner, false)
      assert.equal(ix.keys[2]!.isWritable, false)
    })

    it('should have authority as fourth account (signer, writable)', async () => {
      const { unsigned } = await admin.generateUnsignedAcceptAdminRole(sender, {
        tokenAddress,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys[3]!.pubkey.toBase58(), sender)
      assert.equal(ix.keys[3]!.isSigner, true)
      assert.equal(ix.keys[3]!.isWritable, true)
    })

    it('should have exactly 4 accounts (no SystemProgram per IDL)', async () => {
      const { unsigned } = await admin.generateUnsignedAcceptAdminRole(sender, {
        tokenAddress,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      // IDL only defines 4 accounts: config, tokenAdminRegistry, mint, authority
      assert.equal(ix.keys.length, 4)
    })

    it('should have 8-byte discriminator only as instruction data (no arguments)', async () => {
      const { unsigned } = await admin.generateUnsignedAcceptAdminRole(sender, {
        tokenAddress,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      // 8 bytes discriminator only — no arguments for accept
      assert.equal(ix.data.length, 8)
    })
  })

  // ===========================================================================
  // acceptAdminRole — Wallet Validation
  // ===========================================================================

  describe('acceptAdminRole — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.acceptAdminRole({}, { tokenAddress, routerAddress }),
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
          admin.acceptAdminRole(null, {
            tokenAddress,
            routerAddress,
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
          admin.acceptAdminRole(undefined, {
            tokenAddress,
            routerAddress,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
