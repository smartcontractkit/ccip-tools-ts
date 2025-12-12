import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { keccak256 } from 'ethers'

import { getLbtcAttestation, getUsdcAttestation } from './offchain.ts'

const origFetch = globalThis.fetch

describe('getUsdcAttestation', () => {
  const mockedFetchJson = mock.fn((_url: string) => undefined as any)
  const mockedFetch = mock.fn((_url: string) => Promise.resolve({ json: mockedFetchJson }))

  beforeEach(() => {
    mockedFetch.mock.resetCalls()
    mockedFetchJson.mock.resetCalls()
    globalThis.fetch = mockedFetch as any
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    mockedFetch.mock.restore()
    mockedFetchJson.mock.restore()
  })

  it('should call the mainnet Circle API when isTestnet is false', async () => {
    const messageHex = '0x1234567890abcdef'
    const msgHash = keccak256(messageHex)
    const completeResponse = { status: 'complete', attestation: '0xabcd' }

    mockedFetchJson.mock.mockImplementation(() => Promise.resolve(completeResponse))

    const result = await getUsdcAttestation(messageHex, false)

    assert.equal(mockedFetch.mock.calls.length, 1)
    assert.equal(
      mockedFetch.mock.calls[0]?.arguments[0],
      `https://iris-api.circle.com/v1/attestations/${msgHash}`,
    )
    assert.equal(result, '0xabcd')
  })

  it('should call the testnet Circle API when isTestnet is true', async () => {
    const messageHex = '0x1234567890abcdef'
    const msgHash = keccak256(messageHex)
    const completeResponse = { status: 'complete', attestation: '0xabcd' }

    mockedFetchJson.mock.mockImplementation(() => Promise.resolve(completeResponse))

    const result = await getUsdcAttestation(messageHex, true)

    assert.equal(mockedFetch.mock.calls.length, 1)
    assert.equal(
      mockedFetch.mock.calls[0]?.arguments[0],
      `https://iris-api-sandbox.circle.com/v1/attestations/${msgHash}`,
    )
    assert.equal(result, '0xabcd')
  })

  it('should correctly fetch complete attestation for a real CCTP message', async () => {
    const messageHex = '0x1234567890abcdef1234567890abcdef'
    const expectedMessageHash = keccak256(messageHex)
    const expectedAttestation =
      '0x9a7bf4c29c41c5e5e54c848c0cd4a7a6094ccf17e590a0fa30f0de1d18ba5b0c15dff962c0b6c64621c618e6add5f71bc8e3b8c3bcaae98ed55cf9f75a71f5da1c'

    mockedFetchJson.mock.mockImplementation(() =>
      Promise.resolve({
        status: 'complete',
        attestation: expectedAttestation,
      }),
    )

    const result = await getUsdcAttestation(messageHex, true)

    assert.equal(mockedFetch.mock.calls.length, 1)
    assert.equal(
      mockedFetch.mock.calls[0]?.arguments[0],
      `https://iris-api-sandbox.circle.com/v1/attestations/${expectedMessageHash}`,
    )
    assert.equal(result, expectedAttestation)
  })

  it('should throw an error if the Circle API response is not "complete"', async () => {
    const messageHex = '0x1234567890abcdef'
    const pendingResponse = { status: 'pending_confirmations', attestation: null }

    mockedFetchJson.mock.mockImplementation(() => Promise.resolve(pendingResponse))

    await assert.rejects(
      async () => await getUsdcAttestation(messageHex, true),
      /Could not fetch USDC attestation/,
    )
  })

  it('should throw an error if the Circle API response has an error', async () => {
    const messageHex = '0x1234567890abcdef'
    const errorResponse = { error: 'Not found' }

    mockedFetchJson.mock.mockImplementation(() => Promise.resolve(errorResponse))

    await assert.rejects(
      async () => await getUsdcAttestation(messageHex, true),
      /Could not fetch USDC attestation/,
    )
  })
})

describe('getLbtcAttestation', () => {
  const approvedPayloadHash1 = '0xhash1'
  const approvedPayloadAttestation1 = '0xattestation1'
  const approvedPayloadHash2 = '0xhash2'
  const approvedPayloadAttestation2 = '0xattestation2'
  const pendingPayloadHash = '0xhashpending'

  const mockedFetchJson = mock.fn((_url: string, _opts?: any) =>
    Promise.resolve({
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
    } as any),
  )
  const mockedFetch = mock.fn((_url: string, _opts?: any) =>
    Promise.resolve({ json: mockedFetchJson }),
  )

  beforeEach(() => {
    mockedFetch.mock.resetCalls()
    mockedFetchJson.mock.resetCalls()
    globalThis.fetch = mockedFetch as any
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    mockedFetch.mock.restore()
    mockedFetchJson.mock.restore()
  })

  it('should return offchain token data for approved attestation', async () => {
    const result = await getLbtcAttestation(approvedPayloadHash1, true)

    assert.equal(mockedFetch.mock.calls.length, 1)
    assert.equal(
      mockedFetch.mock.calls[0]?.arguments[0],
      'https://gastald-testnet.prod.lombard.finance/api/bridge/v1/deposits/getByHash',
    )
    assert.deepEqual(mockedFetch.mock.calls[0]?.arguments[1], {
      method: 'POST',
      body: JSON.stringify({ messageHash: [approvedPayloadHash1] }),
    })
    assert.equal(result.attestation, approvedPayloadAttestation1)
  })

  it('should call mainnet API when isTestnet is false', async () => {
    const result = await getLbtcAttestation(approvedPayloadHash1, false)

    assert.equal(mockedFetch.mock.calls.length, 1)
    assert.equal(
      mockedFetch.mock.calls[0]?.arguments[0],
      'https://mainnet.prod.lombard.finance/api/bridge/v1/deposits/getByHash',
    )
    assert.deepEqual(mockedFetch.mock.calls[0]?.arguments[1], {
      method: 'POST',
      body: JSON.stringify({ messageHash: [approvedPayloadHash1] }),
    })
    assert.equal(result.attestation, approvedPayloadAttestation1)
  })

  it('should throw error if attestation is not found', async () => {
    const randomPayloadHash = '0xrandomhash'

    await assert.rejects(
      async () => await getLbtcAttestation(randomPayloadHash, true),
      /Could not find LBTC attestation for hash/,
    )
  })

  it('should throw error if attestation is not approved', async () => {
    await assert.rejects(
      async () => await getLbtcAttestation(pendingPayloadHash, true),
      /LBTC attestation not yet approved for hash/,
    )
  })

  it('should throw error if response is invalid', async () => {
    mockedFetchJson.mock.mockImplementationOnce(() => Promise.resolve({}))

    await assert.rejects(
      async () => await getLbtcAttestation(approvedPayloadHash1, true),
      /Could not find LBTC attestation for hash/,
    )
  })

  it('should throw error if response has no attestations field', async () => {
    mockedFetchJson.mock.mockImplementationOnce(() => Promise.resolve({ data: 'value' }))

    await assert.rejects(
      async () => await getLbtcAttestation(approvedPayloadHash1, true),
      /Could not find LBTC attestation for hash/,
    )
  })

  it('should handle multiple attestations and return correct one', async () => {
    const result = await getLbtcAttestation(approvedPayloadHash2, true)

    assert.equal(result.attestation, approvedPayloadAttestation2)
  })
})
