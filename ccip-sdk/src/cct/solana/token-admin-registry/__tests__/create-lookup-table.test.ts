import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'

import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'

const KEY = PublicKey.default.toBase58()

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getSlot: async () => 123,
      getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }),
    },
    getTokenPoolConfig: async () => ({ token: KEY, router: KEY, tokenPoolProgram: KEY }),
    _getRouterConfig: async () => ({ feeQuoter: PublicKey.default }),
  } as unknown as SolanaChain
}

describe('Solana TokenAdminRegistry createLookupTable', () => {
  it('builds create + extend ALT instructions', async () => {
    const cct = SolanaTokenManager.fromChain(stubChain())
    const unsigned = await cct.tokenAdminRegistry.generateUnsignedCreateLookupTable({
      tokenAddress: KEY,
      poolProgramAddress: KEY,
      payer: KEY,
    })

    assert.equal(unsigned.mainIndex, 0)
    assert.equal(unsigned.instructions.length, 2)
    assert.equal(typeof unsigned.lookupTableAddress, 'string')
  })

  it('validates public keys before RPC', async () => {
    const cct = SolanaTokenManager.fromChain({
      ...stubChain(),
      connection: { getSlot: () => assert.fail('should not RPC before validation') },
    } as unknown as SolanaChain)

    await assert.rejects(
      () =>
        cct.tokenAdminRegistry.generateUnsignedCreateLookupTable({
          tokenAddress: 'nope',
          poolProgramAddress: KEY,
          payer: KEY,
        }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'createLookupTable' &&
        err.context.param === 'tokenAddress',
    )
  })
})
