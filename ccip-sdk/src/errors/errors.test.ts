import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CCIPError } from './CCIPError.ts'
import { CCIPErrorCode, TRANSIENT_ERROR_CODES, isTransientError } from './codes.ts'
import { DEFAULT_RECOVERY_HINTS, getDefaultRecovery } from './recovery.ts'
import {
  CCIPAptosTransactionInvalidError,
  CCIPBlockNotFoundError,
  CCIPChainFamilyUnsupportedError,
  CCIPChainNotFoundError,
  CCIPCommitNotFoundError,
  CCIPContractTypeInvalidError,
  CCIPExecTxNotConfirmedError,
  CCIPExecTxRevertedError,
  CCIPExtraArgsInvalidError,
  CCIPExtraArgsParseError,
  CCIPHasherVersionUnsupportedError,
  CCIPHttpError,
  CCIPLbtcAttestationError,
  CCIPMerkleRootMismatchError,
  CCIPMerkleTreeEmptyError,
  CCIPMessageIdNotFoundError,
  CCIPMessageInvalidError,
  CCIPMessageNotInBatchError,
  CCIPNotImplementedError,
  CCIPOffRampNotFoundError,
  CCIPOnRampRequiredError,
  CCIPSolanaLookupTableNotFoundError,
  CCIPTokenDecimalsInsufficientError,
  CCIPTokenNotConfiguredError,
  CCIPTokenNotInRegistryError,
  CCIPTransactionNotFoundError,
  CCIPUsdcAttestationError,
  CCIPVersionUnsupportedError,
  CCIPWalletNotSignerError,
} from './specialized.ts'
import { assert as assertUtil, formatErrorForLogging, getRetryDelay, shouldRetry } from './utils.ts'

// =============================================================================
// CCIPError Base Class Tests
// =============================================================================

