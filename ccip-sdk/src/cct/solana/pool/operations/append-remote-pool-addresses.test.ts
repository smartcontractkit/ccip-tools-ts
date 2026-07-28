import { Buffer } from 'buffer'

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey, SystemProgram } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { createTokenPoolProgram } from '../../programs/token-pool.ts'
import { AppendRemotePoolAddresses } from './append-remote-pool-addresses.ts'
import { encodeRemotePoolAddressBytes } from './common.ts'
import {
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

const EVM_POOL = '0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD'
const SOL_POOL = new PublicKey('11111111111111111111111111111112').toBase58()

describe('Solana token-pool appendRemotePoolAddresses', () => {
  it('builds a single instruction matching a direct anchor build', async () => {
    const chain = stubChain()
    const unsigned = await new AppendRemotePoolAddresses().generate(chain, {
      poolAddress: POOL_STATE.toBase58(),
      remoteChainSelector: SELECTOR,
      remotePoolAddresses: [EVM_POOL, SOL_POOL],
      payer: PAYER,
    })

    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.instructions.length, 1)
    const [ix] = unsigned.instructions
    assert.ok(ix)
    assert.equal(ix.programId.toBase58(), POOL_PROGRAM.toBase58())
    assert.equal(
      ix.data.subarray(0, 8).toString('hex'),
      anchorDiscriminator('append_remote_pool_addresses').toString('hex'),
    )

    const addresses = [EVM_POOL, SOL_POOL].map((a) => ({
      address: Buffer.from(encodeRemotePoolAddressBytes(a)),
    }))
    const ref = await createTokenPoolProgram(chain, POOL_PROGRAM, new PublicKey(PAYER))
      .methods.appendRemotePoolAddresses(new BN(SELECTOR.toString()), MINT, addresses)
      .accountsStrict({
        state: statePda(),
        chainConfig: chainConfigPda(),
        authority: new PublicKey(PAYER),
        systemProgram: SystemProgram.programId,
      })
      .instruction()

    assert.equal(ix.data.toString('hex'), ref.data.toString('hex'))
    assert.deepEqual(
      ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
      ref.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    )
    // EVM address is preserved as raw 20 bytes (no left-padding to 32).
    assert.ok(ix.data.includes(Buffer.from(EVM_POOL.slice(2), 'hex')))
  })

  it('rejects an empty remotePoolAddresses list before RPC', async () => {
    await assert.rejects(
      () =>
        new AppendRemotePoolAddresses().generate(stubChain(), {
          poolAddress: POOL_STATE.toBase58(),
          remoteChainSelector: SELECTOR,
          remotePoolAddresses: [],
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects a zero selector before RPC', async () => {
    await assert.rejects(
      () =>
        new AppendRemotePoolAddresses().generate(stubChain(), {
          poolAddress: POOL_STATE.toBase58(),
          remoteChainSelector: 0n,
          remotePoolAddresses: [EVM_POOL],
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })
})
