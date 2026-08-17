import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { normalizeSuiAddress } from '@mysten/sui/utils'
import { toUtf8Bytes } from 'ethers'

import { deriveObjectID, getObjectRef } from './objects.ts'

// Regression: on a Sui package that has been upgraded, `getObjectRef` was
// querying `getOwnedObjects` against the LATEST package id. The
// `OnRampStatePointer` is transferred to the ORIGINAL package address at
// publish time (`type_name::with_original_ids<OTW>()`), and its `StructType`
// also carries the original id. Both filters therefore missed the pointer on
// upgraded deployments — `getObjectRef` must normalize to the original first.
describe('getObjectRef — upgraded package resolution', () => {
  const originalPkg = '0x30e087460af8a8aacccbc218aa358cdcde8d43faf61ec0638d71108e276e2f1d'
  const latestPkg = '0xfa4dc9ef5e099b6dc61c90b00e2b28a90b788fda510790bae84c96d2f0b0303c'
  const parentObjectId = '0xabc0000000000000000000000000000000000000000000000000000000000abc'

  function makeClient() {
    const getNormalizedMoveModulesByPackage = mock.fn(
      async ({ package: pkg }: { package: string }) => {
        // Both original and latest package ids resolve to the ORIGINAL id via
        // module.address — that's the invariant Sui preserves across upgrades.
        const normalized = normalizeSuiAddress(pkg)
        if (normalized === originalPkg || normalized === latestPkg) {
          return {
            onramp: {
              address: originalPkg,
              name: 'onramp',
              fileFormatVersion: 6,
              friends: [],
              structs: {},
              exposedFunctions: {},
            },
          }
        }
        throw new Error(`unexpected package ${pkg}`)
      },
    )

    const getOwnedObjects = mock.fn(
      async ({ owner, filter }: { owner: string; filter: { StructType: string } }) => {
        // Only the ORIGINAL-owned, ORIGINAL-typed pointer exists on-chain.
        if (
          normalizeSuiAddress(owner) === originalPkg &&
          filter.StructType === `${originalPkg}::onramp::OnRampStatePointer`
        ) {
          return {
            data: [
              {
                data: {
                  objectId: '0xdeadbeef',
                  content: {
                    dataType: 'moveObject' as const,
                    fields: { on_ramp_object_id: parentObjectId },
                  },
                },
              },
            ],
            hasNextPage: false,
            nextCursor: null,
          }
        }
        return { data: [], hasNextPage: false, nextCursor: null }
      },
    )

    return {
      client: { getNormalizedMoveModulesByPackage, getOwnedObjects },
      getNormalizedMoveModulesByPackage,
      getOwnedObjects,
    }
  }

  const expected = deriveObjectID(parentObjectId, toUtf8Bytes('OnRampState'))

  it('resolves the OnRampState when called with the ORIGINAL package id', async () => {
    const { client } = makeClient()
    const address = `${originalPkg}::onramp`

    const result = await getObjectRef(address, client as any)

    assert.equal(result, expected)
  })

  it('resolves the OnRampState when called with the LATEST (upgraded) package id', async () => {
    const { client, getNormalizedMoveModulesByPackage, getOwnedObjects } = makeClient()
    // Use a distinct suffix to avoid the module-level memoize cache from the
    // ORIGINAL-id test above.
    const address = `${latestPkg}::onramp`

    const result = await getObjectRef(address, client as any)

    assert.equal(result, expected)
    // Original-id resolution must have been consulted.
    assert.ok(getNormalizedMoveModulesByPackage.mock.callCount() >= 1)
    // getOwnedObjects must have been called with the ORIGINAL id.
    const call = getOwnedObjects.mock.calls[0]!.arguments[0]
    assert.equal(normalizeSuiAddress(call.owner), originalPkg)
    assert.equal(call.filter.StructType, `${originalPkg}::onramp::OnRampStatePointer`)
  })
})