describe('CCIPError', () => {
  describe('constructor', () => {
    it('should create error with code and message', () => {
      const error = new CCIPError(CCIPErrorCode.CHAIN_NOT_FOUND, 'Chain not found')

      assert.equal(error.code, 'CHAIN_NOT_FOUND')
      assert.equal(error.message, 'Chain not found')
      assert.equal(error.name, 'CCIPError')
      assert.equal(error.isTransient, false)
      assert.deepEqual(error.context, {})
    })

    it('should create error with all options', () => {
      const cause = new Error('Original error')
      const error = new CCIPError(CCIPErrorCode.HTTP_ERROR, 'HTTP request failed', {
        cause,
        context: { url: 'https://example.com', status: 500 },
        isTransient: true,
        retryAfterMs: 5000,
        recovery: 'Custom recovery hint',
      })

      assert.equal(error.code, 'HTTP_ERROR')
      assert.equal(error.message, 'HTTP request failed')
      assert.equal(error.isTransient, true)
      assert.equal(error.retryAfterMs, 5000)
      assert.equal(error.recovery, 'Custom recovery hint')
      assert.equal(error.cause, cause)
      assert.deepEqual(error.context, { url: 'https://example.com', status: 500 })
    })

    it('should use default recovery hint when not provided', () => {
      const error = new CCIPError(CCIPErrorCode.CHAIN_NOT_FOUND, 'Chain not found')

      assert.equal(error.recovery, DEFAULT_RECOVERY_HINTS.CHAIN_NOT_FOUND)
    })

    it('should have brand property for cross-module identification', () => {
      const error = new CCIPError(CCIPErrorCode.UNKNOWN, 'Unknown error')

      assert.equal(error._isCCIPError, true)
    })
  })

  describe('isCCIPError', () => {
    it('should return true for CCIPError instances', () => {
      const error = new CCIPError(CCIPErrorCode.UNKNOWN, 'Test')

      assert.equal(CCIPError.isCCIPError(error), true)
    })

    it('should return true for objects with _isCCIPError brand', () => {
      const fakeError = { _isCCIPError: true, code: 'UNKNOWN', message: 'Test' }

      assert.equal(CCIPError.isCCIPError(fakeError), true)
    })

    it('should return false for regular Error instances', () => {
      const error = new Error('Regular error')

      assert.equal(CCIPError.isCCIPError(error), false)
    })

    it('should return false for null/undefined', () => {
      assert.equal(CCIPError.isCCIPError(null), false)
      assert.equal(CCIPError.isCCIPError(undefined), false)
    })

    it('should return false for non-error objects', () => {
      assert.equal(CCIPError.isCCIPError({}), false)
      assert.equal(CCIPError.isCCIPError({ code: 'UNKNOWN' }), false)
      assert.equal(CCIPError.isCCIPError('string'), false)
      assert.equal(CCIPError.isCCIPError(123), false)
    })
  })

  describe('from', () => {
    it('should return same instance for CCIPError input', () => {
      const original = new CCIPError(CCIPErrorCode.CHAIN_NOT_FOUND, 'Original')
      const result = CCIPError.from(original)

      assert.equal(result, original)
    })

    it('should wrap regular Error with cause', () => {
      const original = new Error('Original error')
      const result = CCIPError.from(original)

      assert.equal(result.code, 'UNKNOWN')
      assert.equal(result.message, 'Original error')
      assert.equal(result.cause, original)
    })

    it('should wrap Error with custom code', () => {
      const original = new Error('Not found')
      const result = CCIPError.from(original, CCIPErrorCode.CHAIN_NOT_FOUND)

      assert.equal(result.code, 'CHAIN_NOT_FOUND')
      assert.equal(result.message, 'Not found')
    })

    it('should wrap non-Error values', () => {
      const result1 = CCIPError.from('string error')
      assert.equal(result1.code, 'UNKNOWN')
      assert.equal(result1.message, 'string error')

      const result2 = CCIPError.from(123)
      assert.equal(result2.message, '123')

      const result3 = CCIPError.from(null)
      assert.equal(result3.message, 'null')
    })
  })

  describe('toJSON', () => {
    it('should serialize all properties', () => {
      const cause = new Error('Cause error')
      const error = new CCIPError(CCIPErrorCode.HTTP_ERROR, 'HTTP failed', {
        cause,
        context: { status: 500 },
        isTransient: true,
        retryAfterMs: 5000,
        recovery: 'Retry later',
      })

      const json = error.toJSON()

      assert.equal(json.name, 'CCIPError')
      assert.equal(json.message, 'HTTP failed')
      assert.equal(json.code, 'HTTP_ERROR')
      assert.deepEqual(json.context, { status: 500 })
      assert.equal(json.isTransient, true)
      assert.equal(json.retryAfterMs, 5000)
      assert.equal(json.recovery, 'Retry later')
      assert.ok(typeof json.stack === 'string')
      assert.equal(json.cause, 'Cause error')
    })

    it('should handle non-Error cause', () => {
      const error = new CCIPError(CCIPErrorCode.UNKNOWN, 'Test')
      const json = error.toJSON()

      assert.equal(json.cause, undefined)
    })
  })

  describe('instanceof and prototype chain', () => {
    it('should be instanceof Error', () => {
      const error = new CCIPError(CCIPErrorCode.UNKNOWN, 'Test')

      assert.ok(error instanceof Error)
      assert.ok(error instanceof CCIPError)
    })

    it('should have proper stack trace', () => {
      const error = new CCIPError(CCIPErrorCode.UNKNOWN, 'Test')

      assert.ok(error.stack)
      assert.ok(error.stack.includes('CCIPError'))
    })
  })
})

// =============================================================================
// Error Codes Tests
// =============================================================================

describe('CCIPErrorCode', () => {
  it('should have all expected error categories', () => {
    // Chain/Network
    assert.equal(CCIPErrorCode.CHAIN_NOT_FOUND, 'CHAIN_NOT_FOUND')
    assert.equal(CCIPErrorCode.CHAIN_FAMILY_UNSUPPORTED, 'CHAIN_FAMILY_UNSUPPORTED')

    // Block & Transaction
    assert.equal(CCIPErrorCode.BLOCK_NOT_FOUND, 'BLOCK_NOT_FOUND')
    assert.equal(CCIPErrorCode.TRANSACTION_NOT_FOUND, 'TRANSACTION_NOT_FOUND')

    // CCIP Message
    assert.equal(CCIPErrorCode.MESSAGE_ID_NOT_FOUND, 'MESSAGE_ID_NOT_FOUND')
    assert.equal(CCIPErrorCode.MESSAGE_INVALID, 'MESSAGE_INVALID')

    // Version
    assert.equal(CCIPErrorCode.VERSION_UNSUPPORTED, 'VERSION_UNSUPPORTED')

    // HTTP
    assert.equal(CCIPErrorCode.HTTP_ERROR, 'HTTP_ERROR')
  })

  it('should be usable as type', () => {
    const code: CCIPErrorCode = CCIPErrorCode.CHAIN_NOT_FOUND
    assert.equal(code, 'CHAIN_NOT_FOUND')
  })
})

