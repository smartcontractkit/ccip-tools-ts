import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { keccak256 } from 'ethers'

import { getLbtcAttestation, getUsdcAttestation } from './offchain.ts'

const origFetch = global.fetch

describe('getUsdcAttestation', () => {
  const mockedFetchJson = jest.fn<any, any[], any>()
  const mockedFetch = jest.fn<any, any[], any>(() => Promise.resolve({ json: mockedFetchJson }))

  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = mockedFetch as any
  })

  afterEach(() => {
    global.fetch = origFetch
  })

  it('should call the mainnet Circle API when isTestnet is false', async () => {
    const messageHex = '0x1234567890abcdef'
    const msgHash = keccak256(messageHex)
    const completeResponse = { status: 'complete', attestation: '0xabcd' }

    mockedFetchJson.mockResolvedValue(completeResponse)

    const result = await getUsdcAttestation(messageHex, false)

    expect(mockedFetch).toHaveBeenCalledWith(
      `https://iris-api.circle.com/v1/attestations/${msgHash}`,
    )
    expect(result).toBe('0xabcd')
  })

  it('should call the testnet Circle API when isTestnet is true', async () => {
    const messageHex = '0x1234567890abcdef'
    const msgHash = keccak256(messageHex)
    const completeResponse = { status: 'complete', attestation: '0xabcd' }

    mockedFetchJson.mockResolvedValue(completeResponse)

    const result = await getUsdcAttestation(messageHex, true)

    expect(mockedFetch).toHaveBeenCalledWith(
      `https://iris-api-sandbox.circle.com/v1/attestations/${msgHash}`,
    )
    expect(result).toBe('0xabcd')
  })

  it('should correctly fetch complete attestation for a real CCTP message', async () => {
    const messageHex = '0x1234567890abcdef1234567890abcdef'
    const expectedMessageHash = keccak256(messageHex)
    const expectedAttestation =
      '0x9a7bf4c29c41c5e5e54c848c0cd4a7a6094ccf17e590a0fa30f0de1d18ba5b0c15dff962c0b6c64621c618e6add5f71bc8e3b8c3bcaae98ed55cf9f75a71f5da1c'

    mockedFetchJson.mockResolvedValue({
      status: 'complete',
      attestation: expectedAttestation,
    })

    const result = await getUsdcAttestation(messageHex, true)

    expect(mockedFetch).toHaveBeenCalledWith(
      `https://iris-api-sandbox.circle.com/v1/attestations/${expectedMessageHash}`,
    )
    expect(result).toBe(expectedAttestation)
  })

  it('should throw an error if the Circle API response is not "complete"', async () => {
    const messageHex = '0x1234567890abcdef'
    const pendingResponse = { status: 'pending_confirmations', attestation: null }

    mockedFetchJson.mockResolvedValue(pendingResponse)

    await expect(getUsdcAttestation(messageHex, true)).rejects.toThrow(
      'Could not fetch USDC attestation',
    )
  })

  it('should throw an error if the Circle API response has an error', async () => {
    const messageHex = '0x1234567890abcdef'
    const errorResponse = { error: 'Not found' }

    mockedFetchJson.mockResolvedValue(errorResponse)

    await expect(getUsdcAttestation(messageHex, true)).rejects.toThrow(
      'Could not fetch USDC attestation',
    )
  })
})

describe('getLbtcAttestation', () => {
  const approvedPayloadHash1 = '0xhash1'
  const approvedPayloadAttestation1 = '0xattestation1'
  const approvedPayloadHash2 = '0xhash2'
  const approvedPayloadAttestation2 = '0xattestation2'
  const pendingPayloadHash = '0xhashpending'

  const mockedFetchJson = jest.fn<any, any[], any>(() => ({
    attestations: [
      {
        message_hash: approvedPayloadHash1,
        status: 'NOTARIZATION_STATUS_SESSION_APPROVED',
        attestation: approvedPayloadAttestation1,
      },
      {
        message_hash: approvedPayloadHash2,
        status: 'NOTARIZATION_STATUS_SESSION_APPROVED',
        attestation: approvedPayloadAttestation2,
      },
      { message_hash: pendingPayloadHash, status: 'NOTARIZATION_STATUS_PENDING' },
    ],
  }))
  const mockedFetch = jest.fn<any, any[], any>(() => Promise.resolve({ json: mockedFetchJson }))

  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = mockedFetch as any
  })

  afterEach(() => {
    global.fetch = origFetch
  })

  it('should return offchain token data for approved attestation', async () => {
    const result = await getLbtcAttestation(approvedPayloadHash1, true)

    expect(mockedFetch).toHaveBeenCalledWith(
      'https://gastald-testnet.prod.lombard.finance/api/bridge/v1/deposits/getByHash',
      {
        method: 'POST',
        body: JSON.stringify({ messageHash: [approvedPayloadHash1] }),
      },
    )
    expect(result).toBe(approvedPayloadAttestation1)
  })

  it('should call mainnet API when isTestnet is false', async () => {
    const result = await getLbtcAttestation(approvedPayloadHash1, false)

    expect(mockedFetch).toHaveBeenCalledWith(
      'https://mainnet.prod.lombard.finance/api/bridge/v1/deposits/getByHash',
      {
        method: 'POST',
        body: JSON.stringify({ messageHash: [approvedPayloadHash1] }),
      },
    )
    expect(result).toBe(approvedPayloadAttestation1)
  })

  it('should throw error if attestation is not found', async () => {
    const randomPayloadHash = '0xrandomhash'

    await expect(getLbtcAttestation(randomPayloadHash, true)).rejects.toThrow(
      'Could not find requested LBTC attestation',
    )
  })

  it('should throw error if attestation is not approved', async () => {
    await expect(getLbtcAttestation(pendingPayloadHash, true)).rejects.toThrow(
      'LBTC attestation is not approved or invalid',
    )
  })

  it('should throw error if response is invalid', async () => {
    mockedFetchJson.mockResolvedValueOnce({} as any)

    await expect(getLbtcAttestation(approvedPayloadHash1, true)).rejects.toThrow(
      'Error while fetching LBTC attestation',
    )
  })

  it('should throw error if response has no attestations field', async () => {
    mockedFetchJson.mockResolvedValueOnce({ data: 'value' } as any)

    await expect(getLbtcAttestation(approvedPayloadHash1, true)).rejects.toThrow(
      'Error while fetching LBTC attestation',
    )
  })

  it('should handle multiple attestations and return correct one', async () => {
    const result = await getLbtcAttestation(approvedPayloadHash2, true)

    expect(result).toBe(approvedPayloadAttestation2)
  })
})
