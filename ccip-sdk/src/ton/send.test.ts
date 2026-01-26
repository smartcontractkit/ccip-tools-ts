import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { Address } from '@ton/core'
import type { TonClient } from '@ton/ton'

import {
  CCIP_SEND_OPCODE,
  DEFAULT_GAS_BUFFER,
  WRAPPED_NATIVE,
  buildCcipSendCell,
  generateUnsignedCcipSend,
  getFee,
} from './send.ts'
import { EVMExtraArgsV2Tag } from '../extra-args.ts'
import type { AnyMessage } from '../types.ts'

describe('TON send unit tests', () => {
  const TEST_ROUTER = 'EQDWS-oJCjyrf-6c1wF5eGP7b2qNWn7wUqS3dlNgb_YzKNHG'
  const TEST_DEST_CHAIN_SELECTOR = 16015286601757825753n // Sepolia
  const TEST_RECEIVER = '0x40d7c009d073e0d740ed2c50ca0a48c84a3f8b47'

  const baseMessage: AnyMessage = {
    receiver: TEST_RECEIVER,
    data: '0x1234',
    tokenAmounts: [],
    feeToken: '',
    extraArgs: {
      gasLimit: 200_000n,
      allowOutOfOrderExecution: true,
    },
  }

  describe('buildCcipSendCell', () => {
    it('should build cell with correct structure', () => {
      const cell = buildCcipSendCell(TEST_DEST_CHAIN_SELECTOR, baseMessage, null, 12345n)
      const slice = cell.beginParse()

      // Verify inline fields
      assert.equal(slice.loadUint(32), CCIP_SEND_OPCODE, 'opcode')
      assert.equal(slice.loadUint(64), 12345, 'queryId')
      assert.equal(slice.loadUintBig(64), TEST_DEST_CHAIN_SELECTOR, 'destChainSelector')

      // Verify receiver is padded to 32 bytes
      const receiverLen = slice.loadUint(8)
      assert.equal(receiverLen, 32)
      const receiverBytes = slice.loadBuffer(32)
      assert.ok(
        receiverBytes.subarray(0, 12).every((b) => b === 0),
        'first 12 bytes should be zero padding',
      )
      assert.equal(
        receiverBytes.subarray(12).toString('hex'),
        '40d7c009d073e0d740ed2c50ca0a48c84a3f8b47',
        'last 20 bytes should be EVM address',
      )

      // Verify refs: data, tokenAmounts, extraArgs
      assert.equal(cell.refs.length, 3)

      // Verify data ref
      const dataCell = slice.loadRef()
      const dataSlice = dataCell.beginParse()
      assert.equal(dataSlice.loadBuffer(dataSlice.remainingBits / 8).toString('hex'), '1234')

      // Skip tokenAmounts ref
      slice.loadRef()

      // Verify feeToken is addr_none when null
      assert.equal(slice.loadMaybeAddress(), null)

      // Verify extraArgs ref
      const extraArgsCell = slice.loadRef()
      const extraArgsSlice = extraArgsCell.beginParse()
      assert.equal(extraArgsSlice.loadUint(32), Number(EVMExtraArgsV2Tag), 'extraArgs tag')
      assert.equal(extraArgsSlice.loadBit(), true, 'hasGasLimit')
      assert.equal(extraArgsSlice.loadUintBig(256), 200_000n, 'gasLimit')
      assert.equal(extraArgsSlice.loadBit(), true, 'allowOutOfOrderExecution')
    })

    it('should store feeToken address when provided', () => {
      const feeTokenAddr = Address.parse(WRAPPED_NATIVE.toRawString())
      const cell = buildCcipSendCell(TEST_DEST_CHAIN_SELECTOR, baseMessage, feeTokenAddr)
      const slice = cell.beginParse()

      // Skip to feeToken position
      slice.loadUint(32) // opcode
      slice.loadUint(64) // queryId
      slice.loadUintBig(64) // destChainSelector
      slice.loadBuffer(slice.loadUint(8)) // receiver
      slice.loadRef() // data
      slice.loadRef() // tokenAmounts

      const feeToken = slice.loadMaybeAddress()
      assert.ok(feeToken)
      assert.equal(feeToken.toRawString(), WRAPPED_NATIVE.toRawString())
    })

    it('should omit gasLimit from extraArgs when zero', () => {
      const msgNoGas: AnyMessage = {
        ...baseMessage,
        extraArgs: { gasLimit: 0n, allowOutOfOrderExecution: true },
      }
      const cell = buildCcipSendCell(TEST_DEST_CHAIN_SELECTOR, msgNoGas)
      const slice = cell.beginParse()

      // Skip to extraArgs
      slice.loadUint(32) // opcode
      slice.loadUint(64) // queryId
      slice.loadUintBig(64) // destChainSelector
      slice.loadBuffer(slice.loadUint(8)) // receiver
      slice.loadRef() // data
      slice.loadRef() // tokenAmounts
      slice.loadMaybeAddress() // feeToken

      const extraArgsSlice = slice.loadRef().beginParse()
      extraArgsSlice.loadUint(32) // tag

      assert.equal(extraArgsSlice.loadBit(), false, 'hasGasLimit should be false')
      assert.equal(extraArgsSlice.loadBit(), true, 'allowOutOfOrderExecution')
    })
  })

  describe('generateUnsignedCcipSend', () => {
    const mockProvider = {} as TonClient

    it('should return correct unsigned transaction', () => {
      const fee = 2_000_000_000n
      const messageWithFee = { ...baseMessage, fee }
      const unsigned = generateUnsignedCcipSend(
        { provider: mockProvider },
        'sender',
        TEST_ROUTER,
        TEST_DEST_CHAIN_SELECTOR,
        messageWithFee,
      )

      assert.equal(unsigned.to, TEST_ROUTER)
      assert.equal(unsigned.value, fee + DEFAULT_GAS_BUFFER)
      assert.ok(unsigned.body)

      // Verify body has correct opcode
      const slice = unsigned.body.beginParse()
      assert.equal(slice.loadUint(32), CCIP_SEND_OPCODE)
    })

    it('should use custom gas buffer when provided', () => {
      const fee = 2_000_000_000n
      const customBuffer = 100_000_000n
      const messageWithFee = { ...baseMessage, fee }
      const unsigned = generateUnsignedCcipSend(
        { provider: mockProvider },
        'sender',
        TEST_ROUTER,
        TEST_DEST_CHAIN_SELECTOR,
        messageWithFee,
        { gasBuffer: customBuffer },
      )

      assert.equal(unsigned.value, fee + customBuffer)
    })
  })

  describe('getFee', () => {
    function createMockProvider(feeToReturn: bigint) {
      return {
        runMethod: mock.fn(async (_addr: Address, method: string) => {
          if (method === 'onRamp') {
            return {
              stack: {
                readAddress: () =>
                  Address.parse('EQC-GtbjW4hz_gXOiBOxT0_Jj-EYkI_zjQ-H8VyYHH9fbSd6'),
              },
            }
          }
          if (method === 'feeQuoter') {
            return {
              stack: {
                readAddress: () =>
                  Address.parse('EQAoCywn6WT8_R_ydtFzcYlcwWTWXG35w4Zbbhye_u2I0RnI'),
              },
            }
          }
          if (method === 'validatedFee') {
            return { stack: { readBigNumber: () => feeToReturn } }
          }
          throw new Error(`Unknown method: ${method}`)
        }),
      } as unknown as TonClient
    }

    it('should return fee from FeeQuoter', async () => {
      const expectedFee = 2_500_000_000n
      const mockProvider = createMockProvider(expectedFee)

      const fee = await getFee(
        { provider: mockProvider },
        TEST_ROUTER,
        TEST_DEST_CHAIN_SELECTOR,
        baseMessage,
      )

      assert.equal(fee, expectedFee)
    })

    it('should throw for negative fee', async () => {
      const mockProvider = createMockProvider(-1n)

      await assert.rejects(
        async () =>
          getFee({ provider: mockProvider }, TEST_ROUTER, TEST_DEST_CHAIN_SELECTOR, baseMessage),
        /Invalid fee/,
      )
    })

    it('should throw CCIPError when contract lookup fails', async () => {
      const mockProvider = {
        runMethod: mock.fn(async () => {
          throw new Error('Network error')
        }),
      } as unknown as TonClient

      await assert.rejects(
        async () =>
          getFee({ provider: mockProvider }, TEST_ROUTER, TEST_DEST_CHAIN_SELECTOR, baseMessage),
        /Could not get FeeQuoter address/,
      )
    })
  })
})
