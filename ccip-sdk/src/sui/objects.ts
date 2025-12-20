import { bcs } from '@mysten/sui/bcs'
import type { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2'

import { CCIPDataFormatUnsupportedError } from '../errors/index.ts'
import type { CCIPMessage, CCIPVersion } from '../types.ts'

/**
 * Derive a dynamic field object ID using the Sui algorithm
 * This matches the Go implementation in chainlink-sui
 */
export function deriveObjectID(parentAddress: string, keyBytes: Uint8Array): string {
  // Normalize parent address to 32 bytes
  const normalizedParent = normalizeSuiAddress(parentAddress)
  const parentBytes = bcs.Address.serialize(normalizedParent).toBytes()

  // BCS serialize the key (vector<u8>)
  const bcsKeyBytes = bcs.vector(bcs.u8()).serialize(Array.from(keyBytes)).toBytes()

  // Construct TypeTag for DerivedObjectKey<vector<u8>>
  const suiFrameworkAddress = bcs.Address.serialize('0x2').toBytes()
  const typeTagBytes = new Uint8Array([
    0x07, // TypeTag::Struct
    ...suiFrameworkAddress,
    0x0e, // module length
    ...new TextEncoder().encode('derived_object'),
    0x10, // struct name length
    ...new TextEncoder().encode('DerivedObjectKey'),
    0x01, // type params count
    ...[0x06, 0x01], // vector<u8> TypeTag
  ])

  // Build the hash input
  const keyLenBytes = new Uint8Array(8)
  new DataView(keyLenBytes.buffer).setBigUint64(0, BigInt(bcsKeyBytes.length), true)

  const hashInput = new Uint8Array([
    0xf0, // HashingIntentScope::ChildObjectId
    ...parentBytes,
    ...keyLenBytes,
    ...bcsKeyBytes,
    ...typeTagBytes,
  ])

  // Hash with Blake2b-256
  const hash = blake2b(hashInput, { dkLen: 32 })

  // Convert to address string
  return normalizeSuiAddress('0x' + Buffer.from(hash).toString('hex'))
}

/**
 * Get the CCIPObjectRef ID for a CCIP package
 */
export async function getCcipObjectRef(client: SuiClient, ccipPackageId: string): Promise<string> {
  // Get the pointer to find the CCIPObject ID
  const pointerResponse = await client.getOwnedObjects({
    owner: ccipPackageId,
    filter: {
      StructType: `${ccipPackageId}::state_object::CCIPObjectRefPointer`,
    },
  })

  if (pointerResponse.data.length === 0) {
    throw new CCIPDataFormatUnsupportedError(
      'No CCIPObjectRefPointer found for the given packageId',
    )
  }

  // Get the pointer object to extract ccip_object_id
  const pointerId = pointerResponse.data[0].data?.objectId
  if (!pointerId) {
    throw new CCIPDataFormatUnsupportedError('Pointer does not have objectId')
  }

  const pointerObject = await client.getObject({
    id: pointerId,
    options: { showContent: true },
  })

  if (pointerObject.data?.content?.dataType !== 'moveObject') {
    throw new CCIPDataFormatUnsupportedError('Pointer object is not a Move object')
  }

  const ccipObjectId = (pointerObject.data.content.fields as Record<string, unknown>)[
    'ccip_object_id'
  ] as string

  if (!ccipObjectId) {
    throw new CCIPDataFormatUnsupportedError('Could not find ccip_object_id in pointer')
  }

  // Derive the CCIPObjectRef ID from the parent CCIPObject ID
  return deriveObjectID(ccipObjectId, new TextEncoder().encode('CCIPObjectRef'))
}

/**
 * Get the OffRampState object ID for an offramp package
 */
export async function getOffRampStateObject(
  client: SuiClient,
  offrampPackageId: string,
): Promise<string> {
  const offrampPointerResponse = await client.getOwnedObjects({
    owner: offrampPackageId,
    filter: {
      StructType: `${offrampPackageId}::offramp::OffRampStatePointer`,
    },
  })

  if (offrampPointerResponse.data.length === 0) {
    throw new CCIPDataFormatUnsupportedError(
      'No OffRampStatePointer found for the given offramp package',
    )
  }

  const offrampPointerId = offrampPointerResponse.data[0].data?.objectId

  if (!offrampPointerId) {
    throw new CCIPDataFormatUnsupportedError('OffRampStatePointer does not have a valid objectId')
  }

  const offrampPointerObject = await client.getObject({
    id: offrampPointerId,
    options: { showContent: true },
  })

  if (offrampPointerObject.data?.content?.dataType !== 'moveObject') {
    throw new CCIPDataFormatUnsupportedError('OffRamp pointer object is not a Move object')
  }

  const offrampObjectId = (offrampPointerObject.data.content.fields as Record<string, unknown>)[
    'off_ramp_object_id'
  ] as string

  if (!offrampObjectId) {
    throw new CCIPDataFormatUnsupportedError('Could not find off_ramp_object_id in pointer')
  }

  // Derive the OffRampState ID from the parent OffRamp Object ID
  return deriveObjectID(offrampObjectId, new TextEncoder().encode('OffRampState'))
}

/**
 * Get the receiver module configuration from the receiver registry.
 * @param provider - Sui client
 * @param ccipPackageId - CCIP package ID
 * @param ccipObjectRef - CCIP object reference
 * @param receiverPackageId - Receiver package ID
 * @returns Receiver module name and package ID
 */
export async function getReceiverModule(
  provider: SuiClient,
  ccipPackageId: string,
  ccipObjectRef: string,
  receiverPackageId: string,
) {
  // Call get_receiver_config from receiver_registry contract
  const tx = new Transaction()

  tx.moveCall({
    target: `${ccipPackageId}::receiver_registry::get_receiver_config`,
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

  if (!returnValues || returnValues.length === 0) {
    throw new CCIPDataFormatUnsupportedError('No return values from get_receiver_config')
  }

  // Decode the ReceiverConfig struct
  // ReceiverConfig has two fields: module_name (String) and proof_typename (ascii::String)
  // The struct is returned as a BCS-encoded byte array
  const receiverConfigBytes = returnValues[0][0]

  // Parse the struct:
  // First field is module_name (String = vector<u8> with length prefix)
  let offset = 0
  const moduleNameLength = receiverConfigBytes[offset]
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
  client: SuiClient,
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
  for (const tokenAddress of tokenAddresses) {
    const tx = new Transaction()

    // Call get_token_config_struct from token_admin_registry
    tx.moveCall({
      target: `${ccipPackageId}::token_admin_registry::get_token_config_struct`,
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

    if (!returnValues || returnValues.length === 0) {
      throw new CCIPDataFormatUnsupportedError(
        `No return values from get_token_config_struct for ${tokenAddress}`,
      )
    }

    // Parse the TokenConfig struct from BCS-encoded bytes
    const configBytes = returnValues[0][0]

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
    const moduleNameLength = configBytes[offset]
    offset += 1
    const tokenPoolModule = new TextDecoder().decode(
      new Uint8Array(configBytes.slice(offset, offset + moduleNameLength)),
    )
    offset += moduleNameLength

    // TokenType (ascii::String)
    const tokenTypeLength = configBytes[offset]
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
    const proofLength = configBytes[offset]
    offset += 1
    const tokenPoolTypeProof = new TextDecoder().decode(
      new Uint8Array(configBytes.slice(offset, offset + proofLength)),
    )
    offset += proofLength

    // LockOrBurnParams (vector<address>)
    const lockOrBurnCount = configBytes[offset]
    offset += 1
    const lockOrBurnParams: string[] = []
    for (let i = 0; i < lockOrBurnCount; i++) {
      const addrBytes = configBytes.slice(offset, offset + 32)
      lockOrBurnParams.push(normalizeSuiAddress('0x' + Buffer.from(addrBytes).toString('hex')))
      offset += 32
    }

    // ReleaseOrMintParams (vector<address>)
    const releaseOrMintCount = configBytes[offset]
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
