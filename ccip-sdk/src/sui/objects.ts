import { Buffer } from 'buffer'

import { bcs } from '@mysten/sui/bcs'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { hexlify, toUtf8Bytes } from 'ethers'
import { memoize } from 'micro-memoize'

import { CCIPDataFormatUnsupportedError } from '../errors/index.ts'
import type { CCIPMessage, CCIPVersion } from '../types.ts'
import { toLeArray } from '../utils.ts'
import { withLookupRetry } from './events.ts'

const bcsBytes = (bytes: Uint8Array) => bcs.vector(bcs.u8()).serialize(bytes).toBytes()

const HASHING_INTENT_SCOPE_CHILD_OBJECT_ID = 0xf0
const SUI_FRAMEWORK_ADDRESS = '0x2'

/**
 * Derive a dynamic field object ID using the Sui algorithm
 * This matches the Go implementation in chainlink-sui
 */
export function deriveObjectID(parentAddress: string, keyBytes: Uint8Array): string {
  // Normalize parent address to 32 bytes
  const normalizedParent = normalizeSuiAddress(parentAddress)
  const parentBytes = bcs.Address.serialize(normalizedParent).toBytes()

  // BCS serialize the key (vector<u8>)
  const bcsKeyBytes = bcsBytes(keyBytes)
  const keyLenBytes = toLeArray(bcsKeyBytes.length, 8) // uint64

  // Construct TypeTag for DerivedObjectKey<vector<u8>>
  const suiFrameworkAddress = bcs.Address.serialize(SUI_FRAMEWORK_ADDRESS).toBytes()
  const typeTagBytes = new Uint8Array([
    0x07, // TypeTag::Struct
    ...suiFrameworkAddress,
    ...bcsBytes(toUtf8Bytes('derived_object')), //module
    ...bcsBytes(toUtf8Bytes('DerivedObjectKey')), // struct name
    0x01, // type params count
    0x06, // TypeTag::Vector
    0x01, // TypeTag::U8
  ])

  // Build the hash input
  const hashInput = new Uint8Array([
    HASHING_INTENT_SCOPE_CHILD_OBJECT_ID,
    ...parentBytes,
    ...keyLenBytes,
    ...bcsKeyBytes,
    ...typeTagBytes,
  ])

  // Hash with Blake2b-256
  const hash = blake2b(hashInput, { dkLen: 32 })

  return hexlify(hash)
}

/**
 * Finds the StatePointer object owned by a package.
 * The StatePointer contains a reference to the parent object used for derivation.
 */
export const getObjectRef = memoize(
  async function getPackageIds_(address: string, client: SuiJsonRpcClient): Promise<string> {
    return withLookupRetry(() => getObjectRef_(address, client))
  },
  { maxArgs: 1, expires: 300e3, async: true },
)

async function getObjectRef_(address: string, client: SuiJsonRpcClient): Promise<string> {
  // addresses may come unpadded (e.g. from Move module metadata); normalize
  const inputPackageId = normalizeSuiAddress(address.split('::')[0]!)
  const suffix = address.split('::').slice(1).join('::')

  let stateObjectName
  if (suffix === 'onramp') stateObjectName = 'OnRampState'
  else if (suffix === 'offramp') stateObjectName = 'OffRampState'
  else stateObjectName = 'CCIPObjectRef'

  // The *StatePointer object is transferred to the ORIGINAL package address at
  // publish time (`type_name::with_original_ids<OTW>()` in the Move contracts).
  // Its StructType also carries the original id. If the caller passes a LATEST
  // (upgraded) package id, both the owner filter and the StructType filter
  // would miss it — resolve to the original first via the Move module metadata,
  // whose `address` field is always the original package id.
  const packageId = await resolveOriginalPackageId(inputPackageId, suffix, client)
  address = suffix ? `${packageId}::${suffix}` : packageId

  const fullStatePointerType = `${address}::${stateObjectName}Pointer`

  const ownedObjects = await client.getOwnedObjects({
    owner: packageId,
    filter: { StructType: fullStatePointerType },
    options: { showContent: true },
  })

  const pointer = ownedObjects.data[0]?.data
  if (!pointer?.objectId || pointer.content!.dataType !== 'moveObject')
    throw new CCIPDataFormatUnsupportedError(
      'No CCIP ObjectRef Pointer found for the given packageId',
      { context: { inputPackageId, originalPackageId: packageId, fullStatePointerType, pointer } },
    )
  // const statePointerObjectId = pointer.objectId
  const parentObjectId = Object.entries(pointer.content!.fields).find(([key]) =>
    key.endsWith('_object_id'),
  )?.[1]
  if (typeof parentObjectId !== 'string')
    throw new CCIPDataFormatUnsupportedError('No parent object id found inthe given pointer', {
      context: { fullStatePointerType, pointer },
    })
  return deriveObjectID(parentObjectId, toUtf8Bytes(stateObjectName))
}

