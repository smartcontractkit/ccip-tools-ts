import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'

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
): SolanaChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    connection: {},
    getTokenAdminRegistryFor: async (address: string) => {
      onAddress?.(address)
      return ROUTER
    },
    getRegistryTokenConfig: async () => ({ administrator }),
  } as unknown as SolanaChain
}

function generate(opts = {}) {
  return SolanaTokenManager.fromChain(stubChain()).generateUnsignedProposeAdmin({
    tokenAddress: TOKEN,
    address: ADDRESS,
    newAdmin: NEW_ADMIN,
    payer: PAYER,
    authority: CURRENT_ADMIN,
    ...opts,
  })
}

describe('ProposeAdmin (cct/solana)', () => {
  describe('generate', () => {
    it('builds an unsigned propose admin instruction', async () => {
      const unsigned = await generate()
      const [instruction] = unsigned.instructions

      assert.ok(instruction)
      assert.equal(unsigned.family, ChainFamily.Solana)
      assert.equal(unsigned.mainIndex, 0)
      assert.equal(instruction.programId.toBase58(), ROUTER)
      assert.deepEqual(instruction.data.subarray(-32), new PublicKey(NEW_ADMIN).toBuffer())
    })

    it('resolves the router from address', async () => {
      let requestedAddress: string | undefined
      const cct = SolanaTokenManager.fromChain(
        stubChain(CURRENT_ADMIN, (address) => (requestedAddress = address)),
      )

      await cct.generateUnsignedProposeAdmin({
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
  })

  describe('execute', () => {
    it('requires the current admin to be the executing wallet', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(stubChain()).proposeAdmin({
            tokenAddress: TOKEN,
            address: ADDRESS,
            newAdmin: NEW_ADMIN,
            authority: CURRENT_ADMIN,
            wallet: WALLET,
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
      )
    })
  })
})
