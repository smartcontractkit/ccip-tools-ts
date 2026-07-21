import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import { deriveTokenPoolConfigPda } from '../../programs/token-pool.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const BURN_MINT_POOL_PROGRAM = '41FGToCmdaWa1dgZLKFAjvmx6e6AjVTX7SVRibvsMGVB'
const LOCK_RELEASE_POOL_PROGRAM = '8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC'
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
  } as unknown as SolanaChain
}

function generate(opts = {}) {
  return SolanaTokenManager.fromChain(stubChain()).generateUnsignedDeployTokenPool({
    tokenAddress: TOKEN,
    poolType: 'burn-mint',
    payer: PAYER,
    authority: AUTHORITY,
    ...opts,
  })
}

describe('Solana token pool deployTokenPool', () => {
  it('builds unsigned initialize pool instruction', async () => {
    const unsigned = await generate()

    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(unsigned.instructions.length, 1)
    assert.equal(unsigned.instructions[0]!.programId.toBase58(), BURN_MINT_POOL_PROGRAM)
    assert.equal(
      unsigned.poolAddress,
      deriveTokenPoolConfigPda(
        new PublicKey(BURN_MINT_POOL_PROGRAM),
        new PublicKey(TOKEN),
      ).toBase58(),
    )
  })

  it('adds configure allowlist instruction when provided', async () => {
    const unsigned = await generate({
      allowlist: [Keypair.generate().publicKey.toBase58()],
    })

    assert.equal(unsigned.instructions.length, 2)
    assert.equal(unsigned.instructions[1]!.programId.toBase58(), BURN_MINT_POOL_PROGRAM)
  })

  it('uses canonical lock-release pool program', async () => {
    const unsigned = await generate({ poolType: 'lock-release' })

    assert.equal(unsigned.instructions[0]!.programId.toBase58(), LOCK_RELEASE_POOL_PROGRAM)
  })

  it('defaults authority to payer', async () => {
    const unsigned = await generate({ authority: undefined })

    assert.ok(unsigned.instructions[0]!.keys.some((key) => key.pubkey.toBase58() === PAYER))
  })

  it('rejects signed deploy when authority is not the wallet', async () => {
    await assert.rejects(
      () =>
        SolanaTokenManager.fromChain(stubChain()).deployTokenPool({
          tokenAddress: TOKEN,
          poolType: 'burn-mint',
          wallet: WALLET,
          authority: AUTHORITY,
        }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'deployTokenPool' &&
        err.context.param === 'authority',
    )
  })

  it('rejects invalid pool types', async () => {
    await assert.rejects(
      () => generate({ poolType: 'custom' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'deployTokenPool' &&
        err.context.param === 'poolType',
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