describe('isTransientError', () => {
  it('should return true for transient error codes', () => {
    assert.equal(isTransientError(CCIPErrorCode.BLOCK_NOT_FOUND), true)
    assert.equal(isTransientError(CCIPErrorCode.MESSAGE_ID_NOT_FOUND), true)
    assert.equal(isTransientError(CCIPErrorCode.HTTP_ERROR), true)
    assert.equal(isTransientError(CCIPErrorCode.COMMIT_NOT_FOUND), true)
  })

  it('should return false for permanent error codes', () => {
    assert.equal(isTransientError(CCIPErrorCode.CHAIN_NOT_FOUND), false)
    assert.equal(isTransientError(CCIPErrorCode.VERSION_UNSUPPORTED), false)
    assert.equal(isTransientError(CCIPErrorCode.MESSAGE_INVALID), false)
  })
})

describe('TRANSIENT_ERROR_CODES', () => {
  it('should be a Set of transient codes', () => {
    assert.ok(TRANSIENT_ERROR_CODES instanceof Set)
    assert.ok(TRANSIENT_ERROR_CODES.has(CCIPErrorCode.BLOCK_NOT_FOUND))
    assert.ok(TRANSIENT_ERROR_CODES.has(CCIPErrorCode.HTTP_ERROR))
    assert.ok(!TRANSIENT_ERROR_CODES.has(CCIPErrorCode.CHAIN_NOT_FOUND))
  })
})

// =============================================================================
// Recovery Hints Tests
// =============================================================================

describe('recovery hints', () => {
  describe('DEFAULT_RECOVERY_HINTS', () => {
    it('should have hints for common error codes', () => {
      assert.ok(DEFAULT_RECOVERY_HINTS.CHAIN_NOT_FOUND)
      assert.ok(DEFAULT_RECOVERY_HINTS.BLOCK_NOT_FOUND)
      assert.ok(DEFAULT_RECOVERY_HINTS.HTTP_ERROR)
      assert.ok(DEFAULT_RECOVERY_HINTS.VERSION_UNSUPPORTED)
    })

    it('should have descriptive hints', () => {
      assert.ok(DEFAULT_RECOVERY_HINTS.CHAIN_NOT_FOUND?.includes('chainId'))
      assert.ok(DEFAULT_RECOVERY_HINTS.BLOCK_NOT_FOUND?.includes('Wait'))
      assert.ok(DEFAULT_RECOVERY_HINTS.HTTP_ERROR?.includes('rate limiting'))
    })
  })

  describe('getDefaultRecovery', () => {
    it('should return hint for known codes', () => {
      const hint = getDefaultRecovery(CCIPErrorCode.CHAIN_NOT_FOUND)
      assert.equal(hint, DEFAULT_RECOVERY_HINTS.CHAIN_NOT_FOUND)
    })

    it('should return undefined for codes without hints', () => {
      // Using a code that might not have a hint
      const hint = getDefaultRecovery('NONEXISTENT_CODE' as CCIPErrorCode)
      assert.equal(hint, undefined)
    })
  })

  describe('coverage', () => {
    it('should have recovery hints for all error codes', () => {
      const allCodes = Object.values(CCIPErrorCode)
      const codesWithHints = Object.keys(DEFAULT_RECOVERY_HINTS)
      const missing = allCodes.filter((code) => !codesWithHints.includes(code))

      assert.deepEqual(
        missing,
        [],
        `Missing recovery hints for: ${missing.join(', ')}. Add hints in recovery.ts.`,
      )
    })
  })
})

// =============================================================================
// Specialized Error Classes Tests
// =============================================================================

