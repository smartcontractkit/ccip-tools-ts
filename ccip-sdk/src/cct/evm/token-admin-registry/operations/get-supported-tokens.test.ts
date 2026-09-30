import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { interfaces } from '../../../../evm/const.ts'
import { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { GetSupportedTokens } from './get-supported-tokens.ts'

const OFF_RAMP = '0x' + '11'.repeat(20)
const TAR = '0x' + '22'.repeat(20)
const TOKENS = ['0x' + '33'.repeat(20), '0x' + '44'.repeat(20)]

describe('GetSupportedTokens (cct/evm)', () => {
  describe('query', () => {
    it('resolves the TAR and lists its configured tokens', async () => {
      let resolvedAddress: string | undefined
      let seenOpts: { page?: number } | undefined
      const chain = {
        getTokenAdminRegistryFor: async (address: string) => {
          resolvedAddress = address
          return TAR
        },
        getSupportedTokens: async (registry: string, opts?: { page?: number }) => {
          assert.equal(registry, TAR)
          seenOpts = opts
          return TOKENS
        },
      } as unknown as EVMChain

      const result = await new GetSupportedTokens().query(chain, { address: OFF_RAMP })
      assert.deepEqual(result, TOKENS)
      assert.equal(resolvedAddress, OFF_RAMP)
      assert.deepEqual(seenOpts, { page: undefined })
    })

    it('forwards `page` to chain.getSupportedTokens, which owns the pagination loop', async () => {
      let seenPage: number | undefined
      const chain = {
        getTokenAdminRegistryFor: async () => TAR,
        getSupportedTokens: async (_registry: string, opts?: { page?: number }) => {
          seenPage = opts?.page
          return TOKENS
        },
      } as unknown as EVMChain

      await new GetSupportedTokens().query(chain, { address: OFF_RAMP, page: 50 })
      assert.equal(seenPage, 50)
    })

    it('paginates `getAllConfiguredTokens` through the real EVMChain.getSupportedTokens loop', async () => {
      // The two tests above stub `chain.getSupportedTokens` wholesale, so they only pin that this
      // op forwards `page` — they cannot catch a startIndex/maxCount swap or a dropped final page
      // in the loop itself. This test runs the *real* `EVMChain.prototype.getSupportedTokens`
      // (bound to a stub with just `provider.call`) against three tokens with `page: 2`, so a full
      // first page (0,2) must be followed by a short second page (2,2) that ends the scan.
      const allTokens = [...TOKENS, '0x' + '55'.repeat(20)]
      const seenCalls: Array<{ startIndex: bigint; maxCount: bigint }> = []
      const chain = {
        getTokenAdminRegistryFor: async () => TAR,
        provider: {
          call: async ({ data }: { data: string }) => {
            const [startIndex, maxCount] = interfaces.TokenAdminRegistry.decodeFunctionData(
              'getAllConfiguredTokens',
              data,
            ) as unknown as [bigint, bigint]
            seenCalls.push({ startIndex, maxCount })
            const page = allTokens.slice(Number(startIndex), Number(startIndex + maxCount))
            return interfaces.TokenAdminRegistry.encodeFunctionResult('getAllConfiguredTokens', [
              page,
            ])
          },
        },
      } as unknown as EVMChain
      chain.getSupportedTokens = EVMChain.prototype.getSupportedTokens.bind(chain)

      const result = await new GetSupportedTokens().query(chain, { address: OFF_RAMP, page: 2 })

      assert.deepEqual(result, allTokens, 'pages are concatenated in order')
      assert.deepEqual(
        seenCalls,
        [
          { startIndex: 0n, maxCount: 2n },
          { startIndex: 2n, maxCount: 2n },
        ],
        'startIndex advances by the previous page length and maxCount stays pinned to `page`',
      )
    })
  })

  describe('validation', () => {
    it('rejects an invalid address before any RPC', async () => {
      let called = false
      const chain = {
        getTokenAdminRegistryFor: async () => {
          called = true
          return TAR
        },
      } as unknown as EVMChain

      await assert.rejects(
        () => new GetSupportedTokens().query(chain, { address: 'not-an-address' }),
        (error: unknown) =>
          error instanceof CCTParamsInvalidError &&
          error.context.operation === 'getSupportedTokens' &&
          error.context.param === 'address',
      )
      assert.equal(called, false, 'validation fails before TAR discovery')
    })

    it('rejects a non-positive `page`', async () => {
      await assert.rejects(
        () => new GetSupportedTokens().query({} as EVMChain, { address: OFF_RAMP, page: 0 }),
        (error: unknown) =>
          error instanceof CCTParamsInvalidError && error.context.param === 'page',
      )
    })

    it('rejects a non-integer `page`', async () => {
      await assert.rejects(
        () => new GetSupportedTokens().query({} as EVMChain, { address: OFF_RAMP, page: 1.5 }),
        (error: unknown) =>
          error instanceof CCTParamsInvalidError && error.context.param === 'page',
      )
    })
  })
})
