import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { createTokenPoolProgram } from '../../programs/token-pool.ts'
import type { ChainRateLimiterConfig } from './set-chain-rate-limiter-config.ts'
import { SetChainRateLimiterConfig } from './set-chain-rate-limiter-config.ts'
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

const SELECTOR_2 = 14767482510784806043n

const config: ChainRateLimiterConfig = {
  remoteChainSelector: SELECTOR,
  outboundRateLimiterConfig: { isEnabled: true, capacity: '1000', rate: '5' },
  inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
}

describe('Solana token-pool setChainRateLimiterConfig', () => {
  it('builds an instruction that matches a direct anchor build', async () => {
    const chain = stubChain()
    const unsigned = await new SetChainRateLimiterConfig().generate(chain, {
      poolAddress: POOL_STATE.toBase58(),
      chainConfigs: [config],
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
      anchorDiscriminator('set_chain_rate_limit').toString('hex'),
    )

    const ref = await createTokenPoolProgram(chain, POOL_PROGRAM, new PublicKey(PAYER))
      .methods.setChainRateLimit(
        new BN(SELECTOR.toString()),
        MINT,
        { enabled: false, capacity: new BN(0), rate: new BN(0) },
        { enabled: true, capacity: new BN(1000), rate: new BN(5) },
      )
      .accountsStrict({
        state: statePda(),
        chainConfig: chainConfigPda(),
        authority: new PublicKey(PAYER),
      })
      .instruction()

    assert.equal(ix.data.toString('hex'), ref.data.toString('hex'))
    assert.deepEqual(
      ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
      ref.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
    )
  })

  it('emits one instruction per chain config, targeting each chainConfig PDA', async () => {
    const unsigned = await new SetChainRateLimiterConfig().generate(stubChain(), {
      poolAddress: POOL_STATE.toBase58(),
      chainConfigs: [config, { ...config, remoteChainSelector: SELECTOR_2 }],
      payer: PAYER,
    })

    assert.equal(unsigned.instructions.length, 2)
    assert.equal(
      unsigned.instructions[0]!.keys[1]!.pubkey.toBase58(),
      chainConfigPda(SELECTOR).toBase58(),
    )
    assert.equal(
      unsigned.instructions[1]!.keys[1]!.pubkey.toBase58(),
      chainConfigPda(SELECTOR_2).toBase58(),
    )
  })

  it('uses caller-provided authority for the signer account', async () => {
    const unsigned = await new SetChainRateLimiterConfig().generate(stubChain(), {
      poolAddress: POOL_STATE.toBase58(),
      chainConfigs: [config],
      payer: PAYER,
      authority: AUTHORITY,
    })
    const authKey = unsigned.instructions[0]!.keys.find((k) => k.isSigner)
    assert.equal(authKey!.pubkey.toBase58(), AUTHORITY)
  })

  it('rejects an empty chainConfigs list before RPC', async () => {
    await assert.rejects(
      () =>
        new SetChainRateLimiterConfig().generate(stubChain(), {
          poolAddress: POOL_STATE.toBase58(),
          chainConfigs: [],
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects a zero remoteChainSelector before RPC', async () => {
    await assert.rejects(
      () =>
        new SetChainRateLimiterConfig().generate(stubChain(), {
          poolAddress: POOL_STATE.toBase58(),
          chainConfigs: [{ ...config, remoteChainSelector: 0n }],
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })

  it('rejects an invalid poolAddress before RPC', async () => {
    await assert.rejects(
      () =>
        new SetChainRateLimiterConfig().generate(stubChain(), {
          poolAddress: 'not-a-key',
          chainConfigs: [config],
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })
})
