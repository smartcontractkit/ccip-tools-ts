import { type JsonRpcApiProvider, getAddress, hexlify, randomBytes, toBeHex } from 'ethers'

import { discoverOffRamp, validateOffRamp } from './execution.ts'
import { estimateExecGasForRequest } from './gas.ts'
import { CCIPContractType, CCIPVersion } from './types.ts'

jest.mock('./execution.ts')

const mockProvider = {
  get provider() {
    return mockProvider
  },
  getNetwork: jest.fn(() => ({ chainId: 11155111 })),
  send: jest.fn(() => toBeHex(44_000)),
}

const mockedContract = {
  runner: mockProvider,
  typeAndVersion: jest.fn(() => Promise.resolve(`${CCIPContractType.OnRamp} ${CCIPVersion.V1_2}`)),
  getToken: jest.fn(() => '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'),
  balanceOf: jest.fn(() => 0n),
  getPoolBySourceToken: jest.fn(() => '0xPool'),
  getRemoteToken: jest.fn(
    () => '0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc',
  ),
  getAddress: jest.fn(),
}

// Mock Contract instance
jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  Contract: jest.fn(() => mockedContract),
}))

beforeEach(() => {
  jest.clearAllMocks()
})

describe('estimateExecGasForRequest', () => {
  const sourceChainSelector = 1n,
    destChainSelector = 10n

  it('should estimate 1.2 gas correctly', async () => {
    const onRamp = getAddress(hexlify(randomBytes(20)))
    const destTokenAddress = getAddress(hexlify(randomBytes(20)))
    const message = {
      sender: getAddress(hexlify(randomBytes(20))),
      receiver: '0x00bb',
      data: '0xdaad',
      tokenAmounts: [{ destTokenAddress, amount: BigInt(1000) }],
    }
    const hints = { offRamp: getAddress(hexlify(randomBytes(20))) }
    const router = getAddress(hexlify(randomBytes(20)))
    const offRamp = {
      getDynamicConfig: jest.fn(() => ({ router })),
      getPoolBySourceToken: jest.fn(() => getAddress(hexlify(randomBytes(20)))),
    }
    ;(validateOffRamp as jest.Mock).mockResolvedValue(offRamp)
    const lane = {
      sourceChainSelector,
      destChainSelector,
      onRamp,
      version: CCIPVersion.V1_2,
    }

    const result = await estimateExecGasForRequest(
      mockProvider as unknown as JsonRpcApiProvider,
      {
        lane,
        message,
      },
      hints,
    )

    expect(result).toBe(23700) // 44000 - (21000 - 700)
    expect(mockProvider.send).toHaveBeenCalledWith('eth_estimateGas', [
      expect.objectContaining({
        from: router,
        to: message.receiver,
        data: expect.stringMatching(/^0x85572ffb/),
      }),
      'latest',
      expect.objectContaining({
        [destTokenAddress]: {
          stateDiff: {
            ['0x7ea9ef6961c72f24c672381b2c6f42f72eebb176da225658897880d3448d61f8']: toBeHex(
              1000,
              32,
            ),
          },
        },
      }),
    ])
  })

  it('should estimate 1.5 gas correctly', async () => {
    const onRamp = '0xOnRamp15'
    const destTokenAddress = getAddress(hexlify(randomBytes(20)))
    const message = {
      sender: getAddress(hexlify(randomBytes(20))),
      receiver: '0x00dd',
      data: '0xdaad',
      tokenAmounts: [{ destTokenAddress, amount: 1000n }],
    }
    const lane = {
      sourceChainSelector,
      destChainSelector,
      onRamp,
      version: CCIPVersion.V1_5,
    }

    const router = getAddress(hexlify(randomBytes(20)))
    const offRamp = {
      getDynamicConfig: jest.fn(() => ({ router })),
    }
    ;(discoverOffRamp as jest.Mock).mockResolvedValue(offRamp)
    mockedContract.getAddress.mockResolvedValue(onRamp)
    mockedContract.typeAndVersion.mockResolvedValue(
      `${CCIPContractType.OnRamp} ${CCIPVersion.V1_5}`,
    )
    mockProvider.send.mockReturnValueOnce(toBeHex(46_000))

    const result = await estimateExecGasForRequest(mockProvider as unknown as JsonRpcApiProvider, {
      lane,
      message,
    })

    expect(result).toBe(25700) // 46000 - (21000 - 700)
    expect(mockProvider.send).toHaveBeenCalledWith('eth_estimateGas', [
      expect.objectContaining({
        from: router,
        to: message.receiver,
        data: expect.stringMatching(/^0x85572ffb/),
      }),
      'latest',
      expect.objectContaining({
        [destTokenAddress]: {
          stateDiff: {
            ['0x4dcf6190957b4c81ae2c63d03e0734b5724c3492a007dbdc3fc548e91171f626']: toBeHex(
              1000,
              32,
            ),
          },
        },
      }),
    ])
  })
})
