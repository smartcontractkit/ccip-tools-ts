import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Mocks ──

const CODE_OBJECT = '0xcode_object'
const CODE_OBJECT_OWNER = '0xcode_object_owner'
const TOKEN_STATE_OWNER = '0xtoken_state_owner'
const TOKEN_ADDRESS = '0x89fd6b14b4a7'

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

const dummyNetwork: NetworkInfo = {
  name: 'aptos-testnet',
  family: ChainFamily.Aptos,
  chainSelector: 1n,
  chainId: 'aptos:2' as `aptos:${number}`,
  networkType: NetworkType.Testnet,
}

function makeAdmin(provider: Aptos): AptosTokenAdmin {
  return new AptosTokenAdmin(provider, dummyNetwork, {
    logger: silentLogger,
    apiClient: null,
  })
}

/**
 * Creates a mock provider for managed_token that returns the given minters and burners.
 */
function mockProviderManaged(minters: string[], burners: string[]) {
  return {
    getTransactionByVersion: async () => ({}),
    getAccountModules: async () => [],
    view: async ({
      payload,
    }: {
      payload: { function: string; typeArguments?: string[]; functionArguments?: string[] }
    }) => {
      const fn = payload.function
      // resolveTokenCodeObject: first owner call → tokenStateOwner
      if (
        fn === '0x1::object::owner' &&
        payload.typeArguments?.[0] === '0x1::fungible_asset::Metadata'
      ) {
        return [TOKEN_STATE_OWNER]
      }
      // resolveTokenCodeObject: second owner call (tokenState → codeObject)
      // + owner resolution call (codeObject → owner)
      if (fn === '0x1::object::owner' && payload.typeArguments?.[0] === '0x1::object::ObjectCore') {
        if (payload.functionArguments?.[0] === TOKEN_STATE_OWNER) return [CODE_OBJECT]
        if (payload.functionArguments?.[0] === CODE_OBJECT) return [CODE_OBJECT_OWNER]
      }
      // managed_token view calls
      if (fn === `${CODE_OBJECT}::managed_token::get_allowed_minters`) return [minters]
      if (fn === `${CODE_OBJECT}::managed_token::get_allowed_burners`) return [burners]
      throw new Error(`Unexpected view call: ${fn}`)
    },
  } as unknown as Aptos
}

/**
 * Creates a mock provider for regulated_token that returns the given minters, burners,
 * and bridgeMintersOrBurners.
 */
function mockProviderRegulated(
  minters: string[],
  burners: string[],
  bridgeMintersOrBurners: string[],
) {
  return {
    getTransactionByVersion: async () => ({}),
    getAccountModules: async () => [],
    view: async ({
      payload,
    }: {
      payload: { function: string; typeArguments?: string[]; functionArguments?: string[] }
    }) => {
      const fn = payload.function
      // resolveTokenCodeObject
      if (
        fn === '0x1::object::owner' &&
        payload.typeArguments?.[0] === '0x1::fungible_asset::Metadata'
      ) {
        return [TOKEN_STATE_OWNER]
      }
      if (fn === '0x1::object::owner' && payload.typeArguments?.[0] === '0x1::object::ObjectCore') {
        if (payload.functionArguments?.[0] === TOKEN_STATE_OWNER) return [CODE_OBJECT]
        if (payload.functionArguments?.[0] === CODE_OBJECT) return [CODE_OBJECT_OWNER]
      }
      // managed_token calls should fail so we fall through to regulated
      if (fn.includes('managed_token::')) throw new Error('not managed')
      // regulated_token view calls
      if (fn === `${CODE_OBJECT}::regulated_token::get_minters`) return [minters]
      if (fn === `${CODE_OBJECT}::regulated_token::get_burners`) return [burners]
      if (fn === `${CODE_OBJECT}::regulated_token::get_bridge_minters_or_burners`)
        return [bridgeMintersOrBurners]
      throw new Error(`Unexpected view call: ${fn}`)
    },
  } as unknown as Aptos
}

/**
 * Creates a mock provider where both managed and regulated calls fail,
 * so getMintBurnRoles returns unknown.
 */
