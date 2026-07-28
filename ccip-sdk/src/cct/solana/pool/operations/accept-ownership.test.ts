import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { createTokenPoolProgram } from '../../programs/token-pool.ts'
import { AcceptOwnership } from './accept-ownership.ts'
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

describe('Solana token-pool acceptOwnership', () => {
  it('builds an instruction that matches a direct anchor build', async () => {
    const chain = stubChain()
    const unsigned = await new AcceptOwnership().generate(chain, {
      poolAddress: POOL_STATE.toBase58(),
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
      anchorDiscriminator('accept_ownership').toString('hex'),
    )

    const ref = await createTokenPoolProgram(chain, POOL_PROGRAM, new PublicKey(PAYER))
      .methods.acceptOwnership()
      .accountsStrict({ state: statePda(), mint: MINT, authority: new PublicKey(PAYER) })
      .instruction()

    assert.equal(ix.data.toString('hex'), ref.data.toString('hex'))
    assert.deepEqual(
      ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
      ref.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    )
  })

  it('uses caller-provided authority for the signer account', async () => {
    const unsigned = await new AcceptOwnership().generate(stubChain(), {
      poolAddress: POOL_STATE.toBase58(),
      payer: PAYER,
      authority: AUTHORITY,
    })
    const authKey = unsigned.instructions[0]!.keys.find((k) => k.isSigner)
    assert.equal(authKey!.pubkey.toBase58(), AUTHORITY)
  })

  it('rejects an invalid poolAddress before RPC', async () => {
    await assert.rejects(
      () =>
        new AcceptOwnership().generate(stubChain(), {
          poolAddress: 'not-a-key',
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })
})
