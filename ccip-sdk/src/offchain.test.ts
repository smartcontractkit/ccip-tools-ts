import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { getLbtcAttestation, getUsdcAttestation } from './offchain.ts'
import { NetworkType } from './types.ts'

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

  it('should call the mainnet Circle API when networkType is MAINNET', async () => {
    const sourceDomain = 0
    const nonce = 12345
    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    const completeResponse = {
      messages: [
        {
          status: 'complete' as const,
          eventNonce: '12345',
          attestation: '0xabcd',
          message: '0xmessage',
        },
      ],
    }

    mockedFetchJson.mock.mockImplementation(() => Promise.resolve(completeResponse))

    const result = await getUsdcAttestation({ sourceDomain, nonce, txHash }, NetworkType.Mainnet)

    assert.equal(mockedFetch.mock.calls.length, 1)
    assert.equal(
      mockedFetch.mock.calls[0]?.arguments[0],
      `https://iris-api.circle.com/v2/messages/${sourceDomain}?transactionHash=${txHash}`,
    )
    assert.equal(result.attestation, '0xabcd')
    assert.equal(result.message, '0xmessage')
  })

  it('should call the testnet Circle API when networkType is TESTNET', async () => {
    const sourceDomain = 1
    const nonce = 54321
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
    const completeResponse = {
      messages: [
        {
          status: 'complete' as const,
          eventNonce: '54321',
          attestation: '0xabcd',
          message: '0xmessage',
        },
      ],
    }

    mockedFetchJson.mock.mockImplementation(() => Promise.resolve(completeResponse))

    const result = await getUsdcAttestation({ sourceDomain, nonce, txHash }, NetworkType.Testnet)

    assert.equal(mockedFetch.mock.calls.length, 1)
    assert.equal(
      mockedFetch.mock.calls[0]?.arguments[0],
      `https://iris-api-sandbox.circle.com/v2/messages/${sourceDomain}?transactionHash=${txHash}`,
    )
    assert.equal(result.attestation, '0xabcd')
    assert.equal(result.message, '0xmessage')
  })

  it('should correctly fetch complete attestation for a real CCTP message', async () => {
    const sourceDomain = 2
    const nonce = 99999
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
    const expectedAttestation =
      '0x9a7bf4c29c41c5e5e54c848c0cd4a7a6094ccf17e590a0fa30f0de1d18ba5b0c15dff962c0b6c64621c618e6add5f71bc8e3b8c3bcaae98ed55cf9f75a71f5da1c'
    const expectedMessage = '0x000000000000000000000000...'

    mockedFetchJson.mock.mockImplementation(() =>
      Promise.resolve({
        messages: [
          {
            status: 'complete' as const,
            eventNonce: '99999',
            attestation: expectedAttestation,
            message: expectedMessage,
          },
        ],
      }),
    )

    const result = await getUsdcAttestation({ sourceDomain, nonce, txHash }, NetworkType.Testnet)

    assert.equal(mockedFetch.mock.calls.length, 1)
    assert.equal(
      mockedFetch.mock.calls[0]?.arguments[0],
      `https://iris-api-sandbox.circle.com/v2/messages/${sourceDomain}?transactionHash=${txHash}`,
    )
    assert.equal(result.attestation, expectedAttestation)
    assert.equal(result.message, expectedMessage)
  })

  it('should throw an error if the Circle API response is not "complete"', async () => {
    const sourceDomain = 0
    const nonce = 12345
    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    const pendingResponse = {
      messages: [
        {
          status: 'pending_confirmations' as const,
          eventNonce: '12345',
          attestation: '0x',
          message: '0x',
        },
      ],
    }

    mockedFetchJson.mock.mockImplementation(() => Promise.resolve(pendingResponse))

    await assert.rejects(
      async () => await getUsdcAttestation({ sourceDomain, nonce, txHash }, NetworkType.Testnet),
      /Could not fetch USDC attestation/,
    )
  })

  it('should throw an error if the Circle API response has an error', async () => {
    const sourceDomain = 0
    const nonce = 12345
    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    const errorResponse = { error: 'Not found' }

    mockedFetchJson.mock.mockImplementation(() => Promise.resolve(errorResponse))

    await assert.rejects(
      async () => await getUsdcAttestation({ sourceDomain, nonce, txHash }, NetworkType.Testnet),
      /Could not fetch USDC attestation/,
    )
  })

  it('should filter by nonce when multiple messages are returned', async () => {
    const sourceDomain = 0
    const nonce = 12345
    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    const response = {
      messages: [
        {
          status: 'complete' as const,
          eventNonce: '12344',
          attestation: '0xwrong1',
          message: '0xwrongmsg1',
        },
        {
          status: 'complete' as const,
          eventNonce: '12345',
          attestation: '0xcorrect',
          message: '0xcorrectmsg',
        },
        {
          status: 'complete' as const,
          eventNonce: '12346',
          attestation: '0xwrong2',
          message: '0xwrongmsg2',
        },
      ],
    }

    mockedFetchJson.mock.mockImplementation(() => Promise.resolve(response))

    const result = await getUsdcAttestation({ sourceDomain, nonce, txHash }, NetworkType.Testnet)

    assert.equal(result.attestation, '0xcorrect')
    assert.equal(result.message, '0xcorrectmsg')
  })

  it('should throw error if no complete message matches the nonce', async () => {
    const sourceDomain = 0
    const nonce = 12345
    const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    const response = {
      messages: [
        {
          status: 'complete' as const,
          eventNonce: '12344',
          attestation: '0xother',
          message: '0xothermsg',
        },
      ],
    }

    mockedFetchJson.mock.mockImplementation(() => Promise.resolve(response))

    await assert.rejects(
      async () => await getUsdcAttestation({ sourceDomain, nonce, txHash }, NetworkType.Testnet),
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
    const result = await getLbtcAttestation(approvedPayloadHash1, NetworkType.Testnet)

    assert.equal(mockedFetch.mock.calls.length, 1)
    assert.equal(
      mockedFetch.mock.calls[0]?.arguments[0],
      'https://gastald-testnet.prod.lombard.finance/api/bridge/v1/deposits/getByHash',
    )
    assert.deepEqual(mockedFetch.mock.calls[0].arguments[1], {
      method: 'POST',
      body: JSON.stringify({ messageHash: [approvedPayloadHash1] }),
    })
    assert.equal(result.attestation, approvedPayloadAttestation1)
  })

  it('should call mainnet API when networkType is MAINNET', async () => {
    const result = await getLbtcAttestation(approvedPayloadHash1, NetworkType.Mainnet)

    assert.equal(mockedFetch.mock.calls.length, 1)
    assert.equal(
      mockedFetch.mock.calls[0]?.arguments[0],
      'https://mainnet.prod.lombard.finance/api/bridge/v1/deposits/getByHash',
    )
    assert.deepEqual(mockedFetch.mock.calls[0].arguments[1], {
      method: 'POST',
      body: JSON.stringify({ messageHash: [approvedPayloadHash1] }),
    })
    assert.equal(result.attestation, approvedPayloadAttestation1)
  })

  it('should throw error if attestation is not found', async () => {
    const randomPayloadHash = '0xrandomhash'

    await assert.rejects(
      async () => await getLbtcAttestation(randomPayloadHash, NetworkType.Testnet),
      /Could not find LBTC attestation for hash/,
    )
  })

  it('should throw error if attestation is not approved', async () => {
    await assert.rejects(
      async () => await getLbtcAttestation(pendingPayloadHash, NetworkType.Testnet),
      /LBTC attestation not yet approved for hash/,
    )
  })

  it('should throw error if response is invalid', async () => {
    mockedFetchJson.mock.mockImplementationOnce(() => Promise.resolve({}))

    await assert.rejects(
      async () => await getLbtcAttestation(approvedPayloadHash1, NetworkType.Testnet),
      /Could not find LBTC attestation for hash/,
    )
  })

  it('should throw error if response has no attestations field', async () => {
    mockedFetchJson.mock.mockImplementationOnce(() => Promise.resolve({ data: 'value' }))

    await assert.rejects(
      async () => await getLbtcAttestation(approvedPayloadHash1, NetworkType.Testnet),
      /Could not find LBTC attestation for hash/,
    )
  })

  it('should handle multiple attestations and return correct one', async () => {
    const result = await getLbtcAttestation(approvedPayloadHash2, NetworkType.Testnet)

    assert.equal(result.attestation, approvedPayloadAttestation2)
  })
})
