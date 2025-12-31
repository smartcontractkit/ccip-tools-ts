import type { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { hexlify } from 'ethers'

import { CCIPError } from '../errors/CCIPError.ts'
import { CCIPErrorCode } from '../errors/codes.ts'
import { bytesToBuffer } from '../utils.ts'

/**
 * Discovers the CCIP package ID associated with a given Sui onramp package.
 *
 * @param client - sui client
 * @param onramp - sui onramp package id
 * @returns ccip package id
 */
export const discoverCCIP = async (client: SuiClient, onramp: string): Promise<string> => {
  const tx = new Transaction()
  tx.moveCall({
    target: `${onramp}::onramp::get_ccip_package_id`,
  })

  const inspectResult = await client.devInspectTransactionBlock({
    sender: normalizeSuiAddress('0x0'),
    transactionBlock: tx,
  })
  const returnValues = inspectResult.results?.[0]?.returnValues
  if (!returnValues?.length) {
    throw new CCIPError(CCIPErrorCode.UNKNOWN, 'No return values from dev inspect')
  }
  const [valueBytes] = returnValues[0]!

  return normalizeSuiAddress(hexlify(bytesToBuffer(valueBytes)))
}

/**
 * Gets the Sui offramp package ID associated with a given CCIP package ID.
 *
 * @param client - Sui client
 * @param ccip - Sui CCIP Package Id
 * @returns Sui offramp package id
 */
export const discoverOfframp = async (client: SuiClient, ccip: string) => {
  // Get CCIP publish tx info
  // Get the owner cap created in that tx.
  // Get owner of the ownercap object.
  // Get objects owned by that owner.
  // Trough each of the objects owned by that owner, get the original transaction that created them.
  // Take any of the objects created by that transaction, check its info to find the OffRamp package.
  const ccipObject = await client.getObject({
    id: ccip,
    options: {
      showPreviousTransaction: true,
    },
  })

  // Get the tx that created the ownercap object.
  const ccipCreationTxDigest = ccipObject.data?.previousTransaction
  if (!ccipCreationTxDigest) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      'Could not find previous transaction for CCIP object',
    )
  }

  const ccipCreationTx = await client.getTransactionBlock({
    digest: ccipCreationTxDigest,
    options: {
      showEffects: true,
    },
  })

  const ccipCreatedObjects = ccipCreationTx.effects?.created?.map((obj) => obj.reference.objectId)
  if (!ccipCreatedObjects || ccipCreatedObjects.length === 0) {
    throw new CCIPError(CCIPErrorCode.UNKNOWN, 'No created objects found in creation transaction')
  }

  const ccipObjectsData = await Promise.all(
    ccipCreatedObjects.map((objId) =>
      client.getObject({
        id: objId,
        options: {
          showType: true,
          showContent: true,
          showOwner: true,
        },
      }),
    ),
  )

  const ownerCapObject = ccipObjectsData.find((objData) =>
    objData.data?.type?.includes('::ownable::OwnerCap'),
  )

  if (!ownerCapObject) {
    throw new CCIPError(CCIPErrorCode.UNKNOWN, 'OwnerCap object not found among created objects')
  }

  const ownerCapOwner = ownerCapObject.data?.owner
  if (!ownerCapOwner) {
    throw new CCIPError(CCIPErrorCode.UNKNOWN, 'Could not find owner of the OwnerCap object')
  }

  if (typeof ownerCapOwner === 'string' || !('AddressOwner' in ownerCapOwner)) {
    throw new CCIPError(CCIPErrorCode.UNKNOWN, 'OwnerCap object does not have an AddressOwner')
  }

  const ownerCapOwnerObjects = await client.getOwnedObjects({
    owner: ownerCapOwner['AddressOwner'],
  })

  const fullObjectsInfo = await Promise.all(
    ownerCapOwnerObjects.data.map((obj) =>
      client.getObject({
        id: obj.data?.objectId || '',
        options: {
          showType: true,
        },
      }),
    ),
  )

  const ownerCapPackageIds = fullObjectsInfo
    .filter((objData) => objData.data?.type?.includes('::ownable::OwnerCap'))
    .map((obj) => obj.data?.type?.split('::')[0])

  const packagesInfo = await Promise.all(
    ownerCapPackageIds.map((pkgId) =>
      client.getNormalizedMoveModulesByPackage({
        package: pkgId || '',
      }),
    ),
  )

  const offrampPkgs = packagesInfo
    .filter((pkg) => {
      return Object.values(pkg).some((module) => module.name === 'offramp')
    })
    .flatMap((pkg) => Object.values(pkg))
    .filter((module) => module.name === 'offramp')

  if (!offrampPkgs.length) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      'Could not find OffRamp package among OwnerCap packages',
    )
  }

  if (offrampPkgs.length > 1) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      'Multiple OffRamp packages found; unable to uniquely identify OffRamp package',
    )
  }

  return normalizeSuiAddress(offrampPkgs[0]!.address)
}
