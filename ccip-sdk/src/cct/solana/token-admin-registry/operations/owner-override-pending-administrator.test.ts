import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { deriveRouterConfigPda, deriveTokenAdminRegistryPda } from '../../programs/router.ts'
import {
  type GenerateOwnerOverridePendingAdministratorParams,
  OwnerOverridePendingAdministrator,
} from './owner-override-pending-administrator.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const ADDRESS = Keypair.generate().publicKey.toBase58()
const ROUTER = Keypair.generate().publicKey.toBase58()
const OWNER = Keypair.generate().publicKey.toBase58()
const NEW_ADMIN = Keypair.generate().publicKey.toBase58()
const HASH = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: new PublicKey(OWNER),
  signTransaction: async <T>(tx: T) => tx,
}

function stubChain(
  administrator = PublicKey.default.toBase58(),
  onAddress?: (address: string) => void,
): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {
      simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
      getLatestBlockhash: async () => ({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 1,
      }),
      sendTransaction: async () => HASH,
      confirmTransaction: async () => ({ value: { err: null } }),
    },
    getTokenAdminRegistryFor: async (address: string) => {
      onAddress?.(address)
      return ROUTER
    },
    getRegistryTokenConfig: async () => ({ administrator }),
  } as unknown as SolanaChain
}

function generate(opts: Partial<GenerateOwnerOverridePendingAdministratorParams> = {}) {
  return new OwnerOverridePendingAdministrator().generate(stubChain(), {
    tokenAddress: TOKEN,
    address: ADDRESS,
    newAdmin: NEW_ADMIN,
    payer: OWNER,
    authority: OWNER,
    ...opts,
  })
}

describe('OwnerOverridePendingAdministrator (cct/solana)', () => {
  describe('generate', () => {
    it('builds an unsigned owner override pending administrator instruction', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions

      assert.ok(instruction)
      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(instruction.programId.toBase58(), ROUTER)
      assert.equal(instruction.data.subarray(0, 8).toString('hex'), 'e66f8695cba876c9')
      assert.deepEqual(instruction.data.subarray(8), new PublicKey(NEW_ADMIN).toBuffer())
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
          { pubkey: OWNER, isSigner: true, isWritable: true },
          { pubkey: PublicKey.default.toBase58(), isSigner: false, isWritable: false },
        ],
      )
    })

    it('resolves the router from address', async () => {
      let requestedAddress: string | undefined
      await new OwnerOverridePendingAdministrator().generate(
        stubChain(PublicKey.default.toBase58(), (address) => (requestedAddress = address)),
        { tokenAddress: TOKEN, address: ADDRESS, newAdmin: NEW_ADMIN, payer: OWNER },
      )

      assert.equal(requestedAddress, ADDRESS)
    })
  })

  describe('validation', () => {
    for (const param of ['tokenAddress', 'address', 'newAdmin', 'authority'] as const) {
      it(`rejects an invalid ${param}`, async () => {
        await assert.rejects(
          () => generate({ [param]: 'not-a-public-key' }),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      })
    }

    it('rejects an accepted registry administrator before building the transaction', async () => {
      await assert.rejects(
        () =>
          new OwnerOverridePendingAdministrator().generate(stubChain(OWNER), {
            tokenAddress: TOKEN,
            address: ADDRESS,
            newAdmin: NEW_ADMIN,
            payer: OWNER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'tokenAddress' &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('The current administrator must use transferAdmin instead'),
      )
    })
  })

  describe('execute', () => {
    it('signs, submits, and returns the tx hash', async () => {
      assert.deepEqual(
        await new OwnerOverridePendingAdministrator().execute(stubChain(), {
          tokenAddress: TOKEN,
          address: ADDRESS,
          newAdmin: NEW_ADMIN,
          wallet: WALLET,
        }),
        { hash: HASH },
      )
    })

    it('requires the mint authority to be the executing wallet', async () => {
      await assert.rejects(
        () =>
          new OwnerOverridePendingAdministrator().execute(stubChain(), {
            tokenAddress: TOKEN,
            address: ADDRESS,
            newAdmin: NEW_ADMIN,
            authority: NEW_ADMIN,
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
