import assert from 'node:assert/strict'
import { after, beforeEach, describe, it, mock } from 'node:test'

import { getAddress, hexlify, randomBytes, toBeHex } from 'ethers'

import { estimateExecGasForRequest } from './gas.ts'
import { CCIPVersion, ChainFamily } from './types.ts'

// Test doubles - we create mock chain objects that implement the minimal interface needed
// The discoverOffRamp function performs a complex cross-check between chains, so we need
// to ensure the mocks return consistent values that satisfy the discovery logic
function createMockChains(onRamp: string, offRamp: string) {
  const sourceRouter = getAddress(hexlify(randomBytes(20)))
  const destRouter = getAddress(hexlify(randomBytes(20)))
  const destOnRamp = getAddress(hexlify(randomBytes(20)))

  const mockSourceChain = {
    network: {
      name: 'ethereum-sepolia',
      chainId: 11155111,
      chainSelector: 16015286601757825753n,
      family: ChainFamily.EVM,
      isTestnet: true,
    },
    getTokenForTokenPool: mock.fn(async () => getAddress(hexlify(randomBytes(20)))),
    getTokenInfo: mock.fn(async () => ({ decimals: 18 })),
    getRouterForOnRamp: mock.fn(async () => sourceRouter),
    getOffRampsForRouter: mock.fn(async () => [offRamp]),
    getOnRampForOffRamp: mock.fn(async () => destOnRamp),
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
      send: mock.fn(async () => toBeHex(44_000)),
      call: mock.fn(
        async () => '0x0000000000000000000000000000000000000000000000000000000000000000',
      ), // balanceOf returns 0
    },
    getRouterForOffRamp: mock.fn(async () => destRouter),
    getTokenInfo: mock.fn(async () => ({ decimals: 18 })),
    getOffRampsForRouter: mock.fn(async () => [offRamp]),
    getRouterForOnRamp: mock.fn(async () => destRouter),
    // This is the key - it needs to return the onRamp to satisfy the discovery logic
    getOnRampForOffRamp: mock.fn(async () => onRamp),
    balanceOf: mock.fn(async () => 0n),
  }

  return { mockSourceChain, mockDestChain }
}

