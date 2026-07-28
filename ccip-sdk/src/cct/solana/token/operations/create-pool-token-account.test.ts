import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { deriveTokenPoolSignerPda } from '../../programs/token-pool.ts'
import { CreatePoolTokenAccount } from './create-pool-token-account.ts'

const MINT = Keypair.generate().publicKey
const POOL_PROGRAM = Keypair.generate().publicKey
const POOL_STATE = Keypair.generate().publicKey
const PAYER = Keypair.generate().publicKey.toBase58()

function stubChain(mintOwner: PublicKey = TOKEN_PROGRAM_ID): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async (key: PublicKey) => {
        if (key.equals(POOL_STATE)) return { owner: POOL_PROGRAM }
        if (key.equals(MINT)) return { owner: mintOwner }
        return null
      },
    },
  } as unknown as SolanaChain
}

function noRpcChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: { getAccountInfo: () => assert.fail('should not RPC before validation') },
  } as unknown as SolanaChain
}

describe('Solana token createPoolTokenAccount', () => {
  it('matches createAssociatedTokenAccountIdempotentInstruction for the pool signer PDA', async () => {
    const unsigned = await new CreatePoolTokenAccount().generate(stubChain(), {
      payer: PAYER,
      tokenAddress: MINT.toBase58(),
      poolAddress: POOL_STATE.toBase58(),
    })

    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(unsigned.instructions.length, 1)

    const poolSignerPda = deriveTokenPoolSignerPda(POOL_PROGRAM, MINT)
    const poolTokenAta = getAssociatedTokenAddressSync(MINT, poolSignerPda, true, TOKEN_PROGRAM_ID)

    assert.equal(unsigned.poolSignerPda, poolSignerPda.toBase58())
    assert.equal(unsigned.poolTokenAccount, poolTokenAta.toBase58())

    const ref = createAssociatedTokenAccountIdempotentInstruction(
      new PublicKey(PAYER),
      poolTokenAta,
      poolSignerPda,
      MINT,
      TOKEN_PROGRAM_ID,
    )
    assert.equal(unsigned.instructions[0]!.programId.toBase58(), ref.programId.toBase58())
    assert.equal(unsigned.instructions[0]!.data.toString('hex'), ref.data.toString('hex'))
    assert.deepEqual(
      unsigned.instructions[0]!.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
      ref.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    )
  })

  it('derives the Token-2022 ATA when the mint is owned by Token-2022', async () => {
    const unsigned = await new CreatePoolTokenAccount().generate(stubChain(TOKEN_2022_PROGRAM_ID), {
      payer: PAYER,
      tokenAddress: MINT.toBase58(),
      poolAddress: POOL_STATE.toBase58(),
    })
    const poolSignerPda = deriveTokenPoolSignerPda(POOL_PROGRAM, MINT)
    const ata = getAssociatedTokenAddressSync(MINT, poolSignerPda, true, TOKEN_2022_PROGRAM_ID)
    assert.equal(unsigned.poolTokenAccount, ata.toBase58())
  })

  it('rejects an invalid poolAddress before any RPC', async () => {
    await assert.rejects(
      () =>
        new CreatePoolTokenAccount().generate(noRpcChain(), {
          payer: PAYER,
          tokenAddress: MINT.toBase58(),
          poolAddress: 'not-a-key',
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects when the pool state account is missing on-chain', async () => {
    const chain = {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      connection: { getAccountInfo: async () => null },
    } as unknown as SolanaChain
    await assert.rejects(
      () =>
        new CreatePoolTokenAccount().generate(chain, {
          payer: PAYER,
          tokenAddress: MINT.toBase58(),
          poolAddress: POOL_STATE.toBase58(),
        }),
      CCTParamsInvalidError,
    )
  })
})
