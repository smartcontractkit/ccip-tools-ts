import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

import { CCIPTokenPoolStateNotFoundError } from '../../../../errors/index.ts'
import { tokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTDataDecodeError, CCTParamsInvalidError } from '../../../errors.ts'
import {
  TOKEN_POOL_PROGRAMS,
  decodeTokenPoolState,
  deriveTokenPoolConfigPda,
  resolveTokenPoolProgram,
} from '../../programs/token-pool.ts'
import { GetTokenPoolState } from './get-token-pool-state.ts'

function key(byte: number): PublicKey {
  return new PublicKey(Uint8Array.from({ length: 32 }, () => byte))
}

function stateData(mint: PublicKey): Buffer {
  return Buffer.concat([
    BorshAccountsCoder.accountDiscriminator('State'),
    Buffer.from([1]),
    key(3).toBuffer(),
    mint.toBuffer(),
    Buffer.from([6]),
    key(4).toBuffer(),
    key(5).toBuffer(),
    key(6).toBuffer(),
    key(7).toBuffer(),
    key(8).toBuffer(),
    key(9).toBuffer(),
    key(10).toBuffer(),
    key(11).toBuffer(),
    Buffer.from([1, 1]),
    Buffer.from([2, 0, 0, 0]),
    key(12).toBuffer(),
    key(13).toBuffer(),
    key(14).toBuffer(),
  ])
}

/**
 * Stub chain whose pool state for `mint` exists only under `poolProgram`. `typeAndVersion`
 * reports `type`, or rejects like a program without `typeVersion`.
 */
function poolChain(mint: PublicKey, poolProgram: PublicKey, type?: string): SolanaChain {
  const state = deriveTokenPoolConfigPda(poolProgram, mint)
  const account = { owner: poolProgram, data: stateData(mint) }
  return {
    connection: {
      getAccountInfo: async (address: PublicKey) => (address.equals(state) ? account : null),
      getMultipleAccountsInfo: async (addresses: PublicKey[]) =>
        addresses.map((address) => (address.equals(state) ? account : null)),
    },
    typeAndVersion: async () => {
      if (type === undefined) throw new Error('typeVersion not implemented')
      return [type, '1.6.0', `${type} 1.6.0`]
    },
  } as unknown as SolanaChain
}

