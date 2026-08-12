import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

import { CCIPTokenPoolChainConfigNotFoundError } from '../../../../errors/index.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTDataDecodeError, CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import { deriveTokenPoolChainConfigPda } from '../../programs/token-pool.ts'

function key(byte: number): PublicKey {
  return new PublicKey(Uint8Array.from({ length: 32 }, () => byte))
}

function u64(value: bigint): Buffer {
  const data = Buffer.alloc(8)
  data.writeBigUInt64LE(value)
  return data
}

function rateLimit(
  tokens: bigint,
  lastUpdated: bigint,
  enabled: boolean,
  capacity: bigint,
  rate: bigint,
) {
  return Buffer.concat([
    u64(tokens),
    u64(lastUpdated),
    Buffer.from([Number(enabled)]),
    u64(capacity),
    u64(rate),
  ])
}

function chainConfigData(): Buffer {
  const remotePool = Buffer.from('1234567890abcdef1234567890abcdef12345678', 'hex')
  const remoteToken = Buffer.from(
    '000000000000000000000000abcdef1234567890abcdef1234567890abcdef12',
    'hex',
  )
  return Buffer.concat([
    BorshAccountsCoder.accountDiscriminator('ChainConfig'),
    Buffer.from([1, 0, 0, 0]),
    Buffer.from([remotePool.length, 0, 0, 0]),
    remotePool,
    Buffer.from([remoteToken.length, 0, 0, 0]),
    remoteToken,
    Buffer.from([18]),
    rateLimit(25n, 100n, true, 50n, 5n),
    rateLimit(75n, 200n, false, 100n, 10n),
  ])
}

describe('GetTokenPoolRemote (cct/solana)', () => {
  const mint = key(2)
  const program = key(3)
  const selector = 5009297550715157269n

  function chain(accountData: Buffer | null = chainConfigData()): SolanaChain {
    return {
      connection: {
        getAccountInfo: async () => accountData && { owner: key(1), data: accountData },
      },
    } as unknown as SolanaChain
  }

  describe('query', () => {
    it('returns the decoded remote configuration', async () => {
      const remote = await SolanaTokenManager.fromChain(chain()).getTokenPoolRemote({
        tokenAddress: mint.toBase58(),
        poolProgramAddress: program.toBase58(),
        remoteChainSelector: selector,
      })

      assert.deepEqual(remote, {
        chainConfigAddress: deriveTokenPoolChainConfigPda(program, selector, mint).toBase58(),
        programId: program.toBase58(),
        config: {
          remoteTokenAddress: '0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef12',
          remotePoolAddresses: ['0x1234567890abcdef1234567890abcdef12345678'],
          remoteTokenDecimals: 18,
          inboundRateLimit: {
            tokens: 25n,
            lastUpdated: 100n,
            config: { enabled: true, capacity: 50n, rate: 5n },
          },
          outboundRateLimit: {
            tokens: 75n,
            lastUpdated: 200n,
            config: { enabled: false, capacity: 100n, rate: 10n },
          },
        },
      })
    })

    it('reports the derived account when the remote config is missing', async () => {
      await assert.rejects(
        SolanaTokenManager.fromChain(chain(null)).getTokenPoolRemote({
          tokenAddress: mint.toBase58(),
          poolProgramAddress: program.toBase58(),
          remoteChainSelector: selector,
        }),
        (error: unknown) => {
          assert.ok(error instanceof CCIPTokenPoolChainConfigNotFoundError)
          assert.equal(
            error.context.address,
            deriveTokenPoolChainConfigPda(program, selector, mint).toBase58(),
          )
          assert.equal(error.context.mint, mint.toBase58())
          assert.equal(error.context.poolProgram, program.toBase58())
          return true
        },
      )
    })

    it('wraps malformed remote config data with account context', async () => {
      await assert.rejects(
        SolanaTokenManager.fromChain(chain(Buffer.alloc(8))).getTokenPoolRemote({
          tokenAddress: mint.toBase58(),
          poolProgramAddress: program.toBase58(),
          remoteChainSelector: selector,
        }),
        (error: unknown) => {
          assert.ok(error instanceof CCTDataDecodeError)
          assert.equal(error.context.mint, mint.toBase58())
          assert.equal(error.context.poolProgram, program.toBase58())
          assert.equal(error.context.accountOwner, key(1).toBase58())
          return true
        },
      )
    })
  })

  describe('validation', () => {
    it('validates the token address and remote selector before reading', async () => {
      const cases: Array<[Partial<{ tokenAddress: string; remoteChainSelector: bigint }>, string]> =
        [
          [{ tokenAddress: 'invalid' }, 'tokenAddress'],
          [{ remoteChainSelector: -1n }, 'remoteChainSelector'],
          [{ remoteChainSelector: 1 as never }, 'remoteChainSelector'],
        ]
      for (const [opts, param] of cases) {
        await assert.rejects(
          SolanaTokenManager.fromChain(chain()).getTokenPoolRemote({
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
