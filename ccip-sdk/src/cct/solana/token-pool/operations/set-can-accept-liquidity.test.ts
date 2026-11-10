import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { lockReleaseTokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
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
    connection: {
      getMultipleAccountsInfo: async () => [null, {}], // only the canonical lock-release pool
      getAccountInfo: async () => ({}), // any custom pool program's state
    },
    // a pre-2.0 lock-release pool
    typeAndVersion: async () => ['lockreleaseTokenPool', '1.6.2', 'lockrelease-token-pool 1.6.2'],
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return Object.assign(chain(), {
    connection: {
      getMultipleAccountsInfo: async () => [null, {}],
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
      const unsigned = await generate({ poolProgramAddress })

      assert.equal(unsigned.instructions[0]?.programId.toBase58(), poolProgramAddress)
    })
  })

  describe('validation', () => {
    it('rejects invalid public keys, non-boolean values, and burn-mint pools', async () => {
      for (const [opts, param] of [
        [{ tokenAddress: 'invalid' }, 'tokenAddress'],
        [{ allow: 'true' }, 'allow'],
        [
          {
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

  describe('CCIP 2.0', () => {
    const withVersion = (typeAndVersion: string[]) =>
      Object.assign(chain(), { typeAndVersion: async () => typeAndVersion })

    it('rejects 2.0 pools, which removed the instruction, before building', async () => {
      await assert.rejects(
        () =>
          new SetCanAcceptLiquidity().generate(
            withVersion(['lockreleaseTokenPool', '2.0.0', 'lockrelease-token-pool 2.0.0']),
            {
              tokenAddress: TOKEN,
              payer: PAYER,
              allow: ALLOW,
            },
          ),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'setCanAcceptLiquidity' &&
          err.context.version === '2.0.0',
      )
    })

    it('surfaces typeVersion RPC failures instead of assuming a pre-2.0 pool', async () => {
      // the canonical program may be 2.0, so building the removed instruction would fail on-chain
      const rpcError = new Error('429 Too Many Requests')
      const failing = Object.assign(chain(), { typeAndVersion: () => Promise.reject(rpcError) })
      await assert.rejects(
        () =>
          new SetCanAcceptLiquidity().generate(failing, {
            tokenAddress: TOKEN,
            payer: PAYER,
            allow: ALLOW,
          }),
        rpcError,
      )
    })

    it('still builds for pre-2.0 pools', async () => {
      const unsigned = await new SetCanAcceptLiquidity().generate(
        withVersion(['lockreleaseTokenPool', '1.6.2', 'lockrelease-token-pool 1.6.2']),
        {
          tokenAddress: TOKEN,
          payer: PAYER,
          allow: ALLOW,
        },
      )
      assert.equal(
        lockReleaseTokenPoolCoder.instruction.decode(unsigned.instructions[0]!.data)?.name,
        'setCanAcceptLiquidity',
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await new SetCanAcceptLiquidity().execute(submitChain(), {
        tokenAddress: TOKEN,
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
