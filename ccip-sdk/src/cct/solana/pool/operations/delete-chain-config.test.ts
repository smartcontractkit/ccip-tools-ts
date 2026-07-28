import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { createTokenPoolProgram } from '../../programs/token-pool.ts'
import { DeleteChainConfig } from './delete-chain-config.ts'
import {
  AUTHORITY,
  MINT,
  PAYER,
  POOL_PROGRAM,
  POOL_STATE,
  SELECTOR,
  anchorDiscriminator,
  chainConfigPda,
  statePda,
  stubChain,
} from './test-helpers.ts'

describe('Solana token-pool deleteChainConfig', () => {
  it('builds an instruction that matches a direct anchor build', async () => {
    const chain = stubChain()
    const unsigned = await new DeleteChainConfig().generate(chain, {
      poolAddress: POOL_STATE.toBase58(),
      remoteChainSelector: SELECTOR,
      payer: PAYER,
    })

    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(unsigned.instructions.length, 1)
    const [ix] = unsigned.instructions
    assert.ok(ix)

    // programId + instruction identity
    assert.equal(ix.programId.toBase58(), POOL_PROGRAM.toBase58())
    assert.equal(
      ix.data.subarray(0, 8).toString('hex'),
      anchorDiscriminator('delete_chain_config').toString('hex'),
    )

    // Reference build via a fresh anchor Program client (independent of the op).
    const ref = await createTokenPoolProgram(chain, POOL_PROGRAM, new PublicKey(PAYER))
      .methods.deleteChainConfig(new BN(SELECTOR.toString()), MINT)
      .accountsStrict({
        state: statePda(),
        chainConfig: chainConfigPda(),
        authority: new PublicKey(PAYER),
      })
      .instruction()

    // account order + pubkeys (state RO, chainConfig W, authority W+signer)
    assert.equal(ix.keys.length, 3)
    assert.equal(ix.keys[0]!.pubkey.toBase58(), statePda().toBase58())
    assert.equal(ix.keys[0]!.isWritable, false)
    assert.equal(ix.keys[1]!.pubkey.toBase58(), chainConfigPda().toBase58())
    assert.equal(ix.keys[1]!.isWritable, true)
    assert.equal(ix.keys[2]!.pubkey.toBase58(), PAYER)
    assert.equal(ix.keys[2]!.isSigner, true)
    assert.equal(ix.keys[2]!.isWritable, true)

    assert.equal(ix.data.toString('hex'), ref.data.toString('hex'))
    assert.deepEqual(
      ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
      ref.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    )
  })

  it('uses caller-provided authority for the signer account', async () => {
    const unsigned = await new DeleteChainConfig().generate(stubChain(), {
      poolAddress: POOL_STATE.toBase58(),
      remoteChainSelector: SELECTOR,
      payer: PAYER,
      authority: AUTHORITY,
    })
    assert.equal(unsigned.instructions[0]!.keys[2]!.pubkey.toBase58(), AUTHORITY)
  })

  it('rejects a zero remoteChainSelector before RPC', async () => {
    await assert.rejects(
      () =>
        new DeleteChainConfig().generate(stubChain(), {
          poolAddress: POOL_STATE.toBase58(),
          remoteChainSelector: 0n,
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects an invalid poolAddress before RPC', async () => {
    await assert.rejects(
      () =>
        new DeleteChainConfig().generate(stubChain(), {
          poolAddress: 'not-a-key',
          remoteChainSelector: SELECTOR,
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })
})
