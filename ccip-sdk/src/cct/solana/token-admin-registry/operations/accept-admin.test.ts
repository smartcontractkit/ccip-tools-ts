import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { deriveRouterConfigPda, deriveTokenAdminRegistryPda } from '../../programs/router.ts'
import { type GenerateAcceptAdminParams, AcceptAdmin } from './accept-admin.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const ADDRESS = Keypair.generate().publicKey.toBase58()
const ROUTER = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const PENDING_ADMIN = Keypair.generate().publicKey.toBase58()
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: new PublicKey(PENDING_ADMIN),
  signTransaction: async <T>(tx: T) => tx,
}

function stubChain(
  pendingAdministrator = PENDING_ADMIN,
  onAddress?: (address: string) => void,
): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
    getTokenAdminRegistryFor: async (address: string) => {
      onAddress?.(address)
      return ROUTER
    },
    getRegistryTokenConfig: async () => ({ administrator: PAYER, pendingAdministrator }),
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

function generate(opts: Partial<GenerateAcceptAdminParams> = {}) {
  return new AcceptAdmin().generate(stubChain(), {
    tokenAddress: TOKEN,
    address: ADDRESS,
    payer: PAYER,
    authority: PENDING_ADMIN,
    ...opts,
  })
}

describe('AcceptAdmin (cct/solana)', () => {
  describe('generate', () => {
    it('builds an unsigned accept admin instruction', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions

      assert.ok(instruction)
      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(instruction.programId.toBase58(), ROUTER)
      assert.equal(instruction.data.toString('hex'), '6af010ad89d5a3f6')
      assert.deepEqual(
        instruction.keys.map(({ pubkey, isSigner, isWritable }) => ({
          pubkey: pubkey.toBase58(),
          isSigner,
          isWritable,
        })),
        [
          {
            pubkey: deriveRouterConfigPda(new PublicKey(ROUTER)).toBase58(),
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: deriveTokenAdminRegistryPda(
              new PublicKey(ROUTER),
              new PublicKey(TOKEN),
            ).toBase58(),
            isSigner: false,
            isWritable: true,
          },
          { pubkey: TOKEN, isSigner: false, isWritable: false },
          { pubkey: PENDING_ADMIN, isSigner: true, isWritable: true },
        ],
      )
    })

    it('resolves the router from address', async () => {
      let requestedAddress: string | undefined
      await new AcceptAdmin().generate(
        stubChain(PENDING_ADMIN, (address) => (requestedAddress = address)),
        {
          tokenAddress: TOKEN,
          address: ADDRESS,
          payer: PAYER,
          authority: PENDING_ADMIN,
        },
      )

      assert.equal(requestedAddress, ADDRESS)
    })
  })

  describe('validation', () => {
    it('rejects an authority that is not the pending administrator', async () => {
      await assert.rejects(
        () => generate({ authority: PAYER }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
      )
    })

    it('rejects when no administrator is pending', async () => {
      const noPendingChain = {
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        connection: {},
        getTokenAdminRegistryFor: async () => ROUTER,
        getRegistryTokenConfig: async () => ({ administrator: PAYER }),
      } as unknown as SolanaChain

      await assert.rejects(
        () =>
          new AcceptAdmin().generate(noPendingChain, {
            tokenAddress: TOKEN,
            address: ADDRESS,
            payer: PAYER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'authority' &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('no administrator is pending'),
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      assert.deepEqual(
        await new AcceptAdmin().execute(submitChain(), {
          tokenAddress: TOKEN,
          address: ADDRESS,
          wallet: WALLET,
        }),
        { hash: HASH },
      )
    })

    it('rejects an invalid wallet before generating instructions', async () => {
      await assert.rejects(
        new AcceptAdmin().execute(stubChain(), {
          tokenAddress: TOKEN,
          address: ADDRESS,
          wallet: {},
        }),
        CCIPWalletInvalidError,
      )
    })

    it('requires the pending admin to be the executing wallet', async () => {
      await assert.rejects(
        () =>
          new AcceptAdmin().execute(stubChain(), {
            tokenAddress: TOKEN,
            address: ADDRESS,
            authority: PAYER,
            wallet: WALLET,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'authority' &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('requires authority to be the executing wallet'),
      )
    })
  })
})
