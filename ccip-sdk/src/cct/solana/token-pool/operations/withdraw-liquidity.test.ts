import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { AccountLayout, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { lockReleaseTokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import {
  deriveTokenPoolConfigPda,
  deriveTokenPoolSignerPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'
import { WithdrawLiquidity } from './withdraw-liquidity.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function tokenAccount(owner: PublicKey, amount = 1_000_000n) {
  const data = Buffer.alloc(AccountLayout.span)
  AccountLayout.encode(
    {
      mint: new PublicKey(TOKEN),
      owner,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  )
  return { owner: TOKEN_PROGRAM_ID, data }
}

function poolState(poolProgram: PublicKey, rebalancer = new PublicKey(AUTHORITY), accepts = true) {
  const mint = new PublicKey(TOKEN)
  const poolSigner = deriveTokenPoolSignerPda(poolProgram, mint)
  return Buffer.concat([
    BorshAccountsCoder.accountDiscriminator('State'),
    Buffer.from([1]),
    TOKEN_PROGRAM_ID.toBuffer(),
    mint.toBuffer(),
    Buffer.from([9]),
    poolSigner.toBuffer(),
    PublicKey.default.toBuffer(),
    new PublicKey(AUTHORITY).toBuffer(),
    PublicKey.default.toBuffer(),
    PublicKey.default.toBuffer(),
    PublicKey.default.toBuffer(),
    PublicKey.default.toBuffer(),
    rebalancer.toBuffer(),
    Buffer.from([accepts ? 1 : 0, 0]),
    Buffer.alloc(4),
    PublicKey.default.toBuffer(),
  ])
}

function chain(
  poolProgram = resolveTokenPoolProgram('lock-release'),
  rebalancer = new PublicKey(AUTHORITY),
  acceptsLiquidity = true,
  poolBalance = 1_000_000n,
): SolanaChain {
  const mint = new PublicKey(TOKEN)
  const state = deriveTokenPoolConfigPda(poolProgram, mint)
  const poolSigner = deriveTokenPoolSignerPda(poolProgram, mint)
  const poolTokenAccount = getAssociatedTokenAddressSync(mint, poolSigner, true)
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async (address: PublicKey) =>
        address.equals(state)
          ? { owner: poolProgram, data: poolState(poolProgram, rebalancer, acceptsLiquidity) }
          : address.equals(poolTokenAccount)
            ? tokenAccount(poolSigner, poolBalance)
            : tokenAccount(rebalancer),
    },
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  const poolProgram = resolveTokenPoolProgram('lock-release')
  const mint = new PublicKey(TOKEN)
  const state = deriveTokenPoolConfigPda(poolProgram, mint)
  const poolSigner = deriveTokenPoolSignerPda(poolProgram, mint)
  const poolTokenAccount = getAssociatedTokenAddressSync(mint, poolSigner, true)
  return Object.assign(chain(), {
    connection: {
      getAccountInfo: async (address: PublicKey) =>
        address.equals(state)
          ? { owner: poolProgram, data: poolState(poolProgram, WALLET.publicKey) }
          : address.equals(poolTokenAccount)
            ? tokenAccount(poolSigner)
            : tokenAccount(WALLET.publicKey),
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
  return new WithdrawLiquidity().generate(chain(), {
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

    it('explains failed liquidity preflight checks', async () => {
      for (const [pool, hint] of [
        [chain(resolveTokenPoolProgram('lock-release'), PublicKey.default), 'setRebalancer'],
        [
          chain(resolveTokenPoolProgram('lock-release'), new PublicKey(AUTHORITY), false),
          'setCanAcceptLiquidity(true)',
        ],
        [
          chain(resolveTokenPoolProgram('lock-release'), new PublicKey(AUTHORITY), true, 0n),
          'pool token account',
        ],
      ] as const) {
        await assert.rejects(
          () =>
            new WithdrawLiquidity().generate(pool, {
              tokenAddress: TOKEN,
              poolType: 'lock-release',
              payer: PAYER,
              authority: AUTHORITY,
              amount: 1n,
            }),
          (error: unknown) => error instanceof CCTTxFailedError && error.message.includes(hint),
        )
      }
    })

    it('defaults authority to payer', async () => {
      const unsigned = await new WithdrawLiquidity().generate(
        chain(resolveTokenPoolProgram('lock-release'), new PublicKey(PAYER)),
        {
          tokenAddress: TOKEN,
          poolType: 'lock-release',
          payer: PAYER,
          amount: 1_000_000n,
        },
      )

      assert.equal(unsigned.instructions[0]!.keys[6]!.pubkey.toBase58(), PAYER)
    })

    it('supports a compatible custom pool program', async () => {
      const poolProgramAddress = Keypair.generate().publicKey.toBase58()
      const unsigned = await new WithdrawLiquidity().generate(
        chain(new PublicKey(poolProgramAddress)),
        {
          tokenAddress: TOKEN,
          poolProgramAddress,
          payer: PAYER,
          authority: AUTHORITY,
          amount: 1_000_000n,
        },
      )

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
      const result = await new WithdrawLiquidity().execute(submitChain(), {
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
          new WithdrawLiquidity().execute(chain(), {
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
