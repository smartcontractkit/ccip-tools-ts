import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Connection, Keypair, PublicKey } from '@solana/web3.js'
import { sha256, toUtf8Bytes } from 'ethers'

import { SolanaTokenAdmin } from './index.ts'
import {
  CCIPDeleteChainConfigParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { DeleteChainConfigParams } from '../types.ts'

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
const remoteChainSelector = 16015286601757825753n

// Derive pool state PDA
const [poolStatePda] = PublicKey.findProgramAddressSync(
  [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
  poolProgramId,
)

const validParams: DeleteChainConfigParams = {
  poolAddress: poolStatePda.toBase58(),
  remoteChainSelector,
}

// =============================================================================
// SolanaTokenAdmin — deleteChainConfig
// =============================================================================

describe('SolanaTokenAdmin — deleteChainConfig', () => {
  // ===========================================================================
  // generateUnsignedDeleteChainConfig — Validation
  // ===========================================================================

  describe('generateUnsignedDeleteChainConfig — validation', () => {
    const mockConnection = {
      getSignaturesForAddress: async () => [],
      getAccountInfo: async () => null,
    } as unknown as Connection
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeleteChainConfig(sender, {
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPDeleteChainConfigParamsInvalidError)
          assert.equal(err.code, 'DELETE_CHAIN_CONFIG_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedDeleteChainConfig(sender, {
            ...validParams,
            remoteChainSelector: 0n,
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPDeleteChainConfigParamsInvalidError)
          assert.equal(err.context.param, 'remoteChainSelector')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // deleteChainConfig — Wallet Validation
  // ===========================================================================

  describe('deleteChainConfig — wallet validation', () => {
    const mockConnection = {
      getSignaturesForAddress: async () => [],
      getAccountInfo: async () => null,
    } as unknown as Connection
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.deleteChainConfig({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.deleteChainConfig(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })

  // ===========================================================================
  // generateUnsignedDeleteChainConfig — Happy Path
  // ===========================================================================

  describe('generateUnsignedDeleteChainConfig — Happy Path', () => {
    /**
     * Build a Borsh-encoded buffer that matches the on-chain `state` account layout
     * so that `tokenPoolCoder.accounts.decode('state', data)` succeeds and returns
     * the expected mint.
     */
    function buildMockStateData(mintPubkey: PublicKey): Buffer {
      const discriminator = Buffer.from(sha256(toUtf8Bytes('account:State')).slice(2, 18), 'hex')
      const version = Buffer.from([0])
      const zeroPk = Buffer.alloc(32)
      const parts: Buffer[] = [
        discriminator,
        version,
        zeroPk, // tokenProgram
        mintPubkey.toBuffer(), // mint
        Buffer.from([9]), // decimals
        zeroPk, // poolSigner
        zeroPk, // poolTokenAccount
        zeroPk, // owner
        zeroPk, // proposedOwner
        zeroPk, // rateLimitAdmin
        zeroPk, // routerOnrampAuthority
        zeroPk, // router
        zeroPk, // rebalancer
        Buffer.from([0]), // canAcceptLiquidity
        Buffer.from([0]), // listEnabled
        Buffer.alloc(4), // allowList vec length = 0
        zeroPk, // rmnRemote
      ]
      return Buffer.concat(parts)
    }

    const stateData = buildMockStateData(mint)

    function createHappyPathConnection(): Connection {
      return {
        getSignaturesForAddress: async () => [],
        getAccountInfo: async (pubkey: PublicKey) => {
          if (pubkey.equals(poolStatePda)) {
            return {
              owner: poolProgramId,
              data: stateData,
              lamports: 1_000_000,
              executable: false,
              rentEpoch: 0,
            }
          }
          return null
        },
      } as unknown as Connection
    }

    function makeHappyAdmin(): SolanaTokenAdmin {
      return new SolanaTokenAdmin(createHappyPathConnection(), dummyNetwork, {
        logger: silentLogger,
        apiClient: null,
      })
    }

    it('should return family: ChainFamily.Solana', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedDeleteChainConfig(sender, validParams)
      assert.equal(unsigned.family, ChainFamily.Solana)
    })

    it('should return mainIndex 0', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedDeleteChainConfig(sender, validParams)
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should return 1 instruction', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedDeleteChainConfig(sender, validParams)
      assert.equal(unsigned.instructions.length, 1)
    })

    it('should have correct discriminator (sha256 of global:delete_chain_config)', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedDeleteChainConfig(sender, validParams)
      const ix = unsigned.instructions[0]!
      const expectedDisc = Buffer.from(
        sha256(toUtf8Bytes('global:delete_chain_config')).slice(2, 18),
        'hex',
      )
      const actualDisc = Buffer.from(ix.data.subarray(0, 8))
      assert.deepEqual(actualDisc, expectedDisc)
    })

    it('should have instruction programId matching poolProgramId', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedDeleteChainConfig(sender, validParams)
      const ix = unsigned.instructions[0]!
      assert.equal(ix.programId.toBase58(), poolProgramId.toBase58())
    })

    it('should have 3 accounts (state, chainConfig, authority)', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedDeleteChainConfig(sender, validParams)
      const ix = unsigned.instructions[0]!
      assert.equal(ix.keys.length, 3)

      // state — not writable, not signer
      assert.equal(ix.keys[0]!.isWritable, false)
      assert.equal(ix.keys[0]!.isSigner, false)

      // chainConfig — writable, not signer
      assert.equal(ix.keys[1]!.isWritable, true)
      assert.equal(ix.keys[1]!.isSigner, false)

      // authority — writable, signer
      assert.equal(ix.keys[2]!.isWritable, true)
      assert.equal(ix.keys[2]!.isSigner, true)
    })
  })
})
