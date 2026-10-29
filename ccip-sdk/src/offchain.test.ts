import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import { concat, hexlify } from 'ethers'

import { NetworkType } from './networks.ts'
import {
  CCTP_V2_CCV_TAG,
  getAttestedVersionTag,
  getLbtcAttestation,
  getLbtcPayloadHash,
  getOffchainTokenData,
  getUsdcAttestation,
  parseCctpV2ExtraData,
} from './offchain.ts'

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

describe('getOffchainTokenData', () => {
  const lbtcHashHex = '0x1bb7b6793a5d97c3d9e55cfee4122e417adcb8fd7df0491a4378e12937c74337'
  const lbtcHashBase64 = 'G7e2eTpdl8PZ5Vz+5BIuQXrcuP198EkaQ3jhKTfHQzc='
  const lbtcAttestation = '0xattestation1'

  const lombardResponse = {
    attestations: [
      {
        message_hash: lbtcHashHex,
        status: 'NOTARIZATION_STATUS_SESSION_APPROVED',
        attestation: lbtcAttestation,
      },
    ],
  }

  const mockedFetchJson = mock.fn(() => Promise.resolve(lombardResponse as any))
  const mockedFetch = mock.fn((_url: string, _opts?: any) =>
    Promise.resolve({ json: mockedFetchJson }),
  )

  const makeRequest = (extraData: string) => ({
    tx: { hash: '0xdeadbeef' },
    message: {
      sourceChainSelector: 16015286601757825753n, // Sepolia (testnet)
      tokenAmounts: [{ extraData }],
    },
  })

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

  it('should normalize base64 extraData to hex when fetching LBTC attestation', async () => {
    const request = makeRequest(lbtcHashBase64)

    const result = await getOffchainTokenData(request as any, { logger: { warn: () => {} } as any })

    assert.equal(mockedFetch.mock.calls.length, 1)
    const body = JSON.parse(mockedFetch.mock.calls[0]!.arguments[1]!.body)
    assert.deepEqual(body, { messageHash: [lbtcHashHex] })
    assert.equal(result[0]!._tag, 'lbtc')
    assert.equal(result[0]!.attestation, lbtcAttestation)
  })

  it('should handle hex extraData for LBTC attestation', async () => {
    const request = makeRequest(lbtcHashHex)

    const result = await getOffchainTokenData(request as any, { logger: { warn: () => {} } as any })

    assert.equal(mockedFetch.mock.calls.length, 1)
    const body = JSON.parse(mockedFetch.mock.calls[0]!.arguments[1]!.body)
    assert.deepEqual(body, { messageHash: [lbtcHashHex] })
    assert.equal(result[0]!._tag, 'lbtc')
    assert.equal(result[0]!.attestation, lbtcAttestation)
  })
})

describe('CCTP v2 helpers', () => {
  const messageId = '0x' + '42'.repeat(32)
  const versionTag = '0x91b3338e'
  const cctpMessage = hexlify(concat([new Uint8Array(376), versionTag, messageId]))

  it('should parse the 4-byte CCTP v2 tag', () => {
    assert.deepEqual(parseCctpV2ExtraData(CCTP_V2_CCV_TAG), { tag: CCTP_V2_CCV_TAG })
  })

  it('should parse the 40-byte CCTP v2 payload and its source domain', () => {
    const extraData = hexlify(concat([CCTP_V2_CCV_TAG, '0x00000005', '0x' + '11'.repeat(32)]))
    assert.deepEqual(parseCctpV2ExtraData(extraData), {
      tag: CCTP_V2_CCV_TAG,
      sourceDomain: 5,
    })
  })

  it('should reject payloads that are not CCTP v2', () => {
    assert.equal(parseCctpV2ExtraData('0x' + '00'.repeat(4)), undefined)
    assert.equal(parseCctpV2ExtraData('0x' + '00'.repeat(32)), undefined)
  })

  it('should read the version tag from the CCTP hook data', () => {
    assert.equal(getAttestedVersionTag(cctpMessage, messageId), versionTag)
  })

  it('should reject a CCTP message that does not end with the message id', () => {
    assert.equal(getAttestedVersionTag(cctpMessage, '0x' + '43'.repeat(32)), undefined)
  })

  it('should read the version tag from a Lombard bridged message', () => {
    const lombardPayload = hexlify(concat(['0x' + '00'.repeat(200), versionTag, messageId]))
    assert.equal(getAttestedVersionTag(lombardPayload, messageId), versionTag)
  })
})

describe('getUsdcAttestation by message id', () => {
  const messageId = '0x' + '42'.repeat(32)
  const origFetchFn = globalThis.fetch
  const mockedFetchJson = mock.fn(() =>
    Promise.resolve({
      messages: [
        {
          status: 'complete' as const,
          eventNonce: '1',
          attestation: '0xwrong',
          message: '0x' + '11'.repeat(32),
        },
        {
          status: 'complete' as const,
          eventNonce: '2',
          attestation: '0xright',
          message: hexlify(concat(['0x' + '00'.repeat(376), '0x91b3338e', messageId])),
        },
      ],
    }),
  )
  const mockedFetch = mock.fn(() => Promise.resolve({ json: mockedFetchJson }))

  beforeEach(() => {
    mockedFetch.mock.resetCalls()
    mockedFetchJson.mock.resetCalls()
    globalThis.fetch = mockedFetch as any
  })

  afterEach(() => {
    globalThis.fetch = origFetchFn
    mockedFetch.mock.restore()
    mockedFetchJson.mock.restore()
  })

  it('should select the CCTP message whose hook data carries the CCIP message id', async () => {
    const result = await getUsdcAttestation(
      { sourceDomain: 5, txHash: '0xdeadbeef', messageId },
      NetworkType.Testnet,
    )

    assert.equal(result.attestation, '0xright')
    assert.equal(mockedFetch.mock.calls.length, 1)
  })
})

