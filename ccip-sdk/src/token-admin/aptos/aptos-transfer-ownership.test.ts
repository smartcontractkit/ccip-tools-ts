import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'

import { AptosTokenAdmin } from './index.ts'
import {
  CCIPAcceptOwnershipParamsInvalidError,
  CCIPExecuteOwnershipTransferParamsInvalidError,
  CCIPTransferOwnershipParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type NetworkInfo, ChainFamily, NetworkType } from '../../types.ts'

// ── Mocks ──

const mockProvider = {
  getTransactionByVersion: async () => ({}),
  getAccountModules: async () => [{ abi: { name: 'managed_token_pool' } }],
  view: async () => ['0x123'],
} as unknown as Aptos

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} }

const dummyNetwork: NetworkInfo = {
  name: 'aptos-testnet',
  family: ChainFamily.Aptos,
  chainSelector: 1n,
  chainId: 'aptos:2' as `aptos:${number}`,
  networkType: NetworkType.Testnet,
}

// ── Helpers ──

function makeAdmin(): AptosTokenAdmin {
  return new AptosTokenAdmin(mockProvider, dummyNetwork, { logger: silentLogger, apiClient: null })
}

const sender = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

const validTransferParams = {
  poolAddress: '0xeb6334947b4',
  newOwner: '0xabc123',
}

const validAcceptParams = {
  poolAddress: '0xeb6334947b4',
}

// =============================================================================
// AptosTokenAdmin — transferOwnership
// =============================================================================

describe('AptosTokenAdmin — transferOwnership', () => {
  // ===========================================================================
  // generateUnsignedTransferOwnership — Validation
  // ===========================================================================

  describe('generateUnsignedTransferOwnership — validation', () => {
    const admin = makeAdmin()

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedTransferOwnership(sender, {
            ...validTransferParams,
            poolAddress: '',
          }),
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
        () =>
          admin.generateUnsignedTransferOwnership(sender, {
            ...validTransferParams,
            newOwner: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPTransferOwnershipParamsInvalidError)
          assert.equal(err.code, 'TRANSFER_OWNERSHIP_PARAMS_INVALID')
          assert.equal(err.context.param, 'newOwner')
          return true
        },
      )
    })

    it('should accept valid params (fails at Aptos provider)', async () => {
      await assert.rejects(
        () => admin.generateUnsignedTransferOwnership(sender, validTransferParams),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPTransferOwnershipParamsInvalidError))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // transferOwnership — Wallet Validation
  // ===========================================================================

  describe('transferOwnership — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.transferOwnership({}, validTransferParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.transferOwnership(null, validTransferParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () => admin.transferOwnership(undefined, validTransferParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})

// =============================================================================
// AptosTokenAdmin — acceptOwnership
// =============================================================================

describe('AptosTokenAdmin — acceptOwnership', () => {
  // ===========================================================================
  // generateUnsignedAcceptOwnership — Validation
  // ===========================================================================

  describe('generateUnsignedAcceptOwnership — validation', () => {
    const admin = makeAdmin()

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedAcceptOwnership(sender, {
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPAcceptOwnershipParamsInvalidError)
          assert.equal(err.code, 'ACCEPT_OWNERSHIP_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should accept valid params (fails at Aptos provider)', async () => {
      await assert.rejects(
        () => admin.generateUnsignedAcceptOwnership(sender, validAcceptParams),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPAcceptOwnershipParamsInvalidError))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // acceptOwnership — Wallet Validation
  // ===========================================================================

  describe('acceptOwnership — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.acceptOwnership({}, validAcceptParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.acceptOwnership(null, validAcceptParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () => admin.acceptOwnership(undefined, validAcceptParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})

// =============================================================================
// AptosTokenAdmin — executeOwnershipTransfer (Aptos 3rd step)
// =============================================================================

const validExecuteParams = {
  poolAddress: '0xeb6334947b4',
  newOwner: '0xabc123',
}

describe('AptosTokenAdmin — executeOwnershipTransfer', () => {
  // ===========================================================================
  // generateUnsignedExecuteOwnershipTransfer — Validation
  // ===========================================================================

  describe('generateUnsignedExecuteOwnershipTransfer — validation', () => {
    const admin = makeAdmin()

    it('should reject empty poolAddress', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedExecuteOwnershipTransfer(sender, {
            ...validExecuteParams,
            poolAddress: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPExecuteOwnershipTransferParamsInvalidError)
          assert.equal(err.code, 'EXECUTE_OWNERSHIP_TRANSFER_PARAMS_INVALID')
          assert.equal(err.context.param, 'poolAddress')
          return true
        },
      )
    })

    it('should reject empty newOwner', async () => {
      await assert.rejects(
        () =>
          admin.generateUnsignedExecuteOwnershipTransfer(sender, {
            ...validExecuteParams,
            newOwner: '',
          }),
        (err: unknown) => {
          assert.ok(err instanceof CCIPExecuteOwnershipTransferParamsInvalidError)
          assert.equal(err.code, 'EXECUTE_OWNERSHIP_TRANSFER_PARAMS_INVALID')
          assert.equal(err.context.param, 'newOwner')
          return true
        },
      )
    })

    it('should accept valid params (fails at Aptos provider)', async () => {
      await assert.rejects(
        () => admin.generateUnsignedExecuteOwnershipTransfer(sender, validExecuteParams),
        (err: unknown) => {
          assert.ok(!(err instanceof CCIPExecuteOwnershipTransferParamsInvalidError))
          return true
        },
      )
    })
  })

  // ===========================================================================
  // executeOwnershipTransfer — Wallet Validation
  // ===========================================================================

  describe('executeOwnershipTransfer — wallet validation', () => {
    const admin = makeAdmin()

    it('should reject non-wallet object', async () => {
      await assert.rejects(
        () => admin.executeOwnershipTransfer({}, validExecuteParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          assert.equal(err.code, 'WALLET_INVALID')
          return true
        },
      )
    })

    it('should reject null wallet', async () => {
      await assert.rejects(
        () => admin.executeOwnershipTransfer(null, validExecuteParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })

    it('should reject undefined wallet', async () => {
      await assert.rejects(
        () => admin.executeOwnershipTransfer(undefined, validExecuteParams),
        (err: unknown) => {
          assert.ok(err instanceof CCIPWalletInvalidError)
          return true
        },
      )
    })
  })
})