describe('specialized errors', () => {
  describe('Chain/Network errors', () => {
    it('CCIPChainNotFoundError should be permanent', () => {
      const error = new CCIPChainNotFoundError(1)

      assert.equal(error.code, 'CHAIN_NOT_FOUND')
      assert.equal(error.name, 'CCIPChainNotFoundError')
      assert.equal(error.isTransient, false)
      assert.ok(error.message.includes('1'))
      assert.equal(error.context.chainIdOrSelector, 1)
    })

    it('CCIPChainNotFoundError should handle bigint', () => {
      const error = new CCIPChainNotFoundError(5009297550715157269n)

      assert.ok(error.message.includes('5009297550715157269'))
      assert.equal(error.context.chainIdOrSelector, 5009297550715157269n)
    })

    it('CCIPChainFamilyUnsupportedError should include family', () => {
      const error = new CCIPChainFamilyUnsupportedError('cosmos')

      assert.equal(error.code, 'CHAIN_FAMILY_UNSUPPORTED')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.family, 'cosmos')
    })
  })

  describe('Block & Transaction errors', () => {
    it('CCIPBlockNotFoundError should be transient with retry delay', () => {
      const error = new CCIPBlockNotFoundError(12345)

      assert.equal(error.code, 'BLOCK_NOT_FOUND')
      assert.equal(error.name, 'CCIPBlockNotFoundError')
      assert.equal(error.isTransient, true)
      assert.equal(error.retryAfterMs, 12000)
      assert.equal(error.context.block, 12345)
    })

    it('CCIPTransactionNotFoundError should be transient', () => {
      const hash = '0x1234567890abcdef'
      const error = new CCIPTransactionNotFoundError(hash)

      assert.equal(error.code, 'TRANSACTION_NOT_FOUND')
      assert.equal(error.isTransient, true)
      assert.equal(error.retryAfterMs, 5000)
      assert.equal(error.context.hash, hash)
    })
  })

  describe('CCIP Message errors', () => {
    it('CCIPMessageIdNotFoundError should be transient', () => {
      const messageId = '0xabcdef123456'
      const error = new CCIPMessageIdNotFoundError(messageId)

      assert.equal(error.code, 'MESSAGE_ID_NOT_FOUND')
      assert.equal(error.isTransient, true)
      assert.equal(error.retryAfterMs, 30000)
      assert.equal(error.context.messageId, messageId)
    })

    it('CCIPMessageInvalidError should be permanent', () => {
      const data = { foo: 'bar' }
      const error = new CCIPMessageInvalidError(data)

      assert.equal(error.code, 'MESSAGE_INVALID')
      assert.equal(error.isTransient, false)
      assert.deepEqual(error.context.data, data)
    })

    it('CCIPMessageNotInBatchError should be permanent', () => {
      const error = new CCIPMessageNotInBatchError('0xmsgid', { min: 100n, max: 200n })

      assert.equal(error.code, 'MESSAGE_NOT_IN_BATCH')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.messageId, '0xmsgid')
      assert.deepEqual(error.context.seqNumRange, { min: 100n, max: 200n })
    })
  })

  describe('Lane & Routing errors', () => {
    it('CCIPOffRampNotFoundError should be permanent', () => {
      const error = new CCIPOffRampNotFoundError('0xOnRamp', 'Ethereum Mainnet')

      assert.equal(error.code, 'OFFRAMP_NOT_FOUND')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.onRamp, '0xOnRamp')
      assert.equal(error.context.destNetwork, 'Ethereum Mainnet')
    })

    it('CCIPOnRampRequiredError should be permanent', () => {
      const error = new CCIPOnRampRequiredError()

      assert.equal(error.code, 'ONRAMP_REQUIRED')
      assert.equal(error.isTransient, false)
    })
  })

  describe('Commit & Merkle errors', () => {
    it('CCIPCommitNotFoundError should be transient', () => {
      const error = new CCIPCommitNotFoundError(12345, 100n)

      assert.equal(error.code, 'COMMIT_NOT_FOUND')
      assert.equal(error.isTransient, true)
      assert.equal(error.retryAfterMs, 60000)
      assert.equal(error.context.startBlock, 12345)
      assert.equal(error.context.sequenceNumber, 100n)
    })

    it('CCIPMerkleRootMismatchError should be permanent', () => {
      const error = new CCIPMerkleRootMismatchError('0xexpected', '0xactual')

      assert.equal(error.code, 'MERKLE_ROOT_MISMATCH')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.expected, '0xexpected')
      assert.equal(error.context.got, '0xactual')
    })

    it('CCIPMerkleTreeEmptyError should be permanent', () => {
      const error = new CCIPMerkleTreeEmptyError()

      assert.equal(error.code, 'MERKLE_TREE_EMPTY')
      assert.equal(error.isTransient, false)
    })
  })

  describe('Version errors', () => {
    it('CCIPVersionUnsupportedError should be permanent', () => {
      const error = new CCIPVersionUnsupportedError('0.9')

      assert.equal(error.code, 'VERSION_UNSUPPORTED')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.version, '0.9')
    })

    it('CCIPHasherVersionUnsupportedError should be permanent', () => {
      const error = new CCIPHasherVersionUnsupportedError('evm', '1.0')

      assert.equal(error.code, 'HASHER_VERSION_UNSUPPORTED')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.chain, 'evm')
      assert.equal(error.context.version, '1.0')
    })
  })

  describe('ExtraArgs errors', () => {
    it('CCIPExtraArgsParseError should be permanent', () => {
      const error = new CCIPExtraArgsParseError('invalid format')

      assert.equal(error.code, 'EXTRA_ARGS_PARSE_FAILED')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.from, 'invalid format')
    })

    it('CCIPExtraArgsInvalidError should be permanent', () => {
      const error = new CCIPExtraArgsInvalidError('EVM', '0x1234')

      assert.equal(error.code, 'EXTRA_ARGS_INVALID_EVM')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.chainFamily, 'EVM')
      assert.equal(error.context.extraArgs, '0x1234')
      assert.ok(error.message.includes('0x1234'))
    })
  })

  describe('Token errors', () => {
    it('CCIPTokenNotInRegistryError should be permanent', () => {
      const error = new CCIPTokenNotInRegistryError('0xtoken', '0xregistry')

      assert.equal(error.code, 'TOKEN_NOT_IN_REGISTRY')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.token, '0xtoken')
      assert.equal(error.context.registry, '0xregistry')
    })

    it('CCIPTokenNotConfiguredError should be permanent', () => {
      const error = new CCIPTokenNotConfiguredError('0xtoken', '0xregistry')

      assert.equal(error.code, 'TOKEN_NOT_CONFIGURED')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.token, '0xtoken')
      assert.equal(error.context.registry, '0xregistry')
    })

    it('CCIPTokenDecimalsInsufficientError should be permanent', () => {
      const error = new CCIPTokenDecimalsInsufficientError(
        '0xtoken',
        6,
        'Polygon',
        '1000000000000000000',
      )

      assert.equal(error.code, 'TOKEN_DECIMALS_INSUFFICIENT')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.token, '0xtoken')
      assert.equal(error.context.destDecimals, 6)
      assert.equal(error.context.destChain, 'Polygon')
      assert.equal(error.context.amount, '1000000000000000000')
    })
  })

  describe('Contract Type errors', () => {
    it('CCIPContractTypeInvalidError should be permanent', () => {
      const error = new CCIPContractTypeInvalidError('0xaddr', 'TokenPool 1.0', [
        'Router',
        'OnRamp',
        'OffRamp',
      ])

      assert.equal(error.code, 'CONTRACT_TYPE_INVALID')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.address, '0xaddr')
      assert.equal(error.context.actualType, 'TokenPool 1.0')
      assert.deepEqual(error.context.expectedTypes, ['Router', 'OnRamp', 'OffRamp'])
    })
  })

  describe('Wallet errors', () => {
    it('CCIPWalletNotSignerError should be permanent', () => {
      const error = new CCIPWalletNotSignerError({ address: '0x123' })

      assert.equal(error.code, 'WALLET_NOT_SIGNER')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.walletType, 'object')
    })
  })

  describe('Execution errors', () => {
    it('CCIPExecTxNotConfirmedError should be transient', () => {
      const error = new CCIPExecTxNotConfirmedError('0xtxhash')

      assert.equal(error.code, 'EXEC_TX_NOT_CONFIRMED')
      assert.equal(error.isTransient, true)
      assert.equal(error.retryAfterMs, 5000)
      assert.equal(error.context.txHash, '0xtxhash')
    })

    it('CCIPExecTxRevertedError should be permanent', () => {
      const error = new CCIPExecTxRevertedError('0xtxhash')

      assert.equal(error.code, 'EXEC_TX_REVERTED')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.txHash, '0xtxhash')
    })
  })

  describe('Attestation errors', () => {
    it('CCIPUsdcAttestationError should be transient', () => {
      const response = { status: 'pending', message: 'attestation not ready' }
      const error = new CCIPUsdcAttestationError('0x123abc', response)

      assert.equal(error.code, 'USDC_ATTESTATION_FAILED')
      assert.equal(error.isTransient, true)
      assert.equal(error.retryAfterMs, 10000)
      assert.deepEqual(error.context.response, response)
      assert.equal(error.context.messageHash, '0x123abc')
    })

    it('CCIPLbtcAttestationError should be transient', () => {
      const response = { error: 'fetch failed' }
      const error = new CCIPLbtcAttestationError(response)

      assert.equal(error.code, 'LBTC_ATTESTATION_ERROR')
      assert.equal(error.isTransient, true)
      assert.equal(error.retryAfterMs, 10000)
      assert.deepEqual(error.context.response, response)
    })
  })

  describe('Solana-specific errors', () => {
    it('CCIPSolanaLookupTableNotFoundError should be transient', () => {
      const error = new CCIPSolanaLookupTableNotFoundError('tableAddr')

      assert.equal(error.code, 'SOLANA_LOOKUP_TABLE_NOT_FOUND')
      assert.equal(error.isTransient, true)
      assert.equal(error.retryAfterMs, 5000)
      assert.equal(error.context.address, 'tableAddr')
    })
  })

  describe('Aptos-specific errors', () => {
    it('CCIPAptosTransactionInvalidError should be permanent', () => {
      const error = new CCIPAptosTransactionInvalidError('invalid hash')

      assert.equal(error.code, 'APTOS_TX_INVALID')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.hashOrVersion, 'invalid hash')
    })
  })

  describe('HTTP errors', () => {
    it('CCIPHttpError should be transient for 5xx errors', () => {
      const error = new CCIPHttpError(500, 'Internal Server Error')

      assert.equal(error.code, 'HTTP_ERROR')
      assert.equal(error.isTransient, true)
      assert.equal(error.context.status, 500)
      assert.equal(error.context.statusText, 'Internal Server Error')
    })

    it('CCIPHttpError should be transient for 429 rate limit', () => {
      const error = new CCIPHttpError(429, 'Too Many Requests')

      assert.equal(error.code, 'HTTP_ERROR')
      assert.equal(error.isTransient, true)
      assert.equal(error.context.status, 429)
    })

    it('CCIPHttpError should be permanent for 4xx errors (except 429)', () => {
      const error = new CCIPHttpError(404, 'Not Found')

      assert.equal(error.code, 'HTTP_ERROR')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.status, 404)
    })

    it('CCIPNotImplementedError should be permanent', () => {
      const error = new CCIPNotImplementedError('someFeature')

      assert.equal(error.code, 'NOT_IMPLEMENTED')
      assert.equal(error.isTransient, false)
      assert.equal(error.context.feature, 'someFeature')
    })
  })

  describe('inheritance', () => {
    it('all specialized errors should be instanceof CCIPError', () => {
      const errors = [
        new CCIPChainNotFoundError(1),
        new CCIPBlockNotFoundError(1),
        new CCIPMessageIdNotFoundError('0x'),
        new CCIPVersionUnsupportedError('0.9'),
        new CCIPHttpError(500, 'Internal Server Error'),
      ]

      for (const error of errors) {
        assert.ok(error instanceof CCIPError, `${error.name} should be instanceof CCIPError`)
        assert.ok(error instanceof Error, `${error.name} should be instanceof Error`)
        assert.ok(
          CCIPError.isCCIPError(error),
          `CCIPError.isCCIPError should return true for ${error.name}`,
        )
      }
    })
  })
})

