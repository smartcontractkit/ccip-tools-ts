import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { Keypair, PublicKey } from '@solana/web3.js'

import {
  CCIPTokenAccountNotFoundError,
  CCIPTokenMintInvalidError,
  CCIPTokenMintNotFoundError,
} from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import { U64_MAX } from '../../validate.ts'

const TOKEN = Keypair.generate().publicKey
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const DELEGATE = Keypair.generate().publicKey.toBase58()
const TOKEN_ACCOUNT = Keypair.generate().publicKey.toBase58()
const MULTISIG = Keypair.generate().publicKey.toBase58()
const MULTISIG_SIGNER = Keypair.generate().publicKey.toBase58()
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = { publicKey: Keypair.generate().publicKey, signTransaction: async <T>(tx: T) => tx }

function chain(
  mintOwner: PublicKey | null = TOKEN_PROGRAM_ID,
  tokenAccountExists = true,
): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async (address: PublicKey) => {
        if (!mintOwner || address.equals(TOKEN)) return mintOwner ? { owner: mintOwner } : null
        return tokenAccountExists ? { owner: mintOwner, data: Buffer.alloc(165) } : null
      },
    },
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return {
    ...chain(),
    connection: {
      getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(165) }),
      simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 1,
      }),
      sendTransaction: async () => HASH,
      confirmTransaction: async () => ({ value: { err: null } }),
    },
  } as unknown as SolanaChain
}

function generate(opts: Record<string, unknown> = {}, mintOwner?: PublicKey | null) {
  return SolanaTokenManager.fromChain(chain(mintOwner)).generateUnsignedApproveToken({
    payer: PAYER,
    tokenAddress: TOKEN.toBase58(),
    delegate: DELEGATE,
    authority: AUTHORITY,
    amount: 1_000_000n,
    ...opts,
  })
}

describe('ApproveToken (cct/solana)', () => {
  describe('generate', () => {
    it('derives the authority ATA and approves the delegate', async () => {
      const unsigned = await generate()
      const ata = getAssociatedTokenAddressSync(
        TOKEN,
        new PublicKey(AUTHORITY),
        true,
        TOKEN_PROGRAM_ID,
      )
      const [instruction] = unsigned.instructions

      assert.ok(instruction)
      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(instruction.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58())
      assert.equal(instruction.data[0], 4) // Approve
      assert.equal(instruction.data.readBigUInt64LE(1), 1_000_000n)
      assert.deepEqual(
        instruction.keys.slice(0, 3).map(({ pubkey, isSigner }) => ({
          pubkey: pubkey.toBase58(),
          isSigner,
        })),
        [
          { pubkey: ata.toBase58(), isSigner: false },
          { pubkey: DELEGATE, isSigner: false },
          { pubkey: AUTHORITY, isSigner: true },
        ],
      )
    })

    it('uses an explicitly supplied token account', async () => {
      const unsigned = await generate({ tokenAccount: TOKEN_ACCOUNT })
      assert.equal(unsigned.instructions[0]!.keys[0]!.pubkey.toBase58(), TOKEN_ACCOUNT)
    })

    it('supports Token-2022 multisig authorities', async () => {
      const unsigned = await generate(
        { authority: MULTISIG, multisigSigners: [MULTISIG_SIGNER] },
        TOKEN_2022_PROGRAM_ID,
      )
      const ata = getAssociatedTokenAddressSync(
        TOKEN,
        new PublicKey(MULTISIG),
        true,
        TOKEN_2022_PROGRAM_ID,
      )
      const [instruction] = unsigned.instructions

      assert.ok(instruction)
      assert.equal(instruction.programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58())
      assert.equal(instruction.keys[0]!.pubkey.toBase58(), ata.toBase58())
      assert.deepEqual(
        instruction.keys
          .slice(2)
          .map(({ pubkey, isSigner }) => ({ pubkey: pubkey.toBase58(), isSigner })),
        [
          { pubkey: MULTISIG, isSigner: false },
          { pubkey: MULTISIG_SIGNER, isSigner: true },
        ],
      )
    })

    it('defaults authority to payer and supports zero through maximum u64 allowances', async () => {
      const zero = await generate({ amount: 0n })
      const maximum = await generate({ authority: undefined, amount: U64_MAX })

      assert.equal(zero.instructions[0]!.data.readBigUInt64LE(1), 0n)
      assert.equal(maximum.instructions[0]!.keys[2]!.pubkey.toBase58(), PAYER)
      assert.equal(maximum.instructions[0]!.data.readBigUInt64LE(1), U64_MAX)
    })
  })

  describe('validation', () => {
    it('rejects invalid parameters', async () => {
      for (const [opts, param] of [
        [{ tokenAddress: 'invalid' }, 'tokenAddress'],
        [{ tokenAccount: 'invalid' }, 'tokenAccount'],
        [{ delegate: 'invalid' }, 'delegate'],
        [{ authority: 'invalid' }, 'authority'],
        [{ amount: 1 }, 'amount'],
        [{ amount: U64_MAX + 1n }, 'amount'],
        [{ multisigSigners: 'invalid' }, 'multisigSigners'],
        [{ multisigSigners: ['invalid'] }, 'multisigSigners[0]'],
      ] as const) {
        await assert.rejects(
          () => generate(opts),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })

    it('rejects a missing token account before submission', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(chain(TOKEN_PROGRAM_ID, false)).generateUnsignedApproveToken(
            {
              payer: PAYER,
              tokenAddress: TOKEN.toBase58(),
              delegate: DELEGATE,
              amount: 1n,
            },
          ),
        (err: unknown) => err instanceof CCIPTokenAccountNotFoundError,
      )
    })

    it('rejects missing and non-token mints', async () => {
      await assert.rejects(
        () => generate({}, null),
        (err: unknown) => err instanceof CCIPTokenMintNotFoundError,
      )
      await assert.rejects(
        () => generate({}, Keypair.generate().publicKey),
        (err: unknown) => err instanceof CCIPTokenMintInvalidError,
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      const result = await SolanaTokenManager.fromChain(submitChain()).approveToken({
        tokenAddress: TOKEN.toBase58(),
        delegate: DELEGATE,
        amount: 1n,
        wallet: WALLET,
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('requires unsigned generation for SPL multisig and external authorities', async () => {
      for (const opts of [
        { authority: MULTISIG, multisigSigners: [MULTISIG_SIGNER] },
        { authority: AUTHORITY },
      ]) {
        await assert.rejects(
          () =>
            SolanaTokenManager.fromChain(chain()).approveToken({
              tokenAddress: TOKEN.toBase58(),
              delegate: DELEGATE,
              amount: 1n,
              wallet: WALLET,
              ...opts,
            }),
          (err: unknown) => err instanceof CCTParamsInvalidError,
        )
      }
    })
  })
})
