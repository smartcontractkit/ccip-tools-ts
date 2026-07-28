import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { createTokenPoolProgram } from '../../programs/token-pool.ts'
import { TransferOwnership } from './transfer-ownership.ts'
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

const NEW_OWNER = Keypair.generate().publicKey.toBase58()

describe('Solana token-pool transferOwnership', () => {
  it('builds an instruction that matches a direct anchor build', async () => {
    const chain = stubChain()
    const unsigned = await new TransferOwnership().generate(chain, {
      poolAddress: POOL_STATE.toBase58(),
      newOwner: NEW_OWNER,
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
      anchorDiscriminator('transfer_ownership').toString('hex'),
    )

    const ref = await createTokenPoolProgram(chain, POOL_PROGRAM, new PublicKey(PAYER))
      .methods.transferOwnership(new PublicKey(NEW_OWNER))
      .accountsStrict({ state: statePda(), mint: MINT, authority: new PublicKey(PAYER) })
      .instruction()

    assert.equal(ix.data.toString('hex'), ref.data.toString('hex'))
    assert.deepEqual(
      ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
      ref.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    )
  })

  it('uses caller-provided authority for the signer account', async () => {
    const unsigned = await new TransferOwnership().generate(stubChain(), {
      poolAddress: POOL_STATE.toBase58(),
      newOwner: NEW_OWNER,
      payer: PAYER,
      authority: AUTHORITY,
    })
    const authKey = unsigned.instructions[0]!.keys.find((k) => k.isSigner)
    assert.equal(authKey!.pubkey.toBase58(), AUTHORITY)
  })

  it('rejects an invalid newOwner before RPC', async () => {
    await assert.rejects(
      () =>
        new TransferOwnership().generate(stubChain(), {
          poolAddress: POOL_STATE.toBase58(),
          newOwner: 'not-a-key',
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects an invalid poolAddress before RPC', async () => {
    await assert.rejects(
      () =>
        new TransferOwnership().generate(stubChain(), {
          poolAddress: 'not-a-key',
          newOwner: NEW_OWNER,
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })
})
