const mockContract = {
  typeAndVersion: jest.fn(() => Promise.resolve(`${CCIPContractType.OffRamp} ${CCIPVersion.V1_5}`)),
  getStaticConfig: jest.fn(() =>
    Promise.resolve({
      chainSelector: chainSelectorFromId(421614),
      sourceChainSelector: chainSelectorFromId(11155111),
      onRamp: '0xOnRamp',
    }),
  ),
  getOffRamps: jest.fn(() =>
    Promise.resolve([
      { sourceChainSelector: chainSelectorFromId(11155111), offRamp: '0xOffRamp1' },
    ]),
  ),
}

// Mock Contract instance
jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  Contract: jest.fn(() => mockContract),
}))

import {
  type ContractRunner,
  type Provider,
  Interface,
  ZeroHash,
  hexlify,
  randomBytes,
} from 'ethers'
import {
  calculateManualExecProof,
  discoverOffRamp,
  fetchExecutionReceipts,
  validateOffRamp,
} from './execution.js'
import { getLeafHasher } from './hasher/index.js'
import {
  type CCIPMessage,
  type CCIPRequest,
  type Lane,
  CCIPContractType,
  CCIPVersion,
  CCIP_ABIs,
  ExecutionState,
} from './types.js'
import { chainSelectorFromId, lazyCached } from './utils.js'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('calculateManualExecProof', () => {
  const lane: Lane = {
    sourceChainSelector: chainSelectorFromId(11155111),
    destChainSelector: chainSelectorFromId(421614),
    onRamp: '0x0000000000000000000000000000000000000007',
    version: CCIPVersion.V1_5,
  }
  const hasher = getLeafHasher(lane)
  const messages: CCIPMessage[] = [
    {
      messageId: ZeroHash,
      sourceChainSelector: chainSelectorFromId(11155111),
      sender: '0x0000000000000000000000000000000000000001',
      receiver: '0x0000000000000000000000000000000000000002',
      data: '0x',
      gasLimit: 200_000n,
      strict: false,
      nonce: 1n,
      sequenceNumber: 1n,
      feeToken: '0x0000000000000000000000000000000000000003',
      feeTokenAmount: 200n,
      tokenAmounts: [],
      sourceTokenData: [],
    },
    {
      messageId: ZeroHash,
      sourceChainSelector: chainSelectorFromId(11155111),
      sender: '0x0000000000000000000000000000000000000011',
      receiver: '0x0000000000000000000000000000000000000012',
      data: '0x',
      gasLimit: 200_000n,
      strict: false,
      nonce: 2n,
      sequenceNumber: 2n,
      feeToken: '0x0000000000000000000000000000000000000003',
      feeTokenAmount: 300n,
      tokenAmounts: [{ token: '0x0000000000000000000000000000000000000004', amount: 100n }],
      sourceTokenData: ['0x'],
    },
  ]
  messages[0].messageId = hasher(messages[0])
  messages[1].messageId = hasher(messages[1])

  it('should calculate manual execution proof correctly', () => {
    const merkleRoot = '0xd055c6a2bf69febaeae385fc855d732a2ed0d0fd14612d1fd45e0b83059b2876'
    const messageIds = [messages[0].messageId]
    const result = calculateManualExecProof(messages, lane, messageIds, merkleRoot)

    expect(result).toEqual({
      messages: messages.slice(0, 1),
      proofs: ['0xf3393e4a9c575ef46c2bfd3e614cb84d994a0504fddafa609c070d0c2a8d79d8'],
      proofFlagBits: 0n,
    })
  })

  it('should calculate messageId as root of batch with single message', () => {
    const messageIds = [messages[0].messageId]
    const merkleRoot = messageIds[0]
    const batch = messages.slice(0, 1)

    const result = calculateManualExecProof(batch, lane, messageIds, merkleRoot)

    expect(result).toEqual({
      messages: batch,
      proofs: [],
      proofFlagBits: 0n,
    })
  })

  it('should throw an error if messageIds are missing', () => {
    const messageIds = [hexlify(randomBytes(32))]

    expect(() => calculateManualExecProof(messages, lane, messageIds)).toThrow(
      `Could not find messageIds: ${messageIds[0]}`,
    )
  })

  it('should throw an error if merkle root does not match', () => {
    const messageIds = [messages[1].messageId]
    const merkleRoot = '0xMerkleRoot'

    expect(() => calculateManualExecProof(messages, lane, messageIds, merkleRoot)).toThrow(
      /^Merkle root created from send events doesn't match ReportAccepted merkle root: expected=0xMerkleRoot, got=0x.*/,
    )
  })
})

