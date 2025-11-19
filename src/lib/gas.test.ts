import { getAddress, hexlify, randomBytes, toBeHex } from 'ethers'

import { ChainFamily } from './chain.ts'
import { discoverOffRamp } from './execution.ts'
import { estimateExecGasForRequest } from './gas.ts'
import { CCIPVersion } from './types.ts'

jest.mock('./execution.ts')

// Mock Contract to avoid "contract runner does not support calling" error
const mockBalanceOf = jest.fn()
jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  Contract: jest.fn(() => ({
    balanceOf: mockBalanceOf,
  })),
}))

const mockSourceChain = {
  network: {
    name: 'ethereum-sepolia',
    chainId: 11155111,
    chainSelector: 16015286601757825753n,
    family: ChainFamily.EVM,
    isTestnet: true,
  },
  getTokenForTokenPool: jest.fn(),
  getTokenInfo: jest.fn(),
}

const mockDestChain = {
  network: {
    name: 'base-sepolia',
    chainId: 84532,
    chainSelector: 10344971235874465080n,
    family: ChainFamily.EVM,
    isTestnet: true,
  },
  provider: {
    send: jest.fn(),
  },
  getRouterForOffRamp: jest.fn(),
  getTokenInfo: jest.fn(),
}

beforeEach(() => {
  jest.clearAllMocks()
  mockBalanceOf.mockResolvedValue(0n)
})

