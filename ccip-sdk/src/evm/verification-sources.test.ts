import '../index.ts' // Register supported chains
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import type { JsonRpcApiProvider } from 'ethers'

import type { CCIPAPIClient } from '../api/index.ts'
import type { Chain, ExecuteOpts } from '../chain.ts'
import { CCIPMessageNotVerifiedYetError } from '../errors/index.ts'
import { networkInfo } from '../networks.ts'
import { type CCIPRequest, CCIPVersion } from '../types.ts'
import { fakeTransport } from '../verifiers/__mocks__/verifier.ts'
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
})
