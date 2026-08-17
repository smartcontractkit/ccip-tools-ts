import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import { tokenPoolCoder } from '../../../../solana/idl/token-pool-coder.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import { deriveTokenPoolConfigPda, resolveTokenPoolProgram } from '../../programs/token-pool.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const PROPOSED_OWNER = Keypair.generate().publicKey.toBase58()
const OWNER = Keypair.generate().publicKey
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function stateData(owner = OWNER): Buffer {
  const key = PublicKey.default.toBuffer()
  return Buffer.concat([
    BorshAccountsCoder.accountDiscriminator('State'),
    Buffer.from([1]),
    key,
    new PublicKey(TOKEN).toBuffer(),
    Buffer.from([6]),
    key,
    key,
    owner.toBuffer(),
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

function chain(owner = OWNER): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async () => ({ owner: PublicKey.default, data: stateData(owner) }),
    },
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return {
    ...chain(),
    connection: {
      simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 1,
      }),
      sendTransaction: async () => HASH,
      confirmTransaction: async () => ({ value: { err: null } }),
      getAccountInfo: async () => ({ owner: PublicKey.default, data: stateData() }),
    },
  } as unknown as SolanaChain
}

function generate(opts = {}) {
  return SolanaTokenManager.fromChain(chain()).generateUnsignedTransferPoolOwnership({
    tokenAddress: TOKEN,
    poolType: 'burn-mint',
    payer: PAYER,
    authority: AUTHORITY,
    proposedOwner: PROPOSED_OWNER,
    ...opts,
  })
}

describe('TransferPoolOwnership (cct/solana)', () => {
  describe('generate', () => {
    it('builds the ownership-transfer instruction', async () => {
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
      assert.equal(decoded.name, 'transferOwnership')
      assert.equal(
        (decoded.data as { proposedOwner: PublicKey }).proposedOwner.toBase58(),
        PROPOSED_OWNER,
      )
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
    it('rejects invalid public keys', async () => {
      for (const [opts, param] of [
        [{ tokenAddress: 'invalid' }, 'tokenAddress'],
        [{ proposedOwner: 'invalid' }, 'proposedOwner'],
        [{ proposedOwner: PublicKey.default.toBase58() }, 'proposedOwner'],
      ]) {
        await assert.rejects(
          () => generate(opts),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })

    it('rejects the current pool owner', async () => {
      await assert.rejects(
        () => generate({ proposedOwner: OWNER.toBase58() }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferPoolOwnership' &&
          err.context.param === 'proposedOwner' &&
          err.message.includes('must not be the current pool owner'),
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await SolanaTokenManager.fromChain(submitChain()).transferPoolOwnership({
        tokenAddress: TOKEN,
        poolType: 'burn-mint',
        proposedOwner: PROPOSED_OWNER,
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a non-wallet authority for signed transfer', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(chain()).transferPoolOwnership({
            tokenAddress: TOKEN,
            poolType: 'burn-mint',
            proposedOwner: PROPOSED_OWNER,
            authority: AUTHORITY,
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferPoolOwnership' &&
          err.context.param === 'authority',
      )
    })
  })
})