describe('estimateExecGasForRequest', () => {
  const sourceChainSelector = 16015286601757825753n
  const destChainSelector = 10344971235874465080n

  let mockSourceChain: any
  let mockDestChain: any

  beforeEach(() => {
    mock.restoreAll()
  })

  after(() => {
    mock.restoreAll()
  })

  it('should estimate gas correctly for v1.2', async () => {
    const onRamp = getAddress(hexlify(randomBytes(20)))
    const offRamp = getAddress(hexlify(randomBytes(20)))
    const router = getAddress(hexlify(randomBytes(20)))
    const sourcePoolAddress = getAddress(hexlify(randomBytes(20)))
    const destTokenAddress = getAddress(hexlify(randomBytes(20)))
    const sourceToken = getAddress(hexlify(randomBytes(20)))

    const chains = createMockChains(onRamp, offRamp)
    mockSourceChain = chains.mockSourceChain
    mockDestChain = chains.mockDestChain

    // Configure specific responses
    mockSourceChain.getTokenForTokenPool = mock.fn(async () => sourceToken)
    mockDestChain.getRouterForOffRamp = mock.fn(async () => router)
    mockDestChain.provider.send = mock.fn(async () => toBeHex(44_000))

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

    const result = await estimateExecGasForRequest(mockSourceChain, mockDestChain, {
      lane,
      message,
    })

    assert.equal(result, 23700) // 44000 - (21000 - 700)
    assert.equal(mockDestChain.getRouterForOffRamp.mock.calls.length, 1)
    assert.ok(mockDestChain.provider.send.mock.calls.length >= 1)

    const sendCall =
      mockDestChain.provider.send.mock.calls[mockDestChain.provider.send.mock.calls.length - 1]
    assert.equal(sendCall.arguments[0], 'eth_estimateGas')
    assert.equal(sendCall.arguments[1][0].from, router)
    assert.equal(sendCall.arguments[1][0].to, message.receiver)
    assert.match(sendCall.arguments[1][0].data, /^0x85572ffb/) // ccipReceive selector
  })

  it('should estimate gas correctly for v1.5', async () => {
    const onRamp = getAddress(hexlify(randomBytes(20)))
    const offRamp = getAddress(hexlify(randomBytes(20)))
    const router = getAddress(hexlify(randomBytes(20)))
    const sourcePoolAddress = getAddress(hexlify(randomBytes(20)))
    const destTokenAddress = getAddress(hexlify(randomBytes(20)))
    const sourceToken = getAddress(hexlify(randomBytes(20)))

    const chains = createMockChains(onRamp, offRamp)
    mockSourceChain = chains.mockSourceChain
    mockDestChain = chains.mockDestChain

    mockSourceChain.getTokenForTokenPool = mock.fn(async () => sourceToken)
    mockDestChain.getRouterForOffRamp = mock.fn(async () => router)
    mockDestChain.provider.send = mock.fn(async () => toBeHex(46_000))

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

    const result = await estimateExecGasForRequest(mockSourceChain, mockDestChain, {
      lane,
      message,
    })

    assert.equal(result, 25700) // 46000 - (21000 - 700)
    assert.ok(mockDestChain.provider.send.mock.calls.length >= 1)

    const sendCall =
      mockDestChain.provider.send.mock.calls[mockDestChain.provider.send.mock.calls.length - 1]
    assert.equal(sendCall.arguments[0], 'eth_estimateGas')
    assert.match(sendCall.arguments[1][0].data, /^0x85572ffb/)
  })

  it('should handle different token decimals', async () => {
    const onRamp = getAddress(hexlify(randomBytes(20)))
    const offRamp = getAddress(hexlify(randomBytes(20)))
    const router = getAddress(hexlify(randomBytes(20)))
    const sourcePoolAddress = getAddress(hexlify(randomBytes(20)))
    const destTokenAddress = getAddress(hexlify(randomBytes(20)))
    const sourceToken = getAddress(hexlify(randomBytes(20)))

    const chains = createMockChains(onRamp, offRamp)
    mockSourceChain = chains.mockSourceChain
    mockDestChain = chains.mockDestChain

    // USDC has 6 decimals
    mockSourceChain.getTokenForTokenPool = mock.fn(async () => sourceToken)
    mockSourceChain.getTokenInfo = mock.fn(async () => ({ decimals: 6 }))
    mockDestChain.getTokenInfo = mock.fn(async () => ({ decimals: 6 }))
    mockDestChain.getRouterForOffRamp = mock.fn(async () => router)
    mockDestChain.provider.send = mock.fn(async () => toBeHex(50_000))

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

    const result = await estimateExecGasForRequest(mockSourceChain, mockDestChain, {
      lane,
      message,
    })

    assert.equal(result, 29700) // 50000 - (21000 - 700)
    assert.equal(mockSourceChain.getTokenInfo.mock.calls.length, 1)
    assert.equal(mockDestChain.getTokenInfo.mock.calls.length, 1)
  })

  it('should throw error for legacy token pools without destTokenAddress', async () => {
    const onRamp = getAddress(hexlify(randomBytes(20)))
    const offRamp = getAddress(hexlify(randomBytes(20)))
    const router = getAddress(hexlify(randomBytes(20)))

    const chains = createMockChains(onRamp, offRamp)
    mockSourceChain = chains.mockSourceChain
    mockDestChain = chains.mockDestChain

    mockDestChain.getRouterForOffRamp = mock.fn(async () => router)

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

    await assert.rejects(
      async () => {
        await estimateExecGasForRequest(mockSourceChain, mockDestChain, {
          lane,
          message,
        })
      },
      {
        message: 'Legacy <1.5 token pools not supported',
      },
    )
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

    const chains = createMockChains(onRamp, offRamp)
    mockSourceChain = chains.mockSourceChain
    mockDestChain = chains.mockDestChain

    let tokenCallCount = 0
    mockSourceChain.getTokenForTokenPool = mock.fn(async () => {
      return tokenCallCount++ === 0 ? sourceToken1 : sourceToken2
    })
    mockDestChain.getRouterForOffRamp = mock.fn(async () => router)
    mockDestChain.provider.send = mock.fn(async () => toBeHex(60_000))

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

    const result = await estimateExecGasForRequest(mockSourceChain, mockDestChain, {
      lane,
      message,
    })

    assert.equal(result, 39700) // 60000 - (21000 - 700)
    assert.equal(mockSourceChain.getTokenForTokenPool.mock.calls.length, 2)
    assert.ok(mockDestChain.provider.send.mock.calls.length >= 1)

    const sendCall =
      mockDestChain.provider.send.mock.calls[mockDestChain.provider.send.mock.calls.length - 1]
    const stateOverrides = sendCall.arguments[1][2]
    assert.ok(destTokenAddress1 in stateOverrides)
    assert.ok(destTokenAddress2 in stateOverrides)
  })

  it('should handle message with no token amounts', async () => {
    const onRamp = getAddress(hexlify(randomBytes(20)))
    const offRamp = getAddress(hexlify(randomBytes(20)))
    const router = getAddress(hexlify(randomBytes(20)))

    const chains = createMockChains(onRamp, offRamp)
    mockSourceChain = chains.mockSourceChain
    mockDestChain = chains.mockDestChain

    mockDestChain.getRouterForOffRamp = mock.fn(async () => router)
    mockDestChain.provider.send = mock.fn(async () => toBeHex(35_000))

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

    const result = await estimateExecGasForRequest(mockSourceChain, mockDestChain, {
      lane,
      message,
    })

    assert.equal(result, 14700) // 35000 - (21000 - 700)
    assert.equal(mockDestChain.provider.send.mock.calls.length, 1)

    // Should not have stateOverrides when no tokens
    const sendCall = mockDestChain.provider.send.mock.calls[0]
    assert.equal(sendCall.arguments[1].length, 2) // Only transaction and block, no stateOverrides
  })
})
