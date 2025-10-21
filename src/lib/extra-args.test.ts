import { dataSlice, getNumber } from 'ethers'

import {
  type SourceTokenData,
  encodeExtraArgs,
  parseExtraArgs,
  parseSourceTokenData,
} from './extra-args.ts'

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

describe('encode/parseSourceTokenData', () => {
  const decoded: SourceTokenData = {
    sourcePoolAddress: '0x0000000000000000000000006987756a2fc8e4f3f0a5e026cb200cc2b5221b1f',
    destTokenAddress: '0x000000000000000000000000cc44ff0e5a1fc9a6f3224ef0f47f0c03b3f8eaee',
    extraData: '0xd8e78c2c6144d59c308cee0365b6d223a9cea73dd7a46e990505271b4abb47b4',
    destGasAmount: 1515322476n,
  }
  const encoded =
    '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000005a51fc6c00000000000000000000000000000000000000000000000000000000000000200000000000000000000000006987756a2fc8e4f3f0a5e026cb200cc2b5221b1f0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000cc44ff0e5a1fc9a6f3224ef0f47f0c03b3f8eaee0000000000000000000000000000000000000000000000000000000000000020d8e78c2c6144d59c308cee0365b6d223a9cea73dd7a46e990505271b4abb47b4'

  it('should parse v1.5 message.sourceTokenData', () => {
    expect(parseSourceTokenData(encoded)).toEqual(decoded)
  })
})
