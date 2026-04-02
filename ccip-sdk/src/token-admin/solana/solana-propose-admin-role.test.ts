import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import {
  CCIPProposeAdminRoleParamsInvalidError,
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
const administrator = Keypair.generate().publicKey.toBase58()
const routerAddress = Keypair.generate().publicKey.toBase58()

// =============================================================================
// SolanaTokenAdmin — proposeAdminRole
// =============================================================================

describe('SolanaTokenAdmin — proposeAdminRole', () => {
  // ===========================================================================
  // generateUnsignedProposeAdminRole — Validation
  // ===========================================================================

  describe('generateUnsignedProposeAdminRole — validation', () => {
    const admin = makeAdmin()

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedProposeAdminRole(sender, {
            tokenAddress: '',
            administrator,
            routerAddress,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPProposeAdminRoleParamsInvalidError)
          assert.equal(err.code, 'PROPOSE_ADMIN_ROLE_PARAMS_INVALID')
          assert.equal(err.context.param, 'tokenAddress')
          return true
        },
      )
    })

    it('should reject empty administrator', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedProposeAdminRole(sender, {
            tokenAddress,
            administrator: '',
            routerAddress,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPProposeAdminRoleParamsInvalidError)
          assert.equal(err.context.param, 'administrator')
          return true
        },
      )
    })

    it('should reject empty routerAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedProposeAdminRole(sender, {
            tokenAddress,
            administrator,
            routerAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPProposeAdminRoleParamsInvalidError)
          assert.equal(err.context.param, 'routerAddress')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // generateUnsignedProposeAdminRole — Happy Path
  // ===========================================================================

  describe('generateUnsignedProposeAdminRole — happy path', () => {
    const admin = makeAdmin()

    it('should return UnsignedSolanaTx with correct family', async () => {
      const { unsigned } = await admin.generateUnsignedProposeAdminRole(sender, {
        tokenAddress,
        administrator,
        routerAddress,
      })

      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.instructions.length, 1)
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should build instruction with correct programId (routerAddress)', async () => {
      const { unsigned } = await admin.generateUnsignedProposeAdminRole(sender, {
        tokenAddress,
        administrator,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.programId.toBase58(), routerAddress)
    })

    it('should build instruction with 5 accounts', async () => {
      const { unsigned } = await admin.generateUnsignedProposeAdminRole(sender, {
        tokenAddress,
        administrator,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys.length, 5)
    })

    it('should have config PDA as first account (read-only)', async () => {
      const routerPubkey = new PublicKey(routerAddress)
      const [expectedConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from('config')],
        routerPubkey,
      )

      const { unsigned } = await admin.generateUnsignedProposeAdminRole(sender, {
        tokenAddress,
        administrator,
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

      const { unsigned } = await admin.generateUnsignedProposeAdminRole(sender, {
        tokenAddress,
        administrator,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys[1]!.pubkey.toBase58(), expectedTarPda.toBase58())
      assert.equal(ix.keys[1]!.isSigner, false)
      assert.equal(ix.keys[1]!.isWritable, true)
    })

    it('should have mint as third account (read-only)', async () => {
      const { unsigned } = await admin.generateUnsignedProposeAdminRole(sender, {
        tokenAddress,
        administrator,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys[2]!.pubkey.toBase58(), tokenAddress)
      assert.equal(ix.keys[2]!.isSigner, false)
      assert.equal(ix.keys[2]!.isWritable, false)
    })

    it('should have authority as fourth account (signer, writable)', async () => {
      const { unsigned } = await admin.generateUnsignedProposeAdminRole(sender, {
        tokenAddress,
        administrator,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys[3]!.pubkey.toBase58(), sender)
      assert.equal(ix.keys[3]!.isSigner, true)
      assert.equal(ix.keys[3]!.isWritable, true)
    })

    it('should include SystemProgram as fifth account', async () => {
      const { unsigned } = await admin.generateUnsignedProposeAdminRole(sender, {
        tokenAddress,
        administrator,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys[4]!.pubkey.toBase58(), SystemProgram.programId.toBase58())
    })

    it('should have 8-byte discriminator + 32-byte pubkey as instruction data', async () => {
      const { unsigned } = await admin.generateUnsignedProposeAdminRole(sender, {
        tokenAddress,
        administrator,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      // 8 bytes discriminator + 32 bytes administrator pubkey
      assert.equal(ix.data.length, 40)
    })

    it('should encode administrator pubkey in instruction data', async () => {
      const { unsigned } = await admin.generateUnsignedProposeAdminRole(sender, {
        tokenAddress,
        administrator,
        routerAddress,
      })

      const ix = unsigned.instructions[0]!
      const adminPubkeyBytes = new PublicKey(administrator).toBuffer()
      const dataAdminBytes = ix.data.subarray(8) // skip 8-byte discriminator
      assert.deepEqual(Buffer.from(dataAdminBytes), adminPubkeyBytes)
    })
  })

  // ===========================================================================
  // proposeAdminRole — Wallet Validation
  // ===========================================================================

  describe('proposeAdminRole — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.proposeAdminRole({}, { tokenAddress, administrator, routerAddress }),
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
          admin.proposeAdminRole(null, {
            tokenAddress,
            administrator,
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
          admin.proposeAdminRole(undefined, {
            tokenAddress,
            administrator,
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