describe('validateOffRamp', () => {
  it('should validate offRamp correctly', async () => {
    const runner = {} as any
    const offRamp = hexlify(randomBytes(20))
    const onRamp = hexlify(randomBytes(20))
    const lane: Lane = {
      sourceChainSelector: chainSelectorFromId(11155111),
      destChainSelector: chainSelectorFromId(421614),
      onRamp,
      version: CCIPVersion.V1_5,
    }
    mockContract.getStaticConfig.mockResolvedValue({
      chainSelector: lane.destChainSelector,
      sourceChainSelector: lane.sourceChainSelector,
      onRamp,
    })

    const result = await validateOffRamp(runner, offRamp, lane)

    expect(result).toBe(mockContract)
  })

  it('should return undefined if offRamp is not valid', async () => {
    const runner = {} as any
    const offRamp = hexlify(randomBytes(20))
    const onRamp = hexlify(randomBytes(20))
    const lane: Lane = {
      sourceChainSelector: chainSelectorFromId(11155111),
      destChainSelector: chainSelectorFromId(421614),
      onRamp,
      version: CCIPVersion.V1_5,
    }
    mockContract.getStaticConfig.mockResolvedValue({
      chainSelector: lane.destChainSelector,
      sourceChainSelector: lane.sourceChainSelector,
      onRamp: hexlify(randomBytes(20)),
    })

    await expect(validateOffRamp(runner, offRamp, lane)).resolves.toBeUndefined()
  })
})

describe('discoverOffRamp', () => {
  const lane: Lane = {
    sourceChainSelector: chainSelectorFromId(11155111),
    destChainSelector: chainSelectorFromId(421614),
    onRamp: '0x0000000000000000000000000000000000000007',
    version: CCIPVersion.V1_5,
  }
  const routerEvt = '0x9b877de93ea9895756e337442c657f95a34fc68e7eb988bdfa693d5be83016b6'
  const offRampEvt = '0xd4f851956a5d67c3997d1c9205045fef79bae2947fdee7e9e2641abc7391ef65'

  const provider = {
    getBlockNumber: jest.fn(() => Promise.resolve(22050)),
    getLogs: jest.fn(() => Promise.resolve(<unknown[]>[])),
  }
  const runner = { provider }

  beforeEach(() => {
    lane.onRamp = hexlify(randomBytes(20))
  })

  it('should discover offRamp correctly', async () => {
    provider.getLogs.mockResolvedValueOnce([
      { address: '0xRouter', topics: [routerEvt] },
      { address: '0xOffRamp2', topics: [offRampEvt] },
    ])
    mockContract.getStaticConfig.mockResolvedValueOnce({
      chainSelector: lane.destChainSelector,
      sourceChainSelector: lane.sourceChainSelector,
      onRamp: hexlify(randomBytes(20)),
    })
    mockContract.getStaticConfig.mockResolvedValueOnce({
      chainSelector: lane.destChainSelector,
      sourceChainSelector: lane.sourceChainSelector,
      onRamp: lane.onRamp,
    })
    const hints = { fromBlock: 50 }

    const result = await discoverOffRamp(runner as unknown as ContractRunner, lane, hints)

    expect(result).toBe(mockContract)
    expect(provider.getLogs).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        fromBlock: 50,
        topics: [expect.arrayContaining([routerEvt, offRampEvt])],
      }),
    )
  })

  it('should throw an error if no offRamp is found', async () => {
    provider.getLogs.mockResolvedValueOnce([
      { address: '0xRouter', topics: [routerEvt] },
      { address: '0xOffRamp2', topics: [offRampEvt] },
    ])
    mockContract.getStaticConfig.mockResolvedValue({
      chainSelector: lane.destChainSelector,
      sourceChainSelector: lane.sourceChainSelector,
      onRamp: hexlify(randomBytes(20)),
    })

    await expect(discoverOffRamp(runner as unknown as ContractRunner, lane)).rejects.toThrow(
      /Could not find OffRamp on "ethereum-testnet-sepolia-arbitrum-1" for OnRamp=0x[a-zA-Z0-9]{40} on "ethereum-testnet-sepolia"/,
    )
  })
})

