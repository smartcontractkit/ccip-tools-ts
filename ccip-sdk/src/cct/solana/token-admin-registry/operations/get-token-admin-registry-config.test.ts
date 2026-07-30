import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { Keypair, PublicKey } from '@solana/web3.js'

import { CCIPTokenNotConfiguredError } from '../../../../errors/index.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { SolanaTokenManager } from '../../index.ts'
import { deriveTokenAdminRegistryPda } from '../../programs/router.ts'

const ROUTER = Keypair.generate().publicKey
const TOKEN = Keypair.generate().publicKey
const ADMINISTRATOR = Keypair.generate().publicKey
const PENDING_ADMINISTRATOR = Keypair.generate().publicKey
const LOOKUP_TABLE = Keypair.generate().publicKey
const REGISTRY = deriveTokenAdminRegistryPda(ROUTER, TOKEN)

function registryAccount(
  pendingAdministrator = PENDING_ADMINISTRATOR,
  poolLookupTable = LOOKUP_TABLE,
) {
  const data = Buffer.alloc(170)
  BorshAccountsCoder.accountDiscriminator('TokenAdminRegistry').copy(data)
  data[8] = 2
  ADMINISTRATOR.toBuffer().copy(data, 9)
  pendingAdministrator.toBuffer().copy(data, 41)
  poolLookupTable.toBuffer().copy(data, 73)
  data[120] = 0x19 // Writable indexes 3, 4, and 7 use the high bits of the first u128 bitmap.
  data[136] = 0x20 // Writable index 130 uses the high bits of the second u128 bitmap.
  TOKEN.toBuffer().copy(data, 137)
  return { data }
}

function stubChain(account: { data: Buffer } | null = registryAccount()): SolanaChain {
  return {
    connection: {
      getAccountInfo: async (address: PublicKey) => (address.equals(REGISTRY) ? account : null),
    },
    getTokenAdminRegistryFor: async () => ROUTER.toBase58(),
  } as unknown as SolanaChain
}

describe('Solana TokenAdminRegistry getTokenAdminRegistryConfig', () => {
  describe('query', () => {
    it('returns configured administrators, lookup table, and writable indexes', async () => {
      const config = await SolanaTokenManager.fromChain(stubChain()).getTokenAdminRegistryConfig({
        address: ROUTER.toBase58(),
        tokenAddress: TOKEN.toBase58(),
      })

      assert.deepEqual(config, {
        administrator: ADMINISTRATOR.toBase58(),
        pendingAdministrator: PENDING_ADMINISTRATOR.toBase58(),
        poolLookupTable: LOOKUP_TABLE.toBase58(),
        writableIndexes: [3, 4, 7, 130],
      })
    })

    it('returns default addresses when optional fields are unset', async () => {
      const config = await SolanaTokenManager.fromChain(
        stubChain(registryAccount(PublicKey.default, PublicKey.default)),
      ).getTokenAdminRegistryConfig({ address: ROUTER.toBase58(), tokenAddress: TOKEN.toBase58() })

      assert.deepEqual(config, {
        administrator: ADMINISTRATOR.toBase58(),
        pendingAdministrator: PublicKey.default.toBase58(),
        poolLookupTable: PublicKey.default.toBase58(),
        writableIndexes: [3, 4, 7, 130],
      })
    })

    it('rejects unregistered tokens', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(stubChain(null)).getTokenAdminRegistryConfig({
            address: ROUTER.toBase58(),
            tokenAddress: TOKEN.toBase58(),
          }),
        CCIPTokenNotConfiguredError,
      )
    })
  })

  describe('validation', () => {
    it('rejects an invalid router address', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(stubChain()).getTokenAdminRegistryConfig({
            address: 'invalid',
            tokenAddress: TOKEN.toBase58(),
          }),
        (error: unknown) =>
          error instanceof CCTParamsInvalidError && error.context.param === 'address',
      )
    })

    it('rejects an invalid token address', async () => {
      await assert.rejects(
        () =>
          SolanaTokenManager.fromChain(stubChain()).getTokenAdminRegistryConfig({
            address: ROUTER.toBase58(),
            tokenAddress: 'invalid',
          }),
        (error: unknown) =>
          error instanceof CCTParamsInvalidError && error.context.param === 'tokenAddress',
      )
    })
  })
})
