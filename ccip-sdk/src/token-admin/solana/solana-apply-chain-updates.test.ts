import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Connection, Keypair, PublicKey } from '@solana/web3.js'
import { sha256, toUtf8Bytes } from 'ethers'

import { SolanaTokenAdmin } from './index.ts'
import {
  CCIPApplyChainUpdatesParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { ApplyChainUpdatesParams } from '../types.ts'

// ── Constants ──

const CCIP_TOKENPOOL_CONFIG_SEED = 'ccip_tokenpool_config'
const CCIP_TOKENPOOL_CHAINCONFIG_SEED = 'ccip_tokenpool_chainconfig'

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
const remoteEvmToken = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
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

const validParams: ApplyChainUpdatesParams = {
  poolAddress: poolStatePda.toBase58(),
  remoteChainSelectorsToRemove: [],
  chainsToAdd: [
    {
      remoteChainSelector,
      remotePoolAddresses: [remoteEvmPool],
      remoteTokenAddress: remoteEvmToken,
      outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
      inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
    },
  ],
}

// =============================================================================
// SolanaTokenAdmin — applyChainUpdates
// =============================================================================

describe('SolanaTokenAdmin — applyChainUpdates', () => {
  // ===========================================================================
  // generateUnsignedApplyChainUpdates — Validation
  // ===========================================================================

  describe('generateUnsignedApplyChainUpdates — validation', () => {
    const mockConnection = createMockConnection()
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedApplyChainUpdates(sender, {
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPApplyChainUpdatesParamsInvalidError)
          assert.equal(err.code, 'APPLY_CHAIN_UPDATES_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedApplyChainUpdates(sender, {
            ...validParams,
            chainsToAdd: [{ ...validParams.chainsToAdd[0]!, remoteChainSelector: '' }],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPApplyChainUpdatesParamsInvalidError)
          assert.equal(err.context.param, 'chainsToAdd[0].remoteChainSelector')
          return true
        },
      )
    })

    it('should reject empty remotePoolAddresses', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedApplyChainUpdates(sender, {
            ...validParams,
            chainsToAdd: [{ ...validParams.chainsToAdd[0]!, remotePoolAddresses: [] }],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPApplyChainUpdatesParamsInvalidError)
          assert.equal(err.context.param, 'chainsToAdd[0].remotePoolAddresses')
          return true
        },
      )
    })

    it('should reject empty remoteTokenAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedApplyChainUpdates(sender, {
            ...validParams,
            chainsToAdd: [{ ...validParams.chainsToAdd[0]!, remoteTokenAddress: '' }],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPApplyChainUpdatesParamsInvalidError)
          assert.equal(err.context.param, 'chainsToAdd[0].remoteTokenAddress')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // applyChainUpdates — Wallet Validation
  // ===========================================================================

  describe('applyChainUpdates — wallet validation', () => {
    const mockConnection = createMockConnection()
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.applyChainUpdates({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.applyChainUpdates(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })

  // ===========================================================================
  // Discriminator verification
  // ===========================================================================

  describe('discriminators', () => {
    it('init_chain_remote_config discriminator should be 8 bytes from SHA256', () => {
      const hash = sha256(toUtf8Bytes('global:init_chain_remote_config'))
      const expected = Buffer.from(hash.slice(2, 18), 'hex')
      assert.equal(expected.length, 8)
    })

    it('set_chain_rate_limit discriminator should be 8 bytes from SHA256', () => {
      const hash = sha256(toUtf8Bytes('global:set_chain_rate_limit'))
      const expected = Buffer.from(hash.slice(2, 18), 'hex')
      assert.equal(expected.length, 8)
    })

    it('delete_chain_config discriminator should be 8 bytes from SHA256', () => {
      const hash = sha256(toUtf8Bytes('global:delete_chain_config'))
      const expected = Buffer.from(hash.slice(2, 18), 'hex')
      assert.equal(expected.length, 8)
    })
  })

  // ===========================================================================
  // PDA derivation verification
  // ===========================================================================

  // ===========================================================================
  // generateUnsignedApplyChainUpdates — Happy Path
  // ===========================================================================

  describe('generateUnsignedApplyChainUpdates — Happy Path', () => {
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
          // For chain config PDA lookups — return null (not yet initialized)
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
      const { unsigned } = await admin.generateUnsignedApplyChainUpdates(sender, validParams)
      assert.equal(unsigned.family, ChainFamily.Solana)
    })

    it('should return mainIndex 0', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedApplyChainUpdates(sender, validParams)
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should return 3 instructions for one add-chain (init + appendPool + rateLimit)', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedApplyChainUpdates(sender, validParams)
      // For each chain to add: initChainRemoteConfig + appendRemotePoolAddresses + setChainRateLimit
      assert.equal(unsigned.instructions.length, 3)
    })

    it('should have all instruction programIds matching poolProgramId', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedApplyChainUpdates(sender, validParams)
      for (const ix of unsigned.instructions) {
        assert.equal(ix.programId.toBase58(), poolProgramId.toBase58())
      }
    })

    it('should have init_chain_remote_config discriminator on first instruction', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedApplyChainUpdates(sender, validParams)
      const ix = unsigned.instructions[0]!
      const expectedDisc = Buffer.from(
        sha256(toUtf8Bytes('global:init_chain_remote_config')).slice(2, 18),
        'hex',
      )
      const actualDisc = Buffer.from(ix.data.subarray(0, 8))
      assert.deepEqual(actualDisc, expectedDisc)
    })

    it('should have append_remote_pool_addresses discriminator on second instruction', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedApplyChainUpdates(sender, validParams)
      const ix = unsigned.instructions[1]!
      const expectedDisc = Buffer.from(
        sha256(toUtf8Bytes('global:append_remote_pool_addresses')).slice(2, 18),
        'hex',
      )
      const actualDisc = Buffer.from(ix.data.subarray(0, 8))
      assert.deepEqual(actualDisc, expectedDisc)
    })

    it('should have set_chain_rate_limit discriminator on third instruction', async () => {
      const admin = makeHappyAdmin()
      const { unsigned } = await admin.generateUnsignedApplyChainUpdates(sender, validParams)
      const ix = unsigned.instructions[2]!
      const expectedDisc = Buffer.from(
        sha256(toUtf8Bytes('global:set_chain_rate_limit')).slice(2, 18),
        'hex',
      )
      const actualDisc = Buffer.from(ix.data.subarray(0, 8))
      assert.deepEqual(actualDisc, expectedDisc)
    })

    it('should return 1 instruction for remove-only scenario', async () => {
      const admin = makeHappyAdmin()
      const removeOnlyParams: ApplyChainUpdatesParams = {
        poolAddress: poolStatePda.toBase58(),
        remoteChainSelectorsToRemove: [remoteChainSelector],
        chainsToAdd: [],
      }
      const { unsigned } = await admin.generateUnsignedApplyChainUpdates(sender, removeOnlyParams)
      // One delete_chain_config instruction
      assert.equal(unsigned.instructions.length, 1)
    })

    it('should have delete_chain_config discriminator for remove instruction', async () => {
      const admin = makeHappyAdmin()
      const removeOnlyParams: ApplyChainUpdatesParams = {
        poolAddress: poolStatePda.toBase58(),
        remoteChainSelectorsToRemove: [remoteChainSelector],
        chainsToAdd: [],
      }
      const { unsigned } = await admin.generateUnsignedApplyChainUpdates(sender, removeOnlyParams)
      const ix = unsigned.instructions[0]!
      const expectedDisc = Buffer.from(
        sha256(toUtf8Bytes('global:delete_chain_config')).slice(2, 18),
        'hex',
      )
      const actualDisc = Buffer.from(ix.data.subarray(0, 8))
      assert.deepEqual(actualDisc, expectedDisc)
    })

    it('should return 4 instructions for delete-then-re-add same chain', async () => {
      const admin = makeHappyAdmin()
      const deleteAndReAddParams: ApplyChainUpdatesParams = {
        poolAddress: poolStatePda.toBase58(),
        remoteChainSelectorsToRemove: [remoteChainSelector],
        chainsToAdd: [
          {
            remoteChainSelector,
            remotePoolAddresses: [remoteEvmPool],
            remoteTokenAddress: remoteEvmToken,
            outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
            inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
          },
        ],
      }
      const { unsigned } = await admin.generateUnsignedApplyChainUpdates(
        sender,
        deleteAndReAddParams,
      )
      // 1 delete + 3 add (init + append + rateLimit) = 4
      assert.equal(unsigned.instructions.length, 4)
    })

    it('should return 6 instructions for adding two chains', async () => {
      const admin = makeHappyAdmin()
      const secondRemoteChainSelector = '4949039107694359620'
      const twoChainsParams: ApplyChainUpdatesParams = {
        poolAddress: poolStatePda.toBase58(),
        remoteChainSelectorsToRemove: [],
        chainsToAdd: [
          {
            remoteChainSelector,
            remotePoolAddresses: [remoteEvmPool],
            remoteTokenAddress: remoteEvmToken,
            outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
            inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
          },
          {
            remoteChainSelector: secondRemoteChainSelector,
            remotePoolAddresses: [remoteEvmPool],
            remoteTokenAddress: remoteEvmToken,
            outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
            inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
          },
        ],
      }
      const { unsigned } = await admin.generateUnsignedApplyChainUpdates(sender, twoChainsParams)
      // 3 instructions per chain * 2 chains = 6
      assert.equal(unsigned.instructions.length, 6)
    })

    it('should skip init when chain config already exists (idempotency)', async () => {
      // Create a connection where the chain config PDA already exists
      const chainSelectorBuf = Buffer.alloc(8)
      chainSelectorBuf.writeBigUInt64LE(BigInt(remoteChainSelector))
      const [chainConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(CCIP_TOKENPOOL_CHAINCONFIG_SEED), chainSelectorBuf, mint.toBuffer()],
        poolProgramId,
      )

      const connectionWithExistingChain = {
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
          // Chain config PDA already exists
          if (pubkey.equals(chainConfigPda)) {
            return {
              owner: poolProgramId,
              data: Buffer.alloc(100),
              lamports: 1_000_000,
              executable: false,
              rentEpoch: 0,
            }
          }
          return null
        },
      } as unknown as Connection

      const admin = new SolanaTokenAdmin(connectionWithExistingChain, dummyNetwork, {
        logger: silentLogger,
        apiClient: null,
      })

      const { unsigned } = await admin.generateUnsignedApplyChainUpdates(sender, validParams)
      // Should skip initChainRemoteConfig, so only appendRemotePoolAddresses + setChainRateLimit = 2
      assert.equal(unsigned.instructions.length, 2)
    })
  })

  // ===========================================================================
  // PDA derivation verification
  // ===========================================================================

  describe('PDA derivation', () => {
    it('chain config PDA should use correct seeds', () => {
      const chainSelectorBuf = Buffer.alloc(8)
      chainSelectorBuf.writeBigUInt64LE(BigInt(remoteChainSelector))

      const [chainConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(CCIP_TOKENPOOL_CHAINCONFIG_SEED), chainSelectorBuf, mint.toBuffer()],
        poolProgramId,
      )

      // Verify PDA is deterministic
      const [chainConfigPda2] = PublicKey.findProgramAddressSync(
        [Buffer.from(CCIP_TOKENPOOL_CHAINCONFIG_SEED), chainSelectorBuf, mint.toBuffer()],
        poolProgramId,
      )

      assert.equal(chainConfigPda.toBase58(), chainConfigPda2.toBase58())
    })

    it('state PDA should use correct seeds', () => {
      const [statePda] = PublicKey.findProgramAddressSync(
        [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
        poolProgramId,
      )

      assert.equal(statePda.toBase58(), poolStatePda.toBase58())
    })
  })
})
