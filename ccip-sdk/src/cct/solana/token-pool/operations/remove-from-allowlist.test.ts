import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'

import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { tokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { deriveTokenPoolConfigPda, resolveTokenPoolProgram } from '../../programs/token-pool.ts'
import { RemoveFromAllowlist } from './remove-from-allowlist.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const ALLOWED = Keypair.generate().publicKey.toBase58()
const SECOND_ALLOWED = Keypair.generate().publicKey.toBase58()
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function stubChain(): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return Object.assign(stubChain(), {
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
  return new RemoveFromAllowlist().generate(stubChain(), {
    tokenAddress: TOKEN,
    poolType: 'burn-mint',
    payer: PAYER,
    authority: AUTHORITY,
    remove: [ALLOWED],
    ...opts,
  })
}

describe('RemoveFromAllowlist (cct/solana)', () => {
  describe('generate', () => {
    it('builds an unsigned remove from allowlist instruction', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions
      const poolProgram = resolveTokenPoolProgram('burn-mint')

      assert.ok(instruction)
      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(instruction.programId.toBase58(), poolProgram.toBase58())
      assert.equal(
        instruction.data.subarray(0, 8).toString('hex'),
        createHash('sha256').update('global:remove_from_allow_list').digest('hex').slice(0, 16),
      )
      assert.deepEqual(
        instruction.keys.map(({ pubkey, isSigner, isWritable }) => ({
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
          { pubkey: AUTHORITY, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId.toBase58(), isSigner: false, isWritable: false },
        ],
      )
    })

    it('encodes multiple addresses', async () => {
      const unsigned = await generate({ remove: [ALLOWED, SECOND_ALLOWED] })
      const decoded = tokenPoolCoder.instruction.decode(unsigned.instructions[0]!.data)

      assert.ok(decoded)
      assert.equal(decoded.name, 'removeFromAllowList')
      assert.deepEqual(
        (decoded.data as { remove: PublicKey[] }).remove.map((address) => address.toBase58()),
        [ALLOWED, SECOND_ALLOWED],
      )
    })

    it('uses a compatible custom pool program', async () => {
      const poolProgramAddress = Keypair.generate().publicKey.toBase58()
      const unsigned = await new RemoveFromAllowlist().generate(stubChain(), {
        tokenAddress: TOKEN,
        poolProgramAddress,
        payer: PAYER,
        authority: AUTHORITY,
        remove: [ALLOWED],
      })

      assert.equal(unsigned.instructions[0]?.programId.toBase58(), poolProgramAddress)
    })
  })

  describe('validation', () => {
    it('rejects invalid pool program references', async () => {
      await assert.rejects(
        () => generate({ poolType: 'custom' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'removeFromAllowlist' &&
          err.context.param === 'poolType',
      )
    })

    it('rejects an empty or non-array removal list', async () => {
      for (const remove of [[], 'not-an-array']) {
        await assert.rejects(
          () => generate({ remove }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'removeFromAllowlist' &&
            err.context.param === 'remove',
        )
      }
    })

    it('rejects invalid removal addresses', async () => {
      await assert.rejects(
        () => generate({ remove: ['not-a-pubkey'] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'removeFromAllowlist' &&
          err.context.param === 'remove[0]',
      )
    })

    it('rejects duplicate removal addresses', async () => {
      await assert.rejects(
        () => generate({ remove: [ALLOWED, ALLOWED] }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'removeFromAllowlist' &&
          err.context.param === 'remove',
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await new RemoveFromAllowlist().execute(submitChain(), {
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        remove: [ALLOWED],
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed removal', async () => {
      await assert.rejects(
        () =>
          new RemoveFromAllowlist().execute(stubChain(), {
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            authority: AUTHORITY,
            remove: [ALLOWED],
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'removeFromAllowlist' &&
          err.context.param === 'authority',
      )
    })
  })
})
