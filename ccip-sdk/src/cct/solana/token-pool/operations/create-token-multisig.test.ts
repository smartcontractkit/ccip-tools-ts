import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { MINT_SIZE, MULTISIG_SIZE, MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import { deriveTokenPoolSignerPda } from '../../programs/token-pool.ts'

const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const MINT = Keypair.generate().publicKey.toBase58()
const POOL_PROGRAM = '41FGToCmdaWa1dgZLKFAjvmx6e6AjVTX7SVRibvsMGVB'
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function mintData(mintAuthority: PublicKey | null = new PublicKey(AUTHORITY)) {
  const data = Buffer.alloc(MINT_SIZE)
  MintLayout.encode(
    {
      mintAuthorityOption: mintAuthority ? 1 : 0,
      mintAuthority: mintAuthority ?? PublicKey.default,
      supply: 0n,
      decimals: 0,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  )
  return data
}

function stubChain(mintAuthority?: PublicKey | null): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async () => ({
        owner: TOKEN_PROGRAM_ID,
        data: mintData(mintAuthority),
        executable: false,
        lamports: 1,
      }),
      getMinimumBalanceForRentExemption: async (space: number) => {
        assert.equal(space, MULTISIG_SIZE)
        return 123
      },
    },
  } as unknown as SolanaChain
}

function generate(opts = {}) {
  return SolanaTokenManager.fromChain(stubChain()).generateUnsignedCreateTokenMultisig({
    tokenAddress: MINT,
    poolType: 'burn-mint',
    threshold: 2,
    payer: PAYER,
    seed: 'seed',
    ...opts,
  })
}

describe('Solana token createTokenMultisig', () => {
  it('builds unsigned instructions with default signers', async () => {
    const unsigned = await generate()
    const [createIx, initIx] = unsigned.instructions
    assert.ok(createIx)
    assert.ok(initIx)

    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    assert.match(unsigned.multisigAddress, /^[1-9A-HJ-NP-Za-km-z]+$/)
    assert.equal(createIx.programId.toBase58(), SystemProgram.programId.toBase58())
    assert.equal(initIx.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58())
    assert.equal(initIx.data[0], 2) // InitializeMultisig
    assert.equal(initIx.data[1], 2) // threshold

    const poolSigner = deriveTokenPoolSignerPda(new PublicKey(POOL_PROGRAM), new PublicKey(MINT))
    assert.ok(initIx.keys.some((key) => key.pubkey.equals(poolSigner)))
    assert.ok(initIx.keys.some((key) => key.pubkey.equals(new PublicKey(AUTHORITY))))
    assert.ok(!initIx.keys.some((key) => key.pubkey.equals(new PublicKey(PAYER))))
  })

  it('adds additional signers', async () => {
    const signer = Keypair.generate().publicKey
    const unsigned = await generate({ additionalSigners: [signer.toBase58()] })

    assert.ok(unsigned.instructions[1]!.keys.some((key) => key.pubkey.equals(signer)))
  })

  it('rejects invalid pool type', async () => {
    await assert.rejects(
      () => generate({ poolType: 'custom' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'createTokenMultisig' &&
        err.context.param === 'poolType',
    )
  })

  it('rejects threshold above signer count', async () => {
    await assert.rejects(
      () => generate({ threshold: 3 }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'createTokenMultisig' &&
        err.context.param === 'threshold',
    )
  })

  it('rejects mint without mint authority', async () => {
    await assert.rejects(
      () =>
        SolanaTokenManager.fromChain(stubChain(null)).generateUnsignedCreateTokenMultisig({
          tokenAddress: MINT,
          poolType: 'burn-mint',
          threshold: 2,
          payer: PAYER,
        }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'createTokenMultisig' &&
        err.context.param === 'tokenAddress',
    )
  })

  it('rejects signed execute when wallet is not mint authority', async () => {
    await assert.rejects(
      () =>
        SolanaTokenManager.fromChain(stubChain()).createTokenMultisig({
          tokenAddress: MINT,
          poolType: 'burn-mint',
          threshold: 2,
          wallet: WALLET,
        }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'createTokenMultisig' &&
        err.context.param === 'tokenAddress',
    )
  })
})
