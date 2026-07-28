import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair } from '@solana/web3.js'

import { ChainFamily } from '../../../../networks.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'

const TOKEN = Keypair.generate().publicKey.toBase58()
const ADDRESS = Keypair.generate().publicKey.toBase58()
const ROUTER = Keypair.generate().publicKey.toBase58()
const PAYER = Keypair.generate().publicKey.toBase58()
const PENDING_ADMIN = Keypair.generate().publicKey.toBase58()
const WALLET = {
  publicKey: Keypair.generate().publicKey,
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

function generate(opts = {}) {
  return SolanaTokenManager.fromChain(stubChain()).generateUnsignedAcceptAdmin({
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
    })

    it('resolves the router from address', async () => {
      let requestedAddress: string | undefined
      const cct = SolanaTokenManager.fromChain(
        stubChain(PENDING_ADMIN, (address) => (requestedAddress = address)),
      )

      await cct.generateUnsignedAcceptAdmin({
        tokenAddress: TOKEN,
        address: ADDRESS,
        payer: PAYER,
        authority: PENDING_ADMIN,
      })

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
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(stubChain(undefined)).generateUnsignedAcceptAdmin({
            tokenAddress: TOKEN,
            address: ADDRESS,
            payer: PAYER,
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
      )
    })
  })

  describe('execute', () => {
    it('requires the pending admin to be the executing wallet', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(stubChain()).acceptAdmin({
            tokenAddress: TOKEN,
            address: ADDRESS,
            authority: PENDING_ADMIN,
            wallet: WALLET,
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
      )
    })
  })
})
