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
  Contract: jest.fn((address, _, runner) => ({
    ...mockContract,
    getAddress: jest.fn(() => address),
    runner,
  })),
}))

import {
  type ContractRunner,
  type Provider,
  Interface,
  ZeroHash,
  getAddress,
  hexlify,
  randomBytes,
} from 'ethers'
import {
  calculateManualExecProof,
  discoverOffRamp,
  fetchExecutionReceipts,
  validateOffRamp,
} from './execution.ts'
import { getLeafHasher } from './hasher/index.ts'
import { decodeMessage } from './requests.ts'
import {
  type CCIPMessage,
  type CCIPRequest,
  type Lane,
  CCIPContractType,
  CCIPVersion,
  CCIP_ABIs,
  ExecutionState,
} from './types.ts'
import { chainSelectorFromId, lazyCached } from './utils.ts'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('calculateManualExecProof', () => {
  const lane: Lane<typeof CCIPVersion.V1_5> = {
    sourceChainSelector: chainSelectorFromId(11155111),
    destChainSelector: chainSelectorFromId(421614),
    onRamp: '0x0000000000000000000000000000000000000007',
    version: CCIPVersion.V1_5,
  }
  const hasher = getLeafHasher(lane)
  const messages: CCIPMessage<typeof CCIPVersion.V1_5>[] = [
    {
      header: {
        messageId: ZeroHash,
        sequenceNumber: 1n,
        nonce: 1n,
        sourceChainSelector: lane.sourceChainSelector,
      },
      messageId: ZeroHash,
      sourceChainSelector: lane.sourceChainSelector,
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
      header: {
        messageId: ZeroHash,
        sequenceNumber: 2n,
        nonce: 2n,
        sourceChainSelector: lane.sourceChainSelector,
      },
      messageId: ZeroHash,
      sourceChainSelector: lane.sourceChainSelector,
      sender: '0x0000000000000000000000000000000000000011',
      receiver: '0x0000000000000000000000000000000000000012',
      data: '0x',
      gasLimit: 200_000n,
      strict: false,
      nonce: 2n,
      sequenceNumber: 2n,
      feeToken: '0x0000000000000000000000000000000000000003',
      feeTokenAmount: 300n,
      tokenAmounts: [
        {
          token: '0x0000000000000000000000000000000000000004',
          destTokenAddress: '0x0200000000000000000000000000000000000004',
          amount: 100n,
          sourcePoolAddress: '0x0030000000000000000000000000000000000004',
          extraData: '0x',
          destExecData: '0x10',
          destGasAmount: 16n,
        } as any,
      ],
      sourceTokenData: ['0x'],
    },
  ]
  messages[0].header.messageId = hasher(messages[0])
  messages[1].header.messageId = hasher(messages[1])

  it('should calculate manual execution proof correctly', () => {
    const merkleRoot = '0xd055c6a2bf69febaeae385fc855d732a2ed0d0fd14612d1fd45e0b83059b2876'
    const messageIds = [messages[0].header.messageId]
    const result = calculateManualExecProof(messages, lane, messageIds, merkleRoot)

    expect(result).toEqual({
      messages: messages.slice(0, 1),
      proofs: ['0xf3393e4a9c575ef46c2bfd3e614cb84d994a0504fddafa609c070d0c2a8d79d8'],
      proofFlagBits: 0n,
    })
  })

  it('should calculate messageId as root of batch with single message', () => {
    const messageIds = [messages[0].header.messageId]
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
    const messageIds = [messages[1].header.messageId]
    const merkleRoot = '0xMerkleRoot'

    expect(() => calculateManualExecProof(messages, lane, messageIds, merkleRoot)).toThrow(
      /^Merkle root created from send events doesn't match ReportAccepted merkle root: expected=0xMerkleRoot, got=0x.*/,
    )
  })

  it('should calculate manual execution proof for v1.6 EVM->EVM', () => {
    const merkleRoot1_6 = '0x1b708ef99ebc240fe6e55d126944a56503eae87436319494edff8f4902175172'
    const messages1_6: CCIPMessage<typeof CCIPVersion.V1_6>[] = [
      decodeMessage({
        data: '0x68656c6c6f',
        header: {
          nonce: 1040,
          messageId: '0x4b42209c9cb8255171d0575555d6168824112e3b905f4bd06554bd5322fed40e',
          sequenceNumber: 1073,
          destChainSelector: 16281711391670634445n,
          sourceChainSelector: 3478487238524512106n,
        },
        sender: '0x79de45bbbbbbd1bd179352aa5e7836a32285e8bd',
        feeToken: '0xe591bf0a0cf924a0674d7792db046b23cebf5f34',
        receiver: '0x00000000000000000000000095b9e79a732c0e03d04a41c30c9df7852a3d8da4',
        extraArgs:
          '0x181dcf100000000000000000000000000000000000000000000000000000000000030d400000000000000000000000000000000000000000000000000000000000000000',
        tokenAmounts: [
          {
            amount: 1,
            extraData: '0x0000000000000000000000000000000000000000000000000000000000000012',
            destExecData: '0x000000000000000000000000000000000000000000000000000000000001e848',
            destTokenAddress: '0x000000000000000000000000a4c9e2108ca478de0b91c7d9ba034bbc93c22ecc',
            sourcePoolAddress: '0x3915fd663c32e56771d14dff40031e13956a0909',
          },
        ],
        feeValueJuels: 1165428296631803n,
        feeTokenAmount: 7474222373173n,
      }),
    ] as CCIPMessage<typeof CCIPVersion.V1_6>[]

    const lane1_6: Lane<typeof CCIPVersion.V1_6> = {
      sourceChainSelector: messages1_6[0].header.sourceChainSelector,
      destChainSelector: messages1_6[0].header.destChainSelector,
      onRamp: getAddress('0xfd04bd4cf2e51ed6c57183768d270539127b9143'),
      version: CCIPVersion.V1_6,
    }

    const messageIds1_6 = [messages1_6[0].header.messageId]
    const result = calculateManualExecProof(messages1_6, lane1_6, messageIds1_6, merkleRoot1_6)

    expect(result).toMatchObject({ proofs: [], proofFlagBits: 0n })
    expect(result.messages).toHaveLength(1)
    // sender and sourcePoolAddress should be left-zero-padded 32B hex strings
    expect(result.messages[0].sender).toMatch(/^0x0{24}[a-z0-9]{40}$/)
    expect(result.messages[0].tokenAmounts[0].sourcePoolAddress).toMatch(/^0x0{24}[a-z0-9]{40}$/)
    // receiver should be checksummed 20B hex address
    expect(result.messages[0].receiver).toEqual('0x95b9e79A732C0E03d04a41c30C9DF7852a3D8Da4')
    expect(result.messages[0]).toHaveProperty('gasLimit', 200000n)
  })

  it('should calculate manual execution proof for v1.6 EVM->SVM', () => {
    const merkleRoot1_6 = '0xdd90b4c5787af181896f4b8cd7ff54e875c9ae940aec6cb52a83a6c8535affa7'
    const messages1_6: CCIPMessage<typeof CCIPVersion.V1_6>[] = [
      {
        data: 'SGVsbG8gV29ybGQ=',
        header: {
          nonce: 0n,
          messageId: '0x0fc6a9112085da645b3a2ac94c10e1a1761d3998649e1223fd62aa260fa5d8dc',
          sequenceNumber: 491n,
          destChainSelector: 16423721717087811551n,
          sourceChainSelector: 16015286601757825753n,
        },
        sender: '0x9d087fC03ae39b088326b67fA3C788236645b717',
        accounts: [
          '9XDoTJ5mYNnxqdtWV5dA583VCiGUhmL3oEMWirqys3tF',
          'CB7ptrDkY9EgwqHoJwa3TF8u4rhwYmTob2YqzaSpPMtE',
        ],
        feeToken: '0x779877A7B0D9E8603169DdbD7836e478b4624789',
        receiver: 'BqmcnLFSbKwyMEgi7VhVeJCis1wW26VySztF34CJrKFq',
        extraArgs:
          '0x1f3b3aba00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000030d4000000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000027e9b64cb72241a9053e1e3d7c80002e6b03dfcebe50c282201c6bf9794c8d4f4a608150a5cc4840ff37e559cef8b10c3b0647ca4c4be3e782709b68fdf49032b',
        computeUnits: 200000n,
        tokenAmounts: [],
        feeValueJuels: 4500000000522683n,
        tokenReceiver: '11111111111111111111111111111111',
        feeTokenAmount: 4500000000522683n,
        accountIsWritableBitmap: 3n,
        allowOutOfOrderExecution: true,
      },
    ] as unknown as CCIPMessage<typeof CCIPVersion.V1_6>[]

    const lane1_6: Lane<typeof CCIPVersion.V1_6> = {
      sourceChainSelector: 16015286601757825753n,
      destChainSelector: 16423721717087811551n,
      onRamp: '0x32f88479dc6e9eebe603ee032161387b96337fff',
      version: CCIPVersion.V1_6,
    }

    const messageIds1_6 = [messages1_6[0].header.messageId]
    const result = calculateManualExecProof(messages1_6, lane1_6, messageIds1_6, merkleRoot1_6)

    expect(result).toEqual({
      messages: messages1_6,
      proofs: [],
      proofFlagBits: 0n,
    })
  })

  it('should calculate manual execution proof for v1.6 SVM->EVM', () => {
    const merkleRoot1_6 = '0xec1e5b01b20770547bc99aea8924e19019a4fce50f1287500acdd2b26a5e840c'
    const messages1_6: CCIPMessage<typeof CCIPVersion.V1_6>[] = [
      {
        data: '0x4920616d206120434349502074657374206d657373616765',
        header: {
          nonce: 0n,
          messageId: '0xc6c76e6efff57774cc0ae8f6c4138e11cd26a3e13a41d19ef74f6b9182bd8684',
          sequenceNumber: 1821n,
          destChainSelector: 16015286601757825753n,
          sourceChainSelector: 16423721717087811551n,
        },
        sender: '7oZnxiocDK1aa9XAQC3CZ1VHKFkKwLuwRK8NddhU3FT2',
        feeToken: 'So11111111111111111111111111111111111111112',
        gasLimit: 0n,
        receiver: '0xbd27CdAB5c9109B3390B25b4Dff7d970918cc550',
        extraArgs: '0x181dcf100000000000000000000000000000000001',
        tokenAmounts: [
          {
            amount: 1000000000n,
            extraData: '0x0000000000000000000000000000000000000000000000000000000000000009',
            destExecData: '0x000493e0',
            destTokenAddress: '0x316496C5dA67D052235B9952bc42db498d6c520b',
            sourcePoolAddress: 'DJqV7aFn32Un1M7j2dwVDc77jXZiUXoufJyHhEqoEY6x',
            destGasAmount: 300000n,
          },
        ],
        feeValueJuels: 50000000000n,
        feeTokenAmount: 5n,
        allowOutOfOrderExecution: true,
      },
    ] as unknown as CCIPMessage<typeof CCIPVersion.V1_6>[]

    const lane1_6: Lane<typeof CCIPVersion.V1_6> = {
      sourceChainSelector: 16423721717087811551n,
      destChainSelector: 16015286601757825753n,
      onRamp: 'Ccip8ZTcM2qHjVt8FYHtuCAqjc637yLKnsJ5q5r2e6eL',
      version: CCIPVersion.V1_6,
    }

    const messageIds1_6 = [messages1_6[0].header.messageId]
    const result = calculateManualExecProof(messages1_6, lane1_6, messageIds1_6, merkleRoot1_6)
    expect(result).toMatchObject({ proofs: [], proofFlagBits: 0n })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].sender).toMatch(/^0x[a-z0-9]{64}$/)
  })
})

