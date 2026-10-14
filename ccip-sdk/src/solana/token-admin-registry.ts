import { Buffer } from 'buffer'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { type Connection, PublicKey, SystemProgram } from '@solana/web3.js'

import { CCIPDataFormatUnsupportedError, CCIPTokenNotConfiguredError } from '../errors/index.ts'

/**
 * How the Router resolves a token pool's accounts (`ccip_common::ResolutionType`):
 * - `NoResolution`: only the pool's lookup table entries
 * - `Standard`: every lookup table entry, plus accounts the pool resolves on-chain
 * - `WithoutExtendedLookupTable`: only the lookup table's required entries, plus accounts the pool
 *   resolves on-chain
 */
export type TokenAccountResolution = 'NoResolution' | 'Standard' | 'WithoutExtendedLookupTable'

const ACCOUNT_RESOLUTIONS: readonly TokenAccountResolution[] = [
  'NoResolution',
  'Standard',
  'WithoutExtendedLookupTable',
]

/** Decoded configuration stored in a Solana TokenAdminRegistry account. */
export type TokenAdminRegistryConfig = {
  mint: PublicKey
  administrator: PublicKey
  pendingAdministrator?: PublicKey
  lookupTable?: PublicKey
  tokenPool?: PublicKey
  writableIndexes: number[]
  /** Whether the Router resolves pool accounts beyond its lookup table; see `accountResolution`. */
  supportsAutoDerivation: boolean
  accountResolution: TokenAccountResolution
  /** Pool interface the token's pool implements: 1 (CCIP 1.6-compatible) or 2 (CCIP 2.0). */
  interfaceVersion: number
}

const TOKEN_ADMIN_REGISTRY_DISCRIMINATOR =
  BorshAccountsCoder.accountDiscriminator('TokenAdminRegistry')

// TokenAdminRegistry layouts (`ccip_common::TokenAdminRegistry`), selected by account size. The
// v1 fields keep their offsets in every layout:
//   v1 (169B): discriminator, version: u8, administrator, pending_administrator, lookup_table,
//              writable_indexes: [u128; 2], mint
//   v2 (170B): + supports_auto_derivation: bool
//   v3 (172B): bool widened to account_resolution: ResolutionType (u8), + bump: u8,
//              interface_version: u8
const TOKEN_ADMIN_REGISTRY_V1_SIZE = 169
const TOKEN_ADMIN_REGISTRY_V2_SIZE = 170
const TOKEN_ADMIN_REGISTRY_V3_SIZE = 172
const ACCOUNT_RESOLUTION_OFFSET = 169
const INTERFACE_VERSION_OFFSET = 171
// Accounts predating the field implement the 1.6-compatible pool interface.
const DEFAULT_INTERFACE_VERSION = 1

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
    data.length < TOKEN_ADMIN_REGISTRY_V1_SIZE ||
    !data.subarray(0, 8).equals(TOKEN_ADMIN_REGISTRY_DISCRIMINATOR)
  ) {
    throw new CCIPDataFormatUnsupportedError('invalid TokenAdminRegistry account data')
  }

  const pendingAdministrator = new PublicKey(data.subarray(41, 73))
  const lookupTable = new PublicKey(data.subarray(73, 105))

  let accountResolution: TokenAccountResolution = 'NoResolution'
  let interfaceVersion = DEFAULT_INTERFACE_VERSION
  if (data.length >= TOKEN_ADMIN_REGISTRY_V3_SIZE) {
    const resolution = ACCOUNT_RESOLUTIONS[data[ACCOUNT_RESOLUTION_OFFSET]!]
    if (!resolution) {
      throw new CCIPDataFormatUnsupportedError(
        `unknown TokenAdminRegistry account resolution ${data[ACCOUNT_RESOLUTION_OFFSET]}`,
      )
    }
    accountResolution = resolution
    interfaceVersion = data[INTERFACE_VERSION_OFFSET]!
  } else if (data.length >= TOKEN_ADMIN_REGISTRY_V2_SIZE && data[ACCOUNT_RESOLUTION_OFFSET]) {
    accountResolution = 'Standard'
  }

  return {
    mint: new PublicKey(data.subarray(137, 169)),
    administrator: new PublicKey(data.subarray(9, 41)),
    ...(isSet(pendingAdministrator) && { pendingAdministrator }),
    ...(isSet(lookupTable) && { lookupTable }),
    writableIndexes: decodeWritableIndexes(data.subarray(105, 137)),
    supportsAutoDerivation: accountResolution !== 'NoResolution',
    accountResolution,
    interfaceVersion,
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
