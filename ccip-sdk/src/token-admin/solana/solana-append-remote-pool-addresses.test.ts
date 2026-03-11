import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Connection, Keypair, PublicKey } from '@solana/web3.js'
import { sha256, toUtf8Bytes } from 'ethers'

import { SolanaTokenAdmin } from './index.ts'
import {
  CCIPAppendRemotePoolAddressesParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { AppendRemotePoolAddressesParams } from '../types.ts'

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
const remoteEvmPool = '0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD'
const remoteChainSelector = '16015286601757825753'

// Derive pool state PDA
const [poolStatePda] = PublicKey.findProgramAddressSync(
  [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
  poolProgramId,
)

/**
 * Creates a mock connection that simulates pool state discovery.
 * Returns account info with the correct owner (poolProgramId) and
 * makes getTokenForTokenPool return the mint.
 */
function createMockConnection(): Connection {
  return {
    getSignaturesForAddress: async () => [],
    getAccountInfo: async (pubkey: PublicKey) => {
      // Return mock pool state account with correct owner
      if (pubkey.equals(poolStatePda)) {
        return {
          owner: poolProgramId,
          data: Buffer.alloc(0), // Will be decoded by getTokenForTokenPool
          lamports: 0,
          executable: false,
          rentEpoch: 0,
        }
      }
      return null
    },
  } as unknown as Connection
}

const validParams: AppendRemotePoolAddressesParams = {
  poolAddress: poolStatePda.toBase58(),
  remoteChainSelector,
  remotePoolAddresses: [remoteEvmPool],
}

// =============================================================================
// SolanaTokenAdmin — appendRemotePoolAddresses
// =============================================================================

describe('SolanaTokenAdmin — appendRemotePoolAddresses', () => {
  // ===========================================================================
  // generateUnsignedAppendRemotePoolAddresses — Validation
  // ===========================================================================

  describe('generateUnsignedAppendRemotePoolAddresses — validation', () => {
    const mockConnection = createMockConnection()
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAppendRemotePoolAddresses(sender, {
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAppendRemotePoolAddressesParamsInvalidError)
          assert.equal(err.code, 'APPEND_REMOTE_POOL_ADDRESSES_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAppendRemotePoolAddresses(sender, {
            ...validParams,
            remoteChainSelector: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAppendRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remoteChainSelector')
          return true
        },
      )
    })

    it('should reject empty remotePoolAddresses', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAppendRemotePoolAddresses(sender, {
            ...validParams,
            remotePoolAddresses: [],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAppendRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remotePoolAddresses')
          return true
        },
      )
    })

    it('should reject empty address in remotePoolAddresses array', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAppendRemotePoolAddresses(sender, {
            ...validParams,
            remotePoolAddresses: [''],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAppendRemotePoolAddressesParamsInvalidError)
          assert.equal(err.context.param, 'remotePoolAddresses[0]')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // appendRemotePoolAddresses — Wallet Validation
  // ===========================================================================

  describe('appendRemotePoolAddresses — wallet validation', () => {
    const mockConnection = createMockConnection()
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.appendRemotePoolAddresses({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.appendRemotePoolAddresses(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })

  // ===========================================================================
  // generateUnsignedAppendRemotePoolAddresses — Happy Path
  // ===========================================================================

  describe('generateUnsignedAppendRemotePoolAddresses — Happy Path', () => {
    /**
     * Build a Borsh-encoded buffer that matches the on-chain `state` account layout
     * so that `tokenPoolCoder.accounts.decode('state', data)` succeeds and returns
     * the expected mint.
     *
     * Layout:
     *   8 bytes  — Anchor account discriminator: sha256("account:State")[0..8]
     *   1 byte   — version (u8)
     *   BaseConfig struct (all public-keys are 32-byte LE):
     *     tokenProgram, mint, decimals(u8), poolSigner, poolTokenAccount,
     *     owner, proposedOwner, rateLimitAdmin, routerOnrampAuthority,
     *     router, rebalancer, canAcceptLiquidity(bool), listEnabled(bool),
     *     allowList(vec<pubkey>: u32 len + items), rmnRemote
     */
    function buildMockStateData(mintPubkey: PublicKey): Buffer {
      const discriminator = Buffer.from(sha256(toUtf8Bytes('account:State')).slice(2, 18), 'hex')
      // version
      const version = Buffer.from([0])

      // BaseConfig fields — use zero-pubkeys for all except mint
      const zeroPk = Buffer.alloc(32)
      const parts: Buffer[] = [
        discriminator, // 8
        version, // 1
        zeroPk, // tokenProgram
        mintPubkey.toBuffer(), // mint — this is what getTokenForTokenPool reads
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
        Buffer.alloc(4), // allowList vec length = 0 (u32 LE)
        zeroPk, // rmnRemote
      ]
      return Buffer.concat(parts)
    }

    const stateData = buildMockStateData(mint)

    /**
     * Creates a mock connection with properly encoded pool state so
     * discoverPoolInfo + getTokenForTokenPool can succeed.
     */
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
      const { unsigned } = await admin.generateUnsignedAppendRemotePoolAddresses(
        sender,
        validParams,
      )
      assert.equal(unsigned.family, ChainFamily.Solana)
    })

    it('should return mainIndex 0', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedAppendRemotePoolAddresses(
        sender,
        validParams,
      )
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should return 1 instruction (single appendRemotePoolAddresses)', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedAppendRemotePoolAddresses(
        sender,
        validParams,
      )
      assert.equal(unsigned.instructions.length, 1)
    })

    it('should have correct discriminator (sha256 of global:append_remote_pool_addresses)', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedAppendRemotePoolAddresses(
        sender,
        validParams,
      )
      const ix = unsigned.instructions[0]!
      const expectedDisc = Buffer.from(
        sha256(toUtf8Bytes('global:append_remote_pool_addresses')).slice(2, 18),
        'hex',
      )
      const actualDisc = Buffer.from(ix.data.subarray(0, 8))
      assert.deepEqual(actualDisc, expectedDisc)
    })

    it('should have all instruction programIds matching poolProgramId', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedAppendRemotePoolAddresses(
        sender,
        validParams,
      )
      for (const ix of unsigned.instructions) {
        assert.equal(ix.programId.toBase58(), poolProgramId.toBase58())
      }
    })

    it('should return 1 instruction even for multiple addresses (single ix with all)', async () => {
      const admin = makeHappyAdmin()
      const secondRemotePool = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
      const multiParams: AppendRemotePoolAddressesParams = {
        poolAddress: poolStatePda.toBase58(),
        remoteChainSelector,
        remotePoolAddresses: [remoteEvmPool, secondRemotePool],
      }
      const { unsigned } = await admin.generateUnsignedAppendRemotePoolAddresses(
        sender,
        multiParams,
      )
      assert.equal(unsigned.instructions.length, 1)
    })
  })
})
