import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Connection, Keypair, PublicKey } from '@solana/web3.js'

import { SolanaTokenAdmin } from './index.ts'
import { CCIPSetPoolParamsInvalidError, CCIPWalletInvalidError } from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Mocks ──

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

const dummyNetwork: NetworkInfo = {
  name: 'solana-devnet',
  family: ChainFamily.Solana,
  chainSelector: 1n,
  chainId: 'solana-devnet',
  networkType: NetworkType.Testnet,
}

function mockConnection() {
  return {
    getSignaturesForAddress: async () => [],
    getAccountInfo: async () => null,
    getSlot: async () => 12345,
  } as unknown as Connection
}

function makeAdmin(connection?: Connection): SolanaTokenAdmin {
  return new SolanaTokenAdmin(connection ?? mockConnection(), dummyNetwork, {
    logger: silentLogger,
    apiClient: null,
  })
}

const sender = Keypair.generate().publicKey.toBase58()
const tokenAddress = Keypair.generate().publicKey.toBase58()
const poolAddress = Keypair.generate().publicKey.toBase58()
const routerAddress = Keypair.generate().publicKey.toBase58()
const poolLookupTable = Keypair.generate().publicKey.toBase58()

const validParams = {
  tokenAddress,
  poolAddress,
  routerAddress,
  poolLookupTable,
}

// =============================================================================
// SolanaTokenAdmin — setPool
// =============================================================================

describe('SolanaTokenAdmin — setPool', () => {
  // ===========================================================================
  // Validation
  // ===========================================================================

  describe('generateUnsignedSetPool — Validation', () => {
    const admin = makeAdmin()

    it('should reject empty tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetPool(sender, {
            ...validParams,
            tokenAddress: '',
          }),
        CCIPSetPoolParamsInvalidError,
      )
    })

    it('should reject invalid tokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetPool(sender, {
            ...validParams,
            tokenAddress: 'not-a-pubkey',
          }),
        CCIPSetPoolParamsInvalidError,
      )
    })

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetPool(sender, {
            ...validParams,
            poolAddress: '',
          }),
        CCIPSetPoolParamsInvalidError,
      )
    })

    it('should reject invalid poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetPool(sender, {
            ...validParams,
            poolAddress: 'not-a-pubkey',
          }),
        CCIPSetPoolParamsInvalidError,
      )
    })

    it('should reject empty routerAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetPool(sender, {
            ...validParams,
            routerAddress: '',
          }),
        CCIPSetPoolParamsInvalidError,
      )
    })

    it('should reject invalid routerAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetPool(sender, {
            ...validParams,
            routerAddress: 'not-a-pubkey',
          }),
        CCIPSetPoolParamsInvalidError,
      )
    })

    it('should reject empty poolLookupTable', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetPool(sender, {
            ...validParams,
            poolLookupTable: '',
          }),
        CCIPSetPoolParamsInvalidError,
      )
    })

    it('should reject invalid poolLookupTable', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetPool(sender, {
            ...validParams,
            poolLookupTable: 'not-a-pubkey',
          }),
        CCIPSetPoolParamsInvalidError,
      )
    })
  })

  // ===========================================================================
  // Happy Path
  // ===========================================================================

  describe('generateUnsignedSetPool — Happy Path', () => {
    it('should return correct family (Solana)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetPool(sender, validParams)
      assert.equal(unsigned.family, ChainFamily.Solana)
    })

    it('should return 1 instruction with mainIndex 0', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetPool(sender, validParams)
      assert.equal(unsigned.instructions.length, 1)
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should have 5 accounts in correct order', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetPool(sender, validParams)
      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys.length, 5)

      const routerProgramId = new PublicKey(routerAddress)
      const mint = new PublicKey(tokenAddress)

      // Account 0: config PDA (read-only, not signer)
      const [expectedConfig] = PublicKey.findProgramAddressSync(
        [Buffer.from('config')],
        routerProgramId,
      )
      assert.equal(ix.keys[0]!.pubkey.toBase58(), expectedConfig.toBase58())
      assert.equal(ix.keys[0]!.isWritable, false)
      assert.equal(ix.keys[0]!.isSigner, false)

      // Account 1: TAR PDA (writable, not signer)
      const [expectedTar] = PublicKey.findProgramAddressSync(
        [Buffer.from('token_admin_registry'), mint.toBuffer()],
        routerProgramId,
      )
      assert.equal(ix.keys[1]!.pubkey.toBase58(), expectedTar.toBase58())
      assert.equal(ix.keys[1]!.isWritable, true)
      assert.equal(ix.keys[1]!.isSigner, false)

      // Account 2: mint (read-only)
      assert.equal(ix.keys[2]!.pubkey.toBase58(), tokenAddress)
      assert.equal(ix.keys[2]!.isWritable, false)

      // Account 3: poolLookuptable (read-only)
      assert.equal(ix.keys[3]!.pubkey.toBase58(), poolLookupTable)
      assert.equal(ix.keys[3]!.isWritable, false)

      // Account 4: authority (writable, signer)
      assert.equal(ix.keys[4]!.pubkey.toBase58(), sender)
      assert.equal(ix.keys[4]!.isWritable, true)
      assert.equal(ix.keys[4]!.isSigner, true)
    })

    it('should have instruction data containing writable indexes [3, 4, 7]', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetPool(sender, validParams)
      const ix = unsigned.instructions[0]!
      // The instruction data should contain the bytes [3, 4, 7] as the writableIndexes argument
      const data = Buffer.from(ix.data)
      // Anchor uses an 8-byte discriminator + borsh-encoded args
      // For bytes type, Borsh encodes as u32 length prefix + raw bytes
      // Skip 8-byte discriminator, then read u32 length (3), then bytes [3, 4, 7]
      const lengthOffset = 8
      const length = data.readUInt32LE(lengthOffset)
      assert.equal(length, 3, 'writableIndexes should have 3 entries')
      assert.equal(data[lengthOffset + 4], 3)
      assert.equal(data[lengthOffset + 5], 4)
      assert.equal(data[lengthOffset + 6], 7)
    })
  })

  // ===========================================================================
  // Wallet Validation
  // ===========================================================================

  describe('setPool — Wallet Validation', () => {
    it('should reject non-wallet object', async () => {
      const admin = makeAdmin()
      await assert.rejects(() => admin.setPool({}, validParams), CCIPWalletInvalidError)
    })

    it('should reject null wallet', async () => {
      const admin = makeAdmin()
      await assert.rejects(() => admin.setPool(null, validParams), CCIPWalletInvalidError)
    })

    it('should reject string wallet', async () => {
      const admin = makeAdmin()
      await assert.rejects(() => admin.setPool('not-a-wallet', validParams), CCIPWalletInvalidError)
    })
  })
})