/**
 * Resolves a Sui package id (which may be a LATEST, upgraded version) to its
 * ORIGINAL published package id. Sui preserves the original id in the
 * `address` field of every normalized module: on upgrade the package gets a
 * new object id, but its modules keep referring to the original id in their
 * type signatures and metadata.
 *
 * @param packageId - Normalized package id (32-byte hex, may be latest).
 * @param moduleHint - Preferred module to consult (e.g. `onramp`); falls back
 *   to any module when the hint is missing.
 * @param client - Sui RPC client.
 * @returns The original package id, normalized. Returns the input unchanged if
 *   the RPC lookup fails (defensive: state-pointer lookup will then surface the
 *   real problem with better context).
 */
async function resolveOriginalPackageId(
  packageId: string,
  moduleHint: string,
  client: SuiJsonRpcClient,
): Promise<string> {
  try {
    const modules = await client.getNormalizedMoveModulesByPackage({ package: packageId })
    const preferred = moduleHint && modules[moduleHint] ? modules[moduleHint] : undefined
    const anyModule = preferred ?? Object.values(modules)[0]
    if (!anyModule?.address) return packageId
    return normalizeSuiAddress(anyModule.address)
  } catch {
    return packageId
  }
}

/**
 * Finds the StatePointer object owned by a package.
 * The StatePointer contains a reference to the parent object used for derivation.
 */
export const getLatestPackageId = memoize(
  async function getLatestPackageId_(address: string, client: SuiJsonRpcClient): Promise<string> {
    const suffix = address.split('::')[1]
    try {
      const stateObjectId = await getObjectRef(address, client)
      const stateObject = await client.getObject({
        id: stateObjectId,
        options: { showContent: true },
      })
      const stateContent = stateObject.data?.content
      if (stateContent?.dataType !== 'moveObject') return address
      const packageIdsField = (stateContent.fields as Record<string, unknown>)['package_ids']
      if (!Array.isArray(packageIdsField) || packageIdsField.length === 0) return address
      const latest = packageIdsField[packageIdsField.length - 1] as string
      return suffix ? `${latest}::${suffix}` : latest
    } catch {
      return address
    }
  },
  { maxArgs: 1, expires: 60e3, async: true },
)

/**
 * Get the receiver module configuration from the receiver registry.
 * @param provider - Sui client
 * @param ccipPackageId - CCIP package ID
 * @param ccipObjectRef - CCIP object reference
 * @param receiverPackageId - Receiver package ID
 * @returns Receiver module name and package ID
 */
export async function getReceiverModule(
  provider: SuiJsonRpcClient,
  ccipPackageId: string,
  ccipObjectRef: string,
  receiverPackageId: string,
) {
  const ccipBarePackageId = ccipPackageId.split('::')[0]!
  // Call get_receiver_config from receiver_registry contract
  const tx = new Transaction()

  tx.moveCall({
    target: `${ccipBarePackageId}::receiver_registry::get_receiver_config`,
    arguments: [tx.object(ccipObjectRef), tx.pure.address(receiverPackageId)],
  })

  const result = await provider.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
  })

  if (result.error) {
    throw new CCIPDataFormatUnsupportedError(`Failed to call get_receiver_config: ${result.error}`)
  }

  if (!result.results || result.results.length === 0) {
    throw new CCIPDataFormatUnsupportedError('No results returned from get_receiver_config')
  }

  const returnValues = result.results[0]?.returnValues

  if (!returnValues?.length) {
    throw new CCIPDataFormatUnsupportedError('No return values from get_receiver_config')
  }

  // Decode the ReceiverConfig struct
  // ReceiverConfig has two fields: module_name (String) and proof_typename (ascii::String)
  // The struct is returned as a BCS-encoded byte array
  const receiverConfigBytes = returnValues[0]![0]

  // Parse the struct:
  // First field is module_name (String = vector<u8> with length prefix)
  let offset = 0
  const moduleNameLength = receiverConfigBytes[offset]!
  offset += 1
  const moduleName = new TextDecoder().decode(
    new Uint8Array(receiverConfigBytes.slice(offset, offset + moduleNameLength)),
  )

  return {
    moduleName,
    packageId: receiverPackageId,
  }
}

/**
 * Fetch token configurations for the given token amounts.
 * @param client - Sui client
 * @param ccipPackageId - CCIP package ID
 * @param ccipObjectRef - CCIP object reference
 * @param tokenAmounts - Token amounts from CCIP message
 * @returns Array of token configurations
 */