// =============================================================================
// Utility Functions Tests
// =============================================================================

describe('utility functions', () => {
  describe('getRetryDelay', () => {
    it('should return null for permanent errors', () => {
      const error = new CCIPChainNotFoundError(1)
      assert.equal(getRetryDelay(error), null)
    })

    it('should return retryAfterMs for transient errors with explicit delay', () => {
      const error = new CCIPBlockNotFoundError(1)
      assert.equal(getRetryDelay(error), 12000)
    })

    it('should return default delay for transient errors without explicit delay', () => {
      const error = new CCIPError(CCIPErrorCode.BLOCK_NOT_FOUND, 'Block not found', {
        isTransient: true,
      })
      assert.equal(getRetryDelay(error), 12000)
    })

    it('should use error-specific default delays', () => {
      const httpError = new CCIPHttpError(500, 'Internal Server Error')
      // CCIPHttpError doesn't set retryAfterMs, so it uses default from getDefaultRetryDelay
      assert.ok(getRetryDelay(httpError) !== null)

      const commitError = new CCIPCommitNotFoundError(12345, 100n)
      assert.equal(getRetryDelay(commitError), 60000)

      const usdcError = new CCIPUsdcAttestationError('0x123', { status: 'pending' })
      assert.equal(getRetryDelay(usdcError), 10000)
    })
  })

  describe('shouldRetry', () => {
    it('should return true for transient CCIPErrors', () => {
      assert.equal(shouldRetry(new CCIPBlockNotFoundError(1)), true)
      assert.equal(shouldRetry(new CCIPHttpError(500, 'Internal Server Error')), true)
      assert.equal(shouldRetry(new CCIPCommitNotFoundError(12345, 100n)), true)
    })

    it('should return false for permanent CCIPErrors', () => {
      assert.equal(shouldRetry(new CCIPChainNotFoundError(1)), false)
      assert.equal(shouldRetry(new CCIPVersionUnsupportedError('0.9')), false)
    })

    it('should detect common transient patterns in regular Errors', () => {
      assert.equal(shouldRetry(new Error('Connection timeout')), true)
      assert.equal(shouldRetry(new Error('ECONNREFUSED')), true)
      assert.equal(shouldRetry(new Error('Network error')), true)
      assert.equal(shouldRetry(new Error('Rate limit exceeded')), true)
    })

    it('should return false for regular non-transient errors', () => {
      assert.equal(shouldRetry(new Error('Invalid argument')), false)
      assert.equal(shouldRetry(new Error('Not found')), false)
    })

    it('should return false for non-Error values', () => {
      assert.equal(shouldRetry(null), false)
      assert.equal(shouldRetry(undefined), false)
      assert.equal(shouldRetry('error string'), false)
      assert.equal(shouldRetry(123), false)
      assert.equal(shouldRetry({}), false)
    })
  })

  describe('formatErrorForLogging', () => {
    it('should return structured log object', () => {
      const cause = new Error('Original')
      const error = new CCIPError(CCIPErrorCode.HTTP_ERROR, 'HTTP failed', {
        cause,
        context: { status: 500 },
        isTransient: true,
        retryAfterMs: 5000,
        recovery: 'Retry later',
      })

      const log = formatErrorForLogging(error)

      assert.equal(log.name, 'CCIPError')
      assert.equal(log.code, 'HTTP_ERROR')
      assert.equal(log.message, 'HTTP failed')
      assert.equal(log.isTransient, true)
      assert.deepEqual(log.context, { status: 500 })
      assert.equal(log.recovery, 'Retry later')
      assert.ok(typeof log.stack === 'string')
      assert.deepEqual(log.cause, { name: 'Error', message: 'Original' })
    })

    it('should handle errors without cause', () => {
      const error = new CCIPChainNotFoundError(1)
      const log = formatErrorForLogging(error)

      assert.equal(log.cause, undefined)
    })
  })

  describe('assert', () => {
    it('should not throw when condition is true', () => {
      assert.doesNotThrow(() => {
        assertUtil(true, CCIPErrorCode.UNKNOWN, 'Should not throw')
      })
    })

    it('should throw CCIPError when condition is false', () => {
      assert.throws(
        () => {
          assertUtil(false, CCIPErrorCode.CHAIN_NOT_FOUND, 'Chain not found')
        },
        (err: unknown) => {
          return (
            err instanceof CCIPError &&
            err.code === 'CHAIN_NOT_FOUND' &&
            err.message === 'Chain not found' &&
            err.isTransient === false
          )
        },
      )
    })

    it('should include context in thrown error', () => {
      assert.throws(
        () => {
          assertUtil(false, CCIPErrorCode.CHAIN_NOT_FOUND, 'Chain not found', { chainId: 1 })
        },
        (err: unknown) => {
          return err instanceof CCIPError && err.context.chainId === 1
        },
      )
    })

    it('should work as type assertion', () => {
      const value = 'hello' as string | undefined
      assertUtil(value !== undefined, CCIPErrorCode.UNKNOWN, 'Value required')
      // After assertion, TypeScript knows value is string
      const length: number = value.length
      assert.equal(length, 5)
    })
  })
})