describe('fetchExecutionReceipts', () => {
  const lane: Lane = {
    sourceChainSelector: chainSelectorFromId(11155111),
    destChainSelector: chainSelectorFromId(421614),
    onRamp: '0x0000000000000000000000000000000000000007',
    version: CCIPVersion.V1_5,
  }
  const dest = {
    getBlockNumber: jest.fn(() => Promise.resolve(22050)),
    getLogs: jest.fn(() => Promise.resolve(<unknown[]>[])),
    getBlock: jest.fn(() => Promise.resolve({ timestamp: 123456 })),
  }
  const iface = lazyCached(
    `Interface ${CCIPContractType.OffRamp} ${lane.version}`,
    () => new Interface(CCIP_ABIs[CCIPContractType.OffRamp][lane.version]),
  )

  it('should fetch all execution receipts correctly', async () => {
    const requests = [
      {
        message: {
          messageId: hexlify(randomBytes(32)),
          sequenceNumber: 1n,
          sourceChainSelector: lane.sourceChainSelector,
        },
        log: { address: lane.onRamp },
        lane,
      },
    ]
    const hints = { fromBlock: 50 }
    mockContract.getStaticConfig.mockResolvedValue({
      chainSelector: lane.destChainSelector,
      sourceChainSelector: lane.sourceChainSelector,
      onRamp: lane.onRamp,
    })
    const offRamp = hexlify(randomBytes(20))
    dest.getBlock.mockResolvedValueOnce({ timestamp: 100001 })
    dest.getLogs.mockResolvedValueOnce([
      {
        address: offRamp,
        ...iface.encodeEventLog('ExecutionStateChanged', [
          requests[0].message.sequenceNumber,
          requests[0].message.messageId,
          ExecutionState.Failed,
          '0x1337',
        ]),
        blockNumber: 2024,
        transactionHash: '0xTransactionHash',
      },
    ])
    dest.getLogs.mockResolvedValueOnce([
      {
        address: offRamp,
        ...iface.encodeEventLog('ExecutionStateChanged', [
          requests[0].message.sequenceNumber,
          requests[0].message.messageId,
          ExecutionState.Success,
          '0x',
        ]),
        blockNumber: 12024,
        transactionHash: '0xTransactionHash',
      },
    ])

    const generator = fetchExecutionReceipts(
      dest as unknown as Provider,
      requests as unknown as CCIPRequest[],
      hints,
    )
    const result = []
    for await (const receipt of generator) {
      result.push(receipt)
    }

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      receipt: { state: ExecutionState.Failed, messageId: requests[0].message.messageId },
      log: { blockNumber: 2024 },
      timestamp: 100001,
    })
    expect(result[1]).toMatchObject({
      receipt: { state: ExecutionState.Success, messageId: requests[0].message.messageId },
      log: { blockNumber: 12024 },
      timestamp: 123456,
    })
    expect(dest.getLogs).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        fromBlock: 50,
      }),
    )
  })

  it('should complete backwards when no more requests are left', async () => {
    const requests = [
      {
        message: {
          messageId: hexlify(randomBytes(32)),
          sequenceNumber: 1n,
          sourceChainSelector: lane.sourceChainSelector,
        },
        log: { address: lane.onRamp },
        lane,
      },
    ]
    mockContract.getStaticConfig.mockResolvedValue({
      chainSelector: lane.destChainSelector,
      sourceChainSelector: lane.sourceChainSelector,
      onRamp: lane.onRamp,
    })
    const offRamp = hexlify(randomBytes(20))
    dest.getLogs.mockResolvedValueOnce([
      {
        address: offRamp,
        ...iface.encodeEventLog('ExecutionStateChanged', [
          requests[0].message.sequenceNumber,
          requests[0].message.messageId,
          ExecutionState.Failed,
          '0x1337',
        ]),
        blockNumber: 22014,
        transactionHash: '0xTransactionHash1',
      },
      {
        address: offRamp,
        ...iface.encodeEventLog('ExecutionStateChanged', [
          requests[0].message.sequenceNumber,
          requests[0].message.messageId,
          ExecutionState.Success,
          '0x',
        ]),
        blockNumber: 22024,
        transactionHash: '0xTransactionHash2',
      },
    ])

    const generator = fetchExecutionReceipts(
      dest as unknown as Provider,
      requests as unknown as CCIPRequest[],
    )
    const result = []
    for await (const receipt of generator) {
      result.push(receipt)
    }

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      receipt: { state: ExecutionState.Success, messageId: requests[0].message.messageId },
      log: { blockNumber: 22024 },
      timestamp: 123456,
    })
    expect(dest.getLogs).toHaveBeenCalledTimes(1)
    expect(dest.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        toBlock: 22050,
      }),
    )
  })
})
