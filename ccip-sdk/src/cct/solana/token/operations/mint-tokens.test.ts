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
const RECIPIENT = Keypair.generate().publicKey
const MULTISIG = Keypair.generate().publicKey.toBase58()
const MULTISIG_SIGNER_1 = Keypair.generate().publicKey.toBase58()
const MULTISIG_SIGNER_2 = Keypair.generate().publicKey.toBase58()
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function chain(mintOwner: PublicKey | null = TOKEN_PROGRAM_ID): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      getAccountInfo: async () =>
        mintOwner ? { owner: mintOwner, data: Buffer.alloc(165) } : null,
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
  return SolanaTokenManager.fromChain(chain(mintOwner)).generateUnsignedMintTokens({
    payer: PAYER,
    tokenAddress: TOKEN.toBase58(),
    recipient: RECIPIENT.toBase58(),
    amount: 1_000_000n,
    authority: AUTHORITY,
    ...opts,
  })
}

describe('MintTokens (cct/solana)', () => {
  describe('generate', () => {
    it('mints to the recipient ATA using the detected token program', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions
      const ata = getAssociatedTokenAddressSync(TOKEN, RECIPIENT, true, TOKEN_PROGRAM_ID)

      assert.ok(instruction)
      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(instruction.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58())
      assert.equal(instruction.data[0], 7) // MintTo
      assert.equal(instruction.keys[0]!.pubkey.toBase58(), TOKEN.toBase58())
      assert.equal(instruction.keys[1]!.pubkey.toBase58(), ata.toBase58())
      assert.equal(instruction.keys[2]!.pubkey.toBase58(), AUTHORITY)
      assert.equal(instruction.data.readBigUInt64LE(1), 1_000_000n)
    })

    it('supports Token-2022 and SPL Token multisig authorities', async () => {
      const unsigned = await generate(
        {
          authority: MULTISIG,
          multisigSigners: [MULTISIG_SIGNER_1, MULTISIG_SIGNER_2],
        },
        TOKEN_2022_PROGRAM_ID,
      )

      assert.equal(unsigned.instructions[0]!.programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58())
      assert.deepEqual(
        unsigned.instructions[0]!.keys.slice(2).map(({ pubkey, isSigner }) => ({
          pubkey: pubkey.toBase58(),
          isSigner,
        })),
        [
          { pubkey: MULTISIG, isSigner: false },
          { pubkey: MULTISIG_SIGNER_1, isSigner: true },
          { pubkey: MULTISIG_SIGNER_2, isSigner: true },
        ],
      )
    })

    it('rejects a missing recipient ATA before simulation', async () => {
      const missingAtaChain = {
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        connection: {
          getAccountInfo: async (address: PublicKey) =>
            address.equals(TOKEN) ? { owner: TOKEN_PROGRAM_ID } : null,
        },
      } as unknown as SolanaChain

      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(missingAtaChain).generateUnsignedMintTokens({
            payer: PAYER,
            tokenAddress: TOKEN.toBase58(),
            recipient: RECIPIENT.toBase58(),
            amount: 1n,
          }),
        (error: unknown) =>
          error instanceof CCIPTokenAccountNotFoundError &&
          error.context.token === TOKEN.toBase58() &&
          error.context.holder === RECIPIENT.toBase58(),
      )
    })

    it('encodes the maximum u64 amount', async () => {
      const unsigned = await generate({ amount: U64_MAX })
      assert.equal(unsigned.instructions[0]!.data.readBigUInt64LE(1), U64_MAX)
    })

    it('defaults authority to payer', async () => {
      const unsigned = await generate({ authority: undefined })
      assert.equal(unsigned.instructions[0]!.keys[2]!.pubkey.toBase58(), PAYER)
    })
  })

  describe('validation', () => {
    it('rejects invalid parameters', async () => {
      for (const [opts, param] of [
        [{ tokenAddress: 'invalid' }, 'tokenAddress'],
        [{ recipient: 'invalid' }, 'recipient'],
        [{ authority: 'invalid' }, 'authority'],
        [{ amount: 0n }, 'amount'],
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
      const result = await SolanaTokenManager.fromChain(submitChain()).mintTokens({
        tokenAddress: TOKEN.toBase58(),
        recipient: RECIPIENT.toBase58(),
        amount: 1n,
        wallet: WALLET,
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('requires unsigned generation for SPL multisig authorities', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(chain()).mintTokens({
            tokenAddress: TOKEN.toBase58(),
            recipient: RECIPIENT.toBase58(),
            amount: 1n,
            authority: MULTISIG,
            multisigSigners: [MULTISIG_SIGNER_1],
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'multisigSigners',
      )
    })

    it('rejects a non-wallet authority for signed minting', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(chain()).mintTokens({
            tokenAddress: TOKEN.toBase58(),
            recipient: RECIPIENT.toBase58(),
            amount: 1n,
            authority: AUTHORITY,
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'mintTokens' &&
          err.context.param === 'authority',
      )
    })
  })
})
