import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'

import {
  CCIPDataFormatUnsupportedError,
  CCIPTokenNotConfiguredError,
} from '../../../../errors/index.ts'
import type { SolanaChain } from '../../../../solana/index.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { deriveTokenAdminRegistryPda } from '../../programs/router.ts'
import { GetTokenAdminRegistry } from './get-token-admin-registry.ts'

const ROUTER = Keypair.generate().publicKey
const TOKEN = Keypair.generate().publicKey
const ADMINISTRATOR = Keypair.generate().publicKey
const PENDING_ADMINISTRATOR = Keypair.generate().publicKey
const LOOKUP_TABLE = Keypair.generate().publicKey
const POOL = Keypair.generate().publicKey
const REGISTRY = deriveTokenAdminRegistryPda(ROUTER, TOKEN)

function registryAccount(
  pendingAdministrator = PENDING_ADMINISTRATOR,
  poolLookupTable = LOOKUP_TABLE,
  supportsAutoDerivation = true,
  hasSupportsAutoDerivation = true,
) {
  const data = Buffer.alloc(hasSupportsAutoDerivation ? 170 : 169)
  BorshAccountsCoder.accountDiscriminator('TokenAdminRegistry').copy(data)
  data[8] = 2
  ADMINISTRATOR.toBuffer().copy(data, 9)
  pendingAdministrator.toBuffer().copy(data, 41)
  poolLookupTable.toBuffer().copy(data, 73)
  data[120] = 0x19 // Writable indexes 3, 4, and 7 use the high bits of the first u128 bitmap.
  data[136] = 0x20 // Writable index 130 uses the high bits of the second u128 bitmap.
  TOKEN.toBuffer().copy(data, 137)
  if (hasSupportsAutoDerivation && supportsAutoDerivation) data[169] = 1
  return { data }
}

function stubChain(account: { data: Buffer } | null = registryAccount()): SolanaChain {
  return {
    connection: {
      getAccountInfo: async (address: PublicKey) => (address.equals(REGISTRY) ? account : null),
      getAddressLookupTable: async (address: PublicKey) => ({
        value: address.equals(LOOKUP_TABLE)
          ? {
              state: { addresses: [PublicKey.default, PublicKey.default, PublicKey.default, POOL] },
            }
          : null,
      }),
    },
    getTokenAdminRegistryFor: async () => ROUTER.toBase58(),
  } as unknown as SolanaChain
}

describe('GetTokenAdminRegistry (cct/solana)', () => {
  describe('query', () => {
    it('returns configured administrators, lookup table, and writable indexes', async () => {
      const config = await new GetTokenAdminRegistry().query(stubChain(), {
        address: ROUTER.toBase58(),
        tokenAddress: TOKEN.toBase58(),
      })

      assert.deepEqual(config, {
        mint: TOKEN.toBase58(),
        administrator: ADMINISTRATOR.toBase58(),
        pendingAdministrator: PENDING_ADMINISTRATOR.toBase58(),
        tokenPool: POOL.toBase58(),
        lookupTable: LOOKUP_TABLE.toBase58(),
        writableIndexes: [3, 4, 7, 130],
        supportsAutoDerivation: true,
      })
    })

    it('omits optional fields when unset', async () => {
      const config = await new GetTokenAdminRegistry().query(
        stubChain(registryAccount(PublicKey.default, PublicKey.default, false, false)),
        { address: ROUTER.toBase58(), tokenAddress: TOKEN.toBase58() },
      )

      assert.deepEqual(config, {
        mint: TOKEN.toBase58(),
        administrator: ADMINISTRATOR.toBase58(),
        writableIndexes: [3, 4, 7, 130],
        supportsAutoDerivation: false,
      })
    })

    it('returns disabled auto derivation setting', async () => {
      const config = await new GetTokenAdminRegistry().query(
        stubChain(registryAccount(PENDING_ADMINISTRATOR, LOOKUP_TABLE, false)),
        { address: ROUTER.toBase58(), tokenAddress: TOKEN.toBase58() },
      )

      assert.equal(config.supportsAutoDerivation, false)
    })

    it('omits the system program as pending administrator', async () => {
      const config = await new GetTokenAdminRegistry().query(
        stubChain(registryAccount(SystemProgram.programId)),
        { address: ROUTER.toBase58(), tokenAddress: TOKEN.toBase58() },
      )

      assert.equal(config.pendingAdministrator, undefined)
    })

    it('rejects malformed registry data', async () => {
      await assert.rejects(
        () =>
          new GetTokenAdminRegistry().query(stubChain({ data: Buffer.alloc(8) }), {
            address: ROUTER.toBase58(),
            tokenAddress: TOKEN.toBase58(),
          }),
        CCIPDataFormatUnsupportedError,
      )
    })

    it('rejects unregistered tokens', async () => {
      await assert.rejects(
        () =>
          new GetTokenAdminRegistry().query(stubChain(null), {
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
          new GetTokenAdminRegistry().query(stubChain(), {
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
          new GetTokenAdminRegistry().query(stubChain(), {
            address: ROUTER.toBase58(),
            tokenAddress: 'invalid',
          }),
        (error: unknown) =>
          error instanceof CCTParamsInvalidError && error.context.param === 'tokenAddress',
      )
    })
  })
})