describe('GetTokenPoolState (cct/solana)', () => {
  describe('query', () => {
    it('returns decoded state fields of the resolved canonical pool', async () => {
      const mint = key(2)
      const poolProgram = resolveTokenPoolProgram('lock-release')
      const state = await new GetTokenPoolState().query(poolChain(mint, poolProgram), {
        tokenAddress: mint.toBase58(),
      })

      assert.equal(state.programId, poolProgram.toBase58())
      assert.equal(state.stateAddress, deriveTokenPoolConfigPda(poolProgram, mint).toBase58())
      assert.equal(state.version, 1)
      assert.equal(state.config.mint, mint.toBase58())
      assert.equal(state.config.decimals, 6)
      assert.ok('canAcceptLiquidity' in state.config)
      assert.equal(state.config.rebalancer, key(11).toBase58())
      assert.equal(state.config.canAcceptLiquidity, true)
      assert.equal(state.config.listEnabled, true)
      assert.deepEqual(state.config.allowList, [key(12).toBase58(), key(13).toBase58()])
      assert.equal(state.config.rmnRemote, key(14).toBase58())
    })

    it('picks the result arm from the resolved pool program', async () => {
      const mint = key(2)
      const custom = key(15)
      const read = (chain: SolanaChain, poolProgramAddress?: string) =>
        new GetTokenPoolState().query(chain, { tokenAddress: mint.toBase58(), poolProgramAddress })
      const hasLiquidityFields = (config: object) =>
        'rebalancer' in config && 'canAcceptLiquidity' in config

      const burnMint = await read(poolChain(mint, resolveTokenPoolProgram('burn-mint')))
      assert.equal(burnMint.programId, TOKEN_POOL_PROGRAMS['burn-mint'])
      assert.ok(!hasLiquidityFields(burnMint.config))

      // The canonical lock-release program selects the lock-release arm even when passed explicitly.
      const lockRelease = resolveTokenPoolProgram('lock-release')
      assert.ok(
        hasLiquidityFields(
          (await read(poolChain(mint, lockRelease), lockRelease.toBase58())).config,
        ),
      )

      const customLockRelease = await read(
        poolChain(mint, custom, 'LockReleaseTokenPool'),
        custom.toBase58(),
      )
      assert.equal(customLockRelease.programId, custom.toBase58())
      assert.ok(hasLiquidityFields(customLockRelease.config))

      for (const type of ['BurnMintTokenPool', undefined]) {
        const customBase = await read(poolChain(mint, custom, type), custom.toBase58())
        assert.equal(customBase.programId, custom.toBase58())
        assert.ok(!hasLiquidityFields(customBase.config))
      }
    })

    it('wraps decode failures with pool context', async () => {
      const mint = key(2).toBase58()
      const poolProgram = key(15).toBase58()
      const chain = {
        connection: { getAccountInfo: async () => ({ owner: key(1), data: Buffer.alloc(8) }) },
      } as unknown as SolanaChain

      await assert.rejects(
        new GetTokenPoolState().query(chain, {
          tokenAddress: mint,
          poolProgramAddress: poolProgram,
        }),
        (error: unknown) => {
          assert.ok(error instanceof CCTDataDecodeError)
          assert.equal(
            error.context.account,
            deriveTokenPoolConfigPda(new PublicKey(poolProgram), new PublicKey(mint)).toBase58(),
          )
          assert.equal(error.context.mint, mint)
          assert.equal(error.context.poolProgram, poolProgram)
          assert.equal(error.context.accountOwner, key(1).toBase58())
          assert.ok(error.cause instanceof Error)
          return true
        },
      )
    })

    it('wraps non-Error decode causes', (t) => {
      t.mock.method(tokenPoolCoder.accounts, 'decode', () => {
        throw 'invalid account data'
      })

      assert.throws(
        () =>
          decodeTokenPoolState(Buffer.alloc(8), {
            tokenPool: key(1).toBase58(),
            mint: key(2).toBase58(),
            poolProgram: key(3).toBase58(),
            accountOwner: key(4).toBase58(),
          }),
        (error: unknown) => {
          assert.ok(error instanceof CCTDataDecodeError)
          assert.ok(error.cause instanceof Error)
          assert.equal(error.cause.message, 'invalid account data')
          return true
        },
      )
    })

    it('includes the mint and program in missing-state context', async () => {
      const mint = key(2).toBase58()
      const poolProgram = key(15).toBase58()
      const chain = {
        connection: { getAccountInfo: async () => null },
      } as unknown as SolanaChain

      await assert.rejects(
        new GetTokenPoolState().query(chain, {
          tokenAddress: mint,
          poolProgramAddress: poolProgram,
        }),
        (error: unknown) => {
          assert.ok(error instanceof CCIPTokenPoolStateNotFoundError)
          assert.match(error.message, /^TokenPool State PDA not found at /)
          assert.equal(error.context.mint, mint)
          assert.equal(error.context.poolProgram, poolProgram)
          return true
        },
      )
    })
  })

  describe('validation', () => {
    it('rejects invalid addresses before any RPC', async () => {
      for (const [params, param] of [
        [{ tokenAddress: 'nope' }, 'tokenAddress'],
        [{ tokenAddress: key(2).toBase58(), poolProgramAddress: 'nope' }, 'poolProgramAddress'],
      ] as const) {
        await assert.rejects(
          new GetTokenPoolState().query({} as SolanaChain, params),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })

    it('rejects a mint without a canonical pool', async () => {
      const mint = key(2)

      await assert.rejects(
        new GetTokenPoolState().query(poolChain(mint, key(15)), { tokenAddress: mint.toBase58() }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'tokenAddress',
      )
    })
  })
})
