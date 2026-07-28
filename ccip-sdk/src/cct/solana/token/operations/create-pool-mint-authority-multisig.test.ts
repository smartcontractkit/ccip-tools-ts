import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MULTISIG_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createInitializeMultisigInstruction,
} from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { deriveTokenPoolSignerPda } from '../../programs/token-pool.ts'
import { CreatePoolMintAuthorityMultisig } from './create-pool-mint-authority-multisig.ts'

const MINT = Keypair.generate().publicKey
const POOL_PROGRAM = Keypair.generate().publicKey
const PAYER = Keypair.generate().publicKey.toBase58()
const SIGNER_A = Keypair.generate().publicKey.toBase58()
const SIGNER_B = Keypair.generate().publicKey.toBase58()
const SEED = 'multisig-fixed-seed'
const RENT = 1_000_000

function stubChain(owner: PublicKey = TOKEN_PROGRAM_ID): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async (key: PublicKey) => (key.equals(MINT) ? { owner } : null),
      getMinimumBalanceForRentExemption: async () => RENT,
    },
  } as unknown as SolanaChain
}

function noRpcChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: () => assert.fail('should not RPC before validation'),
      getMinimumBalanceForRentExemption: () => assert.fail('should not RPC before validation'),
    },
  } as unknown as SolanaChain
}

describe('Solana token createPoolMintAuthorityMultisig', () => {
  it('builds createAccountWithSeed + initializeMultisig with the pool signer PDA first', async () => {
    const unsigned = await new CreatePoolMintAuthorityMultisig().generate(stubChain(), {
      payer: PAYER,
      mint: MINT.toBase58(),
      poolProgramId: POOL_PROGRAM.toBase58(),
      additionalSigners: [SIGNER_A, SIGNER_B],
      threshold: 2,
      seed: SEED,
    })

    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 1)
    assert.equal(unsigned.instructions.length, 2)

    const poolSignerPda = deriveTokenPoolSignerPda(POOL_PROGRAM, MINT)
    const multisig = await PublicKey.createWithSeed(new PublicKey(PAYER), SEED, TOKEN_PROGRAM_ID)

    assert.equal(unsigned.multisigAddress, multisig.toBase58())
    assert.equal(unsigned.poolSignerPda, poolSignerPda.toBase58())
    assert.deepEqual(unsigned.allSigners, [poolSignerPda.toBase58(), SIGNER_A, SIGNER_B])

    // Parity: create-account-with-seed
    const refCreate = SystemProgram.createAccountWithSeed({
      fromPubkey: new PublicKey(PAYER),
      newAccountPubkey: multisig,
      basePubkey: new PublicKey(PAYER),
      seed: SEED,
      lamports: RENT,
      space: MULTISIG_SIZE,
      programId: TOKEN_PROGRAM_ID,
    })
    assert.equal(unsigned.instructions[0]!.programId.toBase58(), SystemProgram.programId.toBase58())
    assert.equal(unsigned.instructions[0]!.data.toString('hex'), refCreate.data.toString('hex'))

    // Parity: initialize-multisig
    const refInit = createInitializeMultisigInstruction(
      multisig,
      [poolSignerPda, new PublicKey(SIGNER_A), new PublicKey(SIGNER_B)],
      2,
      TOKEN_PROGRAM_ID,
    )
    assert.equal(unsigned.instructions[1]!.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58())
    assert.equal(unsigned.instructions[1]!.data.toString('hex'), refInit.data.toString('hex'))
    assert.deepEqual(
      unsigned.instructions[1]!.keys.map((k) => k.pubkey.toBase58()),
      refInit.keys.map((k) => k.pubkey.toBase58()),
    )
  })

  it('uses the Token-2022 program when the mint is owned by it', async () => {
    const unsigned = await new CreatePoolMintAuthorityMultisig().generate(
      stubChain(TOKEN_2022_PROGRAM_ID),
      {
        payer: PAYER,
        mint: MINT.toBase58(),
        poolProgramId: POOL_PROGRAM.toBase58(),
        additionalSigners: [SIGNER_A],
        threshold: 1,
        seed: SEED,
      },
    )
    assert.equal(unsigned.instructions[1]!.programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58())
  })

  it('rejects empty additionalSigners before any RPC', async () => {
    await assert.rejects(
      () =>
        new CreatePoolMintAuthorityMultisig().generate(noRpcChain(), {
          payer: PAYER,
          mint: MINT.toBase58(),
          poolProgramId: POOL_PROGRAM.toBase58(),
          additionalSigners: [],
          threshold: 1,
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects a threshold that exceeds total signers before any RPC', async () => {
    await assert.rejects(
      () =>
        new CreatePoolMintAuthorityMultisig().generate(noRpcChain(), {
          payer: PAYER,
          mint: MINT.toBase58(),
          poolProgramId: POOL_PROGRAM.toBase58(),
          additionalSigners: [SIGNER_A],
          threshold: 3,
        }),
      CCTParamsInvalidError,
    )
  })
})
