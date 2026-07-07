import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'

import { CCIPCctParamsInvalidError, CCIPVersionUnsupportedError } from '../../../../errors/index.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCIPVersion } from '../../../../types.ts'
import { SolanaTokenManager } from '../../index.ts'

const KEY = PublicKey.default.toBase58()

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: () => assert.fail('should not RPC before validation'),
      getLatestBlockhash: async () => ({ blockhash: KEY, lastValidBlockHeight: 0 }),
    },
  } as unknown as SolanaChain
}

describe('Solana TokenAdminRegistry setPool', () => {
  it('builds unsigned setPool instruction', async () => {
    const cct = SolanaTokenManager.fromChain(stubChain())
    const unsigned = await cct.tokenAdminRegistry.generateUnsignedSetPool({
      tokenAddress: KEY,
      routerAddress: KEY,
      poolLookupTableAddress: KEY,
      payer: KEY,
    })

    const [instruction] = unsigned.instructions
    assert.ok(instruction)
    assert.equal(unsigned.mainIndex, 0)
    assert.equal(instruction.data.toString('hex'), '771e0eb473e1a7ee03000000030407')
  })

  it('validates public keys before RPC', async () => {
    const cct = SolanaTokenManager.fromChain(stubChain())
    await assert.rejects(
      () =>
        cct.tokenAdminRegistry.generateUnsignedSetPool({
          tokenAddress: 'nope',
          routerAddress: KEY,
          poolLookupTableAddress: KEY,
          payer: KEY,
        }),
      (err: unknown) =>
        err instanceof CCIPCctParamsInvalidError &&
        err.context.operation === 'setPool' &&
        err.context.param === 'tokenAddress',
    )
  })

  it('only supports exact TokenAdminRegistry versions', async () => {
    const cct = SolanaTokenManager.fromChain(stubChain())
    await assert.rejects(
      () =>
        cct.tokenAdminRegistry.generateUnsignedSetPool({
          tokenAddress: KEY,
          routerAddress: KEY,
          poolLookupTableAddress: KEY,
          payer: KEY,
          version: CCIPVersion.V2_0 as never,
        }),
      (err: unknown) => err instanceof CCIPVersionUnsupportedError,
    )
  })
})
