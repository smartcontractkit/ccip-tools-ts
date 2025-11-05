import { bcs } from '@mysten/sui/bcs'
import { SUIExtraArgsV1Tag, decodeSuiExtraArgs } from './sui.ts'

const toHexBytes = (hex: string): number[] => {
  return Array.from(Buffer.from(hex, 'hex'))
}

const encodeSuiExtraArgsV1 = (args: {
  gasLimit: bigint
  allowOutOfOrderExecution: boolean
  tokenReceiver: string
  receiverObjectIds: string[]
}): string => {
  const tokenReceiverBytes = toHexBytes(args.tokenReceiver.slice(2))
  const objectIds = args.receiverObjectIds.map((id) => toHexBytes(id.slice(2)))

  const bcsData = bcs
    .struct('SuiExtraArgsV1', {
      gasLimit: bcs.u64(),
      allowOutOfOrderExecution: bcs.bool(),
      tokenReceiver: bcs.vector(bcs.u8()),
      receiverObjectIds: bcs.vector(bcs.vector(bcs.u8())),
    })
    .serialize({
      gasLimit: args.gasLimit,
      allowOutOfOrderExecution: args.allowOutOfOrderExecution,
      tokenReceiver: Array.from(tokenReceiverBytes),
      receiverObjectIds: objectIds.map((id) => Array.from(id)),
    })

  return SUIExtraArgsV1Tag + Buffer.from(bcsData.toBytes()).toString('hex')
}

describe('Sui Extra Args', () => {
  describe('decodeSuiExtraArgs', () => {
    it('should decode Sui extra args v1 matching Move test data', () => {
      // same test as Move from https://github.com/smartcontractkit/chainlink-sui/blob/develop/contracts/ccip/ccip/sources/fee_quoter.move#L2056
      const expectedGasLimit = 101n
      const expectedAllowOutOfOrderExecution = true
      const expectedTokenReceiver =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const expectedReceiverObjectIds = [
        '0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdea',
        '0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdeb',
      ]

      const extraArgs = encodeSuiExtraArgsV1({
        gasLimit: expectedGasLimit,
        allowOutOfOrderExecution: expectedAllowOutOfOrderExecution,
        tokenReceiver: expectedTokenReceiver,
        receiverObjectIds: expectedReceiverObjectIds,
      })

      // Decode and verify
      const decoded = decodeSuiExtraArgs(extraArgs)

      expect(decoded.gasLimit).toBe(expectedGasLimit)
      expect(decoded.allowOutOfOrderExecution).toBe(expectedAllowOutOfOrderExecution)
      expect(decoded.tokenReceiver).toBe(expectedTokenReceiver)
      expect(decoded.receiverObjectIds).toEqual(expectedReceiverObjectIds)
    })

    it('should decode Sui extra args with no receiver object IDs', () => {
      const gasLimit = 500000n
      const allowOutOfOrderExecution = false
      const tokenReceiver = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

      const extraArgs = encodeSuiExtraArgsV1({
        gasLimit,
        allowOutOfOrderExecution,
        tokenReceiver,
        receiverObjectIds: [],
      })

      const decoded = decodeSuiExtraArgs(extraArgs)

      expect(decoded.gasLimit).toBe(gasLimit)
      expect(decoded.allowOutOfOrderExecution).toBe(allowOutOfOrderExecution)
      expect(decoded.tokenReceiver).toBe(tokenReceiver)
      expect(decoded.receiverObjectIds).toEqual([])
    })

    it('should decode Sui extra args with multiple receiver object IDs', () => {
      const gasLimit = 1000000n
      const allowOutOfOrderExecution = true
      const tokenReceiver = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      const receiverObjectIds = [
        '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      ]

      const extraArgs = encodeSuiExtraArgsV1({
        gasLimit,
        allowOutOfOrderExecution,
        tokenReceiver,
        receiverObjectIds,
      })

      const decoded = decodeSuiExtraArgs(extraArgs)

      expect(decoded.gasLimit).toBe(gasLimit)
      expect(decoded.allowOutOfOrderExecution).toBe(allowOutOfOrderExecution)
      expect(decoded.tokenReceiver).toBe(tokenReceiver)
      expect(decoded.receiverObjectIds).toEqual(receiverObjectIds)
    })

    it('should throw error for invalid tag', () => {
      const invalidTag = '0x12345678'
      const data = invalidTag + '650000000000000001'

      expect(() => decodeSuiExtraArgs(data)).toThrow(
        `Invalid Sui extra args tag. Expected ${SUIExtraArgsV1Tag}`,
      )
    })

    it('should throw error for malformed BCS data', () => {
      // Invalid BCS data (incomplete)
      const invalidData = SUIExtraArgsV1Tag + '6500'

      expect(() => decodeSuiExtraArgs(invalidData)).toThrow()
    })
  })
})
