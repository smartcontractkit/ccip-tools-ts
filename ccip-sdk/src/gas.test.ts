import assert from 'node:assert/strict'
import { after, beforeEach, describe, it, mock } from 'node:test'

import { getAddress, hexlify, randomBytes, toBeHex } from 'ethers'

import { estimateExecGas } from './evm/gas.ts'
import { estimateReceiveExecution } from './gas.ts'
import { ChainFamily, NetworkType } from './types.ts'

// Test doubles - we create mock chain objects that implement the minimal interface needed
// The discoverOffRamp function performs a complex cross-check between chains, so we need
// to ensure the mocks return consistent values that satisfy the discovery logic
function createMockChains(onRamp: string, offRamp: string) {
  const sourceRouter = getAddress(hexlify(randomBytes(20)))
  const destRouter = getAddress(hexlify(randomBytes(20)))
  const destOnRamp = getAddress(hexlify(randomBytes(20)))
  const tokenAdminRegistry = getAddress(hexlify(randomBytes(20)))

  const mockSourceChain = {
    network: {
      name: 'ethereum-sepolia',
      chainId: 11155111,
      chainSelector: 16015286601757825753n,
      family: ChainFamily.EVM,
      networkType: NetworkType.Testnet,
      isTestnet: true,
    },
    typeAndVersion: mock.fn(async (address: string) => {
      if (address === onRamp) return ['EVM2EVMOnRamp', '1.5.0', address]
      return ['Router', '1.0.0', address]
    }),
    getTokenForTokenPool: mock.fn(async () => getAddress(hexlify(randomBytes(20)))),
    getTokenInfo: mock.fn(async () => ({ decimals: 18 })),
    getRouterForOnRamp: mock.fn(async () => sourceRouter),
    getOnRampForRouter: mock.fn(async (_router: string, _destChainSelector: bigint) => onRamp),
    getOffRampsForRouter: mock.fn(async () => [offRamp]),
    getOnRampForOffRamp: mock.fn(async () => destOnRamp),
    getTokenAdminRegistryFor: mock.fn(async () => tokenAdminRegistry),
    getRegistryTokenConfig: mock.fn(async (_registry: string, _token: string) => ({
      tokenPool: getAddress(hexlify(randomBytes(20))),
    })),
    getTokenPoolRemotes: mock.fn(async (_pool: string, _destChainSelector: bigint) => ({
      'ethereum-testnet-sepolia-base-1': {
        remoteToken: getAddress(hexlify(randomBytes(20))),
      },
    })),
  }

  const mockDestChain = {
    network: {
      name: 'base-sepolia',
      chainId: 84532,
      chainSelector: 10344971235874465080n,
      family: ChainFamily.EVM,
      networkType: NetworkType.Testnet,
      isTestnet: true,
    },
    provider: {
      send: mock.fn(async () => toBeHex(44_000)),
      call: mock.fn(
        async () => '0x0000000000000000000000000000000000000000000000000000000000000000',
      ), // balanceOf returns 0
    },
    typeAndVersion: mock.fn(async (address: string) => {
      if (address === offRamp) return ['EVM2EVMOffRamp', '1.5.0', address]
      return ['Router', '1.0.0', address]
    }),
    getRouterForOffRamp: mock.fn(async (_offRamp: string) => destRouter),
    getTokenInfo: mock.fn(async () => ({ decimals: 18 })),
    getOffRampsForRouter: mock.fn(async () => [offRamp]),
    getRouterForOnRamp: mock.fn(async () => destRouter),
    // This is the key - it needs to return the onRamp to satisfy the discovery logic
    getOnRampForOffRamp: mock.fn(async (_offRamp: string, _sourceChainSelector: bigint) => onRamp),
    balanceOf: mock.fn(async () => 0n),
    estimateReceiveExecution: mock.fn(async (opts: any) => {
      const router = await mockDestChain.getRouterForOffRamp(opts.offRamp)
      return estimateExecGas({ provider: mockDestChain.provider, router, ...opts })
    }),
  }

  return { mockSourceChain, mockDestChain }
}

describe('estimateExecGasForRequest', () => {
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

    const result = await estimateReceiveExecution({
      source: mockSourceChain,
      dest: mockDestChain,
      routerOrRamp: onRamp,
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

    const result = await estimateReceiveExecution({
      source: mockSourceChain,
      dest: mockDestChain,
      routerOrRamp: onRamp,
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

    const result = await estimateReceiveExecution({
      source: mockSourceChain,
      dest: mockDestChain,
      routerOrRamp: onRamp,
      message,
    })

    assert.equal(result, 29700) // 50000 - (21000 - 700)
    assert.equal(mockSourceChain.getTokenInfo.mock.calls.length, 1)
    assert.equal(mockDestChain.getTokenInfo.mock.calls.length, 1)
  })

  it('should handle token amounts with only token property (v1.5+ format)', async () => {
    const onRamp = getAddress(hexlify(randomBytes(20)))
    const offRamp = getAddress(hexlify(randomBytes(20)))
    const router = getAddress(hexlify(randomBytes(20)))
    const sourceToken = getAddress(hexlify(randomBytes(20)))
    const destToken = getAddress(hexlify(randomBytes(20)))

    const chains = createMockChains(onRamp, offRamp)
    mockSourceChain = chains.mockSourceChain
    mockDestChain = chains.mockDestChain

    mockDestChain.getRouterForOffRamp = mock.fn(async () => router)
    mockDestChain.provider.send = mock.fn(async () => toBeHex(40_000))
    mockDestChain.getTokenInfo = mock.fn(async () => ({ decimals: 18 }))
    mockSourceChain.getTokenInfo = mock.fn(async () => ({ decimals: 18 }))
    mockSourceChain.getTokenPoolRemotes = mock.fn(async () => ({
      'ethereum-testnet-sepolia-base-1': {
        remoteToken: destToken,
      },
    }))

    const message = {
      sender: getAddress(hexlify(randomBytes(20))),
      receiver: getAddress(hexlify(randomBytes(20))),
      data: '0x',
      tokenAmounts: [
        {
          token: sourceToken,
          amount: 1000n,
        },
      ],
    }

    const result = await estimateReceiveExecution({
      source: mockSourceChain,
      dest: mockDestChain,
      routerOrRamp: onRamp,
      message,
    })

    assert.equal(result, 19700) // 40000 - (21000 - 700)
    assert.equal(mockSourceChain.getTokenAdminRegistryFor.mock.calls.length, 1)
    assert.equal(mockSourceChain.getRegistryTokenConfig.mock.calls.length, 1)
    assert.equal(mockSourceChain.getTokenPoolRemotes.mock.calls.length, 1)
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

    const result = await estimateReceiveExecution({
      source: mockSourceChain,
      dest: mockDestChain,
      routerOrRamp: onRamp,
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

    const result = await estimateReceiveExecution({
      source: mockSourceChain,
      dest: mockDestChain,
      routerOrRamp: onRamp,
      message,
    })

    assert.equal(result, 14700) // 35000 - (21000 - 700)
    assert.equal(mockDestChain.provider.send.mock.calls.length, 1)

    // Should not have stateOverrides when no tokens
    const sendCall = mockDestChain.provider.send.mock.calls[0]
    assert.equal(sendCall.arguments[1].length, 2) // Only transaction and block, no stateOverrides
  })
})
