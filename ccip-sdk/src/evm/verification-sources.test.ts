import '../index.ts' // Register supported chains
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'

import {
  type JsonRpcApiProvider,
  AbiCoder,
  ZeroHash,
  concat,
  getAddress,
  hexlify,
  zeroPadValue,
} from 'ethers'

import type { CCIPAPIClient } from '../api/index.ts'
import type { Chain, ExecuteOpts } from '../chain.ts'
import { CCIPMessageNotVerifiedYetError } from '../errors/index.ts'
import { networkInfo } from '../networks.ts'
import { CCTP_V2_CCV_TAG } from '../offchain.ts'
import { type CCIPRequest, CCIPVersion } from '../types.ts'
import { fakeTransport } from '../verifiers/__mocks__/verifier.ts'
import { interfaces } from './const.ts'
import { encodeMessageV1 } from './messageCodec.ts'
import { encodeEVMTokenCcvData } from './offchain.ts'
import { EVMChain } from './index.ts'

const MESSAGE_ID = '0x' + '42'.repeat(32)
const OFFRAMP = '0x' + '0f'.repeat(20)
const ENCODED = '0x01ab'
const A = '0x345AEDB0988Ff1e897c26f9ad3AE84603Ed517E2'
const B = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
const PROXY = 'https://verifier.example'
const POLICY = { requiredCCVs: [A, B], optionalCCVs: [], optionalThreshold: 0 }

/** An EVMChain whose onchain policy read is stubbed; everything else is the real code path. */
class TestChain extends EVMChain {
  readonly seen: Parameters<Chain['getVerifications']>[0][] = []
  override async getVerifications(opts: Parameters<Chain['getVerifications']>[0]) {
    this.seen.push(opts)
    return {
      verificationPolicy: POLICY,
      verifications: await this.fetchCCVResults(opts.request.message.messageId, POLICY, {
        ...opts,
        indexer: [],
      }),
    }
  }
  resolve(opts: ExecuteOpts) {
    return this.resolveExecuteOpts(opts)
  }
}

function setup() {
  const apiClient = {
    getMessageById: mock.fn(() =>
      Promise.resolve({ lane: { version: CCIPVersion.V2_0 }, message: { messageId: MESSAGE_ID } }),
    ),
    getEncodedMessage: mock.fn(() =>
      Promise.resolve({ offRamp: OFFRAMP, encodedMessage: ENCODED }),
    ),
    getExecutionInput: mock.fn(() =>
      Promise.resolve({ offRamp: OFFRAMP, encodedMessage: ENCODED, verifications: [] }),
    ),
    getVerifications: () => Promise.reject(new CCIPMessageNotVerifiedYetError(MESSAGE_ID)),
  }
  const transport = fakeTransport({ [PROXY]: [{ ccvData: '0xbb', destAddress: B }] })
  const provider = {
    destroy: () => {},
    _getConnection: () => ({ url: 'http://stub.invalid' }),
  } as unknown as JsonRpcApiProvider
  const chain = new TestChain(provider, networkInfo('ethereum-testnet-sepolia'), {
    apiClient: apiClient as unknown as CCIPAPIClient,
    verifierTransport: transport,
  })
  return { chain, apiClient, transport }
}

