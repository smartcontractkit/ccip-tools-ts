import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import type { GenerateTransferAdminParams } from './transfer-admin.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import { deriveRouterConfigPda, deriveTokenAdminRegistryPda } from '../../programs/router.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const ADDRESS = Keypair.generate().publicKey.toBase58()
const ROUTER = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const NEW_ADMIN = Keypair.generate().publicKey.toBase58()
const CURRENT_ADMIN = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T>(tx: T) => tx,
}

function stubChain(
  administrator = CURRENT_ADMIN,
  onAddress?: (address: string) => void,
  pendingAdministrator?: string,
): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
    getTokenAdminRegistryFor: async (address: string) => {
      onAddress?.(address)
      return ROUTER
    },
    getRegistryTokenConfig: async () => ({ administrator, pendingAdministrator }),
  } as unknown as SolanaChain
}

function generate(opts: Partial<GenerateTransferAdminParams> = {}) {
  return SolanaTokenManager.fromChain(stubChain()).generateUnsignedTransferAdmin({
    tokenAddress: TOKEN,
    address: ADDRESS,
    newAdmin: NEW_ADMIN,
    payer: PAYER,
    authority: CURRENT_ADMIN,
    ...opts,
  })
}

describe('TransferAdmin (cct/solana)', () => {
  describe('generate', () => {
    it('builds an unsigned transfer admin instruction', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions

      assert.ok(instruction)
      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(instruction.programId.toBase58(), ROUTER)
      assert.equal(instruction.data.subarray(0, 8).toString('hex'), 'b262cbb5cb6b6a0e')
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
          { pubkey: CURRENT_ADMIN, isSigner: true, isWritable: true },
        ],
      )
    })

    it('resolves the router from address', async () => {
      let requestedAddress: string | undefined
      const cct = SolanaTokenManager.fromChain(
        stubChain(CURRENT_ADMIN, (address) => (requestedAddress = address)),
      )

      await cct.generateUnsignedTransferAdmin({
        tokenAddress: TOKEN,
        address: ADDRESS,
        newAdmin: NEW_ADMIN,
        payer: PAYER,
        authority: CURRENT_ADMIN,
      })

      assert.equal(requestedAddress, ADDRESS)
    })
  })

  describe('validation', () => {
    it('rejects an authority that is not the current administrator', async () => {
      await assert.rejects(
        () => generate({ authority: PAYER }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
      )
    })

    it('requires a pending admin to accept the initial registration before transferring', async () => {
      const cct = SolanaTokenManager.fromChain(
        stubChain(PublicKey.default.toBase58(), undefined, CURRENT_ADMIN),
      )

      await assert.rejects(
        () =>
          cct.generateUnsignedTransferAdmin({
            tokenAddress: TOKEN,
            address: ADDRESS,
            newAdmin: NEW_ADMIN,
            payer: PAYER,
            authority: CURRENT_ADMIN,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'authority' &&
          typeof err.context.reason === 'string' &&
          err.context.reason.includes('still pending acceptance'),
      )
    })
  })

  describe('execute', () => {
    it('requires the current admin to be the executing wallet', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(stubChain()).transferAdmin({
            tokenAddress: TOKEN,
            address: ADDRESS,
            newAdmin: NEW_ADMIN,
            authority: CURRENT_ADMIN,
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