function mockProviderUnknown() {
  return {
    getTransactionByVersion: async () => ({}),
    getAccountModules: async () => [],
    view: async ({
      payload,
    }: {
      payload: { function: string; typeArguments?: string[]; functionArguments?: string[] }
    }) => {
      const fn = payload.function
      // resolveTokenCodeObject
      if (
        fn === '0x1::object::owner' &&
        payload.typeArguments?.[0] === '0x1::fungible_asset::Metadata'
      ) {
        return [TOKEN_STATE_OWNER]
      }
      if (fn === '0x1::object::owner' && payload.typeArguments?.[0] === '0x1::object::ObjectCore') {
        if (payload.functionArguments?.[0] === TOKEN_STATE_OWNER) return [CODE_OBJECT]
        if (payload.functionArguments?.[0] === CODE_OBJECT) return [CODE_OBJECT_OWNER]
      }
      // Both managed and regulated fail
      throw new Error('unknown module')
    },
  } as unknown as Aptos
}

// =============================================================================
// AptosTokenAdmin — getMintBurnRoles
// =============================================================================

describe('AptosTokenAdmin — getMintBurnRoles', () => {
  // ===========================================================================
  // Managed token
  // ===========================================================================

  describe('managed token', () => {
    it('should return managed token roles with correct minters and burners', async () => {
      const minters = ['0xminter1', '0xminter2']
      const burners = ['0xburner1']
      const admin = makeAdmin(mockProviderManaged(minters, burners))

      const result = await admin.getMintBurnRoles(TOKEN_ADDRESS)

      assert.equal(result.tokenModule, 'managed')
      assert.equal(result.owner, CODE_OBJECT_OWNER)
      assert.deepEqual(result.allowedMinters, minters)
      assert.deepEqual(result.allowedBurners, burners)
      assert.equal(result.bridgeMintersOrBurners, undefined)
    })

    it('should return empty arrays when no roles granted', async () => {
      const admin = makeAdmin(mockProviderManaged([], []))

      const result = await admin.getMintBurnRoles(TOKEN_ADDRESS)

      assert.equal(result.tokenModule, 'managed')
      assert.equal(result.owner, CODE_OBJECT_OWNER)
      assert.deepEqual(result.allowedMinters, [])
      assert.deepEqual(result.allowedBurners, [])
    })
  })

  // ===========================================================================
  // Regulated token
  // ===========================================================================

  describe('regulated token', () => {
    it('should return regulated token roles with minters, burners, and bridgeMintersOrBurners', async () => {
      const minters = ['0xreg_minter']
      const burners = ['0xreg_burner1', '0xreg_burner2']
      const bridge = ['0xbridge1']
      const admin = makeAdmin(mockProviderRegulated(minters, burners, bridge))

      const result = await admin.getMintBurnRoles(TOKEN_ADDRESS)

      assert.equal(result.tokenModule, 'regulated')
      assert.equal(result.owner, CODE_OBJECT_OWNER)
      assert.deepEqual(result.allowedMinters, minters)
      assert.deepEqual(result.allowedBurners, burners)
      assert.deepEqual(result.bridgeMintersOrBurners, bridge)
    })

    it('should return empty arrays when no roles granted', async () => {
      const admin = makeAdmin(mockProviderRegulated([], [], []))

      const result = await admin.getMintBurnRoles(TOKEN_ADDRESS)

      assert.equal(result.tokenModule, 'regulated')
      assert.equal(result.owner, CODE_OBJECT_OWNER)
      assert.deepEqual(result.allowedMinters, [])
      assert.deepEqual(result.allowedBurners, [])
      assert.deepEqual(result.bridgeMintersOrBurners, [])
    })
  })

  // ===========================================================================
  // Unknown token module
  // ===========================================================================

  describe('unknown token module', () => {
    it('should return unknown when neither managed nor regulated', async () => {
      const admin = makeAdmin(mockProviderUnknown())

      const result = await admin.getMintBurnRoles(TOKEN_ADDRESS)

      assert.equal(result.tokenModule, 'unknown')
      assert.equal(result.owner, CODE_OBJECT_OWNER)
      assert.equal(result.allowedMinters, undefined)
      assert.equal(result.allowedBurners, undefined)
      assert.equal(result.bridgeMintersOrBurners, undefined)
    })
  })
})
