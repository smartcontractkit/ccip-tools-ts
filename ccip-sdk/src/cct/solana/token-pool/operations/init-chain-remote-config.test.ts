import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

// registers the EVM chain family, for the lanes whose remote is EVM
import '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { tokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import {
  deriveTokenPoolChainConfigPda,
  deriveTokenPoolConfigPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'
import { InitChainRemoteConfig } from './init-chain-remote-config.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const SELECTOR = 5009297550715157269n
const REMOTE_TOKEN = '0x1234567890abcdef1234567890abcdef12345678'
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

/** Only the canonical burn-mint pool exists for TOKEN; it is probed before lock-release. */
const POOL_CONNECTION = {
  getMultipleAccountsInfo: async () => [{}, null],
  // Holds the pool state of any overriding pool program.
  getAccountInfo: async () => ({}),
}

function chain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: { ...POOL_CONNECTION },
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return Object.assign(chain(), {
    connection: {
      ...POOL_CONNECTION,
      simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 1,
      }),
      sendTransaction: async () => HASH,
      confirmTransaction: async () => ({ value: { err: null } }),
    },
  })
}

function generate(opts = {}) {
  return new InitChainRemoteConfig().generate(chain(), {
    tokenAddress: TOKEN,
    payer: PAYER,
    authority: AUTHORITY,
    remoteChainSelector: SELECTOR,
    remoteTokenAddress: REMOTE_TOKEN,
    remoteTokenDecimals: 18,
    ...opts,
  })
}

describe('InitChainRemoteConfig (cct/solana)', () => {
  describe('generate', () => {
    it('builds a padded remote-token config with no remote pools', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions
      const poolProgram = resolveTokenPoolProgram('burn-mint')
      const decoded = tokenPoolCoder.instruction.decode(instruction!.data)

      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(instruction!.programId.toBase58(), poolProgram.toBase58())
      assert.deepEqual(
        instruction!.keys.map(({ pubkey, isSigner, isWritable }) => ({
          pubkey: pubkey.toBase58(),
          isSigner,
          isWritable,
        })),
        [
          {
            pubkey: deriveTokenPoolConfigPda(poolProgram, new PublicKey(TOKEN)).toBase58(),
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: deriveTokenPoolChainConfigPda(
              poolProgram,
              SELECTOR,
              new PublicKey(TOKEN),
            ).toBase58(),
            isSigner: false,
            isWritable: true,
          },
          { pubkey: AUTHORITY, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId.toBase58(), isSigner: false, isWritable: false },
        ],
      )
      assert.ok(decoded)
      assert.equal(decoded.name, 'initChainRemoteConfig')
      const data = decoded.data as {
        remoteChainSelector: { toString(): string }
        cfg: { tokenAddress: { address: Buffer }; poolAddresses: unknown[]; decimals: number }
      }
      assert.equal(data.remoteChainSelector.toString(), SELECTOR.toString())
      assert.deepEqual(
        data.cfg.tokenAddress.address,
        Buffer.from(REMOTE_TOKEN.slice(2).padStart(64, '0'), 'hex'),
      )
      assert.deepEqual(data.cfg.poolAddresses, [])
      assert.equal(data.cfg.decimals, 18)
    })

    it('stores an EVM remote token given padded to 32 bytes the same as unpadded', async () => {
      const unsigned = await generate({
        remoteTokenAddress: '0x' + '00'.repeat(12) + REMOTE_TOKEN.slice(2),
      })
      const decoded = tokenPoolCoder.instruction.decode(unsigned.instructions[0]!.data)
      const { cfg } = decoded!.data as { cfg: { tokenAddress: { address: Buffer } } }
      assert.deepEqual(
        cfg.tokenAddress.address,
        Buffer.from(REMOTE_TOKEN.slice(2).padStart(64, '0'), 'hex'),
      )
    })

    it('rejects a zero remote-chain selector, whose address format is unknown', async () => {
      await assert.rejects(
        () => generate({ remoteChainSelector: 0n }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'remoteTokenAddress',
      )
    })

    it('uses a compatible custom pool program', async () => {
      const poolProgramAddress = Keypair.generate().publicKey.toBase58()
      const unsigned = await generate({ poolProgramAddress })

      assert.equal(unsigned.instructions[0]?.programId.toBase58(), poolProgramAddress)
    })
  })

  describe('validation', () => {
    it('rejects invalid remote configuration values', async () => {
      for (const [opts, param] of [
        [{ remoteChainSelector: 1 }, 'remoteChainSelector'],
        [{ remoteChainSelector: -1n }, 'remoteChainSelector'],
        [{ remoteChainSelector: 1n << 64n }, 'remoteChainSelector'],
        [{ remoteTokenAddress: '' }, 'remoteTokenAddress'],
        [{ remoteTokenAddress: '0x' }, 'remoteTokenAddress'],
        [{ remoteTokenAddress: '0xzz' }, 'remoteTokenAddress'],
        // a Solana address on an EVM lane
        [{ remoteTokenAddress: TOKEN }, 'remoteTokenAddress'],
        [{ remoteTokenAddress: null }, 'remoteTokenAddress'],
        [{ remoteTokenDecimals: 256 }, 'remoteTokenDecimals'],
      ] as const) {
        await assert.rejects(
          () => generate(opts),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await new InitChainRemoteConfig().execute(submitChain(), {
        tokenAddress: TOKEN,
        remoteChainSelector: SELECTOR,
        remoteTokenAddress: REMOTE_TOKEN,
        remoteTokenDecimals: 18,
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed initialization', async () => {
      await assert.rejects(
        () =>
          new InitChainRemoteConfig().execute(chain(), {
            tokenAddress: TOKEN,
            authority: AUTHORITY,
            remoteChainSelector: SELECTOR,
            remoteTokenAddress: REMOTE_TOKEN,
            remoteTokenDecimals: 18,
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'initChainRemoteConfig' &&
          err.context.param === 'authority',
      )
    })
  })
})
