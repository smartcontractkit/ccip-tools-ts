import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair } from '@solana/web3.js'

import { GetSupportedTokens } from './get-supported-tokens.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const OFF_RAMP = Keypair.generate().publicKey.toBase58()
const ROUTER = Keypair.generate().publicKey.toBase58()
const TOKENS = [Keypair.generate().publicKey.toBase58()]

describe('GetSupportedTokens (cct/solana)', () => {
  describe('query', () => {
    it('resolves an OffRamp to the Router and lists configured token mints', async () => {
      let resolvedAddress: string | undefined
      let supportedTokensRouter: string | undefined
      const chain = {
        getTokenAdminRegistryFor: async (address: string) => {
          resolvedAddress = address
          return ROUTER
        },
        getSupportedTokens: async (router: string) => {
          supportedTokensRouter = router
          return TOKENS
        },
      } as unknown as SolanaChain

      assert.deepEqual(await new GetSupportedTokens().query(chain, { address: OFF_RAMP }), TOKENS)
      assert.equal(resolvedAddress, OFF_RAMP)
      assert.equal(supportedTokensRouter, ROUTER)
    })
  })

  describe('validation', () => {
    it('rejects an invalid address', async () => {
      await assert.rejects(
        () => new GetSupportedTokens().query({} as SolanaChain, { address: 'invalid' }),
        (error: unknown) =>
          error instanceof CCTParamsInvalidError && error.context.param === 'address',
      )
    })
  })
})