describe('validateOffRamp', () => {
  const runner = {
    get provider() {
      return runner
    },
    getNetwork: jest.fn(() => ({ chainId: 1n })),
  } as any
  it('should validate offRamp correctly', async () => {
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

    expect(result).toMatchObject({ runner })
  })

  it('should return undefined if offRamp is not valid', async () => {
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
    get provider() {
      return provider
    },
    getBlockNumber: jest.fn(() => Promise.resolve(22050)),
    getLogs: jest.fn(() => Promise.resolve([] as unknown[])),
    getNetwork: jest.fn(() => ({ chainId: 10n })),
  }

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

    const result = await discoverOffRamp(provider as unknown as ContractRunner, lane, hints)

    expect(result).toMatchObject({ runner: provider })
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

    await expect(discoverOffRamp(provider as unknown as ContractRunner, lane)).rejects.toThrow(
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
    get provider() {
      return dest
    },
    getBlockNumber: jest.fn(() => Promise.resolve(22050)),
    getLogs: jest.fn(() => Promise.resolve([] as unknown[])),
    getBlock: jest.fn(() => Promise.resolve({ timestamp: 123456 })),
    getNetwork: jest.fn(() => ({ chainId: 10n })),
  }
  const iface = lazyCached(
    `Interface ${CCIPContractType.OffRamp} ${lane.version}`,
    () => new Interface(CCIP_ABIs[CCIPContractType.OffRamp][lane.version]),
  )

  it('should fetch all execution receipts correctly', async () => {
    const messageId = hexlify(randomBytes(32))
    const requests = [
      {
        message: {
          header: { messageId, sequenceNumber: 1n },
          messageId,
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
          requests[0].message.header.sequenceNumber,
          requests[0].message.header.messageId,
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
    const messageId = hexlify(randomBytes(32))
    const requests = [
      {
        message: {
          header: { messageId, sequenceNumber: 1n },
          messageId,
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
