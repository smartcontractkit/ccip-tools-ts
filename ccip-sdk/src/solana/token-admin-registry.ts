import { Buffer } from 'buffer'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { type Connection, PublicKey } from '@solana/web3.js'

import { CCIPDataFormatUnsupportedError, CCIPTokenNotConfiguredError } from '../errors/index.ts'

/** Decoded configuration stored in a Solana TokenAdminRegistry account. */
export type TokenAdminRegistryConfig = {
  administrator: PublicKey
  pendingAdministrator: PublicKey
  lookupTable: PublicKey
  writableIndexes: number[]
}

const TOKEN_ADMIN_REGISTRY_DISCRIMINATOR =
  BorshAccountsCoder.accountDiscriminator('TokenAdminRegistry')
const TOKEN_ADMIN_REGISTRY_SIZE = 169

/** Decodes the Router's 32-byte MSB-first writable-index bitmap. */
function decodeWritableIndexes(buf: Buffer): number[] {
  const indexes: number[] = []
  for (let byteIndex = 0; byteIndex < 32; byteIndex++) {
    const byte = buf[byteIndex] ?? 0
    for (let bit = 0; bit < 8; bit++) {
      if (byte & (1 << bit)) {
        const bitPosition = (byteIndex % 16) * 8 + bit
        indexes.push(byteIndex < 16 ? 127 - bitPosition : 255 - bitPosition)
      }
    }
  }
  return indexes.sort((a, b) => a - b)
}

function decodeTokenAdminRegistryConfig(data: Buffer): TokenAdminRegistryConfig {
  if (
    data.length < TOKEN_ADMIN_REGISTRY_SIZE ||
    !data.subarray(0, 8).equals(TOKEN_ADMIN_REGISTRY_DISCRIMINATOR)
  ) {
    throw new CCIPDataFormatUnsupportedError('invalid TokenAdminRegistry account data')
  }

  return {
    administrator: new PublicKey(data.subarray(9, 41)),
    pendingAdministrator: new PublicKey(data.subarray(41, 73)),
    lookupTable: new PublicKey(data.subarray(73, 105)),
    writableIndexes: decodeWritableIndexes(data.subarray(105, 137)),
  }
}

/**
 * Fetches and decodes a token's TokenAdminRegistry account.
 *
 * @param connection - Solana RPC connection.
 * @param router - Router program that owns the registry account.
 * @param mint - Token mint registered with the Router.
 * @returns TokenAdminRegistryConfig - The decoded registry configuration.
 */
export async function getTokenAdminRegistryConfig(
  connection: Connection,
  router: PublicKey,
  mint: PublicKey,
): Promise<TokenAdminRegistryConfig> {
  const registry = PublicKey.findProgramAddressSync(
    [Buffer.from('token_admin_registry'), mint.toBuffer()],
    router,
  )[0]

  const account = await connection.getAccountInfo(registry)
  if (!account) throw new CCIPTokenNotConfiguredError(mint.toBase58(), router.toBase58())

  return decodeTokenAdminRegistryConfig(account.data)
}
