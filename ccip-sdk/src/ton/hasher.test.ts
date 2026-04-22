import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type CCIPMessage_V1_6, CCIPVersion } from '../types.ts'
import { getTONLeafHasher, hashTONMetadata } from './hasher.ts'
import type { EVMExtraArgsV2 } from '../extra-args.ts'

const ZERO_ADDRESS = '0x' + '0'.repeat(40)

describe('TON hasher unit tests', () => {
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
      }, /Unsupported hasher version for TON/)
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

    it('should compute leaf hash matching chainlink-ton for Merkle verification', () => {
      // https://github.com/smartcontractkit/chainlink-ton/blob/f56790ae36317956ec09a53f9524bef77fddcadc/contracts/tests/ccip/OffRamp.spec.ts#L989-L990
      const expectedHash = '0xce60f1962af3c7c7f9d3e434dea13530564dbff46704d628ff4b2206bbc93289'
      const message: CCIPMessage_V1_6 & EVMExtraArgsV2 = {
        messageId: '0x' + '0'.repeat(63) + '1',
        sequenceNumber: 1n,
        nonce: 0n,
        sourceChainSelector: CHAINSEL_EVM_TEST_90000001,
        destChainSelector: CHAINSEL_TON,
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

    // https://api.ccip.chain.link/v2/messages/0xc9d521e2b4be8d995d7f9ffbde183e12d88ec93794d6b4329c23cb354db406a8/execution-inputs
    it('should hash the live stuck Solana->TON message to the committed single-leaf merkle root', () => {
      const sourceChainSelector = 16423721717087811551n
      const destChainSelector = 1399300952838017768n
      const hasher = getTONLeafHasher({
        sourceChainSelector,
        destChainSelector,
        onRamp: 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C',
        version: CCIPVersion.V1_6,
      })

      const message: CCIPMessage_V1_6 & EVMExtraArgsV2 = {
        messageId: '0xc9d521e2b4be8d995d7f9ffbde183e12d88ec93794d6b4329c23cb354db406a8',
        sourceChainSelector,
        destChainSelector,
        sequenceNumber: 4n,
        nonce: 0n,
        sender: '9NhaY2AXejCX3c4tXufzWuv52ZG7rjTJDeb1qSo9UV7S',
        receiver: 'EQD4w5mxY0V7Szh2NsZ_BfWuMY6biF42HEjBz1-8_wRO-6gC',
        data: '0x48656c6c6f',
        extraArgs: '0x181dcf1040787d0100000000000000000000000001',
        tokenAmounts: [],
        feeToken: 'So11111111111111111111111111111111111111112',
        feeTokenAmount: 1547524n,
        feeValueJuels: 14388425000000000n,
        gasLimit: 25_000_000n,
        allowOutOfOrderExecution: true,
      }

      assert.equal(
        hasher(message),
        '0x050adeaa0cfe792abbd5e33a3ba6f2d9204052952d091f7624d1a2d23b771ad1',
      )
    })
  })
})
