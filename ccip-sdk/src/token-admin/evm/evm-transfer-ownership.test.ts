import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { JsonRpcProvider } from 'ethers'

import { EVMTokenAdmin } from './index.ts'
import {
  CCIPAcceptOwnershipParamsInvalidError,
  CCIPTransferOwnershipParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Helpers ──

const dummyNetwork: NetworkInfo = {
  name: 'test',
  family: ChainFamily.EVM,
  chainSelector: 1n,
  chainId: 1,
  networkType: NetworkType.Testnet,
}

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

function makeAdmin(provider: JsonRpcProvider): EVMTokenAdmin {
  return new EVMTokenAdmin(provider, dummyNetwork, { logger: silentLogger, apiClient: null })
}

// =============================================================================
// EVMTokenAdmin — transferOwnership
// =============================================================================

describe('EVMTokenAdmin — transferOwnership', () => {
  // ===========================================================================
  // generateUnsignedTransferOwnership — Validation
  // ===========================================================================

  describe('generateUnsignedTransferOwnership — validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    const validParams = {
      poolAddress: '0x1234567890abcdef1234567890abcdef12345678',
      newOwner: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    }

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () => admin.generateUnsignedTransferOwnership({ ...validParams, poolAddress: '' }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferOwnershipParamsInvalidError)
          assert.equal(err.code, 'TRANSFER_OWNERSHIP_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty newOwner', async () => {
      await assert.rejects(
        () => admin.generateUnsignedTransferOwnership({ ...validParams, newOwner: '' }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferOwnershipParamsInvalidError)
          assert.equal(err.code, 'TRANSFER_OWNERSHIP_PARAMS_INVALID')
          assert.equal(err.context.param, 'newOwner')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // transferOwnership — Wallet Validation
  // ===========================================================================

  describe('transferOwnership — wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    const validParams = {
      poolAddress: '0x1234567890abcdef1234567890abcdef12345678',
      newOwner: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    }

    it('should reject non-signer wallet', async () => {
      await assert.rejects(
        () => admin.transferOwnership({}, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.transferOwnership(null, validParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})

// =============================================================================
// EVMTokenAdmin — acceptOwnership
// =============================================================================

describe('EVMTokenAdmin — acceptOwnership', () => {
  // ===========================================================================
  // generateUnsignedAcceptOwnership — Validation
  // ===========================================================================

  describe('generateUnsignedAcceptOwnership — validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () => admin.generateUnsignedAcceptOwnership({ poolAddress: '' }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAcceptOwnershipParamsInvalidError)
          assert.equal(err.code, 'ACCEPT_OWNERSHIP_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })
  })

  // ===========================================================================
  // acceptOwnership — Wallet Validation
  // ===========================================================================

  describe('acceptOwnership — wallet validation', () => {
    const provider = new JsonRpcProvider('http://localhost:8545')
    const admin = makeAdmin(provider)

    it.after(() => provider.destroy())

    it('should reject non-signer wallet', async () => {
      await assert.rejects(
        () =>
          admin.acceptOwnership({}, { poolAddress: '0x1234567890abcdef1234567890abcdef12345678' }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () =>
          admin.acceptOwnership(null, {
            poolAddress: '0x1234567890abcdef1234567890abcdef12345678',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
