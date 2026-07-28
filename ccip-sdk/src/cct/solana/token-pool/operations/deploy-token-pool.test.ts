import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import { deriveTokenPoolConfigPda } from '../../programs/token-pool.ts'

const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const BLOCKHASH = PublicKey.default.toBase58()
const TOKEN = Keypair.generate().publicKey.toBase58()
const POOL_PROGRAM = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      // detectMintTokenProgram reads the mint owner to choose the token program.
      getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }),
    },
  } as unknown as SolanaChain
}

/** A connection that satisfies the full simulate → send → confirm submit pipeline. */
function stubExecuteChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }),
      simulateTransaction: async () => ({
        value: { unitsConsumed: 1000, err: null, logs: [], returnData: null },
      }),
      getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 0 }),
      sendTransaction: async () => 'SIGNATURE',
      confirmTransaction: async () => ({ value: { err: null } }),
    },
  } as unknown as SolanaChain
}

function generate(opts = {}) {
  return SolanaTokenManager.fromChain(stubChain()).generateUnsignedDeployTokenPool({
    tokenAddress: TOKEN,
    poolProgramAddress: POOL_PROGRAM,
    payer: PAYER,
    authority: AUTHORITY,
    ...opts,
  })
}

describe('Solana token pool deployTokenPool', () => {
  it('builds initialize + idempotent pool-ATA creation instructions', async () => {
    const unsigned = await generate()

    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    // POC parity: initialize + auto-created pool token ATA.
    assert.equal(unsigned.instructions.length, 2)
    assert.equal(unsigned.instructions[0]!.programId.toBase58(), POOL_PROGRAM)
    assert.equal(unsigned.instructions[1]!.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM)
  })

  it('adds configure allowlist instruction when provided', async () => {
    const unsigned = await generate({
      allowlist: [Keypair.generate().publicKey.toBase58()],
    })

    // initialize + configureAllowList + pool-ATA creation.
    assert.equal(unsigned.instructions.length, 3)
    assert.equal(unsigned.instructions[1]!.programId.toBase58(), POOL_PROGRAM)
    assert.equal(unsigned.instructions[2]!.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM)
  })

  it('defaults authority to payer', async () => {
    const unsigned = await generate({ authority: undefined })

    assert.ok(unsigned.instructions[0]!.keys.some((key) => key.pubkey.toBase58() === PAYER))
  })

  it('returns the pool state/config PDA from execute', async () => {
    const result = await SolanaTokenManager.fromChain(stubExecuteChain()).deployTokenPool({
      tokenAddress: TOKEN,
      poolProgramAddress: POOL_PROGRAM,
      wallet: WALLET,
    })

    const expected = deriveTokenPoolConfigPda(
      new PublicKey(POOL_PROGRAM),
      new PublicKey(TOKEN),
    ).toBase58()
    assert.equal(result.hash, 'SIGNATURE')
    assert.equal(result.poolAddress, expected)
  })

  it('rejects signed deploy when authority is not the wallet', async () => {
    await assert.rejects(
      () =>
        SolanaTokenManager.fromChain(stubChain()).deployTokenPool({
          tokenAddress: TOKEN,
          poolProgramAddress: POOL_PROGRAM,
          wallet: WALLET,
          authority: AUTHORITY,
        }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'deployTokenPool' &&
        err.context.param === 'authority',
    )
  })

  it('rejects invalid allowlist addresses', async () => {
    await assert.rejects(
      () => generate({ allowlist: ['not-a-pubkey'] }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'deployTokenPool' &&
        err.context.param === 'allowlist[0]',
    )
  })
})
