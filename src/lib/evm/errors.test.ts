import { ErrorFragment, EventFragment, FunctionFragment, Result } from 'ethers'

import { getErrorData, parseWithFragment, recursiveParseError } from './errors.ts'
import { chainSelectorFromId } from '../utils.ts'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('parseWithFragment', () => {
  it('should get function by name', () => {
    const result = parseWithFragment('ccipSend')
    expect(result).toHaveLength(2)
    expect(result![0]).toBeInstanceOf(FunctionFragment)
    expect(result![0].name).toBe('ccipSend')
    expect(result![1]).toBe('Router')
  })

  it('should get function by 4-byte selector and deep data', () => {
    const result = parseWithFragment(
      '0x96f4e9f9',
      '0x000000000000000000000000000000000000000000000000314b66b9a0a5001a000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000300000000000000000000000000779877a7b0d9e8603169ddbd7836e478b4624789000000000000000000000000000000000000000000000000000000000000032000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000362d649ea8ba590faa930471daeea6e0972cc1e00000000000000000000000000000000000000000000000000000000000001f4776b304c4a6a52373768544272635866304c555a30646444646f62756854724f30374631492d47567a45647554726336615770313447466a5f79476f48785747485955425845765f434c6c636e50574b356f654d356766416d79337238456e7a595a7a674979446170724551635659454d414e336257546b632d6668676d427a4658506176735a6b58703265584f5a566a4b45554362754f56787849543968616a39553452375f5754614c6f4b7a45726236626849756243584d38363947755532416c5041415a696c6b517564574535424d2d7475392d36636b55326d736f6d326e3978355f725a566d54544c634843535f33727a5f753748484163336a61464d566d464d4b517649684a5868774c62357448662d5a676b32564d516b6e6d79614a4a554a73455239573679564443615f4a44514c375f4c686b3038454e675a4c3758706c6846704e555163626533627235526f746c39456e5151565f39493370564d5357414c6b763666654e4a6a6a72584a74706f343644666f7431427237432d4554316736754e61525a542d6552794147616a7839384956585932634169387953435f595f6e747371656e70554d3352437955676f4538365f33413655367453566b7459414466454d7a5a794a6f6f32566e704d5749576f676a6a33486b634e7a4847665f3150375455704666654956506b00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044181dcf100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000',
    )
    expect(result).toHaveLength(3)
    expect(result![0]).toBeInstanceOf(FunctionFragment)
    expect(result![0].name).toBe('ccipSend')
    expect(result![1]).toBe('Router')
    expect(result![2]).toBeInstanceOf(Result)
    expect(result![2]?.toObject(true)).toMatchObject({
      destinationChainSelector: chainSelectorFromId(44787),
      message: {
        feeToken: '0x779877A7B0D9E8603169DdbD7836e478b4624789',
      },
    })
  })

  it('should parse error and data', () => {
    const result = parseWithFragment(
      '0x728fe07b',
      '0x000000000000000000000000f6db68333d14f6a0c1123cc420ea60980aeda0eb',
    )
    expect(result).toHaveLength(3)
    expect(result![0]).toBeInstanceOf(ErrorFragment)
    expect(result![0].name).toBe('CallerIsNotARampOnRouter')
    expect(result![1]).toContain('TokenPool')
    expect(result![2]).toHaveLength(1)
    expect(result![2]!.caller).toBe('0xF6dB68333D14f6a0c1123cc420ea60980aEDA0Eb')
  })

  it('should parse event and data', () => {
    const result = parseWithFragment(
      '0xd4f851956a5d67c3997d1c9205045fef79bae2947fdee7e9e2641abc7391ef65',
      '0x000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000',
    )
    expect(result).toHaveLength(3)
    expect(result![0]).toBeInstanceOf(EventFragment)
    expect(result![0].name).toBe('ExecutionStateChanged')
    expect(result![1]).toContain('OffRamp')
    expect(result![2]).toHaveLength(2)
    expect(result![2]!.state).toBe(2n)
    expect(result![2]!.returnData).toBe('0x')
  })

  it('should return undefined on unknown selectors', () => {
    const result = parseWithFragment(
      'unknownEvent',
      '0x0000000000000000000000000000000000000000000000000000000000000002',
    )
    expect(result).toBeUndefined()
  })
})

describe('getErrorData', () => {
  it('should return error data if found in err.data', () => {
    const err = { data: '0x1337' }

    const result = getErrorData(err)

    expect(result).toBe('0x1337')
  })

  it('should return error data if found in err.info.error.data', () => {
    const err = {
      info: {
        error: {
          data: 'Revert reason: 0xdeadbeed',
        },
      },
    }

    const result = getErrorData(err)

    expect(result).toBe('0xdeadbeed')
  })

  it('should return undefined if no error data is found', () => {
    expect(getErrorData({})).toBeUndefined()
    expect(getErrorData(null)).toBeUndefined()
    expect(getErrorData(123)).toBeUndefined()
    expect(getErrorData({ info: { error: { data: 'Unknown' } } })).toBeUndefined()
  })
})

describe('recursiveParseError', () => {
  it('should parse object error data', () => {
    const data =
      '0xcf19edfd000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000440a8d6e8c0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    const res = recursiveParseError('revert', data)
    expect(res).toHaveLength(3)
    expect(res[0]).toEqual(['error', expect.stringContaining('ExecutionError')])
    expect(res[1]).toEqual(['error', expect.stringContaining('ReceiverError')])
    expect(res[2]).toEqual(['error.err', expect.stringMatching(/\b0x\b/)])
    expect(res[2][1]).toContain('out-of-gas')
  })

  it('should parse array error data', () => {
    const data =
      '0xe1cd55090000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000006408c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000156d73672e73656e646572206e6f74206d696e746572000000000000000000000000000000000000000000000000000000000000000000000000000000'
    const res = recursiveParseError('revert', data)
    expect(res).toHaveLength(3)
    expect(res[0]).toEqual(['error', expect.stringContaining('TokenHandlingError')])
    expect(res[1]).toEqual(['error', expect.stringContaining('Error(string)')])
    expect(res[2]).toEqual(['[0]', 'msg.sender not minter'])
  })
})
