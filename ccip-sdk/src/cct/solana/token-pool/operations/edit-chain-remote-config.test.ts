import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { tokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import {
  deriveTokenPoolChainConfigPda,
  deriveTokenPoolConfigPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const SELECTOR = 5009297550715157269n
const REMOTE_TOKEN = '0x1234567890abcdef1234567890abcdef12345678'
const REMOTE_POOLS = ['0x1234567890abcdef1234567890abcdef12345678', '0xaabbccdd']
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function chain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return {
    ...chain(),
    connection: {
      simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 1,
      }),
      sendTransaction: async () => HASH,
      confirmTransaction: async () => ({ value: { err: null } }),
    },
  } as unknown as SolanaChain
}

function generate(opts = {}) {
  return SolanaTokenManager.fromChain(chain()).generateUnsignedEditChainRemoteConfig({
    tokenAddress: TOKEN,
    poolType: 'burn-mint',
    payer: PAYER,
    authority: AUTHORITY,
    remoteChainSelector: SELECTOR,
    remoteTokenAddress: REMOTE_TOKEN,
    remotePoolAddresses: REMOTE_POOLS,
    remoteTokenDecimals: 18,
    ...opts,
  })
}

describe('EditChainRemoteConfig (cct/solana)', () => {
  describe('generate', () => {
    it('builds a padded remote-token config with remote pools', async () => {
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
      assert.equal(decoded.name, 'editChainRemoteConfig')
      const data = decoded.data as {
        remoteChainSelector: { toString(): string }
        cfg: {
          tokenAddress: { address: Buffer }
          poolAddresses: { address: Buffer }[]
          decimals: number
        }
      }
      assert.equal(data.remoteChainSelector.toString(), SELECTOR.toString())
      assert.deepEqual(
        data.cfg.tokenAddress.address,
        Buffer.from(REMOTE_TOKEN.slice(2).padStart(64, '0'), 'hex'),
      )
      assert.deepEqual(
        data.cfg.poolAddresses.map(({ address }) => address),
        REMOTE_POOLS.map((address) => Buffer.from(address.slice(2), 'hex')),
      )
      assert.equal(data.cfg.decimals, 18)
    })

    it('supports a zero remote-chain selector', async () => {
      await assert.doesNotReject(() => generate({ remoteChainSelector: 0n }))
    })

    it('uses a compatible custom pool program', async () => {
      const poolProgramAddress = Keypair.generate().publicKey.toBase58()
      const unsigned = await generate({ poolType: undefined, poolProgramAddress })

      assert.equal(unsigned.instructions[0]?.programId.toBase58(), poolProgramAddress)
    })
  })

  describe('validation', () => {
    it('rejects invalid remote configuration values', async () => {
      for (const [opts, param] of [
        [{ remoteChainSelector: 1 }, 'remoteChainSelector'],
        [{ remoteChainSelector: -1n }, 'remoteChainSelector'],
        [{ remoteChainSelector: 1n << 64n }, 'remoteChainSelector'],
        [{ remoteTokenAddress: '0x123' }, 'remoteTokenAddress'],
        [{ remotePoolAddresses: ['0x123'] }, 'remotePoolAddresses[0]'],
        [{ remotePoolAddresses: '0x12' }, 'remotePoolAddresses'],
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
      const result = await SolanaTokenManager.fromChain(submitChain()).editChainRemoteConfig({
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        remoteChainSelector: SELECTOR,
        remoteTokenAddress: REMOTE_TOKEN,
        remotePoolAddresses: REMOTE_POOLS,
        remoteTokenDecimals: 18,
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed editing', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(chain()).editChainRemoteConfig({
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            authority: AUTHORITY,
            remoteChainSelector: SELECTOR,
            remoteTokenAddress: REMOTE_TOKEN,
            remotePoolAddresses: REMOTE_POOLS,
            remoteTokenDecimals: 18,
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'editChainRemoteConfig' &&
          err.context.param === 'authority',
      )
    })
  })
})
