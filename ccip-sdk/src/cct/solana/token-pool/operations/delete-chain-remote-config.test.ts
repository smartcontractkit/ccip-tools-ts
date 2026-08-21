import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

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
  return SolanaTokenManager.fromChain(chain()).generateUnsignedDeleteChainRemoteConfig({
    tokenAddress: TOKEN,
    poolType: 'burn-mint',
    payer: PAYER,
    authority: AUTHORITY,
    remoteChainSelector: SELECTOR,
    ...opts,
  })
}

describe('DeleteChainRemoteConfig (cct/solana)', () => {
  describe('generate', () => {
    it('builds the delete-chain-remote-config instruction', async () => {
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
        ],
      )
      assert.ok(decoded)
      assert.equal(decoded.name, 'deleteChainConfig')
      const data = decoded.data as {
        remoteChainSelector: { toString(): string }
        mint: PublicKey
      }
      assert.equal(data.remoteChainSelector.toString(), SELECTOR.toString())
      assert.equal(data.mint.toBase58(), TOKEN)
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
    it('rejects invalid remote-chain selectors', async () => {
      for (const remoteChainSelector of [1, -1n, 1n << 64n] as const) {
        await assert.rejects(
          () => generate({ remoteChainSelector }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError && err.context.param === 'remoteChainSelector',
        )
      }
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await SolanaTokenManager.fromChain(submitChain()).deleteChainRemoteConfig({
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        remoteChainSelector: SELECTOR,
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed deletion', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(chain()).deleteChainRemoteConfig({
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            authority: AUTHORITY,
            remoteChainSelector: SELECTOR,
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deleteChainRemoteConfig' &&
          err.context.param === 'authority',
      )
    })
  })
})