export async function fetchTokenConfigs(
  client: SuiJsonRpcClient,
  ccipPackageId: string,
  ccipObjectRef: string,
  tokenAmounts: CCIPMessage<typeof CCIPVersion.V1_6>['tokenAmounts'],
) {
  if (tokenAmounts.length === 0) {
    return []
  }
  const tokenConfigs = []
  const tokenAddresses = [
    ...new Set(
      tokenAmounts.map((token) => token.destTokenAddress).filter((addr) => addr && addr !== '0x0'),
    ),
  ]

  // Fetch token config for each unique token address
  const ccipBarePackageId = ccipPackageId.split('::')[0]!
  for (const tokenAddress of tokenAddresses) {
    const tx = new Transaction()

    // Call get_token_config_struct from token_admin_registry
    tx.moveCall({
      target: `${ccipBarePackageId}::token_admin_registry::get_token_config_struct`,
      arguments: [tx.object(ccipObjectRef), tx.pure.address(tokenAddress)],
    })

    const result = await client.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
    })

    if (result.error) {
      throw new CCIPDataFormatUnsupportedError(
        `Failed to fetch token config for ${tokenAddress}: ${result.error}`,
      )
    }

    if (!result.results || result.results.length === 0) {
      throw new CCIPDataFormatUnsupportedError(
        `No results returned from get_token_config_struct for ${tokenAddress}`,
      )
    }

    const returnValues = result.results[0]?.returnValues

    if (!returnValues?.length) {
      throw new CCIPDataFormatUnsupportedError(
        `No return values from get_token_config_struct for ${tokenAddress}`,
      )
    }

    // Parse the TokenConfig struct from BCS-encoded bytes
    const configBytes = returnValues[0]![0]

    // TokenConfig structure (from token_admin_registry.go):
    // - TokenPoolPackageId (address = 32 bytes)
    // - TokenPoolModule (String = length + bytes)
    // - TokenType (ascii::String = length + bytes)
    // - Administrator (address = 32 bytes)
    // - PendingAdministrator (address = 32 bytes)
    // - TokenPoolTypeProof (ascii::String = length + bytes)
    // - LockOrBurnParams (vector<address> = length + N * 32 bytes)
    // - ReleaseOrMintParams (vector<address> = length + N * 32 bytes)

    let offset = 0

    // TokenPoolPackageId (32 bytes)
    const tokenPoolPackageIdBytes = configBytes.slice(offset, offset + 32)
    const tokenPoolPackageId = normalizeSuiAddress(
      '0x' + Buffer.from(tokenPoolPackageIdBytes).toString('hex'),
    )
    offset += 32

    // TokenPoolModule (String)
    const moduleNameLength = configBytes[offset]!
    offset += 1
    const tokenPoolModule = new TextDecoder().decode(
      new Uint8Array(configBytes.slice(offset, offset + moduleNameLength)),
    )
    offset += moduleNameLength

    // TokenType (ascii::String)
    const tokenTypeLength = configBytes[offset]!
    offset += 1
    const tokenType = new TextDecoder().decode(
      new Uint8Array(configBytes.slice(offset, offset + tokenTypeLength)),
    )
    offset += tokenTypeLength

    // Administrator (32 bytes)
    const administratorBytes = configBytes.slice(offset, offset + 32)
    const administrator = normalizeSuiAddress(
      '0x' + Buffer.from(administratorBytes).toString('hex'),
    )
    offset += 32

    // PendingAdministrator (32 bytes)
    const pendingAdminBytes = configBytes.slice(offset, offset + 32)
    const pendingAdministrator = normalizeSuiAddress(
      '0x' + Buffer.from(pendingAdminBytes).toString('hex'),
    )
    offset += 32

    // TokenPoolTypeProof (ascii::String)
    const proofLength = configBytes[offset]!
    offset += 1
    const tokenPoolTypeProof = new TextDecoder().decode(
      new Uint8Array(configBytes.slice(offset, offset + proofLength)),
    )
    offset += proofLength

    // LockOrBurnParams (vector<address>)
    const lockOrBurnCount = configBytes[offset]!
    offset += 1
    const lockOrBurnParams: string[] = []
    for (let i = 0; i < lockOrBurnCount; i++) {
      const addrBytes = configBytes.slice(offset, offset + 32)
      lockOrBurnParams.push(normalizeSuiAddress('0x' + Buffer.from(addrBytes).toString('hex')))
      offset += 32
    }

    // ReleaseOrMintParams (vector<address>)
    const releaseOrMintCount = configBytes[offset]!
    offset += 1
    const releaseOrMintParams: string[] = []
    for (let i = 0; i < releaseOrMintCount; i++) {
      const addrBytes = configBytes.slice(offset, offset + 32)
      releaseOrMintParams.push(normalizeSuiAddress('0x' + Buffer.from(addrBytes).toString('hex')))
      offset += 32
    }

    tokenConfigs.push({
      tokenPoolPackageId,
      tokenPoolModule,
      tokenType,
      administrator,
      pendingAdministrator,
      tokenPoolTypeProof,
      lockOrBurnParams,
      releaseOrMintParams,
    })
  }
  return tokenConfigs
}
