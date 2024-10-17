import { dataSlice, getNumber } from 'ethers'
import { encodeExtraArgs } from './types.js'

describe('encodeExtraArgs', () => {
  it('should encode v2 args', () => {
    const encoded = encodeExtraArgs({ allowOutOfOrderExecution: true })
    expect(encoded).toMatch(/^0x181dcf1/) // EVMExtraArgsV2Tag
    expect(getNumber(dataSlice(encoded, 4, 4 + 32))).toBe(200_000) // default gas limit
    expect(getNumber(dataSlice(encoded, 4 + 32, 4 + 32 * 2))).toBe(1) // bool true
  })

  it('should encode v1 args with custom gas limit', () => {
    const encoded = encodeExtraArgs({ gasLimit: 100_000n })
    expect(encoded).toMatch(/^0x97a657c9/) // EVMExtraArgsV1Tag
    expect(getNumber(dataSlice(encoded, 4, 4 + 32))).toBe(100_000) // custom gas limit
  })

  it('should default to empty v1', () => {
    expect(encodeExtraArgs({})).toBe('0x')
  })
})
