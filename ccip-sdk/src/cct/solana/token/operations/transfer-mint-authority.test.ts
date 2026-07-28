import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  AuthorityType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createSetAuthorityInstruction,
} from '@solana/spl-token'
import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { TransferMintAuthority } from './transfer-mint-authority.ts'

const MINT = Keypair.generate().publicKey
const PAYER = Keypair.generate().publicKey.toBase58()
const NEW_AUTH = Keypair.generate().publicKey.toBase58()

function stubChain(owner: PublicKey = TOKEN_PROGRAM_ID): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async (key: PublicKey) => (key.equals(MINT) ? { owner } : null),
    },
  } as unknown as SolanaChain
}

function noRpcChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: { getAccountInfo: () => assert.fail('should not RPC before validation') },
  } as unknown as SolanaChain
}

describe('Solana token transferMintAuthority', () => {
  it('matches createSetAuthorityInstruction(MintTokens) for spl-token', async () => {
    const unsigned = await new TransferMintAuthority().generate(stubChain(), {
      payer: PAYER,
      mint: MINT.toBase58(),
      newMintAuthority: NEW_AUTH,
    })

    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(unsigned.instructions.length, 1)

    const ix = unsigned.instructions[0]!
    const ref = createSetAuthorityInstruction(
      MINT,
      new PublicKey(PAYER),
      AuthorityType.MintTokens,
      new PublicKey(NEW_AUTH),
      [],
      TOKEN_PROGRAM_ID,
    )
    assert.equal(ix.programId.toBase58(), ref.programId.toBase58())
    assert.equal(ix.data.toString('hex'), ref.data.toString('hex'))
    assert.deepEqual(
      ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
      ref.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    )
  })

  it('targets the Token-2022 program when the mint is owned by it', async () => {
    const unsigned = await new TransferMintAuthority().generate(stubChain(TOKEN_2022_PROGRAM_ID), {
      payer: PAYER,
      mint: MINT.toBase58(),
      newMintAuthority: NEW_AUTH,
    })
    assert.equal(unsigned.instructions[0]!.programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58())
  })

  it('rejects an invalid mint before any RPC', async () => {
    await assert.rejects(
      () =>
        new TransferMintAuthority().generate(noRpcChain(), {
          payer: PAYER,
          mint: 'not-a-key',
          newMintAuthority: NEW_AUTH,
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects when the mint account is missing on-chain', async () => {
    const chain = {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      connection: { getAccountInfo: async () => null },
    } as unknown as SolanaChain
    await assert.rejects(
      () =>
        new TransferMintAuthority().generate(chain, {
          payer: PAYER,
          mint: MINT.toBase58(),
          newMintAuthority: NEW_AUTH,
        }),
      CCTParamsInvalidError,
    )
  })
})
