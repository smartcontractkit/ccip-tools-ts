import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type CCIPMessage_V1_6, CCIPVersion } from '../types.ts'
import { getTONLeafHasher, getTVM2AnyLeafHasher } from './hasher.ts'
import type { EVMExtraArgsV2 } from '../extra-args.ts'
import type { CCIPMessage_V1_6_TON } from './types.ts'

const ZERO_ADDRESS = '0x' + '0'.repeat(40)

describe('TON hasher unit tests', () => {
  const CHAINSEL_EVM_TEST = 909606746561742123n
  const CHAINSEL_TON = 13879075125137744094n
  const EVM_ONRAMP = '0x111111c891c5d4e6ad68064ae45d43146d4f9f3a'
  const EVM_SENDER = '0x1a5fdbc891c5d4e6ad68064ae45d43146d4f9f3a'
  const TON_ONRAMP = '0:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
  const TON_SENDER = '0:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
  const EVM_RECEIVER = '0xd2ae3ca32e9e1f81abc78a316c49b2767ba02085'
  const silentLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as Console

  // ============================================================================
  // Any→TON
  // ============================================================================

  describe('Any→TON (getTONLeafHasher)', () => {
    it('should throw for unsupported versions', () => {
      assert.throws(() => {
        getTONLeafHasher({
          sourceChainSelector: CHAINSEL_EVM_TEST,
          destChainSelector: CHAINSEL_TON,
          onRamp: EVM_ONRAMP,
          version: CCIPVersion.V1_2,
        })
      }, /Unsupported hasher version for TON/)
    })

    it('should compute v1.6 hash matching chainlink-ton reference', () => {
      // Reference: https://github.com/smartcontractkit/chainlink-ton/blob/f56790ae36317956ec09a53f9524bef77fddcadc/contracts/tests/ccip/OffRamp.spec.ts#L989-L990
      const hasher = getTONLeafHasher({
        sourceChainSelector: CHAINSEL_EVM_TEST,
        destChainSelector: CHAINSEL_TON,
        onRamp: EVM_ONRAMP,
        version: CCIPVersion.V1_6,
      })

      const message: CCIPMessage_V1_6 & EVMExtraArgsV2 = {
        messageId: '0x' + '0'.repeat(63) + '1',
        sequenceNumber: 1n,
        nonce: 0n,
        sourceChainSelector: CHAINSEL_EVM_TEST,
        destChainSelector: CHAINSEL_TON,
        sender: EVM_SENDER,
        receiver: 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2',
        data: '0x',
        extraArgs: '0x',
        gasLimit: 100_000_000n,
        allowOutOfOrderExecution: false,
        tokenAmounts: [],
        feeToken: ZERO_ADDRESS,
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      assert.equal(
        hasher(message),
        '0xce60f1962af3c7c7f9d3e434dea13530564dbff46704d628ff4b2206bbc93289',
      )
    })

    it('should produce different hashes for different inputs', () => {
      const hasher = getTONLeafHasher({
        sourceChainSelector: CHAINSEL_EVM_TEST,
        destChainSelector: CHAINSEL_TON,
        onRamp: EVM_ONRAMP,
        version: CCIPVersion.V1_6,
      })

      const baseMessage: CCIPMessage_V1_6 & EVMExtraArgsV2 = {
        messageId: '0x' + '0'.repeat(63) + '1',
        sequenceNumber: 1n,
        nonce: 0n,
        sourceChainSelector: CHAINSEL_EVM_TEST,
        destChainSelector: CHAINSEL_TON,
        sender: EVM_SENDER,
        receiver: 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2',
        data: '0x',
        extraArgs: '0x',
        gasLimit: 100_000n,
        allowOutOfOrderExecution: false,
        tokenAmounts: [],
        feeToken: ZERO_ADDRESS,
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      const hash1 = hasher(baseMessage)
      const hash2 = hasher({ ...baseMessage, sequenceNumber: 2n })
      const hash3 = hasher({ ...baseMessage, data: '0x1234' })

      assert.notEqual(hash1, hash2)
      assert.notEqual(hash1, hash3)
    })
  })

  // ============================================================================
  // TON→Any
  // ============================================================================

  describe('TON→Any (getTVM2AnyLeafHasher)', () => {
    it('should create hasher and produce valid hash', () => {
      const hasher = getTVM2AnyLeafHasher(CHAINSEL_TON, CHAINSEL_EVM_TEST, TON_ONRAMP, {
        logger: silentLogger,
      })

      const message: CCIPMessage_V1_6_TON = {
        messageId: '0x' + '0'.repeat(63) + '1',
        sequenceNumber: 1n,
        nonce: 0n,
        sourceChainSelector: CHAINSEL_TON,
        destChainSelector: CHAINSEL_EVM_TEST,
        sender: TON_SENDER,
        receiver: EVM_RECEIVER,
        data: '0x',
        extraArgs: '0x',
        gasLimit: 100_000n,
        allowOutOfOrderExecution: false,
        tokenAmounts: [],
        feeToken: '',
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      const hash = hasher(message)
      assert.match(hash, /^0x[0-9a-f]{64}$/i)
    })

    it('should produce consistent hashes', () => {
      const hasher = getTVM2AnyLeafHasher(CHAINSEL_TON, CHAINSEL_EVM_TEST, TON_ONRAMP, {
        logger: silentLogger,
      })

      const message: CCIPMessage_V1_6_TON = {
        messageId: '0x' + '0'.repeat(63) + '1',
        sequenceNumber: 1n,
        nonce: 0n,
        sourceChainSelector: CHAINSEL_TON,
        destChainSelector: CHAINSEL_EVM_TEST,
        sender: TON_SENDER,
        receiver: EVM_RECEIVER,
        data: '0x1234',
        extraArgs: '0x',
        gasLimit: 100_000n,
        allowOutOfOrderExecution: false,
        tokenAmounts: [],
        feeToken: '',
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      assert.equal(hasher(message), hasher(message))
    })

    it('should produce different hashes for different inputs', () => {
      const hasher = getTVM2AnyLeafHasher(CHAINSEL_TON, CHAINSEL_EVM_TEST, TON_ONRAMP, {
        logger: silentLogger,
      })

      const baseMessage: CCIPMessage_V1_6_TON = {
        messageId: '0x' + '0'.repeat(63) + '1',
        sequenceNumber: 1n,
        nonce: 0n,
        sourceChainSelector: CHAINSEL_TON,
        destChainSelector: CHAINSEL_EVM_TEST,
        sender: TON_SENDER,
        receiver: EVM_RECEIVER,
        data: '0x',
        extraArgs: '0x',
        gasLimit: 100_000n,
        allowOutOfOrderExecution: false,
        tokenAmounts: [],
        feeToken: '',
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      const hash1 = hasher(baseMessage)
      const hash2 = hasher({ ...baseMessage, sequenceNumber: 2n })
      const hash3 = hasher({
        ...baseMessage,
        sender: '0:ffff567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      })

      assert.notEqual(hash1, hash2)
      assert.notEqual(hash1, hash3)
    })

    it('should produce different hashes for different lane configs', () => {
      const hasher1 = getTVM2AnyLeafHasher(CHAINSEL_TON, CHAINSEL_EVM_TEST, TON_ONRAMP, {
        logger: silentLogger,
      })
      const hasher2 = getTVM2AnyLeafHasher(CHAINSEL_TON, CHAINSEL_EVM_TEST + 1n, TON_ONRAMP, {
        logger: silentLogger,
      })

      const message: CCIPMessage_V1_6_TON = {
        messageId: '0x' + '0'.repeat(63) + '1',
        sequenceNumber: 1n,
        nonce: 0n,
        sourceChainSelector: CHAINSEL_TON,
        destChainSelector: CHAINSEL_EVM_TEST,
        sender: TON_SENDER,
        receiver: EVM_RECEIVER,
        data: '0x',
        extraArgs: '0x',
        gasLimit: 100_000n,
        allowOutOfOrderExecution: false,
        tokenAmounts: [],
        feeToken: '',
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      assert.notEqual(hasher1(message), hasher2(message))
    })
  })
})