describe('verification sources on the execute-by-messageId path', () => {
  it('collects verifications from ccvData and verifiers against the destination policy', async () => {
    const { chain, apiClient, transport } = setup()
    const resolved = await chain.resolve({
      messageId: MESSAGE_ID,
      ccvData: { [A.toLowerCase()]: '0xaa' },
      verifiers: [PROXY],
      gasLimit: 0,
    })

    assert.equal(resolved.offRamp, OFFRAMP)
    assert.deepEqual(resolved.input, {
      encodedMessage: ENCODED,
      verifications: [
        { ccvData: '0xaa', destAddress: A, sourceAddress: '' }, // key canonicalized
        { ccvData: '0xbb', destAddress: B, sourceAddress: '' },
      ],
    })
    // the verifier is contacted only for what ccvData and the managed sources left uncovered
    assert.deepEqual(transport.calls, [PROXY])
    assert.equal(apiClient.getExecutionInput.mock.callCount(), 0)
    const [opts] = chain.seen
    assert.equal(opts!.offRamp, OFFRAMP)
    assert.equal((opts!.request.message as { encodedMessage?: string }).encodedMessage, ENCODED)
  })

  it('keeps the API-only path when no extra sources are given', async () => {
    const { chain, apiClient } = setup()
    await chain.resolve({ messageId: MESSAGE_ID, gasLimit: 0 })
    assert.equal(apiClient.getExecutionInput.mock.callCount(), 1)
    assert.equal(apiClient.getEncodedMessage.mock.callCount(), 0)
    assert.equal(chain.seen.length, 0)
  })

  it('fetches the encoded message from the API for a request that lacks it', async () => {
    const { chain } = setup()
    const input = await chain.getExecutionInput({
      request: {
        lane: { version: CCIPVersion.V2_0 },
        message: { messageId: MESSAGE_ID }, // as from getMessageById
      } as unknown as CCIPRequest,
      verifications: { verificationPolicy: POLICY, verifications: [] },
    })
    assert.equal((input as { encodedMessage: string }).encodedMessage, ENCODED)
  })

  it('collects verifications locally when the API execution input is not verified yet', async () => {
    const { chain, apiClient } = setup()
    apiClient.getExecutionInput.mock.mockImplementation(() =>
      Promise.reject(new CCIPMessageNotVerifiedYetError(MESSAGE_ID)),
    )
    // the token-verifier fallback lives inside getVerifications; its result is what the retry uses
    Object.assign(chain, {
      getVerifications: mock.fn(async () => ({
        verificationPolicy: POLICY,
        verifications: [{ ccvData: '0xbb', destAddress: B, sourceAddress: '' }],
      })),
    })

    const resolved = await chain.resolve({ messageId: MESSAGE_ID, gasLimit: 0 })

    assert.equal(resolved.offRamp, OFFRAMP)
    assert.deepEqual(resolved.input, {
      encodedMessage: ENCODED,
      verifications: [{ ccvData: '0xbb', destAddress: B, sourceAddress: '' }],
    })
    assert.equal(apiClient.getExecutionInput.mock.callCount(), 1)
    assert.equal(apiClient.getEncodedMessage.mock.callCount(), 1)
  })
})

// ── token verifier fallback: composes CCTP/Lombard ccvData from the issuer attestation ──

const SOURCE_SELECTOR = 16423721717087811551n // solana-devnet
const DEST_SELECTOR = 16015286601757825753n // ethereum-testnet-sepolia
const TX_HASH = '0x' + 'ab'.repeat(32)
const RESOLVER = getAddress('0x' + '0f'.repeat(20))
const CCTP_IMPL = getAddress('0x' + 'c1'.repeat(20))
const LOMBARD_IMPL = getAddress('0x' + '1b'.repeat(20))
const CCTP_TAG = '0x91b3338e'
const LOMBARD_TAG = '0x5b9253ce'
const RECEIVER = '0x' + '22'.repeat(20)
const DEST_TOKEN = '0x' + '33'.repeat(20)
const ATTESTATION = '0x' + 'ab'.repeat(65)

const typeAndVersionSelector = interfaces.CCTPVerifier_v2_0.getFunction('typeAndVersion')!.selector
const inboundImplementationsSelector = interfaces.VersionedVerifierResolver_v2_0.getFunction(
  'getAllInboundImplementations',
)!.selector
const getDomainSelector = interfaces.CCTPVerifier_v2_0.getFunction('getDomain')!.selector

class FallbackChain extends EVMChain {
  callFallback(opts: Parameters<Chain['getVerifications']>[0], missingCCVs: readonly string[]) {
    return this.getTokenVerifierFallback(opts, missingCCVs)
  }
}

function encodedRequest(
  tokenExtraData: string,
  ccvs: { issuer: string; blob: string }[] = [],
): CCIPRequest {
  const sender = zeroPadValue(RECEIVER, 32)
  const encodedMessage = encodeMessageV1({
    sourceChainSelector: SOURCE_SELECTOR,
    destChainSelector: DEST_SELECTOR,
    ccipReceiveGasLimit: 0,
    finality: '0x00000000',
    sender,
    receiver: RECEIVER,
    tokenTransfer: {
      amount: 10_000n,
      destTokenAddress: DEST_TOKEN,
      extraData: tokenExtraData,
    },
  })
  return {
    lane: {
      sourceChainSelector: SOURCE_SELECTOR,
      destChainSelector: DEST_SELECTOR,
      onRamp: '0x' + '44'.repeat(20),
      version: CCIPVersion.V2_0,
    },
    message: {
      messageId: MESSAGE_ID,
      encodedMessage,
      receipts: ccvs.map(({ issuer }) => ({ issuer })),
      verifierBlobs: ccvs.map(({ blob }) => blob),
      sourceChainSelector: SOURCE_SELECTOR,
      tokenAmounts: [],
    },
    log: { transactionHash: TX_HASH, blockTimestamp: 0 },
  } as unknown as CCIPRequest
}

