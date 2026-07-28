import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { createTokenPoolProgram } from '../../programs/token-pool.ts'
import { SetRateLimitAdmin } from './set-rate-limit-admin.ts'
import {
  AUTHORITY,
  MINT,
  PAYER,
  POOL_PROGRAM,
  POOL_STATE,
  anchorDiscriminator,
  statePda,
  stubChain,
} from './test-helpers.ts'

const RATE_LIMIT_ADMIN = Keypair.generate().publicKey.toBase58()

describe('Solana token-pool setRateLimitAdmin', () => {
  it('builds an instruction that matches a direct anchor build', async () => {
    const chain = stubChain()
    const unsigned = await new SetRateLimitAdmin().generate(chain, {
      poolAddress: POOL_STATE.toBase58(),
      rateLimitAdmin: RATE_LIMIT_ADMIN,
      payer: PAYER,
    })

    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(unsigned.instructions.length, 1)
    const [ix] = unsigned.instructions
    assert.ok(ix)

    assert.equal(ix.programId.toBase58(), POOL_PROGRAM.toBase58())
    assert.equal(
      ix.data.subarray(0, 8).toString('hex'),
      anchorDiscriminator('set_rate_limit_admin').toString('hex'),
    )

    const ref = await createTokenPoolProgram(chain, POOL_PROGRAM, new PublicKey(PAYER))
      .methods.setRateLimitAdmin(MINT, new PublicKey(RATE_LIMIT_ADMIN))
      .accountsStrict({ state: statePda(), authority: new PublicKey(PAYER) })
      .instruction()

    assert.equal(ix.data.toString('hex'), ref.data.toString('hex'))
    assert.deepEqual(
      ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
      ref.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    )
  })

  it('uses caller-provided authority for the signer account', async () => {
    const unsigned = await new SetRateLimitAdmin().generate(stubChain(), {
      poolAddress: POOL_STATE.toBase58(),
      rateLimitAdmin: RATE_LIMIT_ADMIN,
      payer: PAYER,
      authority: AUTHORITY,
    })
    const authKey = unsigned.instructions[0]!.keys.find((k) => k.isSigner)
    assert.equal(authKey!.pubkey.toBase58(), AUTHORITY)
  })

  it('rejects an invalid rateLimitAdmin before RPC', async () => {
    await assert.rejects(
      () =>
        new SetRateLimitAdmin().generate(stubChain(), {
          poolAddress: POOL_STATE.toBase58(),
          rateLimitAdmin: 'not-a-key',
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects an invalid poolAddress before RPC', async () => {
    await assert.rejects(
      () =>
        new SetRateLimitAdmin().generate(stubChain(), {
          poolAddress: 'not-a-key',
          rateLimitAdmin: RATE_LIMIT_ADMIN,
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })
})
