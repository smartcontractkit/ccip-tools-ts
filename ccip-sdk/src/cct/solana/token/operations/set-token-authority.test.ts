import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Keypair, PublicKey } from '@solana/web3.js'

import { CCIPTokenMintInvalidError, CCIPTokenMintNotFoundError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const AUTHORITY = Keypair.generate().publicKey.toBase58()
const NEW_AUTHORITY = Keypair.generate().publicKey.toBase58()
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
      getAccountInfo: async () => (mintOwner ? { owner: mintOwner } : null),
    },
  } as unknown as SolanaChain
}

function submitChain(): SolanaChain {
  return Object.assign(chain(), {
    connection: {
      getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }),
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

function generate(opts: Record<string, unknown> = {}, mintOwner?: PublicKey | null) {
  return SolanaTokenManager.fromChain(chain(mintOwner)).generateUnsignedSetTokenAuthority({
    tokenAddress: TOKEN,
    payer: PAYER,
    authority: AUTHORITY,
    newAuthority: NEW_AUTHORITY,
    authorityTypes: ['mint', 'freeze'],
    ...opts,
  })
}

describe('SetTokenAuthority (cct/solana)', () => {
  describe('generate', () => {
    it('builds selected mint and freeze authority updates', async () => {
      const unsigned = await generate()

      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(unsigned.instructions.length, 2)
      assert.deepEqual(
        unsigned.instructions.map((instruction) => ({
          programId: instruction.programId.toBase58(),
          authorityType: instruction.data[1],
          mint: instruction.keys[0]!.pubkey.toBase58(),
          authority: instruction.keys[1]!.pubkey.toBase58(),
          newAuthority: instruction.data.subarray(3).toString('hex'),
        })),
        [
          {
            programId: TOKEN_PROGRAM_ID.toBase58(),
            authorityType: 0, // MintTokens
            mint: TOKEN,
            authority: AUTHORITY,
            newAuthority: new PublicKey(NEW_AUTHORITY).toBuffer().toString('hex'),
          },
          {
            programId: TOKEN_PROGRAM_ID.toBase58(),
            authorityType: 1, // FreezeAccount
            mint: TOKEN,
            authority: AUTHORITY,
            newAuthority: new PublicKey(NEW_AUTHORITY).toBuffer().toString('hex'),
          },
        ],
      )
    })

    it('builds only the selected authority update for Token-2022', async () => {
      const unsigned = await generate({ authorityTypes: ['freeze'] }, TOKEN_2022_PROGRAM_ID)

      assert.equal(unsigned.instructions.length, 1)
      assert.equal(unsigned.instructions[0]!.programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58())
      assert.equal(unsigned.instructions[0]!.data[1], 1) // FreezeAccount
    })

    it('includes SPL multisig member signers', async () => {
      const unsigned = await generate({
        authority: MULTISIG,
        authorityTypes: ['mint'],
        multisigSigners: [MULTISIG_SIGNER_1, MULTISIG_SIGNER_2],
      })

      assert.deepEqual(
        unsigned.instructions[0]!.keys.map(({ pubkey, isSigner, isWritable }) => ({
          pubkey: pubkey.toBase58(),
          isSigner,
          isWritable,
        })),
        [
          { pubkey: TOKEN, isSigner: false, isWritable: true },
          { pubkey: MULTISIG, isSigner: false, isWritable: false },
          { pubkey: MULTISIG_SIGNER_1, isSigner: true, isWritable: false },
          { pubkey: MULTISIG_SIGNER_2, isSigner: true, isWritable: false },
        ],
      )
    })

    it('builds authority revocation with a null new authority', async () => {
      const unsigned = await generate({ authorityTypes: ['mint'], newAuthority: null })
      const [instruction] = unsigned.instructions

      assert.ok(instruction)
      assert.equal(instruction.data[0], 6) // SetAuthority
      assert.equal(instruction.data[1], 0) // MintTokens
      assert.equal(instruction.data[2], 0) // COption<PublicKey>::None
      assert.equal(instruction.data.length, 3)
    })

    it('defaults authority to payer', async () => {
      const unsigned = await generate({ authority: undefined })

      assert.equal(unsigned.instructions[0]!.keys[1]!.pubkey.toBase58(), PAYER)
    })
  })

  describe('validation', () => {
    it('rejects invalid public keys', async () => {
      for (const param of ['tokenAddress', 'newAuthority', 'authority']) {
        await assert.rejects(
          () => generate({ [param]: 'invalid' }),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })

    it('rejects invalid multisig signers', async () => {
      for (const [multisigSigners, param] of [
        ['invalid', 'multisigSigners'],
        [['invalid'], 'multisigSigners[0]'],
      ]) {
        await assert.rejects(
          () => generate({ multisigSigners }),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })

    it('reports invalid authority role selections', async () => {
      const cases: [unknown, string][] = [
        [undefined, 'must be an array'],
        [[], 'must not be empty'],
        [['mint', 'mint'], 'must not contain duplicates'],
        [['close'], 'must contain only mint and/or freeze'],
      ]
      for (const [authorityTypes, message] of cases) {
        await assert.rejects(
          () => generate({ authorityTypes }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.param === 'authorityTypes' &&
            err.message.includes(message),
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
      const result = await SolanaTokenManager.fromChain(submitChain()).setTokenAuthority({
        tokenAddress: TOKEN,
        newAuthority: NEW_AUTHORITY,
        authorityTypes: ['mint'],
        wallet: WALLET,
      })

      assert.deepEqual(result, { hash: HASH })
    })

    it('requires unsigned generation for SPL multisig authorities', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(chain()).setTokenAuthority({
            tokenAddress: TOKEN,
            newAuthority: NEW_AUTHORITY,
            authority: MULTISIG,
            authorityTypes: ['mint'],
            multisigSigners: [MULTISIG_SIGNER_1],
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'multisigSigners',
      )
    })

    it('rejects a non-wallet authority for signed updates', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(chain()).setTokenAuthority({
            tokenAddress: TOKEN,
            newAuthority: NEW_AUTHORITY,
            authority: AUTHORITY,
            authorityTypes: ['mint'],
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setTokenAuthority' &&
          err.context.param === 'authority',
      )
    })
  })
})
