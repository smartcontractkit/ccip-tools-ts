import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { lockReleaseTokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { deriveTokenPoolConfigPda, resolveTokenPoolProgram } from '../../programs/token-pool.ts'
import { SetCanAcceptLiquidity } from './set-can-accept-liquidity.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const ALLOW = true
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function chain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return Object.assign(chain(), {
    connection: {
      simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 1,
      }),
      sendTransaction: async () => HASH,
      confirmTransaction: async () => ({ value: { err: null } }),
    },
  })
}

function generate(opts = {}) {
  return new SetCanAcceptLiquidity().generate(chain(), {
    tokenAddress: TOKEN,
    poolType: 'lock-release',
    payer: PAYER,
    authority: AUTHORITY,
    allow: ALLOW,
    ...opts,
  })
}

describe('SetCanAcceptLiquidity (cct/solana)', () => {
  describe('generate', () => {
    it('builds the set-can-accept-liquidity instruction', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions
      const poolProgram = resolveTokenPoolProgram('lock-release')
      const decoded = lockReleaseTokenPoolCoder.instruction.decode(instruction!.data)

      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(instruction!.programId.toBase58(), poolProgram.toBase58())
      assert.deepEqual(
        instruction!.keys.map(({ pubkey, isSigner, isWritable }) => ({
          pubkey: pubkey.toBase58(),
          isSigner,
          isWritable,
        })),
        [
          {
            pubkey: deriveTokenPoolConfigPda(poolProgram, new PublicKey(TOKEN)).toBase58(),
            isSigner: false,
            isWritable: true,
          },
          { pubkey: TOKEN, isSigner: false, isWritable: false },
          { pubkey: AUTHORITY, isSigner: true, isWritable: false },
        ],
      )
      assert.ok(decoded)
      assert.equal(decoded.name, 'setCanAcceptLiquidity')
      assert.equal((decoded.data as { allow: boolean }).allow, ALLOW)
    })

    it('defaults authority to payer', async () => {
      const unsigned = await generate({ authority: undefined })

      assert.equal(unsigned.instructions[0]!.keys[2]!.pubkey.toBase58(), PAYER)
    })

    it('supports a compatible custom pool program', async () => {
      const poolProgramAddress = Keypair.generate().publicKey.toBase58()
      const unsigned = await generate({ poolType: undefined, poolProgramAddress })

      assert.equal(unsigned.instructions[0]?.programId.toBase58(), poolProgramAddress)
    })
  })

  describe('validation', () => {
    it('rejects invalid public keys, non-boolean values, and burn-mint pools', async () => {
      for (const [opts, param] of [
        [{ tokenAddress: 'invalid' }, 'tokenAddress'],
        [{ allow: 'true' }, 'allow'],
        [{ poolType: 'burn-mint' as const }, 'poolType'],
        [
          {
            poolType: undefined,
            poolProgramAddress: resolveTokenPoolProgram('burn-mint').toBase58(),
          },
          'poolProgramAddress',
        ],
      ]) {
        await assert.rejects(
          () => generate(opts),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await new SetCanAcceptLiquidity().execute(submitChain(), {
        tokenAddress: TOKEN,
        poolType: 'lock-release',
        allow: ALLOW,
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed configuration', async () => {
      await assert.rejects(
        () =>
          new SetCanAcceptLiquidity().execute(chain(), {
            tokenAddress: TOKEN,
            poolType: 'lock-release',
            allow: ALLOW,
            authority: AUTHORITY,
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setCanAcceptLiquidity' &&
          err.context.param === 'authority',
      )
    })
  })
})