/** A provider answering just the CCV metadata reads the fallback makes. */
function makeProvider(implementations: Array<{ version: string; verifier: string; type: string }>) {
  return {
    call: mock.fn(async ({ to, data }: { to: string; data: string }) => {
      const selector = data.slice(0, 10)
      if (selector === typeAndVersionSelector) {
        if (getAddress(to) === RESOLVER) {
          return interfaces.CCTPVerifier_v2_0.encodeFunctionResult('typeAndVersion', [
            'VersionedVerifierResolver 2.0.0',
          ])
        }
        const impl = implementations.find((i) => getAddress(i.verifier) === getAddress(to))
        if (impl) {
          return interfaces.CCTPVerifier_v2_0.encodeFunctionResult('typeAndVersion', [impl.type])
        }
      }
      if (selector === inboundImplementationsSelector) {
        return interfaces.VersionedVerifierResolver_v2_0.encodeFunctionResult(
          'getAllInboundImplementations',
          [implementations.map(({ version, verifier }) => [version, verifier])],
        )
      }
      if (selector === getDomainSelector) {
        return interfaces.CCTPVerifier_v2_0.encodeFunctionResult('getDomain', [
          [ZeroHash, ZeroHash, ZeroHash, 5, true],
        ])
      }
      throw new Error(`unexpected call to ${to} with ${selector}`)
    }),
  }
}

function makeChain(provider: ReturnType<typeof makeProvider>) {
  const chain = Object.create(FallbackChain.prototype) as FallbackChain
  Object.assign(chain, {
    provider,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: networkInfo('ethereum-testnet-sepolia'),
    apiClient: undefined,
  })
  return chain
}

function cctpMessage() {
  return hexlify(concat([new Uint8Array(376), CCTP_TAG, MESSAGE_ID]))
}

