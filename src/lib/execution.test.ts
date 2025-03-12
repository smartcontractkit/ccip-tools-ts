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
  ZeroAddress,
  ZeroHash,
  getBigInt,
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
  parseExtraArgs,
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
      header: {
        messageId: ZeroHash,
        sequenceNumber: 1n,
        nonce: 1n,
      },
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
      header: {
        messageId: ZeroHash,
        sequenceNumber: 2n,
        nonce: 2n,
      },
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

  // TODO: temporary to show edge case in `calculateManualExecProof`
  it('should fail when computing messages with different versions', () => {
    const v1_5_header = {
      messageId: '0x1001',
      sequenceNumber: 1337n,
      nonce: 1337n,
    }
    const v1_5_message = {
      header: v1_5_header,
      sourceChainSelector: lane.sourceChainSelector,
      sender: '0x1110000000000000000000000000000000000001',
      receiver: '0x2220000000000000000000000000000000000001',
      sequenceNumber: v1_5_header.sequenceNumber,
      gasLimit: 100n,
      strict: false,
      nonce: v1_5_header.nonce,
      feeToken: ZeroAddress,
      feeTokenAmount: 1n,
      data: '0x',
      tokenAmounts: [
        { token: '0x4440000000000000000000000000000000000001', amount: 12345678900n } as any,
      ],
      sourceTokenData: [],
      messageId: v1_5_header.messageId,
    } as CCIPMessage<CCIPVersion.V1_5>

    const v1_6_header = {
      messageId: '0xf82dd9f9977f06d5c789d33299f15c3c693c9b7b084206c8c524c3620f966edd',
      sequenceNumber: 17624761845632355147n,
      nonce: 13974814057813369789n,
      sourceChainSelector: lane.sourceChainSelector,
      destChainSelector: lane.destChainSelector,
    }
    const extraArgs =
      '0x181dcf100000000000000000000000000000000000000000000000005eb3e65ecb9fb54e0000000000000000000000000000000000000000000000000000000000000001'

    const v1_6_message: CCIPMessage<CCIPVersion.V1_6> = {
      header: v1_6_header,
      sender: '0x00000000000000000000000021aa8a422bfb1a82e254331259c1cbbea7408b44',
      receiver: '0x56ad368c27ab9a428e9992c3843c79a35830794a',
      feeToken: '0x6627c714a7ba7cc17bddeffa83b36a3b969e4e6c',
      feeTokenAmount: 15188903849671844750n,
      feeValueJuels: 0n,
      extraArgs,
      gasLimit: parseExtraArgs(extraArgs)!.gasLimit!,
      data: '0xeed38ce567ddd944bb1c24619d50d373181a4faf1feed3f726a473df6c0a8dcd4c0fe0a09c843e930dabdd6ac5994025e99828e1d74df0641ec1f1d82c0ad1ab4c277721ba388a7742d711bbefb62182ae2c7ab1b80edaaf97f5527642e0ed167f69030792970994443aabfeceb0b12435f28cdb4925f82beacc1df9232b4f9734eed4c54b2cbe9276428a25ce2f3bea2735d205b40f8f0c488f3d584e6e197801c6d308b1e1d3f42b7cbfbeed21c72300b7126afa0002e20fadf43a8238fb8ac6f6612144fac1733fb1ef927c9d0cdf29eb08fe964e1afeeb845d547ace4ef2313df69b2f8f3d0b9714aa26e5d0a9a6d8f5b37680c617f524b7414e2f96e236b4d8efb037d025b1bcaff2f76b2696811c853283abb56d990197f21f7fbfef06044c31d42f7c8cac72a5a5b0a3f3a19cd24fec76d90efaf00a2b83e7eb9c817fbc667841c27a79168e49b68ecddb44a8e2877cf326a342a2b377dcafe3f692688dac17de842889bb0e2ee717092d2c53ce44a2d33760ab9791cbf9d1273eb2db7b59e741869037aeacfeb10132aa81f2bbc4b2626870f38d9e6a15636561bcbe93b16aef84c92d2b81798c1d332bc031911b8128765e2e74537c2416076ee587caf9178f6fc963ff0fc0a8c3d4551c7ab98bc26c42c4aa63ddbb1886f47456bf26275ef26dd1bde3ed3cabc064a3f1275240be0d799c649e30a3b9c36ba9a7a97e97cec75d6d2d1a6da15413614ebf3246126da03d41febaa07daaa205731336c1cffb3531d69c847f4fd9fb0daf1ee0975ab8a3bfc5251d9c32cca4def2f13540a6978c075d00856aa59c47ac80fb5598ab5646037121aa2b0f0512f7091a5ce33fb5a501c490b2390420c614e105f29abed474a4399c9823d56c88deef0e9de87af5b408cf0f506da2c2092da239383d1019734334125bdb489a8798e86000b6e9e8927d9193c4b0069cb5a3a54b149530229220193766e9f4e73e74d36a50b4166a65ce02aaad5ba014348d4c48562d781cbc246a4d56f5852d50f133a97d0bdf5cc176ac798d094a310f0fadb69bcd247b58199c4e7fa8e4e9662a046209af363e3cc1ebf501938b3bc2ebcbabf867e599c1f50f09be10e1c910973af651be066ed59ae9f136eba74a49f6c944c3b67b5bebdee8a1114781121ea15c9a2e53c8507d425c0cdd34e257e645427a7da23801a381366f74c75bc1c5fe9269423ad3a8be38702c91fee10bd88a6f4968819205f18a46ad290248cbfdf3f36e0ed15f0213326cdd284d40790a475b8e0678b0cdf5331e882e84236673a414259723b36d53d13dd956fef3d105bd5545da',
      tokenAmounts: [
        {
          sourcePoolAddress: '0x0000000000000000000000006987756a2fc8e4f3f0a5e026cb200cc2b5221b1f',
          destTokenAddress: '0xcc44ff0e5a1fc9a6f3224ef0f47f0c03b3f8eaee',
          extraData: '0xd8e78c2c6144d59c308cee0365b6d223a9cea73dd7a46e990505271b4abb47b4',
          amount: 4679472148560135273n,
          destExecData: '0x000000000000000000000000000000000000000000000000000000005a51fc6c',
        },
      ].map((ta) => ({ ...ta, destGasAmount: getBigInt(ta.destExecData) })),
    }

    const msgs = [v1_5_message, v1_6_message]
    const msgsIds = [v1_5_message.messageId, v1_6_message.header.messageId]
    const result = calculateManualExecProof(msgs, lane, msgsIds)

    expect(result).toBe(null)
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
    getLogs: jest.fn(() => Promise.resolve(<unknown[]>[])),
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
    getLogs: jest.fn(() => Promise.resolve(<unknown[]>[])),
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
