const mockInterface = {
  parseError: jest.fn(),
  getFunction: jest.fn(),
  forEachEvent: jest.fn(),
}

// Mock Contract instance
jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  Interface: jest.fn(() => mockInterface),
}))

import { type EventFragment, ParamType, Result, getAddress } from 'ethers'
import { getErrorData, getFunctionBySelector, parseErrorData, tryParseEventData } from './errors.js'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('parseErrorData', () => {
  it('should return parsed error data and name if found', () => {
    const data = '0xErrorData'
    mockInterface.parseError.mockReturnValueOnce('parsedError')

    const result = parseErrorData(data)

    expect(result).toEqual(['parsedError', 'Router'])
  })

  it('should return undefined if no error data is found', () => {
    const data = '0xErrorData'
    mockInterface.parseError.mockImplementation(() => {
      throw new Error()
    })

    const result = parseErrorData(data)

    expect(result).toBeUndefined()
  })
})

describe('getFunctionBySelector', () => {
  it('should return function fragment and name if found', () => {
    const selector = '0xSelector'
    mockInterface.getFunction.mockReturnValueOnce('functionFragment')

    const result = getFunctionBySelector(selector)

    expect(result).toEqual(['functionFragment', 'Router'])
  })

  it('should return undefined if no function fragment is found', () => {
    const selector = '0xSelector'
    mockInterface.getFunction.mockImplementation(() => {
      throw new Error()
    })

    const result = getFunctionBySelector(selector)

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

describe('tryParseEventData', () => {
  it('should return parsed event data and event fragment if found', () => {
    const topicHashOrName = '0xTopicHash'
    const data = '0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const event = {
      topicHash: '0xTopicHash',
      inputs: [ParamType.from('address add')],
      name: 'EventName',
    }
    mockInterface.forEachEvent.mockImplementation(
      (callback: (val: EventFragment, idx: number) => void) =>
        callback(event as unknown as EventFragment, 0),
    )

    const result = tryParseEventData(topicHashOrName, data)

    expect(result).toEqual([
      Result.fromItems([getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')], ['add']),
      event,
    ])
  })

  it('should return undefined if no event data is found', () => {
    const topicHashOrName = '0xTopicHash'
    const data = '0xEventData'
    mockInterface.forEachEvent.mockImplementation(() => {})

    const result = tryParseEventData(topicHashOrName, data)

    expect(result).toBeUndefined()
  })
})
