import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { lockReleaseTokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import {
  deriveTokenPoolConfigPda,
  deriveTokenPoolSignerPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function chain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: { getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }) },
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return {
    ...chain(),
    connection: {
      getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }),
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
  return SolanaTokenManager.fromChain(chain()).generateUnsignedWithdrawLiquidity({
    tokenAddress: TOKEN,
    poolType: 'lock-release',
    payer: PAYER,
    authority: AUTHORITY,
    amount: 1_000_000n,
    ...opts,
  })
}

describe('WithdrawLiquidity (cct/solana)', () => {
  describe('generate', () => {
    it('builds the lock-release pool liquidity instruction', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions
      const poolProgram = resolveTokenPoolProgram('lock-release')
      const token = new PublicKey(TOKEN)
      const poolSigner = deriveTokenPoolSignerPda(poolProgram, token)

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
            pubkey: deriveTokenPoolConfigPda(poolProgram, token).toBase58(),
            isSigner: false,
            isWritable: false,
          },
          { pubkey: TOKEN_PROGRAM_ID.toBase58(), isSigner: false, isWritable: false },
          { pubkey: TOKEN, isSigner: false, isWritable: true },
          { pubkey: poolSigner.toBase58(), isSigner: false, isWritable: false },
          {
            pubkey: getAssociatedTokenAddressSync(token, poolSigner, true).toBase58(),
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: getAssociatedTokenAddressSync(token, new PublicKey(AUTHORITY), true).toBase58(),
            isSigner: false,
            isWritable: true,
          },
          { pubkey: AUTHORITY, isSigner: true, isWritable: false },
        ],
      )
      const decoded = lockReleaseTokenPoolCoder.instruction.decode(instruction!.data)
      assert.ok(decoded)
      assert.equal(decoded.name, 'withdrawLiquidity')
      assert.equal(
        (decoded.data as { amount: { toString(): string } }).amount.toString(),
        '1000000',
      )
    })

    it('defaults authority to payer', async () => {
      const unsigned = await generate({ authority: undefined })

      assert.equal(unsigned.instructions[0]!.keys[6]!.pubkey.toBase58(), PAYER)
    })

    it('supports a compatible custom pool program', async () => {
      const poolProgramAddress = Keypair.generate().publicKey.toBase58()
      const unsigned = await generate({ poolType: undefined, poolProgramAddress })

      assert.equal(unsigned.instructions[0]?.programId.toBase58(), poolProgramAddress)
    })
  })

  describe('validation', () => {
    it('rejects invalid public keys, amounts, and burn-mint pools', async () => {
      for (const [opts, param] of [
        [{ tokenAddress: 'invalid' }, 'tokenAddress'],
        [{ authority: 'invalid' }, 'authority'],
        [{ amount: 0n }, 'amount'],
        [{ amount: 0x1_0000_0000_0000_0000n }, 'amount'],
        [{ poolType: 'burn-mint' as const }, 'poolType'],
        [
          {
            poolType: undefined,
            poolProgramAddress: resolveTokenPoolProgram('burn-mint').toBase58(),
          },
          'poolProgramAddress',
        ],
      ]) {
        await assert.rejects(
          () => generate(opts),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await SolanaTokenManager.fromChain(submitChain()).withdrawLiquidity({
        tokenAddress: TOKEN,
        poolType: 'lock-release',
        amount: 1_000_000n,
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed liquidity withdrawal', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(chain()).withdrawLiquidity({
            tokenAddress: TOKEN,
            poolType: 'lock-release',
            amount: 1_000_000n,
            authority: AUTHORITY,
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'withdrawLiquidity' &&
          err.context.param === 'authority',
      )
    })
  })
})