describe('estimateExecGasForRequest', () => {
  const sourceChainSelector = 16015286601757825753n
  const destChainSelector = 10344971235874465080n

  it('should estimate gas correctly for v1.2', async () => {
    const onRamp = getAddress(hexlify(randomBytes(20)))
    const offRamp = getAddress(hexlify(randomBytes(20)))
    const router = getAddress(hexlify(randomBytes(20)))
    const sourcePoolAddress = getAddress(hexlify(randomBytes(20)))
    const destTokenAddress = getAddress(hexlify(randomBytes(20)))
    const sourceToken = getAddress(hexlify(randomBytes(20)))

    const message = {
      sender: getAddress(hexlify(randomBytes(20))),
      receiver: getAddress(hexlify(randomBytes(20))),
      data: '0xdaad',
      tokenAmounts: [
        {
          sourcePoolAddress,
          destTokenAddress,
          amount: 1000n,
        },
      ],
    }

    const lane = {
      sourceChainSelector,
      destChainSelector,
      onRamp,
      version: CCIPVersion.V1_2,
    }

    // Setup mocks
    ;(discoverOffRamp as unknown as jest.Mock).mockResolvedValue(offRamp)
    mockDestChain.getRouterForOffRamp.mockResolvedValue(router)
    mockSourceChain.getTokenForTokenPool.mockResolvedValue(sourceToken)
    mockSourceChain.getTokenInfo.mockResolvedValue({ decimals: 18 })
    mockDestChain.getTokenInfo.mockResolvedValue({ decimals: 18 })
    mockDestChain.provider.send.mockResolvedValue(toBeHex(44_000))

    const result = await estimateExecGasForRequest(mockSourceChain as any, mockDestChain as any, {
      lane,
      message,
    })

    expect(result).toBe(23700) // 44000 - (21000 - 700)
    expect(discoverOffRamp).toHaveBeenCalledWith(mockSourceChain, mockDestChain, onRamp)
    expect(mockDestChain.getRouterForOffRamp).toHaveBeenCalledWith(offRamp, sourceChainSelector)
    expect(mockDestChain.provider.send).toHaveBeenCalledWith('eth_estimateGas', [
      expect.objectContaining({
        from: router,
        to: message.receiver,
        data: expect.stringMatching(/^0x85572ffb/), // ccipReceive selector
      }),
      'latest',
      expect.objectContaining({
        [destTokenAddress]: {
          stateDiff: expect.any(Object),
        },
      }),
    ])
  })

  it('should estimate gas correctly for v1.5', async () => {
    const onRamp = getAddress(hexlify(randomBytes(20)))
    const offRamp = getAddress(hexlify(randomBytes(20)))
    const router = getAddress(hexlify(randomBytes(20)))
    const sourcePoolAddress = getAddress(hexlify(randomBytes(20)))
    const destTokenAddress = getAddress(hexlify(randomBytes(20)))
    const sourceToken = getAddress(hexlify(randomBytes(20)))

    const message = {
      sender: getAddress(hexlify(randomBytes(20))),
      receiver: getAddress(hexlify(randomBytes(20))),
      data: '0xdaad',
      tokenAmounts: [
        {
          sourcePoolAddress,
          destTokenAddress,
          amount: 1000n,
        },
      ],
    }

    const lane = {
      sourceChainSelector,
      destChainSelector,
      onRamp,
      version: CCIPVersion.V1_5,
    }

    // Setup mocks
    ;(discoverOffRamp as unknown as jest.Mock).mockResolvedValue(offRamp)
    mockDestChain.getRouterForOffRamp.mockResolvedValue(router)
    mockSourceChain.getTokenForTokenPool.mockResolvedValue(sourceToken)
    mockSourceChain.getTokenInfo.mockResolvedValue({ decimals: 18 })
    mockDestChain.getTokenInfo.mockResolvedValue({ decimals: 18 })
    mockDestChain.provider.send.mockResolvedValue(toBeHex(46_000))

    const result = await estimateExecGasForRequest(mockSourceChain as any, mockDestChain as any, {
      lane,
      message,
    })

    expect(result).toBe(25700) // 46000 - (21000 - 700)
    expect(discoverOffRamp).toHaveBeenCalledWith(mockSourceChain, mockDestChain, onRamp)
    expect(mockDestChain.getRouterForOffRamp).toHaveBeenCalledWith(offRamp, sourceChainSelector)
    expect(mockDestChain.provider.send).toHaveBeenCalledWith('eth_estimateGas', [
      expect.objectContaining({
        from: router,
        to: message.receiver,
        data: expect.stringMatching(/^0x85572ffb/),
      }),
      'latest',
      expect.objectContaining({
        [destTokenAddress]: {
          stateDiff: expect.any(Object),
        },
      }),
    ])
  })

  it('should handle different token decimals', async () => {
    const onRamp = getAddress(hexlify(randomBytes(20)))
    const offRamp = getAddress(hexlify(randomBytes(20)))
    const router = getAddress(hexlify(randomBytes(20)))
    const sourcePoolAddress = getAddress(hexlify(randomBytes(20)))
    const destTokenAddress = getAddress(hexlify(randomBytes(20)))
    const sourceToken = getAddress(hexlify(randomBytes(20)))

    const message = {
      sender: getAddress(hexlify(randomBytes(20))),
      receiver: getAddress(hexlify(randomBytes(20))),
      data: '0x',
      tokenAmounts: [
        {
          sourcePoolAddress,
          destTokenAddress,
          amount: 1000000n, // 1 USDC (6 decimals)
        },
      ],
    }

    const lane = {
      sourceChainSelector,
      destChainSelector,
      onRamp,
      version: CCIPVersion.V1_5,
    }

    // Setup mocks - USDC has 6 decimals on source, 6 on dest
    ;(discoverOffRamp as unknown as jest.Mock).mockResolvedValue(offRamp)
    mockDestChain.getRouterForOffRamp.mockResolvedValue(router)
    mockSourceChain.getTokenForTokenPool.mockResolvedValue(sourceToken)
    mockSourceChain.getTokenInfo.mockResolvedValue({ decimals: 6 })
    mockDestChain.getTokenInfo.mockResolvedValue({ decimals: 6 })
    mockDestChain.provider.send.mockResolvedValue(toBeHex(50_000))

    const result = await estimateExecGasForRequest(mockSourceChain as any, mockDestChain as any, {
      lane,
      message,
    })

    expect(result).toBe(29700) // 50000 - (21000 - 700)
    expect(mockSourceChain.getTokenInfo).toHaveBeenCalledWith(sourceToken)
    expect(mockDestChain.getTokenInfo).toHaveBeenCalledWith(destTokenAddress)
  })

  it('should throw error for legacy token pools without destTokenAddress', async () => {
    const onRamp = getAddress(hexlify(randomBytes(20)))
    const offRamp = getAddress(hexlify(randomBytes(20)))
    const router = getAddress(hexlify(randomBytes(20)))

    const message = {
      sender: getAddress(hexlify(randomBytes(20))),
      receiver: getAddress(hexlify(randomBytes(20))),
      data: '0x',
      tokenAmounts: [
        {
          sourcePoolAddress: getAddress(hexlify(randomBytes(20))),
          // Missing destTokenAddress - legacy format
          amount: 1000n,
        } as any,
      ],
    }

    const lane = {
      sourceChainSelector,
      destChainSelector,
      onRamp,
      version: CCIPVersion.V1_2,
    }

    ;(discoverOffRamp as unknown as jest.Mock).mockResolvedValue(offRamp)
    mockDestChain.getRouterForOffRamp.mockResolvedValue(router)

    await expect(
      estimateExecGasForRequest(mockSourceChain as any, mockDestChain as any, {
        lane,
        message,
      }),
    ).rejects.toThrow('legacy <1.5 tokenPools not supported')
  })

  it('should handle multiple token amounts', async () => {
    const onRamp = getAddress(hexlify(randomBytes(20)))
    const offRamp = getAddress(hexlify(randomBytes(20)))
    const router = getAddress(hexlify(randomBytes(20)))
    const sourcePoolAddress1 = getAddress(hexlify(randomBytes(20)))
    const sourcePoolAddress2 = getAddress(hexlify(randomBytes(20)))
    const destTokenAddress1 = getAddress(hexlify(randomBytes(20)))
    const destTokenAddress2 = getAddress(hexlify(randomBytes(20)))
    const sourceToken1 = getAddress(hexlify(randomBytes(20)))
    const sourceToken2 = getAddress(hexlify(randomBytes(20)))

    const message = {
      sender: getAddress(hexlify(randomBytes(20))),
      receiver: getAddress(hexlify(randomBytes(20))),
      data: '0x',
      tokenAmounts: [
        {
          sourcePoolAddress: sourcePoolAddress1,
          destTokenAddress: destTokenAddress1,
          amount: 1000n,
        },
        {
          sourcePoolAddress: sourcePoolAddress2,
          destTokenAddress: destTokenAddress2,
          amount: 2000n,
        },
      ],
    }

    const lane = {
      sourceChainSelector,
      destChainSelector,
      onRamp,
      version: CCIPVersion.V1_5,
    }

    ;(discoverOffRamp as unknown as jest.Mock).mockResolvedValue(offRamp)
    mockDestChain.getRouterForOffRamp.mockResolvedValue(router)
    mockSourceChain.getTokenForTokenPool
      .mockResolvedValueOnce(sourceToken1)
      .mockResolvedValueOnce(sourceToken2)
    mockSourceChain.getTokenInfo.mockResolvedValue({ decimals: 18 })
    mockDestChain.getTokenInfo.mockResolvedValue({ decimals: 18 })
    mockDestChain.provider.send.mockResolvedValue(toBeHex(60_000))

    const result = await estimateExecGasForRequest(mockSourceChain as any, mockDestChain as any, {
      lane,
      message,
    })

    expect(result).toBe(39700) // 60000 - (21000 - 700)
    expect(mockSourceChain.getTokenForTokenPool).toHaveBeenCalledTimes(2)
    expect(mockDestChain.provider.send).toHaveBeenCalledWith('eth_estimateGas', [
      expect.objectContaining({
        from: router,
        to: message.receiver,
      }),
      'latest',
      expect.objectContaining({
        [destTokenAddress1]: {
          stateDiff: expect.any(Object),
        },
        [destTokenAddress2]: {
          stateDiff: expect.any(Object),
        },
      }),
    ])
  })

  it('should handle message with no token amounts', async () => {
    const onRamp = getAddress(hexlify(randomBytes(20)))
    const offRamp = getAddress(hexlify(randomBytes(20)))
    const router = getAddress(hexlify(randomBytes(20)))

    const message = {
      sender: getAddress(hexlify(randomBytes(20))),
      receiver: getAddress(hexlify(randomBytes(20))),
      data: '0xdeadbeef',
      tokenAmounts: [],
    }

    const lane = {
      sourceChainSelector,
      destChainSelector,
      onRamp,
      version: CCIPVersion.V1_5,
    }

    ;(discoverOffRamp as unknown as jest.Mock).mockResolvedValue(offRamp)
    mockDestChain.getRouterForOffRamp.mockResolvedValue(router)
    mockDestChain.provider.send.mockResolvedValue(toBeHex(35_000))

    const result = await estimateExecGasForRequest(mockSourceChain as any, mockDestChain as any, {
      lane,
      message,
    })

    expect(result).toBe(14700) // 35000 - (21000 - 700)
    // Should not call eth_estimateGas with stateOverrides when no tokens
    expect(mockDestChain.provider.send).toHaveBeenCalledWith('eth_estimateGas', [
      expect.objectContaining({
        from: router,
        to: message.receiver,
        data: expect.any(String),
      }),
      'latest',
    ])
  })
})
