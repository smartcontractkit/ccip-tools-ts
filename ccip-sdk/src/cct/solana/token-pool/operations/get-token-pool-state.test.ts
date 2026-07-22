import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

import { GetTokenPoolState } from './get-token-pool-state.ts'
import { CCIPTokenPoolStateNotFoundError } from '../../../../errors/index.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTTokenPoolStateDecodeError } from '../../../errors.ts'

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

describe('Solana token pool getTokenPoolState', () => {
  it('returns decoded state fields', async () => {
    const mint = key(2)
    const chain = {
      connection: { getAccountInfo: async () => ({ owner: key(1), data: stateData(mint) }) },
    } as unknown as SolanaChain

    const getTokenPoolState = new GetTokenPoolState()
    const lockRelease = await getTokenPoolState.query(chain, {
      poolType: 'lock-release',
      tokenAddress: mint.toBase58(),
    })
    const burnMint = await getTokenPoolState.query(chain, {
      poolType: 'burn-mint',
      tokenAddress: mint.toBase58(),
    })
    const customProgram = key(15).toBase58()
    const custom = await getTokenPoolState.query(chain, {
      poolProgramAddress: customProgram,
      tokenAddress: mint.toBase58(),
    })

    assert.equal(lockRelease.version, 1)
    assert.equal(lockRelease.config.mint, mint.toBase58())
    assert.equal(lockRelease.config.decimals, 6)
    assert.equal(lockRelease.config.canAcceptLiquidity, true)
    assert.equal(lockRelease.config.listEnabled, true)
    assert.deepEqual(lockRelease.config.allowList, [key(12).toBase58(), key(13).toBase58()])
    assert.equal(lockRelease.config.rmnRemote, key(14).toBase58())
    assert.ok(!('rebalancer' in burnMint.config))
    assert.ok(!('canAcceptLiquidity' in burnMint.config))
    assert.equal(custom.programId, customProgram)
    assert.equal(custom.config.mint, mint.toBase58())
  })

  it('wraps decode failures with pool context', async () => {
    const mint = key(2).toBase58()
    const poolProgram = key(15).toBase58()
    const chain = {
      connection: { getAccountInfo: async () => ({ owner: key(1), data: Buffer.alloc(8) }) },
    } as unknown as SolanaChain

    await assert.rejects(
      new GetTokenPoolState().query(chain, { tokenAddress: mint, poolProgramAddress: poolProgram }),
      (error: unknown) => {
        assert.ok(error instanceof CCTTokenPoolStateDecodeError)
        assert.equal(error.context.mint, mint)
        assert.equal(error.context.poolProgram, poolProgram)
        assert.ok(error.cause instanceof Error)
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
      new GetTokenPoolState().query(chain, { tokenAddress: mint, poolProgramAddress: poolProgram }),
      (error: unknown) => {
        assert.ok(error instanceof CCIPTokenPoolStateNotFoundError)
        assert.match(error.message, /^TokenPool State PDA not found at /)
        assert.equal(error.context.mint, mint)
        assert.equal(error.context.poolProgram, poolProgram)
        return true
      },
    )
  })

  it('requires exactly one pool program reference', async () => {
    const getTokenPoolState = new GetTokenPoolState()
    const tokenAddress = key(2).toBase58()
    const poolProgramAddress = key(15).toBase58()

    await assert.rejects(
      getTokenPoolState.query(
        {} as SolanaChain,
        {
          tokenAddress,
          poolType: 'burn-mint',
          poolProgramAddress,
        } as never,
      ),
    )
    await assert.rejects(getTokenPoolState.query({} as SolanaChain, { tokenAddress } as never))
  })
})
