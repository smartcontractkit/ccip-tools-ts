import { Buffer } from 'buffer'

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey, SystemProgram } from '@solana/web3.js'
import BN from 'bn.js'

import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { createTokenPoolProgram } from '../../programs/token-pool.ts'
import { ApplyChainUpdates } from './apply-chain-updates.ts'
import type { RemoteChainConfig } from './common.ts'
import { encodeRemoteAddressBytes, encodeRemotePoolAddressBytes } from './common.ts'
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

const EVM_TOKEN = '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888'
const EVM_POOL = '0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD'
const REMOVE_SELECTOR = 14767482510784806043n

const addChain: RemoteChainConfig = {
  remoteChainSelector: SELECTOR,
  remotePoolAddresses: [EVM_POOL],
  remoteTokenAddress: EVM_TOKEN,
  remoteTokenDecimals: 18,
  outboundRateLimiterConfig: { isEnabled: true, capacity: '1000', rate: '5' },
  inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
}

describe('Solana token-pool applyChainUpdates', () => {
  it('emits delete + init + append + rateLimit in order for a fresh chain', async () => {
    const chain = stubChain({ chainConfigExists: false })
    const unsigned = await new ApplyChainUpdates().generate(chain, {
      poolAddress: POOL_STATE.toBase58(),
      remoteChainSelectorsToRemove: [REMOVE_SELECTOR],
      chainsToAdd: [addChain],
      payer: PAYER,
    })

    assert.equal(unsigned.family, ChainFamily.Solana)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(unsigned.instructions.length, 4)

    const discs = unsigned.instructions.map((ix) => ix.data.subarray(0, 8).toString('hex'))
    assert.deepEqual(discs, [
      anchorDiscriminator('delete_chain_config').toString('hex'),
      anchorDiscriminator('init_chain_remote_config').toString('hex'),
      anchorDiscriminator('append_remote_pool_addresses').toString('hex'),
      anchorDiscriminator('set_chain_rate_limit').toString('hex'),
    ])

    for (const ix of unsigned.instructions) {
      assert.equal(ix.programId.toBase58(), POOL_PROGRAM.toBase58())
    }

    // Reference builds for the add-chain instructions.
    const program = createTokenPoolProgram(chain, POOL_PROGRAM, new PublicKey(PAYER))
    const authority = new PublicKey(PAYER)
    const state = statePda()
    const cfg = chainConfigPda()

    const refInit = await program.methods
      .initChainRemoteConfig(new BN(SELECTOR.toString()), MINT, {
        poolAddresses: [],
        tokenAddress: { address: Buffer.from(encodeRemoteAddressBytes(EVM_TOKEN)) },
        decimals: 18,
      })
      .accountsStrict({
        state,
        chainConfig: cfg,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .instruction()

    const refAppend = await program.methods
      .appendRemotePoolAddresses(new BN(SELECTOR.toString()), MINT, [
        { address: Buffer.from(encodeRemotePoolAddressBytes(EVM_POOL)) },
      ])
      .accountsStrict({
        state,
        chainConfig: cfg,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .instruction()

    const refRate = await program.methods
      .setChainRateLimit(
        new BN(SELECTOR.toString()),
        MINT,
        { enabled: false, capacity: new BN(0), rate: new BN(0) },
        { enabled: true, capacity: new BN(1000), rate: new BN(5) },
      )
      .accountsStrict({ state, chainConfig: cfg, authority })
      .instruction()

    assert.equal(unsigned.instructions[1]!.data.toString('hex'), refInit.data.toString('hex'))
    assert.equal(unsigned.instructions[2]!.data.toString('hex'), refAppend.data.toString('hex'))
    assert.equal(unsigned.instructions[3]!.data.toString('hex'), refRate.data.toString('hex'))

    // delete targets the REMOVE_SELECTOR chain config PDA
    assert.equal(
      unsigned.instructions[0]!.keys[1]!.pubkey.toBase58(),
      chainConfigPda(REMOVE_SELECTOR).toBase58(),
    )
  })

  it('skips init when the chain config already exists and is not being removed', async () => {
    const chain = stubChain({ chainConfigExists: true })
    const unsigned = await new ApplyChainUpdates().generate(chain, {
      poolAddress: POOL_STATE.toBase58(),
      remoteChainSelectorsToRemove: [],
      chainsToAdd: [addChain],
      payer: PAYER,
    })

    const discs = unsigned.instructions.map((ix) => ix.data.subarray(0, 8).toString('hex'))
    assert.deepEqual(discs, [
      anchorDiscriminator('append_remote_pool_addresses').toString('hex'),
      anchorDiscriminator('set_chain_rate_limit').toString('hex'),
    ])
  })

  it('re-inits when the chain is being removed and re-added in the same tx', async () => {
    const chain = stubChain({ chainConfigExists: true })
    const unsigned = await new ApplyChainUpdates().generate(chain, {
      poolAddress: POOL_STATE.toBase58(),
      remoteChainSelectorsToRemove: [SELECTOR],
      chainsToAdd: [addChain],
      payer: PAYER,
    })

    const discs = unsigned.instructions.map((ix) => ix.data.subarray(0, 8).toString('hex'))
    assert.deepEqual(discs, [
      anchorDiscriminator('delete_chain_config').toString('hex'),
      anchorDiscriminator('init_chain_remote_config').toString('hex'),
      anchorDiscriminator('append_remote_pool_addresses').toString('hex'),
      anchorDiscriminator('set_chain_rate_limit').toString('hex'),
    ])
  })

  it('rejects an add-chain with no remote pool addresses before RPC', async () => {
    await assert.rejects(
      () =>
        new ApplyChainUpdates().generate(stubChain(), {
          poolAddress: POOL_STATE.toBase58(),
          remoteChainSelectorsToRemove: [],
          chainsToAdd: [{ ...addChain, remotePoolAddresses: [] }],
          payer: PAYER,
        }),
      CCTParamsInvalidError,
    )
  })
})
