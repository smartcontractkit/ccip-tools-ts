import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type CCIPMessage_V1_6, CCIPVersion } from '../types.ts'
import { getTONLeafHasher, hashTONMetadata } from './hasher.ts'

const ZERO_ADDRESS = '0x' + '0'.repeat(40)
const TON_RECEIVER = '0:' + '3'.repeat(64)

describe('TON hasher', () => {
  const CHAINSEL_EVM_TEST_90000001 = 909606746561742123n
  const CHAINSEL_TON = 13879075125137744094n
  const EVM_ONRAMP_ADDRESS_TEST = '0x111111c891c5d4e6ad68064ae45d43146d4f9f3a'
  const EVM_SENDER_ADDRESS_TEST = '0x1a5fdbc891c5d4e6ad68064ae45d43146d4f9f3a'

  describe('hashTONMetadata', () => {
    it('should create consistent metadata hash', () => {
      const hash1 = hashTONMetadata(
        CHAINSEL_EVM_TEST_90000001,
        CHAINSEL_TON,
        EVM_ONRAMP_ADDRESS_TEST,
      )
      const hash2 = hashTONMetadata(
        CHAINSEL_EVM_TEST_90000001,
        CHAINSEL_TON,
        EVM_ONRAMP_ADDRESS_TEST,
      )

      assert.equal(hash1, hash2)
      assert.match(hash1, /^0x[a-f0-9]{64}$/)
    })

    it('should create different hashes for different parameters', () => {
      const hash1 = hashTONMetadata(
        CHAINSEL_EVM_TEST_90000001,
        CHAINSEL_TON,
        EVM_ONRAMP_ADDRESS_TEST,
      )
      const hash2 = hashTONMetadata(
        CHAINSEL_EVM_TEST_90000001 + 1n,
        CHAINSEL_TON,
        EVM_ONRAMP_ADDRESS_TEST,
      )

      assert.notEqual(hash1, hash2)
    })
  })

  describe('getTONLeafHasher', () => {
    it('should throw error for unsupported version', () => {
      assert.throws(() => {
        getTONLeafHasher({
          sourceChainSelector: CHAINSEL_EVM_TEST_90000001,
          destChainSelector: CHAINSEL_TON,
          onRamp: EVM_ONRAMP_ADDRESS_TEST,
          version: CCIPVersion.V1_2,
        })
      }, /TON only supports CCIP v1.6/)
    })

    it('should create hasher for v1.6', () => {
      const hasher = getTONLeafHasher({
        sourceChainSelector: CHAINSEL_EVM_TEST_90000001,
        destChainSelector: CHAINSEL_TON,
        onRamp: EVM_ONRAMP_ADDRESS_TEST,
        version: CCIPVersion.V1_6,
      })

      assert.equal(typeof hasher, 'function')
    })
  })

  describe('message hashing', () => {
    const hasher = getTONLeafHasher({
      sourceChainSelector: CHAINSEL_EVM_TEST_90000001,
      destChainSelector: CHAINSEL_TON,
      onRamp: EVM_ONRAMP_ADDRESS_TEST,
      version: CCIPVersion.V1_6,
    })

    it('should hash basic message', () => {
      const message: CCIPMessage_V1_6 & {
        gasLimit: bigint
        allowOutOfOrderExecution: boolean
      } = {
        header: {
          messageId: '0x' + '1'.repeat(64),
          sequenceNumber: 123n,
          nonce: 456n,
          sourceChainSelector: CHAINSEL_EVM_TEST_90000001,
          destChainSelector: CHAINSEL_TON,
        },
        sender: EVM_SENDER_ADDRESS_TEST,
        receiver: TON_RECEIVER,
        data: '0x1234',
        extraArgs: '0x181dcf10000000000000000000000000000000000000000000000000000000000000000001',
        gasLimit: 0n,
        allowOutOfOrderExecution: true,
        tokenAmounts: [] as CCIPMessage_V1_6['tokenAmounts'],
        feeToken: ZERO_ADDRESS,
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      const hash = hasher(message)
      assert.match(hash, /^0x[a-f0-9]{64}$/)
    })

    it('should hash message with tokens', () => {
      const tokenAmounts: CCIPMessage_V1_6['tokenAmounts'] = [
        {
          sourcePoolAddress: '0x123456789abcdef123456789abcdef123456789a',
          destTokenAddress: '0:' + '5'.repeat(64),
          extraData: '0x',
          destGasAmount: 1000n,
          amount: 1000n,
          destExecData: '0x',
        },
      ]

      const message: CCIPMessage_V1_6 & {
        gasLimit: bigint
        allowOutOfOrderExecution: boolean
      } = {
        header: {
          messageId: '0x' + '1'.repeat(64),
          sequenceNumber: 123n,
          nonce: 456n,
          sourceChainSelector: CHAINSEL_EVM_TEST_90000001,
          destChainSelector: CHAINSEL_TON,
        },
        sender: EVM_SENDER_ADDRESS_TEST,
        receiver: TON_RECEIVER,
        data: '0x1234',
        extraArgs: '0x181dcf10000000000000000000000000000000000000000000000000000000000000000001',
        gasLimit: 0n,
        allowOutOfOrderExecution: true,
        tokenAmounts,
        feeToken: ZERO_ADDRESS,
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      const hash = hasher(message)
      assert.match(hash, /^0x[a-f0-9]{64}$/)
    })

    it('should handle embedded gasLimit', () => {
      const message: CCIPMessage_V1_6 & {
        gasLimit: bigint
        allowOutOfOrderExecution: boolean
      } = {
        header: {
          messageId: '0x' + '1'.repeat(64),
          sequenceNumber: 123n,
          nonce: 456n,
          sourceChainSelector: CHAINSEL_EVM_TEST_90000001,
          destChainSelector: CHAINSEL_TON,
        },
        sender: EVM_SENDER_ADDRESS_TEST,
        receiver: TON_RECEIVER,
        data: '0x1234',
        extraArgs: '0x',
        gasLimit: 500000n,
        allowOutOfOrderExecution: false,
        tokenAmounts: [] as CCIPMessage_V1_6['tokenAmounts'],
        feeToken: ZERO_ADDRESS,
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      const hash = hasher(message)
      assert.match(hash, /^0x[a-f0-9]{64}$/)
    })

    it('should compute leaf hash matching chainlink-ton for Merkle verification', () => {
      // https://github.com/smartcontractkit/chainlink-ton/blob/f56790ae36317956ec09a53f9524bef77fddcadc/contracts/tests/ccip/OffRamp.spec.ts#L989-L990
      const expectedHash = '0xce60f1962af3c7c7f9d3e434dea13530564dbff46704d628ff4b2206bbc93289'
      const message: CCIPMessage_V1_6 & {
        gasLimit: bigint
        allowOutOfOrderExecution: boolean
      } = {
        header: {
          messageId: '0x' + '0'.repeat(63) + '1',
          sequenceNumber: 1n,
          nonce: 0n,
          sourceChainSelector: CHAINSEL_EVM_TEST_90000001,
          destChainSelector: CHAINSEL_TON,
        },
        sender: EVM_SENDER_ADDRESS_TEST,
        receiver: 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2',
        data: '0x',
        extraArgs: '0x',
        gasLimit: 100_000_000n,
        allowOutOfOrderExecution: false,
        tokenAmounts: [] as CCIPMessage_V1_6['tokenAmounts'],
        feeToken: ZERO_ADDRESS,
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      const computedHash = hasher(message)

      assert.equal(computedHash, expectedHash)
    })
  })
})
