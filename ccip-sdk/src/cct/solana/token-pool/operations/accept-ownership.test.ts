import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { tokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { deriveTokenPoolConfigPda, resolveTokenPoolProgram } from '../../programs/token-pool.ts'
import { AcceptOwnership } from './accept-ownership.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function stateData(proposedOwner = AUTHORITY): Buffer {
  const key = PublicKey.default.toBuffer()
  return Buffer.concat([
    BorshAccountsCoder.accountDiscriminator('State'),
    Buffer.from([1]),
    key,
    new PublicKey(TOKEN).toBuffer(),
    Buffer.from([6]),
    key,
    key,
    key,
    new PublicKey(proposedOwner).toBuffer(),
    key,
    key,
    key,
    key,
    key,
    Buffer.from([0, 0]),
    Buffer.alloc(4),
    key,
  ])
}

function chain(proposedOwner = AUTHORITY): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async () => ({ owner: PublicKey.default, data: stateData(proposedOwner) }),
    },
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return Object.assign(chain(WALLET.publicKey.toBase58()), {
    connection: {
      simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 1,
      }),
      sendTransaction: async () => HASH,
      confirmTransaction: async () => ({ value: { err: null } }),
      getAccountInfo: async () => ({
        owner: PublicKey.default,
        data: stateData(WALLET.publicKey.toBase58()),
      }),
    },
  })
}

function generate(opts = {}) {
  return new AcceptOwnership().generate(chain(), {
    tokenAddress: TOKEN,
    poolType: 'burn-mint',
    payer: PAYER,
    authority: AUTHORITY,
    ...opts,
  })
}

describe('AcceptOwnership (cct/solana)', () => {
  describe('generate', () => {
    it('builds the ownership-acceptance instruction', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions
      const poolProgram = resolveTokenPoolProgram('burn-mint')
      const decoded = tokenPoolCoder.instruction.decode(instruction!.data)

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
      assert.equal(decoded.name, 'acceptOwnership')
    })

    it('defaults authority to payer', async () => {
      const unsigned = await new AcceptOwnership().generate(chain(PAYER), {
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        payer: PAYER,
      })

      assert.equal(unsigned.instructions[0]!.keys[2]!.pubkey.toBase58(), PAYER)
    })

    it('supports a compatible custom pool program', async () => {
      const poolProgramAddress = Keypair.generate().publicKey.toBase58()
      const unsigned = await generate({ poolType: undefined, poolProgramAddress })

      assert.equal(unsigned.instructions[0]?.programId.toBase58(), poolProgramAddress)
    })
  })

  describe('validation', () => {
    it('rejects an authority that is not the proposed owner', async () => {
      await assert.rejects(
        () => generate({ authority: PAYER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'authority' &&
          err.message.includes('must be the proposed owner'),
      )
    })

    it('rejects when there is no proposed owner', async () => {
      await assert.rejects(
        () =>
          new AcceptOwnership().generate(chain(PublicKey.default.toBase58()), {
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            payer: PAYER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'authority' &&
          err.message.includes('no proposed owner'),
      )
    })

    it('rejects invalid public keys', async () => {
      for (const [opts, param] of [
        [{ tokenAddress: 'invalid' }, 'tokenAddress'],
        [{ authority: 'invalid' }, 'authority'],
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
      const result = await new AcceptOwnership().execute(submitChain(), {
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed acceptance', async () => {
      await assert.rejects(
        () =>
          new AcceptOwnership().execute(chain(), {
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            authority: AUTHORITY,
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'acceptOwnership' &&
          err.context.param === 'authority',
      )
    })
  })
})
