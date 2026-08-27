import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { GetTokenPoolRemotes } from './get-token-pool-remotes.ts'
import type { TokenPoolRemote } from '../../../../chain.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'

const POOL = '0x' + '11'.repeat(20)
const SELECTOR = 5009297550715157269n

const REMOTES: Record<string, TokenPoolRemote> = {
  'ethereum-mainnet': {
    remoteToken: '0x' + '22'.repeat(20),
    remotePools: ['0x' + '33'.repeat(20)],
    inboundRateLimiterState: { tokens: 25n, capacity: 50n, rate: 5n },
    outboundRateLimiterState: null,
  },
}

/** Records every `getTokenPoolRemotes` call so tests can assert forwarding and RPC-freeness. */
function stubChain(calls: Array<[string, bigint | undefined]> = []): EVMChain {
  return {
    getTokenPoolRemotes: (tokenPool: string, remoteChainSelector?: bigint) => {
      calls.push([tokenPool, remoteChainSelector])
      return Promise.resolve(REMOTES)
    },
  } as unknown as EVMChain
}

describe('GetTokenPoolRemotes (cct/evm)', () => {
  describe('query', () => {
    it('forwards poolAddress and the selector to chain.getTokenPoolRemotes', async () => {
      const calls: Array<[string, bigint | undefined]> = []
      const result = await new GetTokenPoolRemotes().query(stubChain(calls), {
        poolAddress: POOL,
        remoteChainSelector: SELECTOR,
      })

      assert.equal(result, REMOTES)
      assert.deepEqual(calls, [[POOL, SELECTOR]])
    })

    it('omits the selector to scan every configured lane', async () => {
      const calls: Array<[string, bigint | undefined]> = []
      const result = await new GetTokenPoolRemotes().query(stubChain(calls), { poolAddress: POOL })

      assert.equal(result, REMOTES)
      assert.deepEqual(calls, [[POOL, undefined]], 'no selector is forwarded as undefined')
    })

    it('passes the pool address through unnormalised, leaving resolution to the chain reader', async () => {
      // the op is a thin delegate: it must not checksum, resolve, or otherwise rewrite the address
      const calls: Array<[string, bigint | undefined]> = []
      const lowercase = POOL.toLowerCase()
      await new GetTokenPoolRemotes().query(stubChain(calls), { poolAddress: lowercase })
      assert.equal(calls[0]![0], lowercase)
    })

    it('accepts the uint64 selector bounds', async () => {
      const calls: Array<[string, bigint | undefined]> = []
      const chain = stubChain(calls)
      for (const selector of [0n, 2n ** 64n - 1n]) {
        await new GetTokenPoolRemotes().query(chain, {
          poolAddress: POOL,
          remoteChainSelector: selector,
        })
      }
      assert.deepEqual(
        calls.map(([, selector]) => selector),
        [0n, 2n ** 64n - 1n],
      )
    })
  })

  describe('validation', () => {
    it('rejects an invalid poolAddress before any RPC', async () => {
      let called = false
      const chain = {
        getTokenPoolRemotes: () => {
          called = true
          return Promise.resolve(REMOTES)
        },
      } as unknown as EVMChain

      await assert.rejects(
        () => new GetTokenPoolRemotes().query(chain, { poolAddress: 'not-an-address' }),
        (error: unknown) =>
          error instanceof CCTParamsInvalidError &&
          error.context.operation === 'getTokenPoolRemotes' &&
          error.context.param === 'poolAddress',
      )
      assert.equal(called, false, 'validation fails before the chain read')
    })

    for (const [label, remoteChainSelector] of [
      ['negative', -1n],
      ['above uint64 max', 2n ** 64n],
      ['a number, not a bigint', 1 as never],
    ] as const) {
      it(`rejects a remoteChainSelector that is ${label}, before any RPC`, async () => {
        let called = false
        const chain = {
          getTokenPoolRemotes: () => {
            called = true
            return Promise.resolve(REMOTES)
          },
        } as unknown as EVMChain

        await assert.rejects(
          () => new GetTokenPoolRemotes().query(chain, { poolAddress: POOL, remoteChainSelector }),
          (error: unknown) =>
            error instanceof CCTParamsInvalidError &&
            error.context.operation === 'getTokenPoolRemotes' &&
            error.context.param === 'remoteChainSelector',
        )
        assert.equal(called, false, 'validation fails before the chain read')
      })
    }
  })
})
