import type { Provider } from 'ethers'

import { fetchCommitReport } from './commits.js'
import { CCIPContractTypeOnRamp, CCIPVersion_1_2 } from './types.js'

const mockProvider = {
  getBlockNumber: jest.fn(() => 15_000),
  getLogs: jest.fn<any, [], any>(() => [{}]),
}

const mockedContract = {
  typeAndVersion: jest.fn(() => `${CCIPContractTypeOnRamp} ${CCIPVersion_1_2}`),
  getStaticConfig: jest.fn(() => ({
    sourceChainSelector: 5009297550715157269n,
    onRamp: '0xOnRamp',
  })),
}

const mockedInterface = {
  parseLog: jest.fn(() => ({
    name: 'ReportAccepted',
    args: [
      {
        toObject: jest.fn(() => ({
          interval: { min: 1n, max: 2n },
          merkleRoot: '0x1234',
        })),
        priceUpdates: {
          tokenPriceUpdates: [{ toObject: jest.fn() }],
          gasPriceUpdates: [{ toObject: jest.fn() }],
        },
      },
    ],
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
    const request = {
      log: { address: '0xOnRamp' },
      message: { sequenceNumber: 1n, sourceChainSelector: 5009297550715157269n },
      version: CCIPVersion_1_2 as CCIPVersion_1_2,
    }
    const result = await fetchCommitReport(mockProvider as unknown as Provider, request, hints)
    expect(result).toMatchObject({
      report: {
        interval: { min: 1n, max: 2n },
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
      log: { address: '0xAnotherOnRamp' },
      message: { sequenceNumber: 1n, sourceChainSelector: 5009297550715157269n },
      version: CCIPVersion_1_2 as CCIPVersion_1_2,
    }
    await expect(
      fetchCommitReport(mockProvider as unknown as Provider, request, hints),
    ).rejects.toThrow(`Could not find commit after 12345 for sequenceNumber=1`)
  })
})
