import { dataSlice, getNumber } from 'ethers'

import { encodeExtraArgs, parseExtraArgs, parseSourceTokenData } from './extra-args.ts'

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

describe('parseExtraArgs', () => {
  it('should parse v1 args', () => {
    const res = parseExtraArgs(
      '0x97a657c9000000000000000000000000000000000000000000000000000000000000000a',
    )
    expect(res).toEqual({ _tag: 'EVMExtraArgsV1', gasLimit: 10n })
  })

  it('should parse v2 args', () => {
    const res = parseExtraArgs(
      '0x181dcf10000000000000000000000000000000000000000000000000000000000000000b0000000000000000000000000000000000000000000000000000000000000001',
    )
    expect(res).toEqual({ _tag: 'EVMExtraArgsV2', gasLimit: 11n, allowOutOfOrderExecution: true })
  })

  it('should parse Solana extraArgs case', () => {
    const res = parseExtraArgs('0x181dcf10400d030000000000000000000000000000')
    expect(res).toEqual({
      _tag: 'EVMExtraArgsV2',
      gasLimit: 200000n,
      allowOutOfOrderExecution: false,
    })
  })

  it('should parse new Aptos extraArgs case', () => {
    const res = parseExtraArgs(
      '0x181dcf10e09304000000000000000000000000000000000000000000000000000000000000',
    )
    expect(res).toEqual({
      _tag: 'EVMExtraArgsV2',
      gasLimit: 300000n,
      allowOutOfOrderExecution: false,
    })
  })

  it('should return v1 on empty data', () => {
    const res = parseExtraArgs('0x')
    expect(res).toEqual({ _tag: 'EVMExtraArgsV1' })
  })

  it('should return undefined on unknown data', () => {
    const res = parseExtraArgs('0x1234')
    expect(res).toBeUndefined()
  })
})
