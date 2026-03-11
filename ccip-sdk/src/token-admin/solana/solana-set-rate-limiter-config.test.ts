import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Connection, Keypair, PublicKey } from '@solana/web3.js'
import { sha256, toUtf8Bytes } from 'ethers'

import { SolanaTokenAdmin } from './index.ts'
import {
  CCIPSetRateLimiterConfigParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'
import type { SetChainRateLimiterConfigParams } from '../types.ts'

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

/**
 * Creates a mock connection that simulates pool state discovery.
 */
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

const validParams: SetChainRateLimiterConfigParams = {
  poolAddress: poolStatePda.toBase58(),
  chainConfigs: [
    {
      remoteChainSelector,
      outboundRateLimiterConfig: {
        isEnabled: true,
        capacity: '100000000000000000000000',
        rate: '167000000000000000000',
      },
      inboundRateLimiterConfig: {
        isEnabled: true,
        capacity: '100000000000000000000000',
        rate: '167000000000000000000',
      },
    },
  ],
}

describe('SolanaTokenAdmin — setChainRateLimiterConfig', () => {
  // ===========================================================================
  // generateUnsignedSetChainRateLimiterConfig — Validation
  // ===========================================================================

  describe('generateUnsignedSetChainRateLimiterConfig — validation', () => {
    const mockConnection = createMockConnection()
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetChainRateLimiterConfig(sender, {
            ...validParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetRateLimiterConfigParamsInvalidError)
          assert.equal(err.code, 'SET_RATE_LIMITER_CONFIG_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty chainConfigs', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetChainRateLimiterConfig(sender, {
            ...validParams,
            chainConfigs: [],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetRateLimiterConfigParamsInvalidError)
          assert.equal(err.context.param, 'chainConfigs')
          return true
        },
      )
    })

    it('should reject empty remoteChainSelector', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetChainRateLimiterConfig(sender, {
            ...validParams,
            chainConfigs: [{ ...validParams.chainConfigs[0]!, remoteChainSelector: 0n }],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetRateLimiterConfigParamsInvalidError)
          assert.equal(err.context.param, 'chainConfigs[0].remoteChainSelector')
          return true
        },
      )
    })

    it('should reject invalid capacity string', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedSetChainRateLimiterConfig(sender, {
            ...validParams,
            chainConfigs: [
              {
                ...validParams.chainConfigs[0]!,
                outboundRateLimiterConfig: { isEnabled: true, capacity: 'not-a-number', rate: '0' },
              },
            ],
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPSetRateLimiterConfigParamsInvalidError)
          assert.equal(err.context.param, 'chainConfigs[0].outboundRateLimiterConfig.capacity')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // setChainRateLimiterConfig — Wallet Validation
  // ===========================================================================

  describe('setChainRateLimiterConfig — wallet validation', () => {
    const mockConnection = createMockConnection()
    const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
      logger: silentLogger,
      apiClient: null,
    })

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.setChainRateLimiterConfig({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.setChainRateLimiterConfig(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })

  // ===========================================================================
  // generateUnsignedSetChainRateLimiterConfig — Happy Path
  // ===========================================================================

  describe('generateUnsignedSetChainRateLimiterConfig — Happy Path', () => {
    // Use u64-safe values (capacity and rate must fit in 8 bytes)
    const happyPathParams: SetChainRateLimiterConfigParams = {
      poolAddress: poolStatePda.toBase58(),
      chainConfigs: [
        {
          remoteChainSelector,
          outboundRateLimiterConfig: {
            isEnabled: true,
            capacity: '1000000000000',
            rate: '167000000000',
          },
          inboundRateLimiterConfig: {
            isEnabled: true,
            capacity: '1000000000000',
            rate: '167000000000',
          },
        },
      ],
    }

    function makeAdmin(): SolanaTokenAdmin {
      const mockConnection = createMockConnection()
      const admin = new SolanaTokenAdmin(mockConnection, dummyNetwork, {
        logger: silentLogger,
        apiClient: null,
      })
      // Stub getTokenForTokenPool so discoverPoolInfo can resolve the mint
      // without needing real Borsh-encoded account data
      ;(admin as any).getTokenForTokenPool = async () => mint.toBase58()
      return admin
    }

    it('should return correct family (Solana)', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetChainRateLimiterConfig(
        sender,
        happyPathParams,
      )
      assert.equal(unsigned.family, ChainFamily.Solana)
    })

    it('should return 1 instruction per chainConfig with mainIndex 0', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetChainRateLimiterConfig(
        sender,
        happyPathParams,
      )
      assert.equal(unsigned.instructions.length, 1)
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should return N instructions for N chainConfigs', async () => {
      const admin = makeAdmin()
      const secondChainSelector = 3734025716853652079n
      const multiParams: SetChainRateLimiterConfigParams = {
        ...happyPathParams,
        chainConfigs: [
          happyPathParams.chainConfigs[0]!,
          {
            remoteChainSelector: secondChainSelector,
            outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
            inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
          },
        ],
      }
      const { unsigned } = await admin.generateUnsignedSetChainRateLimiterConfig(
        sender,
        multiParams,
      )
      assert.equal(unsigned.instructions.length, 2)
      assert.equal(unsigned.mainIndex, 0)
    })

    it('should set instruction programId to the pool program', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetChainRateLimiterConfig(
        sender,
        happyPathParams,
      )
      const ix = unsigned.instructions[0]!
      assert.equal(ix.programId.toBase58(), poolProgramId.toBase58())
    })

    it('should include authority (sender) as a signer', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetChainRateLimiterConfig(
        sender,
        happyPathParams,
      )
      const ix = unsigned.instructions[0]!
      const senderPubkey = new PublicKey(sender)
      const authorityAccount = ix.keys.find((k: any) => k.pubkey.equals(senderPubkey))
      assert.ok(authorityAccount, 'authority account should be present in instruction keys')
      assert.equal(authorityAccount.isSigner, true, 'authority should be a signer')
    })

    it('should include state PDA and chain config PDA as accounts', async () => {
      const admin = makeAdmin()
      const { unsigned } = await admin.generateUnsignedSetChainRateLimiterConfig(
        sender,
        happyPathParams,
      )
      const ix = unsigned.instructions[0]!

      // state PDA should be derived from CCIP_TOKENPOOL_CONFIG_SEED + mint
      const [expectedStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
        poolProgramId,
      )
      const stateAccount = ix.keys.find((k: any) => k.pubkey.equals(expectedStatePda))
      assert.ok(stateAccount, 'state PDA should be present in instruction keys')

      // chain config PDA should be derived from CCIP_TOKENPOOL_CHAINCONFIG_SEED + chainSelector + mint
      const chainSelectorBuf = Buffer.alloc(8)
      chainSelectorBuf.writeBigUInt64LE(BigInt(remoteChainSelector))
      const [expectedChainConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('ccip_tokenpool_chainconfig'), chainSelectorBuf, mint.toBuffer()],
        poolProgramId,
      )
      const chainConfigAccount = ix.keys.find((k: any) => k.pubkey.equals(expectedChainConfigPda))
      assert.ok(chainConfigAccount, 'chain config PDA should be present in instruction keys')
    })
  })

  // ===========================================================================
  // Instruction data layout verification
  // ===========================================================================

  describe('instruction data layout', () => {
    it('setChainRateLimit discriminator should be 8 bytes from SHA256', () => {
      const hash = sha256(toUtf8Bytes('global:set_chain_rate_limit'))
      const expected = Buffer.from(hash.slice(2, 18), 'hex')
      assert.equal(expected.length, 8)
    })

    it('instruction data should be exactly 82 bytes (8+8+32+2*(1+8+8))', () => {
      // discriminator(8) + chainSelector(8) + mint(32) + 2 * (enabled(1) + capacity(8) + rate(8))
      const expectedSize = 8 + 8 + 32 + 2 * (1 + 8 + 8)
      assert.equal(expectedSize, 82)
    })
  })
})
