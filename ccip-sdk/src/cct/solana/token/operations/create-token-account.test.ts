import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { type PublicKey, Keypair } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'

const PAYER = Keypair.generate().publicKey.toBase58()
const MINT = Keypair.generate().publicKey
const OWNER = Keypair.generate().publicKey

function stubChain(mintOwner: PublicKey | null = TOKEN_2022_PROGRAM_ID): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async () => (mintOwner ? { owner: mintOwner } : null),
    },
  } as unknown as SolanaChain
}

function generate(opts = {}, mintOwner?: PublicKey | null) {
  return SolanaTokenManager.fromChain(stubChain(mintOwner)).generateUnsignedCreateTokenAccount({
    payer: PAYER,
    tokenAddress: MINT.toBase58(),
    ownerAddress: OWNER.toBase58(),
    ...opts,
  })
}

describe('Solana token createTokenAccount', () => {
  it('builds an idempotent ATA create instruction for any owner', async () => {
    const unsigned = await generate()
    const [ix] = unsigned.instructions
    const ata = getAssociatedTokenAddressSync(MINT, OWNER, true, TOKEN_2022_PROGRAM_ID)

    assert.ok(ix)
    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(unsigned.tokenAccountAddress, ata.toBase58())
    assert.equal(ix.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58())
    assert.equal(ix.data.length, 1)
    assert.equal(ix.data[0], 1) // CreateIdempotent
    assert.equal(ix.keys[0]!.pubkey.toBase58(), PAYER)
    assert.equal(ix.keys[1]!.pubkey.toBase58(), ata.toBase58())
    assert.equal(ix.keys[2]!.pubkey.toBase58(), OWNER.toBase58())
    assert.equal(ix.keys[3]!.pubkey.toBase58(), MINT.toBase58())
    assert.equal(ix.keys.at(-1)!.pubkey.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58())
  })

  it('builds for legacy SPL Token mints', async () => {
    const unsigned = await generate({}, TOKEN_PROGRAM_ID)
    const ata = getAssociatedTokenAddressSync(MINT, OWNER, true, TOKEN_PROGRAM_ID)

    assert.equal(unsigned.tokenAccountAddress, ata.toBase58())
    assert.equal(
      unsigned.instructions[0]!.keys.at(-1)!.pubkey.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
    )
  })

  it('rejects a missing mint', async () => {
    await assert.rejects(
      () => generate({}, null),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.param === 'tokenAddress',
    )
  })

  it('rejects non-token mint accounts', async () => {
    await assert.rejects(
      () => generate({}, Keypair.generate().publicKey),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.param === 'tokenAddress',
    )
  })
})