describe('getOffchainTokenData for CCTP v2', () => {
  const messageId = '0x' + '42'.repeat(32)
  const versionTag = '0x91b3338e'
  const cctpMessage = hexlify(concat([new Uint8Array(376), versionTag, messageId]))
  const attestation = '0x' + 'ab'.repeat(65)
  const origFetchFn = globalThis.fetch
  const mockedFetchJson = mock.fn(() =>
    Promise.resolve({
      messages: [
        { status: 'complete' as const, eventNonce: '0', attestation, message: cctpMessage },
      ],
    }),
  )
  const mockedFetch = mock.fn((_url: string) => Promise.resolve({ json: mockedFetchJson }))

  function makeRequest(extraData: string) {
    return {
      log: { transactionHash: '0x' + 'ab'.repeat(32) },
      message: {
        sourceChainSelector: 16423721717087811551n, // solana-devnet (testnet)
        messageId,
        tokenAmounts: [{ extraData }],
      },
    }
  }

  beforeEach(() => {
    mockedFetch.mock.resetCalls()
    mockedFetchJson.mock.resetCalls()
    globalThis.fetch = mockedFetch as any
  })

  afterEach(() => {
    globalThis.fetch = origFetchFn
    mockedFetch.mock.restore()
    mockedFetchJson.mock.restore()
  })

  it('should use the supplied source domain for a 4-byte v2 payload', async () => {
    const result = await getOffchainTokenData(makeRequest(CCTP_V2_CCV_TAG) as any, {
      logger: { debug: () => {}, warn: () => {} } as any,
      usdcSourceDomain: 5,
    })

    assert.equal(mockedFetch.mock.calls[0]!.arguments[0]!.includes('/messages/5?'), true)
    assert.equal(result[0]!._tag, 'usdc')
    assert.equal(result[0]!.message, cctpMessage)
    assert.equal(result[0]!.attestation, attestation)
  })

  it('should read the source domain from a 40-byte v2 payload', async () => {
    const extraData = hexlify(concat([CCTP_V2_CCV_TAG, '0x00000005', '0x' + '11'.repeat(32)]))
    const result = await getOffchainTokenData(makeRequest(extraData) as any, {
      logger: { debug: () => {}, warn: () => {} } as any,
    })

    assert.equal(mockedFetch.mock.calls[0]!.arguments[0]!.includes('/messages/5?'), true)
    assert.equal(result[0]!._tag, 'usdc')
  })

  it('should skip a 4-byte v2 payload without a source-domain hint', async () => {
    const result = await getOffchainTokenData(makeRequest(CCTP_V2_CCV_TAG) as any, {
      logger: { debug: () => {}, warn: () => {} } as any,
    })

    assert.equal(mockedFetch.mock.calls.length, 0)
    assert.equal(result[0], undefined)
  })
})

describe('getLbtcPayloadHash', () => {
  // the receipts and verifierBlobs of a real Ethereum -> Monad LBTC v2 send
  const lombardResolver = '0xd314336866369adf98EDC14F95Ed05eD87CC74A8'
  const payloadHash = '0x5aa68f9d03e8227a6863ad17613bdfec46d9c0e98d3457ea1ddd6588caf6e2f6'
  const message = {
    receipts: [
      { issuer: lombardResolver },
      { issuer: '0x2CaAfd3B4Cf606220580c885Bd2B448FB93dC03b' }, // committee verifier
      { issuer: '0x626BdEe51E85A127eb6A08ed79c68a4b7AC80b4A' }, // token pool
      { issuer: '0x6608d995bBDE874De5292bFD289643c88D176ED3' }, // executor
    ],
    verifierBlobs: [payloadHash, '0xe9a05a20'],
  }

  it("should take the Lombard CCV's blob", () => {
    assert.equal(getLbtcPayloadHash(message, [lombardResolver.toLowerCase()]), payloadHash)
  })

  it("should not take another CCV's 32-byte blob", () => {
    const unrelated = {
      receipts: [
        { issuer: '0x2CaAfd3B4Cf606220580c885Bd2B448FB93dC03b' },
        { issuer: lombardResolver },
      ],
      verifierBlobs: ['0x' + '77'.repeat(32), '0x'],
    }
    assert.equal(getLbtcPayloadHash(unrelated, [lombardResolver]), undefined)
  })

  it('should find nothing when the request carries no source receipts', () => {
    assert.equal(getLbtcPayloadHash({}, [lombardResolver]), undefined)
    assert.equal(getLbtcPayloadHash({ verifierBlobs: [payloadHash] }, [lombardResolver]), undefined)
  })
})
