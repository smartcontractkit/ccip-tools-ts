import { Buffer } from 'buffer'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { type Connection, PublicKey, SystemProgram } from '@solana/web3.js'

import { CCIPDataFormatUnsupportedError, CCIPTokenNotConfiguredError } from '../errors/index.ts'

/** Decoded configuration stored in a Solana TokenAdminRegistry account. */
export type TokenAdminRegistryConfig = {
  mint: PublicKey
  administrator: PublicKey
  pendingAdministrator?: PublicKey
  lookupTable?: PublicKey
  tokenPool?: PublicKey
  writableIndexes: number[]
  supportsAutoDerivation: boolean
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

function isSet(address: PublicKey): boolean {
  return !address.equals(PublicKey.default) && !address.equals(SystemProgram.programId)
}

/**
 * Decodes a TokenAdminRegistry account
 *
 * @param data - Raw TokenAdminRegistry account data.
 * @returns Decoded registry configuration, excluding the resolved token pool.
 */
export function decodeTokenAdminRegistryConfig(
  data: Buffer,
): Omit<TokenAdminRegistryConfig, 'tokenPool'> {
  if (
    data.length < TOKEN_ADMIN_REGISTRY_SIZE ||
    !data.subarray(0, 8).equals(TOKEN_ADMIN_REGISTRY_DISCRIMINATOR)
  ) {
    throw new CCIPDataFormatUnsupportedError('invalid TokenAdminRegistry account data')
  }

  const pendingAdministrator = new PublicKey(data.subarray(41, 73))
  const lookupTable = new PublicKey(data.subarray(73, 105))

  return {
    mint: new PublicKey(data.subarray(137, 169)),
    administrator: new PublicKey(data.subarray(9, 41)),
    ...(isSet(pendingAdministrator) && { pendingAdministrator }),
    ...(isSet(lookupTable) && { lookupTable }),
    writableIndexes: decodeWritableIndexes(data.subarray(105, 137)),
    supportsAutoDerivation: data.length > TOKEN_ADMIN_REGISTRY_SIZE && data[169] === 1,
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

  const config = decodeTokenAdminRegistryConfig(account.data)
  if (!config.lookupTable) return config

  try {
    const lookupTable = await connection.getAddressLookupTable(config.lookupTable)
    const tokenPool = lookupTable.value?.state.addresses[3]
    if (tokenPool && !tokenPool.equals(PublicKey.default)) return { ...config, tokenPool }
  } catch {
    // Token pool may not be configured yet.
  }
  return config
}
