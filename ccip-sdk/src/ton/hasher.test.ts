import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type CCIPMessage_V1_6, CCIPVersion } from '../types.ts'
import { getTONLeafHasher } from './hasher.ts'
import type { EVMExtraArgsV2 } from '../extra-args.ts'

const ZERO_ADDRESS = '0x' + '0'.repeat(40)

describe('TON hasher unit tests', () => {
  const CHAINSEL_EVM_TEST = 909606746561742123n
  const CHAINSEL_TON = 13879075125137744094n
  const EVM_ONRAMP = '0x111111c891c5d4e6ad68064ae45d43146d4f9f3a'
  const EVM_SENDER = '0x1a5fdbc891c5d4e6ad68064ae45d43146d4f9f3a'

  describe('getTONLeafHasher', () => {
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
})
