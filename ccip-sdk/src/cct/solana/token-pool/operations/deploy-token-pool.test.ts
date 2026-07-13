import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const POOL_PROGRAM = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
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
  it('builds unsigned initialize pool instruction', async () => {
    const unsigned = await generate()

    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(unsigned.instructions.length, 1)
    assert.equal(unsigned.instructions[0]!.programId.toBase58(), POOL_PROGRAM)
  })

  it('adds configure allowlist instruction when provided', async () => {
    const unsigned = await generate({
      allowlist: [Keypair.generate().publicKey.toBase58()],
    })

    assert.equal(unsigned.instructions.length, 2)
    assert.equal(unsigned.instructions[1]!.programId.toBase58(), POOL_PROGRAM)
  })

  it('defaults authority to payer', async () => {
    const unsigned = await generate({ authority: undefined })

    assert.ok(unsigned.instructions[0]!.keys.some((key) => key.pubkey.toBase58() === PAYER))
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
