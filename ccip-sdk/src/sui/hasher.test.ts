import assert from 'node:assert'
import { describe, it } from 'node:test'

import { zeroPadValue } from 'ethers'

import { ChainFamily } from '../chain.ts'
import { encodeExtraArgs } from '../extra-args.ts'
import '../index.ts'
import { type CCIPMessage_V1_6, CCIPVersion } from '../types.ts'
import { getSuiLeafHasher, hashSuiMetadata, hashV16SuiMessage } from './hasher.ts'
import type { CCIPMessage_V1_6_Sui } from './types.ts'

describe('Sui hasher', () => {
  describe('test_calculate_metadata_hash', () => {
    it('should match expected metadata hash', () => {
      const sourceChainSelector = 123456789n
      const destChainSelector = 987654321n
      const onRamp = '0x' + Buffer.from('source-onramp-address').toString('hex')

      const metadataHash = hashSuiMetadata(sourceChainSelector, destChainSelector, onRamp)

      const expectedMetadataHash =
        '0xb62ec658417caa5bcc6ff1d8c45f8b1cb52e1b0ed71603a04b250b107ed836d9'

      assert.strictEqual(metadataHash, expectedMetadataHash)
    })

    it('should produce different hash when source chain selector changes', () => {
      const sourceChainSelector = 123456789n
      const destChainSelector = 987654321n
      const onRamp = '0x' + Buffer.from('source-onramp-address').toString('hex')

      const metadataHash = hashSuiMetadata(sourceChainSelector, destChainSelector, onRamp)

      const metadataHashDifferentSource = hashSuiMetadata(
        sourceChainSelector + 1n,
        destChainSelector,
        onRamp,
      )

      assert.notStrictEqual(metadataHash, metadataHashDifferentSource)

      // Expected value from Move test
      const expectedMetadataHashDifferentSource =
        '0x89da72ab93f7bd546d60b58a1e1b5f628fd456fe163614ff1e31a2413ca1b55a'
      assert.strictEqual(metadataHashDifferentSource, expectedMetadataHashDifferentSource)
    })

    it('should produce different hash when destination chain selector changes', () => {
      const sourceChainSelector = 123456789n
      const destChainSelector = 987654321n
      const onRamp = '0x' + Buffer.from('source-onramp-address').toString('hex')

      const metadataHash = hashSuiMetadata(sourceChainSelector, destChainSelector, onRamp)

      const metadataHashDifferentDest = hashSuiMetadata(
        sourceChainSelector,
        destChainSelector + 1n,
        onRamp,
      )

      assert.notStrictEqual(metadataHash, metadataHashDifferentDest)
    })

    it('should produce different hash when on_ramp changes', () => {
      const sourceChainSelector = 123456789n
      const destChainSelector = 987654321n
      const onRamp = '0x' + Buffer.from('source-onramp-address').toString('hex')

      const metadataHash = hashSuiMetadata(sourceChainSelector, destChainSelector, onRamp)

      const differentOnRamp = '0x' + Buffer.from('different-onramp-address').toString('hex')
      const metadataHashDifferentOnRamp = hashSuiMetadata(
        sourceChainSelector,
        destChainSelector,
        differentOnRamp,
      )

      assert.notStrictEqual(metadataHash, metadataHashDifferentOnRamp)
    })
  })

  describe('test_calculate_message_hash', () => {
    const messageId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    const sourceChainSelector = 123456789n
    const destChainSelector = 987654321n
    const sequenceNumber = 42n
    const nonce = 0n
    const sender = '0x8765432109fedcba8765432109fedcba87654321'
    const receiver = zeroPadValue('0x1234', 32)
    const onRamp = '0x' + Buffer.from('source-onramp-address').toString('hex')
    const data = '0x' + Buffer.from('sample message data').toString('hex')
    const gasLimit = 500000n

    it('should match expected message hash with no tokens', () => {
      const tokenReceiver = zeroPadValue('0x00', 32) // Zero address

      const extraArgs = encodeExtraArgs(
        {
          gasLimit,
          allowOutOfOrderExecution: false,
          tokenReceiver,
          receiverObjectIds: [],
        },
        ChainFamily.EVM,
      )
      const message: CCIPMessage_V1_6 = {
        header: {
          messageId,
          sourceChainSelector,
          destChainSelector,
          sequenceNumber,
          nonce,
        },
        sender,
        receiver,
        data,
        extraArgs,
        tokenAmounts: [],
        feeToken: '0x0000000000000000000000000000000000000000',
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      const metadataHash = hashSuiMetadata(sourceChainSelector, destChainSelector, onRamp)
      const messageHash = hashV16SuiMessage(message, metadataHash)

      const expectedHashNoTokens =
        '0x9f9be87e216efa0b1571131d9295e3802c5c9a3d6e369d230c72520a2e854a9e'

      assert.strictEqual(messageHash, expectedHashNoTokens)
    })

    it('should match expected message hash with tokens', () => {
      const tokenReceiver = zeroPadValue('0x5678', 32)

      const extraArgs = encodeExtraArgs({
        gasLimit,
        allowOutOfOrderExecution: false,
        tokenReceiver,
        receiverObjectIds: [],
      })

      const message: CCIPMessage_V1_6 = {
        header: {
          messageId,
          sourceChainSelector,
          destChainSelector,
          sequenceNumber,
          nonce,
        },
        sender,
        receiver,
        data,
        extraArgs,
        tokenAmounts: [
          {
            sourcePoolAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
            destTokenAddress: zeroPadValue('0x5678', 32),
            destGasAmount: 10000n,
            extraData: '0x00112233',
            amount: 1000000n,
            destExecData: '0x',
          },
          {
            sourcePoolAddress: '0x123456789abcdef123456789abcdef123456789a',
            destTokenAddress: zeroPadValue('0x9abc', 32),
            destGasAmount: 20000n,
            extraData: '0xffeeddcc',
            amount: 5000000n,
            destExecData: '0x',
          },
        ],
        feeToken: '0x0000000000000000000000000000000000000000',
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      const metadataHash = hashSuiMetadata(sourceChainSelector, destChainSelector, onRamp)
      const messageHash = hashV16SuiMessage(message, metadataHash)

      const expectedHashWithTokens =
        '0xd183d22cb0b713da1b6b42d9c35cc9e1268257ff703c6579d6aa68fdfb1ff4b2'

      assert.strictEqual(messageHash, expectedHashWithTokens)
    })
  })

  describe('getSuiLeafHasher integration', () => {
    it('should work end-to-end with the factory function', () => {
      const sourceChainSelector = 123456789n
      const destChainSelector = 987654321n
      const onRamp = '0x' + Buffer.from('source-onramp-address').toString('hex')

      const hasher = getSuiLeafHasher({
        sourceChainSelector,
        destChainSelector,
        onRamp,
        version: CCIPVersion.V1_6,
      })

      const messageId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const sequenceNumber = 42n
      const nonce = 0n
      const sender = '0x8765432109fedcba8765432109fedcba87654321'
      const receiver = zeroPadValue('0x1234', 32)
      const data = '0x' + Buffer.from('sample message data').toString('hex')
      const gasLimit = 500000n
      const tokenReceiver = zeroPadValue('0x00', 32) // Zero address

      const message: CCIPMessage_V1_6 = {
        header: {
          messageId,
          sourceChainSelector,
          destChainSelector,
          sequenceNumber,
          nonce,
        },
        sender,
        receiver,
        data,
        extraArgs: encodeExtraArgs({
          gasLimit,
          allowOutOfOrderExecution: false,
          tokenReceiver,
          receiverObjectIds: [],
        }),
        tokenAmounts: [],
        feeToken: '0x0000000000000000000000000000000000000000',
        feeTokenAmount: 0n,
        feeValueJuels: 0n,
      }

      const hash = hasher(message as CCIPMessage_V1_6_Sui)

      // Should match the expected hash from Move test
      const expectedHashNoTokens =
        '0x9f9be87e216efa0b1571131d9295e3802c5c9a3d6e369d230c72520a2e854a9e'
      assert.strictEqual(hash, expectedHashNoTokens)
    })
  })
})
