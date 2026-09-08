import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PublicKey } from '@solana/web3.js'

import type { TokenPoolRemote } from '../../../../chain.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { deriveTokenPoolConfigPda } from '../../programs/token-pool.ts'
import { GetTokenPoolRemotes } from './get-token-pool-remotes.ts'

function key(byte: number): PublicKey {
  return new PublicKey(Uint8Array.from({ length: 32 }, () => byte))
}

const REMOTES: Record<string, TokenPoolRemote> = {
  'ethereum-mainnet': {
    remoteToken: '0x1234',
    remotePools: ['0x5678'],
    inboundRateLimiterState: { tokens: 25n, capacity: 50n, rate: 5n },
    outboundRateLimiterState: null,
  },
}

describe('GetTokenPoolRemotes (cct/solana)', () => {
  const mint = key(2)
  const program = key(3)
  const selector = 5009297550715157269n

  function chain(): SolanaChain {
    return {
      getTokenPoolRemotes: async (state: string, remoteChainSelector?: bigint) => {
        assert.equal(state, deriveTokenPoolConfigPda(program, mint).toBase58())
        assert.equal(remoteChainSelector, selector)
        return REMOTES
      },
    } as unknown as SolanaChain
  }

  describe('query', () => {
    it('delegates selected remote config decoding to the chain reader', async () => {
      const remotes = await new GetTokenPoolRemotes().query(chain(), {
        tokenAddress: mint.toBase58(),
        poolProgramAddress: program.toBase58(),
        remoteChainSelector: selector,
      })

      assert.equal(remotes, REMOTES)
    })

    it('omits the selector to read all remote configs', async () => {
      const chainWithAll = {
        getTokenPoolRemotes: async (_state: string, remoteChainSelector?: bigint) => {
          assert.equal(remoteChainSelector, undefined)
          return REMOTES
        },
      } as unknown as SolanaChain

      const remotes = await new GetTokenPoolRemotes().query(chainWithAll, {
        tokenAddress: mint.toBase58(),
        poolProgramAddress: program.toBase58(),
      })

      assert.equal(remotes, REMOTES)
    })
  })

  describe('validation', () => {
    it('validates the token address and optional remote selector before reading', async () => {
      const cases: Array<[Partial<{ tokenAddress: string; remoteChainSelector: bigint }>, string]> =
        [
          [{ tokenAddress: 'invalid' }, 'tokenAddress'],
          [{ remoteChainSelector: -1n }, 'remoteChainSelector'],
          [{ remoteChainSelector: 1 as never }, 'remoteChainSelector'],
        ]
      for (const [opts, param] of cases) {
        await assert.rejects(
          new GetTokenPoolRemotes().query(chain(), {
            tokenAddress: mint.toBase58(),
            poolProgramAddress: program.toBase58(),
            remoteChainSelector: selector,
            ...opts,
          }),
          (error: unknown) =>
            error instanceof CCTParamsInvalidError && error.context.param === param,
        )
      }
    })
  })
})
