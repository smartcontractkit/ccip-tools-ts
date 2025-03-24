import type { Provider } from 'ethers'

import { fetchCommitReport } from './commits.ts'
import { type Lane, CCIPContractType, CCIPVersion } from './types.ts'

const mockProvider = {
  get provider() {
    return mockProvider
  },
  getBlockNumber: jest.fn(() => 15_000),
  getLogs: jest.fn<any, [], any>(() => [{}]),
  getNetwork: jest.fn(() => ({ chainId: 11155111 })),
}

const mockedContract = {
  typeAndVersion: jest.fn(() => `${CCIPContractType.OnRamp} ${CCIPVersion.V1_2}`),
  getStaticConfig: jest.fn(() => ({
    sourceChainSelector: 5009297550715157269n,
    onRamp: '0xOnRamp',
  })),
}

const mockedInterface = {
  parseLog: jest.fn(() => ({
    name: 'ReportAccepted',
    args: {
      interval: { min: 1n, max: 2n },
      merkleRoot: '0x1234',
    } as Record<string, any>,
  })),
  getEvent: jest.fn(() => ({
    topicHash: '0xCommitReportAcceptedTopic0',
  })),
}

// Mock Contract instance
jest.mock('ethers', () => ({
  ...jest.requireActual('ethers'),
  Contract: jest.fn(() => mockedContract),
  Interface: jest.fn(() => mockedInterface),
}))

describe('fetchCommitReport', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return first matching commit report', async () => {
    const hints = { startBlock: 12345 }
    mockProvider.getLogs.mockReturnValueOnce([
      {
        address: '0xCommitStore',
      },
    ])
    const request = {
      message: { header: { sequenceNumber: 1n } },
      lane: {
        sourceChainSelector: 5009297550715157269n,
        onRamp: '0xOnRamp',
        version: CCIPVersion.V1_2,
      } as Lane,
    }
    const result = await fetchCommitReport(mockProvider as unknown as Provider, request, hints)
    expect(result).toMatchObject({
      report: {
        minSeqNr: 1n,
        maxSeqNr: 2n,
        merkleRoot: '0x1234',
      },
    })
    expect(mockProvider.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 12345, toBlock: 15000 }),
    )
  })

  it('should ignore if CommitStore not for our onRamp', async () => {
    const hints = { startBlock: 12345 }
    const request = {
      message: { header: { sequenceNumber: 1n } },
      lane: {
        sourceChainSelector: 5009297550715157269n,
        onRamp: '0xAnotherOnRamp',
        version: CCIPVersion.V1_2,
      } as Lane,
    }
    await expect(
      fetchCommitReport(mockProvider as unknown as Provider, request, hints),
    ).rejects.toThrow(`Could not find commit after 12345 for sequenceNumber=1`)
  })

  it('should return v1.6 commit report', async () => {
    const request = {
      message: { header: { sequenceNumber: 4n } },
      lane: {
        sourceChainSelector: 5009297550715157269n,
        onRamp: '0xOnRamp',
        version: CCIPVersion.V1_6,
      } as Lane,
    }

    mockedContract.typeAndVersion.mockReturnValue(`${CCIPContractType.OffRamp} ${CCIPVersion.V1_6}`)
    mockProvider.getLogs.mockReturnValueOnce([{}, {}, {}])
    mockedInterface.parseLog.mockReturnValueOnce({
      name: 'CommitReportAccepted',
      args: [[], []],
    })
    mockedInterface.parseLog.mockReturnValueOnce({
      name: 'CommitReportAccepted',
      args: [
        [],
        [
          {
            sourceChainSelector: request.lane.sourceChainSelector,
            onRampAddress: '0x000000000000000000000000OnRamp',
            toObject: jest.fn(() => ({
              minSeqNr: 1n,
              maxSeqNr: 2n,
              merkleRoot: '0xdeedbeef',
            })),
          },
        ],
      ],
    })
    mockedInterface.parseLog.mockReturnValueOnce({
      name: 'CommitReportAccepted',
      args: [
        [],
        [
          {
            sourceChainSelector: request.lane.sourceChainSelector,
            onRampAddress: '0x000000000000000000000000OnRamp',
            toObject: jest.fn(() => ({
              minSeqNr: 3n,
              maxSeqNr: 8n,
              merkleRoot: '0x1234',
            })),
          },
        ],
      ],
    })

    const hints = { startBlock: 12345 }
    const result = await fetchCommitReport(mockProvider as unknown as Provider, request, hints)
    expect(result).toMatchObject({
      report: {
        minSeqNr: 3n,
        maxSeqNr: 8n,
        merkleRoot: '0x1234',
      },
    })
    expect(mockProvider.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 12345, toBlock: 15000 }),
    )
  })
})