describe('token verifier fallback', () => {
  const origFetch = globalThis.fetch
  let response: unknown

  const mockedFetch = mock.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve({ json: () => Promise.resolve(response) }),
  )

  beforeEach(() => {
    mockedFetch.mock.resetCalls()
    globalThis.fetch = mockedFetch as unknown as typeof globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = origFetch
    mockedFetch.mock.restore()
  })

  it('composes CCTP ccvData for a resolver with a CCTP implementation', async () => {
    response = {
      messages: [
        { status: 'complete', eventNonce: '0', attestation: ATTESTATION, message: cctpMessage() },
      ],
    }
    const chain = makeChain(
      makeProvider([{ version: CCTP_TAG, verifier: CCTP_IMPL, type: 'CCTPVerifier 2.1.0' }]),
    )

    const result = await chain.callFallback(
      { offRamp: getAddress('0x' + '55'.repeat(20)), request: encodedRequest(CCTP_V2_CCV_TAG) },
      [RESOLVER],
    )

    assert.equal(result.length, 1)
    assert.equal(result[0]!.destAddress, RESOLVER)
    assert.equal(
      result[0]!.ccvData,
      encodeEVMTokenCcvData(CCTP_TAG, {
        _tag: 'usdc',
        message: cctpMessage(),
        attestation: ATTESTATION,
      }),
    )
    // Circle was queried with the domain read from the CCTP verifier
    assert.match(mockedFetch.mock.calls[0]!.arguments[0] as string, /\/messages\/5\?/)
  })

  it('composes Lombard ccvData from the payload hash in the source verifierBlobs', async () => {
    // v2 Lombard pools return `abi.encode(decimals)`; the Lombard verifier's blob is the payload hash
    const payloadHash = '0x' + '1b'.repeat(32)
    const rawPayload = hexlify(concat(['0x' + 'cc'.repeat(165), LOMBARD_TAG, MESSAGE_ID]))
    const attestation = AbiCoder.defaultAbiCoder().encode(
      ['bytes', 'bytes'],
      [rawPayload, '0xddee'],
    )
    response = {
      attestations: [
        { message_hash: payloadHash, status: 'NOTARIZATION_STATUS_SESSION_APPROVED', attestation },
      ],
    }
    const chain = makeChain(
      makeProvider([
        { version: '0x00000001', verifier: CCTP_IMPL, type: 'CCTPVerifier 2.1.0' },
        { version: LOMBARD_TAG, verifier: LOMBARD_IMPL, type: 'LombardVerifier 2.1.0' },
      ]),
    )

    const result = await chain.callFallback(
      {
        offRamp: getAddress('0x' + '55'.repeat(20)),
        // a committee verifier's blob comes first; only the Lombard CCV's blob is looked up
        request: encodedRequest(AbiCoder.defaultAbiCoder().encode(['uint8'], [8]), [
          { issuer: '0x' + '2c'.repeat(20), blob: '0x' + '77'.repeat(32) },
          { issuer: RESOLVER, blob: payloadHash },
        ]),
      },
      [RESOLVER],
    )

    assert.equal(result.length, 1)
    assert.equal(result[0]!.destAddress, RESOLVER)
    assert.equal(
      result[0]!.ccvData,
      encodeEVMTokenCcvData(LOMBARD_TAG, { _tag: 'lbtc', attestation }),
    )
    // Lombard was asked about the Lombard CCV's blob alone
    assert.equal(mockedFetch.mock.calls.length, 1)
    assert.deepEqual(JSON.parse(mockedFetch.mock.calls[0]!.arguments[1]!.body as string), {
      messageHash: [payloadHash],
    })
  })

  it('returns nothing for LBTC without the source verifierBlobs', async () => {
    const chain = makeChain(
      makeProvider([
        { version: LOMBARD_TAG, verifier: LOMBARD_IMPL, type: 'LombardVerifier 2.1.0' },
      ]),
    )

    const result = await chain.callFallback(
      {
        offRamp: getAddress('0x' + '55'.repeat(20)),
        request: encodedRequest(AbiCoder.defaultAbiCoder().encode(['uint8'], [8])),
      },
      [RESOLVER],
    )

    assert.deepEqual(result, [])
    assert.equal(mockedFetch.mock.calls.length, 0)
  })

  it('returns nothing when the missing CCV has no token verifier', async () => {
    const chain = makeChain(
      makeProvider([
        { version: '0xe9a05a20', verifier: CCTP_IMPL, type: 'CommitteeVerifier 2.0.0' },
      ]),
    )

    const result = await chain.callFallback(
      { offRamp: getAddress('0x' + '55'.repeat(20)), request: encodedRequest(CCTP_V2_CCV_TAG) },
      [RESOLVER],
    )

    assert.deepEqual(result, [])
    assert.equal(mockedFetch.mock.calls.length, 0)
  })
})

describe('encodeEVMTokenCcvData', () => {
  const versionTag = '0x91b3338e'

  it('encodes CCTP ccvData as versionTag || message || attestation', () => {
    const message = cctpMessage()
    assert.equal(
      encodeEVMTokenCcvData(versionTag, { _tag: 'usdc', message, attestation: ATTESTATION }),
      hexlify(concat([versionTag, message, ATTESTATION])),
    )
  })

  it('rejects a non-4-byte version tag', () => {
    assert.throws(() =>
      encodeEVMTokenCcvData('0x1234', { _tag: 'usdc', message: '0x', attestation: '0x' }),
    )
  })

  it('encodes Lombard ccvData with length-prefixed payload and proof', () => {
    const rawPayload = '0xaabbcc'
    const proof = '0xddee'
    const attestation = AbiCoder.defaultAbiCoder().encode(['bytes', 'bytes'], [rawPayload, proof])
    assert.equal(
      encodeEVMTokenCcvData(versionTag, { _tag: 'lbtc', attestation }),
      hexlify(concat([versionTag, '0x0003', rawPayload, '0x0002', proof])),
    )
  })

  it('rejects a Lombard attestation that is not abi.encode(bytes, bytes)', () => {
    assert.throws(() => encodeEVMTokenCcvData(versionTag, { _tag: 'lbtc', attestation: '0x1234' }))
  })
})
