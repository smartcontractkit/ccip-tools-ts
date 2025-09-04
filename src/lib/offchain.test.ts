import { BN, web3 } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import { deserialize } from 'borsh'
import { Interface, getAddress, hexlify, id, keccak256, randomBytes } from 'ethers'

import TokenPoolABI from '../abi/BurnMintTokenPool_1_6_1.ts'
import {
  LBTC_EVENT,
  encodeOffchainTokenData,
  fetchOffchainTokenData,
  getUsdcAttestation,
  getUsdcAttestationV2,
} from './offchain.ts'
import type { CcipCctpMessageSentEvent } from './solana/types.ts'
import { type CCIPRequest, defaultAbiCoder } from './types.ts'
import { lazyCached } from './utils.ts'

const origFetch = global.fetch

interface DecodedCctpData {
  message: string
  attestation: string
}

beforeEach(() => {
  jest.clearAllMocks()
})

const TokenPoolInterface = lazyCached(
  `Interface BurnMintTokenPool 1.6.1`,
  () => new Interface(TokenPoolABI),
)
const BURNED_EVENT = TokenPoolInterface.getEvent('LockedOrBurned')!

describe('fetchOffchainTokenData', () => {
  const MESSAGE_SENT_TOPIC0 = id('MessageSent(bytes)')
  const TRANSFER_TOPIC0 = id('Transfer(address,address,uint256)')
  const usdcToken = getAddress(hexlify(randomBytes(20)))
  const sourcePoolAddress = getAddress(hexlify(randomBytes(20)))

  const mockedFetchJson = jest.fn<any, [], any>(() => ({
    status: 'complete',
    attestation: '0xa77e57a71090',
  }))
  const mockedFetch = jest.fn(() => ({ json: mockedFetchJson }))
  beforeAll(() => {
    global.fetch = mockedFetch as any
  })
  afterAll(() => {
    global.fetch = origFetch
  })

  it('should return offchain token data', async () => {
    const mockRequest = {
      lane: {
        sourceChainSelector: 16015286601757825753n,
        destChainSelector: 16015286601757825753n,
      },
      message: {
        tokenAmounts: [{ token: usdcToken, sourcePoolAddress, amount: 100n }],
      },
      log: { topics: ['0x123'], index: 9 },
      tx: {
        logs: [
          { topics: [TRANSFER_TOPIC0], index: 5, address: usdcToken },
          {
            topics: [MESSAGE_SENT_TOPIC0],
            index: 6,
            data: defaultAbiCoder.encode(['bytes'], ['0x1337']),
          },
          { topics: [], index: 7 },
          {
            topics: [BURNED_EVENT.topicHash],
            address: sourcePoolAddress,
            index: 8,
          },
        ],
      },
    }

    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(/^0x.*1337.*a77e57a71090/)
  })

  it('should return default token data if no USDC logs found', async () => {
    const mockRequest = {
      lane: { sourceChainSelector: 16015286601757825753n },
      message: {
        tokenAmounts: [{ token: usdcToken, sourcePoolAddress, amount: 100n }],
      },
      log: { topics: ['0x123'], index: 9 },
      tx: {
        logs: [
          { topics: [TRANSFER_TOPIC0], index: 5, address: usdcToken },
          {
            topics: [MESSAGE_SENT_TOPIC0],
            index: 6,
            data: defaultAbiCoder.encode(['bytes'], ['0x1337']),
          },
          { topics: [], index: 7 },
          {
            topics: [BURNED_EVENT.topicHash],
            address: sourcePoolAddress,
            index: 8,
          },
        ],
      },
    }
    mockedFetchJson.mockResolvedValueOnce({ error: 'Invalid message hash' })

    await expect(fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)).resolves.toEqual([
      '0x',
    ])
  })

  it('should return correct USDC attestations for multiple transfers', async () => {
    const otherToken = getAddress(hexlify(randomBytes(20)))
    const mockRequest = {
      lane: {
        sourceChainSelector: 16015286601757825753n,
        destChainSelector: 16015286601757825753n,
      },
      message: {
        tokenAmounts: [{ token: usdcToken, sourcePoolAddress, amount: 100n }],
      },
      log: { topics: ['0x123'], index: 11 },
      tx: {
        logs: [
          { topics: [TRANSFER_TOPIC0], index: 1, address: usdcToken },
          {
            topics: [MESSAGE_SENT_TOPIC0],
            index: 6,
            data: defaultAbiCoder.encode(['bytes'], ['0xbeef01']),
          },
          // another CCIPSendRequested event, indicating multiple messages in the same tx
          { topics: ['0x123'], index: 2, address: usdcToken },
          // our transfer
          { topics: [TRANSFER_TOPIC0], index: 3, address: usdcToken },
          {
            topics: [MESSAGE_SENT_TOPIC0],
            index: 4,
            data: defaultAbiCoder.encode(['bytes'], ['0xbeef02']),
          },
          { topics: [], index: 5 },
          {
            topics: [BURNED_EVENT.topicHash],
            address: sourcePoolAddress,
            index: 6,
          },
          // another "USDC-like" transfer in request, unrelated token
          { topics: [TRANSFER_TOPIC0], index: 7, address: otherToken },
          {
            topics: [MESSAGE_SENT_TOPIC0],
            index: 8,
            data: defaultAbiCoder.encode(['bytes'], ['0xbeef03']),
          },
          { topics: [], index: 9 },
          {
            topics: [BURNED_EVENT.topicHash],
            address: getAddress(hexlify(randomBytes(20))),
            index: 10,
          },
        ],
      },
    }

    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatch(/^0x.*beef02.*a77e57a71090/)
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining(keccak256('0xbeef02')))
  })
})

describe('fetchLbtcOffchainTokenData', () => {
  const approvedPayloadHash1 = '0x111114eb42fd24b59b6edf6c5aa6b9357be7dcaf91f1d62da303f1fad100762e'
  const approvedPayloadAttestation1 = hexlify(randomBytes(20))
  const approvedPayloadHash2 = '0x222224eb42fd24b59b6edf6c5aa6b9357be7dcaf91f1d62da303f1fad100762e'
  const approvedPayloadAttestation2 = hexlify(randomBytes(20))
  const pendingPayloadHash = '0x333334eb42fd24b59b6edf6c5aa6b9357be7dcaf91f1d62da303f1fad100762e'

  const mockedFetchJson = jest.fn<any, [], any>(() => ({
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
      { message_hash: pendingPayloadHash, status: 'NOTARIZATION_STATUS_SESSION_PENDING' },
    ],
  }))
  const mockedFetch = jest.fn(() => ({ json: mockedFetchJson }))
  beforeAll(() => {
    global.fetch = mockedFetch as any
  })
  afterAll(() => {
    global.fetch = origFetch
  })

  it('should skip if has no LBTC Deposit Event', async () => {
    const mockRequest = {
      lane: { sourceChainSelector: 16015286601757825753n },
      message: {
        tokenAmounts: [{ extraData: approvedPayloadHash1 }],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [],
      },
    }
    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('0x')
  })

  it('should return offchain token data', async () => {
    const mockRequest = {
      lane: { sourceChainSelector: 16015286601757825753n },
      message: {
        tokenAmounts: [{ extraData: approvedPayloadHash1 }],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          {
            topics: [LBTC_EVENT.topicHash, '0x', '0x', approvedPayloadHash1],
            index: 6,
            data: '0x',
          },
        ],
      },
    }
    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(approvedPayloadAttestation1)
  })

  it('should fallback if attestation is not found', async () => {
    const randomExtraData = '0x0000000000000000000000000000000000000000000000000000000000000000'
    const mockRequest = {
      lane: { sourceChainSelector: 16015286601757825753n },
      message: {
        tokenAmounts: [{ extraData: randomExtraData }],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          {
            topics: [LBTC_EVENT.topicHash, '0x', '0x', randomExtraData],
            index: 6,
            data: '0x',
          },
        ],
      },
    }
    await expect(fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)).resolves.toEqual([
      '0x',
    ])
  })

  it('should fallback if attestation is not approved', async () => {
    const mockRequest = {
      lane: { sourceChainSelector: 16015286601757825753n },
      message: {
        tokenAmounts: [{ extraData: pendingPayloadHash }],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          {
            topics: [LBTC_EVENT.topicHash, '0x', '0x', pendingPayloadHash],
            index: 6,
            data: '0x',
          },
        ],
      },
    }
    await expect(fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)).resolves.toEqual([
      '0x',
    ])
  })

  it('should return offchain token data multiple transfers', async () => {
    const mockRequest = {
      lane: { sourceChainSelector: 16015286601757825753n },
      message: {
        tokenAmounts: [{ extraData: approvedPayloadHash1 }, { extraData: approvedPayloadHash2 }],
      },
      log: { topics: ['0x123'], index: 7 },
      tx: {
        logs: [
          {
            topics: [LBTC_EVENT.topicHash, '0x', '0x', approvedPayloadHash1],
            index: 6,
            data: '0x',
          },
          {
            topics: [LBTC_EVENT.topicHash, '0x', '0x', approvedPayloadHash2],
            index: 7,
            data: '0x',
          },
        ],
      },
    }

    const result = await fetchOffchainTokenData(mockRequest as unknown as CCIPRequest)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(approvedPayloadAttestation1)
    expect(result[1]).toBe(approvedPayloadAttestation2)
  })
})

const LOG_MESSAGES_WITH_CCTP_EVENT = [
  // Mock a program data log that will be parsed as a CCTP event
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
  'Program log: Instruction: ApproveChecked',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4456 of 400000 compute units',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
  'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P invoke [1]',
  'Program log: Instruction: CcipSend',
  'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 invoke [2]',
  'Program log: Instruction: VerifyNotCursed',
  'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 consumed 6856 of 334355 compute units',
  'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 success',
  'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P invoke [2]',
  'Program log: Instruction: GetFee',
  'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P consumed 42625 of 283953 compute units',
  'Program return: FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P BpuIV/6rgYT7aH9jRhjANdrEOdwa6ztVmKDwAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAARAAAAOgDAAAVAAAAGB3PEEANAwAAAAAAAAAAAAAAAAAAQA0DAAAAAAAAAAAAAAAAAAAA',
  'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P success',
  'Program 11111111111111111111111111111111 invoke [2]',
  'Program 11111111111111111111111111111111 success',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
  'Program log: Instruction: SyncNative',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 3045 of 236593 compute units',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
  'Program log: Instruction: TransferChecked',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 6290 of 229827 compute units',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
  'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj invoke [2]',
  'Program log: Instruction: LockOrBurnTokens',
  'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 invoke [3]',
  'Program log: Instruction: VerifyNotCursed',
  'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 consumed 6856 of 141854 compute units',
  'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 success',
  'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 invoke [3]',
  'Program log: Instruction: DepositForBurnWithCaller',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [4]',
  'Program log: Instruction: Burn',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4753 of 99677 compute units',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
  'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd invoke [4]',
  'Program log: Instruction: SendMessageWithCaller',
  'Program 11111111111111111111111111111111 invoke [5]',
  'Program 11111111111111111111111111111111 success',
  'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd consumed 16752 of 89165 compute units',
  'Program return: CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd u3IAAAAAAAA=',
  'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd success',
  'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 invoke [4]',
  'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 consumed 3632 of 68445 compute units',
  'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 success',
  'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 consumed 61831 of 124597 compute units',
  'Program return: CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 u3IAAAAAAAA=',
  'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 success',
  'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
  'Program data: zyX7mu/lDkO0EMhfhz9z8NpxfMBabv1pr0AmN8PWxO7HlMQB6EyxngIAAAAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqc=',
  'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj consumed 147198 of 207001 compute units',
  'Program return: CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj IAAAAAAAAAAAAAAAAAAAABx9SxlssMewHXQ/vGEWqQI3nHI4QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU=',
  'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj success',
  'Program data: F01Jt3u5cznZGtnJT7pB3hAAAAAAAAAAo8UDYQrKqyx5ETU5ZS7RudurUBqArrxw9lzKnQYVdRHfN+OU4sfs49ka2clPukHeEAAAAAAAAAAKAAAAAAAAAI7+9vnm//kSmiTiIHPweCZoZb2Aw76BMKL4l6s/XTZeAAAAACAAAAAAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUBUAAAAYHc8QQA0DAAAAAAAAAAAAAAAAAAAGm4hX/quBhPtof2NGGMA12sQ53BrrO1WYoPAAAAAAAQEAAACyj5pu4elxk1FJg6M6L9oSK+l+h7GziUa6ZHUBTaWBEyAAAAAAAAAAAAAAAAAAAAAcfUsZbLDHsB10P7xhFqkCN5xyOEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAByuwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P consumed 341826 of 395544 compute units',
  'Program return: CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P o8UDYQrKqyx5ETU5ZS7RudurUBqArrxw9lzKnQYVdRE=',
  'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P success',
]

const LOG_MESSAGES_WITH_NON_CCTP_TOKEN = [
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
  'Program log: Instruction: ApproveChecked',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4455 of 400000 compute units',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
  'Program Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C invoke [1]',
  'Program log: Instruction: CcipSend',
  'Program RmnXLft1mSEwDgMKu2okYuHkiazxntFFcZFrrcXxYg7 invoke [2]',
  'Program log: Instruction: VerifyNotCursed',
  'Program RmnXLft1mSEwDgMKu2okYuHkiazxntFFcZFrrcXxYg7 consumed 6856 of 335561 compute units',
  'Program RmnXLft1mSEwDgMKu2okYuHkiazxntFFcZFrrcXxYg7 success',
  'Program FeeQPGkKDeRV1MgoYfMH6L8o3KeuYjwUZrgn4LRKfjHi invoke [2]',
  'Program log: Instruction: GetFee',
  'Program FeeQPGkKDeRV1MgoYfMH6L8o3KeuYjwUZrgn4LRKfjHi consumed 45947 of 278613 compute units',
  'Program return: FeeQPGkKDeRV1MgoYfMH6L8o3KeuYjwUZrgn4LRKfjHi BpuIV/6rgYT7aH9jRhjANdrEOdwa6ztVmKDwAAAAAAEMKC0AAAAAAAA+CBb50UsAAAAAAAAAAAABAAAAIAAAAJBfAQAVAAAAGB3PEAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAEA',
  'Program FeeQPGkKDeRV1MgoYfMH6L8o3KeuYjwUZrgn4LRKfjHi success',
  'Program 11111111111111111111111111111111 invoke [2]',
  'Program 11111111111111111111111111111111 success',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
  'Program log: Instruction: SyncNative',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 3045 of 227673 compute units',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
  'Program 11111111111111111111111111111111 invoke [2]',
  'Program 11111111111111111111111111111111 success',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
  'Program log: Instruction: TransferChecked',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 6263 of 215991 compute units',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
  'Program tttpKBqrXCCgKn8Rm5bcJtLBKfpZX16V3ENucSuP1RS invoke [2]',
  'Program log: Instruction: LockOrBurnTokens',
  'Program RmnXLft1mSEwDgMKu2okYuHkiazxntFFcZFrrcXxYg7 invoke [3]',
  'Program log: Instruction: VerifyNotCursed',
  'Program RmnXLft1mSEwDgMKu2okYuHkiazxntFFcZFrrcXxYg7 consumed 6856 of 158311 compute units',
  'Program RmnXLft1mSEwDgMKu2okYuHkiazxntFFcZFrrcXxYg7 success',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [3]',
  'Program log: Instruction: Burn',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4707 of 148994 compute units',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
  'Program data: zyX7mu/lDkOLgXnm9UdYCwoKHi07pQa/nTf2ULpiTFxW6h51FScPZRAnAAAAAAAADUtKF/xy7vqrTJS0fkv8L5qhgeHFQgq9hAS4RVQFe5g=',
  'Program tttpKBqrXCCgKn8Rm5bcJtLBKfpZX16V3ENucSuP1RS consumed 55756 of 197679 compute units',
  'Program return: tttpKBqrXCCgKn8Rm5bcJtLBKfpZX16V3ENucSuP1RS IAAAAAAAAAAAAAAAAAAAADjSVsiL0nyElynucrp8QTLKxWpHIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAG',
  'Program tttpKBqrXCCgKn8Rm5bcJtLBKfpZX16V3ENucSuP1RS success',
  'Program data: F01Jt3u5czn7lo8DcJEVuIcAAAAAAAAAk9ihk3guFtAaepRPGc9kqrVLlMjJjgMpfT0QhrWKIfnfN+OU4sfs4/uWjwNwkRW4hwAAAAAAAAAAAAAAAAAAAI7+9vnm//kSmiTiIHPweCZoZb2Aw76BMKL4l6s/XTZeAAAAACAAAAAAAAAAAAAAAAAAAACHAOnKjlD6M3WajAkw+lJJXEa/qBUAAAAYHc8QAAAAAAAAAAAAAAAAAAAAAAEGm4hX/quBhPtof2NGGMA12sQ53BrrO1WYoPAAAAAAAQEAAADWVyAwzvWkxPKUnYwShKT1O2fikfHbs2R/smOfX3zzGiAAAAAAAAAAAAAAAAAAAAA40lbIi9J8hJcp7nK6fEEyysVqRyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABhAnAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAABX5AMKC0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+CBb50UsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'Program Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C consumed 260290 of 395545 compute units',
  'Program return: Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C k9ihk3guFtAaepRPGc9kqrVLlMjJjgMpfT0QhrWKIfk=',
  'Program Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C success',
]

const LOG_MESSAGES_WITH_NO_TOKENS = [
  'Program Ccip8ZTcM2qHjVt8FYHtuCAqjc637yLKnsJ5q5r2e6eL invoke [1]',
  'Program log: Instruction: CcipSend',
  'Program RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8 invoke [2]',
  'Program log: Instruction: VerifyNotCursed',
  'Program RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8 consumed 5356 of 357799 compute units',
  'Program RmnAZiCJdaYtwR1f634Ba7yNJXuK3pS6kHuX4FgNgX8 success',
  'Program FeeQhewH1cd6ZyHqhfMiKAQntgzPT6bWwK26cJ5qSFo6 invoke [2]',
  'Program log: Instruction: GetFee',
  'Program FeeQhewH1cd6ZyHqhfMiKAQntgzPT6bWwK26cJ5qSFo6 consumed 26291 of 347823 compute units',
  'Program return: FeeQhewH1cd6ZyHqhfMiKAQntgzPT6bWwK26cJ5qSFo6 BpuIV/6rgYT7aH9jRhjANdrEOdwa6ztVmKDwAAAAAAGCSAoAAAAAAAAa7BmdYxEAAAAAAAAAAAAAAAAAFQAAABgdzxAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAABAA==',
  'Program FeeQhewH1cd6ZyHqhfMiKAQntgzPT6bWwK26cJ5qSFo6 success',
  'Program 11111111111111111111111111111111 invoke [2]',
  'Program 11111111111111111111111111111111 success',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
  'Program log: Instruction: SyncNative',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 3045 of 316923 compute units',
  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
  'Program data: F01Jt3u5cznZGtnJT7pB3sYIAAAAAAAALDJaqIc6iH7uQDQflveID88orTwzH3cETudEKbJOM+LfN+OU4sfs49ka2clPukHexggAAAAAAAAAAAAAAAAAAI7+9vnm//kSmiTiIHPweCZoZb2Aw76BMKL4l6s/XTZeDgAAAG1zZyBTT0wgdG8gRVRIIAAAAAAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQFQAAABgdzxAAAAAAAAAAAAAAAAAAAAAAAQabiFf+q4GE+2h/Y0YYwDXaxDncGus7VZig8AAAAAABAAAAAIJICgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABrsGZ1jEQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  'Program Ccip8ZTcM2qHjVt8FYHtuCAqjc637yLKnsJ5q5r2e6eL consumed 90323 of 400000 compute units',
  'Program return: Ccip8ZTcM2qHjVt8FYHtuCAqjc637yLKnsJ5q5r2e6eL LDJaqIc6iH7uQDQflveID88orTwzH3cETudEKbJOM+I=',
  'Program Ccip8ZTcM2qHjVt8FYHtuCAqjc637yLKnsJ5q5r2e6eL success',
  'Program ComputeBudget111111111111111111111111111111 invoke [1]',
  'Program ComputeBudget111111111111111111111111111111 success',
]

describe('fetchSolanaOffchainTokenData', () => {
  const SOLANA_DEVNET_SELECTOR = 16423721717087811551n
  const EVM_TESTNET_SELECTOR = 16015286601757825753n

  const mockedFetchJson = jest.fn()
  const mockedFetch = jest.fn(() => ({ json: mockedFetchJson }))

  // Mock Solana Web3 to prevent real RPC calls
  const mockConnection = {
    getTransaction: jest.fn(),
  }
  const mockSolanaWeb3 = {
    ...web3,
    Connection: jest.fn(() => mockConnection),
  }

  beforeAll(() => {
    global.fetch = mockedFetch as any

    // Clear any existing mocks first
    jest.resetModules()

    // Mock the entire @solana/web3.js module
    jest.doMock('@solana/web3.js', () => mockSolanaWeb3)
  })
  afterAll(() => {
    global.fetch = origFetch

    // Clean up mocks
    jest.dontMock('@solana/web3.js')
    jest.resetModules()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    // Reset the mock implementation for each test
    mockConnection.getTransaction.mockClear()
  })

  it('should return correctly encoded offchainTokenData for a successful transfer to EVM', async () => {
    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')

    mockConnection.getTransaction.mockResolvedValue({
      meta: {
        logMessages: LOG_MESSAGES_WITH_CCTP_EVENT,
        err: null,
      },
    })

    // Use real Circle API values from the actual Solana CCTP transaction
    // https://explorer.solana.com/tx/3k81TLhJuhwB8fvurCwyMPHXR3k9Tmtqe2ZrUQ8e3rMxk9fWFJT2xVHGgKJg1785FkJcaiQkthY4m86JrESGPhMY?cluster=devnet
    const expectedMessageHash = '0xcda5c1abd6640256fd2c837447c355fad6ed7fe6a32880076ad32e6f5821ed1a'
    const expectedAttestation =
      '0x6e70be5cacd093bca66e53837c51543d1829ee065dd6dfe085f3b706b16d56b80a01c3564a53f8864f1d4c1990298558ec45a93331d423d1bd8f964232d65fba1c0a65d1c09e05a1c059e7114c56a24dffbe155a86bc9a9377a20d4460be109d547df9a132d46ec632ae8976f6bfe6739bd25cb47a79bf0d77d6860d709aa62cf81b'

    // mock real attestation return
    mockedFetchJson.mockResolvedValueOnce({
      status: 'complete',
      attestation: expectedAttestation,
    })

    const mockRequest = {
      lane: {
        sourceChainSelector: SOLANA_DEVNET_SELECTOR,
        destChainSelector: EVM_TESTNET_SELECTOR,
      },
      message: {
        destinationChainSelector: EVM_TESTNET_SELECTOR,
        tokenAmounts: [
          {
            // there is a tokenAmount as it is a token transfer, though not bothering to write here the attributes in it
          },
        ],
      },
      log: { transactionHash: 'solana-tx-hash' },
    }

    const result = await fetchSolanaOffchainTokenData(mockRequest as any)

    // Decode and inspect the ABI-encoded result
    const decoded = defaultAbiCoder.decode(
      ['tuple(bytes message, bytes attestation)'],
      result[0],
    ) as unknown as [DecodedCctpData]

    // Verify the structure
    expect(decoded[0]).toHaveProperty('message')
    expect(decoded[0]).toHaveProperty('attestation')

    // The message should be the hex-encoded CCTP message from the mocked transaction
    expect(decoded[0].message).toMatch(/^0x[0-9a-fA-F]+$/)
    expect(decoded[0].message.length).toBeGreaterThan(2) // More than just "0x"

    // Verify it's the actual message from the real Solana transaction
    const expectedMessageBytes = Buffer.from(
      'AAAAAAAAAAUAAAAAAAAAAAAAcrumX8lDQZpa1ZAEL9Z8l5H9AVrPU6VMyCPtuP+Bue1yLgAAAAAAAAAAAAAAAJ87hnnHPC/vi1m080RNThVvtwqlAAAAAAAAAAAAAAAAvSfNq1yRCbM5CyW03/fZcJGMxVAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqcAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC8POk+EYwosdiROyhgxs5wu4nhPwHzJzOFm1MxIADj1M=',
      'base64',
    )
    const expectedMessageHex = '0x' + expectedMessageBytes.toString('hex')
    expect(decoded[0].message).toBe(expectedMessageHex)

    // The attestation should be the real attestation from Circle API
    expect(decoded[0].attestation).toBe(expectedAttestation)

    // Verify Solana RPC was called
    expect(mockConnection.getTransaction).toHaveBeenCalledWith('solana-tx-hash', {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    })

    // Verify Circle API was called with the correct message hash
    expect(mockedFetch).toHaveBeenCalledWith(
      `https://iris-api-sandbox.circle.com/v1/attestations/${expectedMessageHash}`,
    )
  })

  it('should return default token data if there is no token transfer', async () => {
    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')

    mockConnection.getTransaction.mockResolvedValue({
      meta: {
        logMessages: LOG_MESSAGES_WITH_NO_TOKENS,
        err: null,
      },
    })

    const mockRequest = {
      lane: { sourceChainSelector: SOLANA_DEVNET_SELECTOR },
      message: {},
      log: { transactionHash: 'solana-tx-hash-no-tokens' },
    }

    const result = await fetchSolanaOffchainTokenData(mockRequest as any)
    expect(result).toEqual([])

    // Verify Solana RPC was not called, as it short-circuits when there are no token transfers
    expect(mockConnection.getTransaction).not.toHaveBeenCalled()
  })

  it('should return default token data if there is a token transfer but no CCTP events are found', async () => {
    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')

    mockConnection.getTransaction.mockResolvedValue({
      meta: {
        logMessages: LOG_MESSAGES_WITH_NON_CCTP_TOKEN,
        err: null,
      },
    })

    const mockRequest = {
      lane: { sourceChainSelector: SOLANA_DEVNET_SELECTOR },
      message: { tokenAmounts: [{}] },
      log: { transactionHash: 'solana-tx-hash-no-cctp' },
    }

    const result = await fetchSolanaOffchainTokenData(mockRequest as any)
    expect(result).toEqual(['0x'])

    // Verify Solana RPC was called
    expect(mockConnection.getTransaction).toHaveBeenCalledWith('solana-tx-hash-no-cctp', {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    })
  })

  it('should throw an error if there is more than one token transferred', async () => {
    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')

    // Mock transaction with multiple CCTP events
    mockConnection.getTransaction.mockResolvedValue({
      meta: {
        logMessages: [],
        err: null,
      },
    })

    const mockRequest = {
      lane: { sourceChainSelector: SOLANA_DEVNET_SELECTOR },
      message: { tokenAmounts: [{}, {}] }, // two token transfers
      log: { transactionHash: 'solana-tx-hash-multiple-transfers' },
    }

    await expect(fetchSolanaOffchainTokenData(mockRequest as any)).rejects.toThrow(
      'Expected at most 1 token transfer, found 2',
    )

    // Verify Solana RPC was called
    expect(mockConnection.getTransaction).not.toHaveBeenCalled()
  })

  it('should throw an error if more than one CCTP event is found', async () => {
    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')

    // Mock transaction with multiple CCTP events
    mockConnection.getTransaction.mockResolvedValue({
      meta: {
        logMessages: [
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
          'Program log: Instruction: ApproveChecked',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4456 of 400000 compute units',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P invoke [1]',
          'Program log: Instruction: CcipSend',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 invoke [2]',
          'Program log: Instruction: VerifyNotCursed',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 consumed 6856 of 334355 compute units',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 success',
          'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P invoke [2]',
          'Program log: Instruction: GetFee',
          'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P consumed 42625 of 283953 compute units',
          'Program return: FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P BpuIV/6rgYT7aH9jRhjANdrEOdwa6ztVmKDwAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAARAAAAOgDAAAVAAAAGB3PEEANAwAAAAAAAAAAAAAAAAAAQA0DAAAAAAAAAAAAAAAAAAAA',
          'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P success',
          'Program 11111111111111111111111111111111 invoke [2]',
          'Program 11111111111111111111111111111111 success',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
          'Program log: Instruction: SyncNative',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 3045 of 236593 compute units',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
          'Program log: Instruction: TransferChecked',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 6290 of 229827 compute units',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj invoke [2]',
          'Program log: Instruction: LockOrBurnTokens',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 invoke [3]',
          'Program log: Instruction: VerifyNotCursed',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 consumed 6856 of 141854 compute units',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 success',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 invoke [3]',
          'Program log: Instruction: DepositForBurnWithCaller',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [4]',
          'Program log: Instruction: Burn',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4753 of 99677 compute units',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd invoke [4]',
          'Program log: Instruction: SendMessageWithCaller',
          'Program 11111111111111111111111111111111 invoke [5]',
          'Program 11111111111111111111111111111111 success',
          'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd consumed 16752 of 89165 compute units',
          'Program return: CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd u3IAAAAAAAA=',
          'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd success',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 invoke [4]',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 consumed 3632 of 68445 compute units',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 success',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 consumed 61831 of 124597 compute units',
          'Program return: CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 u3IAAAAAAAA=',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 success',
          // First event
          'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
          // Duplicate (for testing)
          'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
          'Program data: zyX7mu/lDkO0EMhfhz9z8NpxfMBabv1pr0AmN8PWxO7HlMQB6EyxngIAAAAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqc=',
          'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj consumed 147198 of 207001 compute units',
          'Program return: CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj IAAAAAAAAAAAAAAAAAAAABx9SxlssMewHXQ/vGEWqQI3nHI4QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU=',
          'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj success',
          'Program data: F01Jt3u5cznZGtnJT7pB3hAAAAAAAAAAo8UDYQrKqyx5ETU5ZS7RudurUBqArrxw9lzKnQYVdRHfN+OU4sfs49ka2clPukHeEAAAAAAAAAAKAAAAAAAAAI7+9vnm//kSmiTiIHPweCZoZb2Aw76BMKL4l6s/XTZeAAAAACAAAAAAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUBUAAAAYHc8QQA0DAAAAAAAAAAAAAAAAAAAGm4hX/quBhPtof2NGGMA12sQ53BrrO1WYoPAAAAAAAQEAAACyj5pu4elxk1FJg6M6L9oSK+l+h7GziUa6ZHUBTaWBEyAAAAAAAAAAAAAAAAAAAAAcfUsZbLDHsB10P7xhFqkCN5xyOEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAByuwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P consumed 341826 of 395544 compute units',
          'Program return: CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P o8UDYQrKqyx5ETU5ZS7RudurUBqArrxw9lzKnQYVdRE=',
          'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P success',
        ],
        err: null,
      },
    })

    const mockRequest = {
      lane: { sourceChainSelector: SOLANA_DEVNET_SELECTOR },
      message: { tokenAmounts: [{}] }, // 1 token transfer but two events (should never happen)
      log: { transactionHash: 'solana-tx-hash-multiple' },
    }

    await expect(fetchSolanaOffchainTokenData(mockRequest as any)).rejects.toThrow(
      'Expected only 1 CcipCctpMessageSentEvent, found 2 in transaction solana-tx-hash-multiple.',
    )

    // Verify Solana RPC was called
    expect(mockConnection.getTransaction).toHaveBeenCalledWith('solana-tx-hash-multiple', {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    })
  })

  it('should return default token data if attestation fetch fails', async () => {
    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')

    // Mock successful CCTP event parsing but failed attestation fetch
    mockConnection.getTransaction.mockResolvedValue({
      meta: {
        logMessages: LOG_MESSAGES_WITH_CCTP_EVENT,
        err: null,
      },
    })

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    // Mock fetch to fail for this test
    mockedFetchJson.mockRejectedValueOnce(new Error('API is down'))

    const mockRequest = {
      lane: {
        sourceChainSelector: SOLANA_DEVNET_SELECTOR,
        destChainSelector: EVM_TESTNET_SELECTOR,
      },
      message: {
        destinationChainSelector: EVM_TESTNET_SELECTOR,
        tokenAmounts: [{}],
      },
      log: { transactionHash: 'solana-tx-hash-fail' },
    }

    const result = await fetchSolanaOffchainTokenData(mockRequest as any)
    expect(result).toEqual(['0x'])
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '❌ Solana CCTP: Failed to fetch attestation for solana-tx-hash-fail:',
      expect.any(Error),
    )

    // Verify Solana RPC was called
    expect(mockConnection.getTransaction).toHaveBeenCalledWith('solana-tx-hash-fail', {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    })

    consoleWarnSpy.mockRestore()
  })

  it('should throw an error if transaction hash is missing', async () => {
    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')

    const mockRequest = {
      lane: { sourceChainSelector: SOLANA_DEVNET_SELECTOR },
      message: { tokenAmounts: [{}] },
      log: { transactionHash: undefined }, // Missing transaction hash
    }

    await expect(fetchSolanaOffchainTokenData(mockRequest as any)).rejects.toThrow(
      'Transaction hash not found for OffchainTokenData parsing',
    )

    // Verify that no Solana RPC call was made since the function should fail early
    expect(mockConnection.getTransaction).not.toHaveBeenCalled()
  })

  it('should handle Circle API returning incomplete status', async () => {
    const { fetchSolanaOffchainTokenData } = await import('./offchain.ts')

    // Mock successful CCTP event parsing but Circle API returns incomplete status
    mockConnection.getTransaction.mockResolvedValue({
      meta: {
        logMessages: LOG_MESSAGES_WITH_CCTP_EVENT,
        err: null,
      },
    })

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    // Mock Circle API to return incomplete status (will cause getUsdcAttestation to throw)
    mockedFetchJson.mockResolvedValueOnce({
      status: 'incomplete',
    })

    const mockRequest = {
      lane: {
        sourceChainSelector: SOLANA_DEVNET_SELECTOR,
        destChainSelector: EVM_TESTNET_SELECTOR,
      },
      message: {
        destinationChainSelector: EVM_TESTNET_SELECTOR,
        tokenAmounts: [{}],
      },
      log: { transactionHash: 'solana-tx-hash-pending' },
    }

    const result = await fetchSolanaOffchainTokenData(mockRequest as any)
    expect(result).toEqual(['0x'])
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '❌ Solana CCTP: Failed to fetch attestation for solana-tx-hash-pending:',
      expect.any(Error),
    )

    // Verify Solana RPC was called
    expect(mockConnection.getTransaction).toHaveBeenCalledWith('solana-tx-hash-pending', {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    })

    consoleWarnSpy.mockRestore()
  })
})

describe('parseCcipCctpEvents', () => {
  const SOLANA_DEVNET_SELECTOR = 16423721717087811551n

  const mockConnection = {
    getTransaction: jest.fn(),
  }

  const mockSolanaWeb3 = {
    ...web3,
    Connection: jest.fn(() => mockConnection),
  }

  const mockSolanaTransaction = {
    meta: {
      logMessages: LOG_MESSAGES_WITH_CCTP_EVENT,
      err: null,
    },
  }

  beforeAll(() => {
    jest.doMock('@solana/web3.js', () => mockSolanaWeb3)
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockConnection.getTransaction.mockResolvedValue(mockSolanaTransaction)
  })

  it('should successfully parse single CCTP event from real Solana transaction', async () => {
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    const result = await parseCcipCctpEvents(
      '3k81TLhJuhwB8fvurCwyMPHXR3k9Tmtqe2ZrUQ8e3rMxk9fWFJT2xVHGgKJg1785FkJcaiQkthY4m86JrESGPhMY',
      SOLANA_DEVNET_SELECTOR,
    )

    expect(result).toHaveLength(1) // Should find exactly 1 CCTP event
    expect(result[0]).toMatchObject({
      remoteChainSelector: new BN('16015286601757825753'),
      originalSender: new PublicKey('AdCPLpAoBYtbpRJaDDm6MFrLCykKpYUXNJ2tkoPv1X1P'),
      eventAddress: new PublicKey('C68qsUiKJyGD3SxWjN6pSkH9jwVJfrDvQDaGeGBzPueG'),
      messageSentBytes: Buffer.from(
        'AAAAAAAAAAUAAAAAAAAAAAAAcrumX8lDQZpa1ZAEL9Z8l5H9AVrPU6VMyCPtuP+Bue1yLgAAAAAAAAAAAAAAAJ87hnnHPC/vi1m080RNThVvtwqlAAAAAAAAAAAAAAAAvSfNq1yRCbM5CyW03/fZcJGMxVAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqcAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC8POk+EYwosdiROyhgxs5wu4nhPwHzJzOFm1MxIADj1M=',
        'base64',
      ),
    } as Partial<CcipCctpMessageSentEvent>)
    // compare BNs separately, to use the type-specific .eq for comparison
    expect(result[0].msgTotalNonce.eq(new BN('10'))).toBe(true)
    expect(result[0].cctpNonce.eq(new BN('29371'))).toBe(true)

    // Verify RPC call
    expect(mockConnection.getTransaction).toHaveBeenCalledWith(
      '3k81TLhJuhwB8fvurCwyMPHXR3k9Tmtqe2ZrUQ8e3rMxk9fWFJT2xVHGgKJg1785FkJcaiQkthY4m86JrESGPhMY',
      {
        commitment: 'finalized',
        maxSupportedTransactionVersion: 0,
      },
    )
  })

  it('should throw an error when transaction not found', async () => {
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    mockConnection.getTransaction.mockResolvedValueOnce(null)

    await expect(
      parseCcipCctpEvents('invalid-tx-signature', SOLANA_DEVNET_SELECTOR),
    ).rejects.toThrow('Transaction not found: invalid-tx-signature')
  })

  it('should return empty array when no program data logs found', async () => {
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    const transactionWithoutProgramData = {
      ...mockSolanaTransaction,
      meta: {
        logMessages: [
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
          'Program log: Instruction: Transfer',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          // No "Program data:" logs
        ],
        err: null,
      },
    }

    mockConnection.getTransaction.mockResolvedValueOnce(transactionWithoutProgramData)

    const result = await parseCcipCctpEvents('tx-without-program-data', SOLANA_DEVNET_SELECTOR)
    expect(result).toEqual([])
  })

  it('should return empty array when no CCTP events found', async () => {
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    const transactionWithoutCCTP = {
      ...mockSolanaTransaction,
      meta: {
        logMessages: [
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
          'Program data: zyX7mu/lDkO0EMhfhz9z8NpxfMBabv1pr0AmN8PWxO7HlMQB6EyxngIAAAAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqc=', // Non-CCTP event
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
        ],
        err: null,
      },
    }

    mockConnection.getTransaction.mockResolvedValueOnce(transactionWithoutCCTP)

    const result = await parseCcipCctpEvents('tx-without-cctp', SOLANA_DEVNET_SELECTOR)
    expect(result).toEqual([])
  })

  it('should handle multiple CCTP events', async () => {
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    const transactionWithMultipleCCTP = {
      ...mockSolanaTransaction,
      meta: {
        logMessages: [
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
          'Program log: Instruction: ApproveChecked',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4456 of 400000 compute units',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P invoke [1]',
          'Program log: Instruction: CcipSend',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 invoke [2]',
          'Program log: Instruction: VerifyNotCursed',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 consumed 6856 of 334355 compute units',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 success',
          'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P invoke [2]',
          'Program log: Instruction: GetFee',
          'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P consumed 42625 of 283953 compute units',
          'Program return: FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P BpuIV/6rgYT7aH9jRhjANdrEOdwa6ztVmKDwAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAARAAAAOgDAAAVAAAAGB3PEEANAwAAAAAAAAAAAAAAAAAAQA0DAAAAAAAAAAAAAAAAAAAA',
          'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P success',
          'Program 11111111111111111111111111111111 invoke [2]',
          'Program 11111111111111111111111111111111 success',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
          'Program log: Instruction: SyncNative',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 3045 of 236593 compute units',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
          'Program log: Instruction: TransferChecked',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 6290 of 229827 compute units',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj invoke [2]',
          'Program log: Instruction: LockOrBurnTokens',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 invoke [3]',
          'Program log: Instruction: VerifyNotCursed',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 consumed 6856 of 141854 compute units',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 success',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 invoke [3]',
          'Program log: Instruction: DepositForBurnWithCaller',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [4]',
          'Program log: Instruction: Burn',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4753 of 99677 compute units',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd invoke [4]',
          'Program log: Instruction: SendMessageWithCaller',
          'Program 11111111111111111111111111111111 invoke [5]',
          'Program 11111111111111111111111111111111 success',
          'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd consumed 16752 of 89165 compute units',
          'Program return: CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd u3IAAAAAAAA=',
          'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd success',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 invoke [4]',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 consumed 3632 of 68445 compute units',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 success',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 consumed 61831 of 124597 compute units',
          'Program return: CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 u3IAAAAAAAA=',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 success',
          // First event
          'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
          // Duplicate (for testing)
          'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
          'Program data: zyX7mu/lDkO0EMhfhz9z8NpxfMBabv1pr0AmN8PWxO7HlMQB6EyxngIAAAAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqc=',
          'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj consumed 147198 of 207001 compute units',
          'Program return: CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj IAAAAAAAAAAAAAAAAAAAABx9SxlssMewHXQ/vGEWqQI3nHI4QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU=',
          'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj success',
          'Program data: F01Jt3u5cznZGtnJT7pB3hAAAAAAAAAAo8UDYQrKqyx5ETU5ZS7RudurUBqArrxw9lzKnQYVdRHfN+OU4sfs49ka2clPukHeEAAAAAAAAAAKAAAAAAAAAI7+9vnm//kSmiTiIHPweCZoZb2Aw76BMKL4l6s/XTZeAAAAACAAAAAAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUBUAAAAYHc8QQA0DAAAAAAAAAAAAAAAAAAAGm4hX/quBhPtof2NGGMA12sQ53BrrO1WYoPAAAAAAAQEAAACyj5pu4elxk1FJg6M6L9oSK+l+h7GziUa6ZHUBTaWBEyAAAAAAAAAAAAAAAAAAAAAcfUsZbLDHsB10P7xhFqkCN5xyOEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAByuwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P consumed 341826 of 395544 compute units',
          'Program return: CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P o8UDYQrKqyx5ETU5ZS7RudurUBqArrxw9lzKnQYVdRE=',
          'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P success',
        ],
        err: null,
      },
    }

    mockConnection.getTransaction.mockResolvedValueOnce(transactionWithMultipleCCTP)

    const result = await parseCcipCctpEvents('tx-with-multiple-cctp', SOLANA_DEVNET_SELECTOR)
    expect(result).toHaveLength(2) // Should find same CCTP event two times

    const expectedCctpEvent: Partial<CcipCctpMessageSentEvent> = {
      remoteChainSelector: new BN(16015286601757825753n),
      originalSender: new PublicKey('AdCPLpAoBYtbpRJaDDm6MFrLCykKpYUXNJ2tkoPv1X1P'),
      eventAddress: new PublicKey('C68qsUiKJyGD3SxWjN6pSkH9jwVJfrDvQDaGeGBzPueG'),
      messageSentBytes: Buffer.from(
        'AAAAAAAAAAUAAAAAAAAAAAAAcrumX8lDQZpa1ZAEL9Z8l5H9AVrPU6VMyCPtuP+Bue1yLgAAAAAAAAAAAAAAAJ87hnnHPC/vi1m080RNThVvtwqlAAAAAAAAAAAAAAAAvSfNq1yRCbM5CyW03/fZcJGMxVAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqcAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC8POk+EYwosdiROyhgxs5wu4nhPwHzJzOFm1MxIADj1M=',
        'base64',
      ),
    }

    // Assert that both found events match the expected object
    expect(result[0]).toMatchObject(expectedCctpEvent)
    expect(result[1]).toMatchObject(expectedCctpEvent)
  })

  it('should handle malformed data gracefully', async () => {
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    const transactionWithMalformedData = {
      ...mockSolanaTransaction,
      meta: {
        logMessages: [
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
          'Program log: Instruction: ApproveChecked',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4456 of 400000 compute units',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P invoke [1]',
          'Program log: Instruction: CcipSend',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 invoke [2]',
          'Program log: Instruction: VerifyNotCursed',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 consumed 6856 of 334355 compute units',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 success',
          'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P invoke [2]',
          'Program log: Instruction: GetFee',
          'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P consumed 42625 of 283953 compute units',
          'Program return: FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P BpuIV/6rgYT7aH9jRhjANdrEOdwa6ztVmKDwAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAARAAAAOgDAAAVAAAAGB3PEEANAwAAAAAAAAAAAAAAAAAAQA0DAAAAAAAAAAAAAAAAAAAA',
          'Program FeeQRpcGNfzR76kX7uCKhAfGtripotrJEuxbxaVPtV3P success',
          'Program 11111111111111111111111111111111 invoke [2]',
          'Program 11111111111111111111111111111111 success',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
          'Program log: Instruction: SyncNative',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 3045 of 236593 compute units',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]',
          'Program log: Instruction: TransferChecked',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 6290 of 229827 compute units',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj invoke [2]',
          'Program log: Instruction: LockOrBurnTokens',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 invoke [3]',
          'Program log: Instruction: VerifyNotCursed',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 consumed 6856 of 141854 compute units',
          'Program RmnVVyLZ7o9vZoBC1vCpBsh4SDDGCGPppyZioGp3gT9 success',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 invoke [3]',
          'Program log: Instruction: DepositForBurnWithCaller',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [4]',
          'Program log: Instruction: Burn',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4753 of 99677 compute units',
          'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success',
          'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd invoke [4]',
          'Program log: Instruction: SendMessageWithCaller',
          'Program 11111111111111111111111111111111 invoke [5]',
          'Program 11111111111111111111111111111111 success',
          'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd consumed 16752 of 89165 compute units',
          'Program return: CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd u3IAAAAAAAA=',
          'Program CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd success',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 invoke [4]',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 consumed 3632 of 68445 compute units',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 success',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 consumed 61831 of 124597 compute units',
          'Program return: CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 u3IAAAAAAAA=',
          'Program CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 success',
          // This will fail Base64 decoding
          'Program data: invalid_base64_data!!!',
          // This is valid Base64 but not a CCTP event (wrong discriminator)
          'Program data: AQIDBAUGBwgJCg==',
          // This is 4 bytes, less than 8 needed for discriminator
          'Program data: VGVzdA==',
          // This is the actual, valid CCTP event
          'Program data: 0WywRxX2Q1KO/vb55v/5Epok4iBz8HgmaGW9gMO+gTCi+JerP102Xtka2clPukHeCgAAAAAAAACkwVPwDpULPHlT2lBv0eNESJ65K1dixlBl19Zw8nc3QQUAAAC7cgAAAAAAAPgAAAAAAAAAAAAABQAAAAAAAAAAAAByu6ZfyUNBmlrVkAQv1nyXkf0BWs9TpUzII+24/4G57XIuAAAAAAAAAAAAAAAAnzuGecc8L++LWbTzRE1OFW+3CqUAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAA7RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwAAAAAAAAAAAAAAAL0nzatckQmzOQsltN/32XCRjMVQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALw86T4RjCix2JE7KGDGznC7ieE/AfMnM4WbUzEgAOPUw==',
          'Program data: zyX7mu/lDkO0EMhfhz9z8NpxfMBabv1pr0AmN8PWxO7HlMQB6EyxngIAAAAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqc=',
          'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj consumed 147198 of 207001 compute units',
          'Program return: CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj IAAAAAAAAAAAAAAAAAAAABx9SxlssMewHXQ/vGEWqQI3nHI4QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU=',
          'Program CCitPr8yZbN8zEBEdwju8bnGgKMYcz6XSTbU61CMedj success',
          'Program data: F01Jt3u5cznZGtnJT7pB3hAAAAAAAAAAo8UDYQrKqyx5ETU5ZS7RudurUBqArrxw9lzKnQYVdRHfN+OU4sfs49ka2clPukHeEAAAAAAAAAAKAAAAAAAAAI7+9vnm//kSmiTiIHPweCZoZb2Aw76BMKL4l6s/XTZeAAAAACAAAAAAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUBUAAAAYHc8QQA0DAAAAAAAAAAAAAAAAAAAGm4hX/quBhPtof2NGGMA12sQ53BrrO1WYoPAAAAAAAQEAAACyj5pu4elxk1FJg6M6L9oSK+l+h7GziUa6ZHUBTaWBEyAAAAAAAAAAAAAAAAAAAAAcfUsZbLDHsB10P7xhFqkCN5xyOEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAByuwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P consumed 341826 of 395544 compute units',
          'Program return: CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P o8UDYQrKqyx5ETU5ZS7RudurUBqArrxw9lzKnQYVdRE=',
          'Program CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P success',
        ],
        err: null,
      },
    }

    mockConnection.getTransaction.mockResolvedValueOnce(transactionWithMalformedData)

    const result = await parseCcipCctpEvents('tx-with-malformed-data', SOLANA_DEVNET_SELECTOR)

    // It should successfully parse the one valid event and skipped invalid ones silently.
    expect(result).toHaveLength(1)
  })

  it('should handle transaction with no meta', async () => {
    const { parseCcipCctpEvents } = await import('./offchain.ts')

    const transactionWithoutMeta = {
      meta: null,
    }

    mockConnection.getTransaction.mockResolvedValueOnce(transactionWithoutMeta)

    await expect(parseCcipCctpEvents('tx-without-meta', SOLANA_DEVNET_SELECTOR)).rejects.toThrow(
      'Transaction not found: tx-without-meta',
    )
  })
})

describe('getUsdcAttestation', () => {
  const mockedFetchJson = jest.fn()
  const mockedFetch = jest.fn(() => ({ json: mockedFetchJson }))

  beforeAll(() => {
    global.fetch = mockedFetch as any
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(() => {
    global.fetch = origFetch
  })

  it('should call the mainnet Circle API when isTestnet is false', async () => {
    const messageHex = '0x123456'
    const msgHash = keccak256(messageHex)
    const completeResponse = { status: 'complete', attestation: '0xabc' }
    mockedFetchJson.mockResolvedValue(completeResponse)

    await getUsdcAttestation(messageHex, false)
    expect(mockedFetch).toHaveBeenCalledWith(
      `https://iris-api.circle.com/v1/attestations/${msgHash}`,
    )
  })

  it('should call the testnet Circle API when isTestnet is true', async () => {
    const messageHex = '0x123456'
    const msgHash = keccak256(messageHex)
    const completeResponse = { status: 'complete', attestation: '0xabc' }
    mockedFetchJson.mockResolvedValue(completeResponse)

    await getUsdcAttestation(messageHex, true)
    expect(mockedFetch).toHaveBeenCalledWith(
      `https://iris-api-sandbox.circle.com/v1/attestations/${msgHash}`,
    )
  })

  it('should correctly fetch complete attestation for a real Solana CCTP message', async () => {
    // Use MessageSent data from real tx logs https://explorer.solana.com/tx/3k81TLhJuhwB8fvurCwyMPHXR3k9Tmtqe2ZrUQ8e3rMxk9fWFJT2xVHGgKJg1785FkJcaiQkthY4m86JrESGPhMY?cluster=devnet
    const messageBytes = Buffer.from(
      'AAAAAAAAAAUAAAAAAAAAAAAAcrumX8lDQZpa1ZAEL9Z8l5H9AVrPU6VMyCPtuP+Bue1yLgAAAAAAAAAAAAAAAJ87hnnHPC/vi1m080RNThVvtwqlAAAAAAAAAAAAAAAAvSfNq1yRCbM5CyW03/fZcJGMxVAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqcAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC8POk+EYwosdiROyhgxs5wu4nhPwHzJzOFm1MxIADj1M=',
      'base64',
    )
    const messageHex = '0x' + messageBytes.toString('hex')
    const expectedMessageHash = '0xcda5c1abd6640256fd2c837447c355fad6ed7fe6a32880076ad32e6f5821ed1a'
    const expectedAttestation =
      '0x6e70be5cacd093bca66e53837c51543d1829ee065dd6dfe085f3b706b16d56b80a01c3564a53f8864f1d4c1990298558ec45a93331d423d1bd8f964232d65fba1c0a65d1c09e05a1c059e7114c56a24dffbe155a86bc9a9377a20d4460be109d547df9a132d46ec632ae8976f6bfe6739bd25cb47a79bf0d77d6860d709aa62cf81b'

    mockedFetchJson.mockResolvedValue({
      status: 'complete',
      attestation: expectedAttestation,
    })

    // Call the function with isTestnet = true for the sandbox URL
    // Verify the correct URL was called and the correct attestation was returned
    const result = await getUsdcAttestation(messageHex, true)
    expect(keccak256(messageHex)).toBe(expectedMessageHash)
    expect(mockedFetch).toHaveBeenCalledWith(
      `https://iris-api-sandbox.circle.com/v1/attestations/${expectedMessageHash}`,
    )
    expect(result).toBe(expectedAttestation)
  })

  it('should throw an error if the Circle API response for a Solana CCTP message is not "complete"', async () => {
    const messageBytes = Buffer.from(
      'AAAAAAAAAAUAAAAAAAAAAAAAcrumX8lDQZpa1ZAEL9Z8l5H9AVrPU6VMyCPtuP+Bue1yLgAAAAAAAAAAAAAAAJ87hnnHPC/vi1m080RNThVvtwqlAAAAAAAAAAAAAAAAvSfNq1yRCbM5CyW03/fZcJGMxVAAAAAAO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqcAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC8POk+EYwosdiROyhgxs5wu4nhPwHzJzOFm1MxIADj1M=',
      'base64',
    )
    const messageHex = '0x' + messageBytes.toString('hex')
    const pendingResponse = { status: 'not_complete', attestation: null }
    mockedFetchJson.mockResolvedValue(pendingResponse)

    await expect(getUsdcAttestation(messageHex, true)).rejects.toThrow(
      'Could not fetch USDC attestation. Response: ' + JSON.stringify(pendingResponse, null, 2),
    )
  })
})

describe('getUsdcAttestationV2', () => {
  const mockedFetchJson = jest.fn()
  const mockedFetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: mockedFetchJson,
    }),
  )

  beforeAll(() => {
    global.fetch = mockedFetch as any
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(() => {
    global.fetch = origFetch
  })

  it('should fetch attestation status from Circle API v2 with real transaction data', async () => {
    const transactionHash = '0xcad22cb982dbe5822d5a9e32e4699ddce89090164fe634d3a572161c10d1d68c'
    const sourceDomainId = 7 // Polygon PoS

    // Mock the real API response for this tx
    const mockApiResponse = {
      messages: [
        {
          attestation:
            '0x31288fbeb9f4d8c6f839d5aeaf9982ef7a373263b431e1cd498e9a46514f01dc119a0f0f05808d998eaed5119df9bd94319f53a17a91558a444d54653b3f43e21c83a8d78d03f39f980b7348e2dc9f12b2db82ab80033226948b99b8e7d7f423847f8a4a944648b71c84fd97aec76efebcb7ba9fda8466b1895ab6f20b20e6c32f1c',
          message:
            '0x0000000000000007000000010000000000056bb40000000000000000000000009daf8c91aefae50b9c0e69629d3f6ca40ca3b3fe0000000000000000000000006b25532e1060ce10cc3b0a99e5683b91bfde69820000000000000000000000005931822f394babc2aacf4588e98fc77a9f5aa8c9000000000000000000000000000000003c499c542cef5e3811e1192ce70d8cc03d5c33590000000000000000000000005f2f4771b7dc7e2f7e9c1308b154e1e8957ecab000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000005931822f394babc2aacf4588e98fc77a9f5aa8c9',
          eventNonce: '355252',
          cctpVersion: 1,
          status: 'complete',
          decodedMessage: {
            sourceDomain: '7',
            destinationDomain: '1',
            nonce: '355252',
            sender: '0x9daf8c91aefae50b9c0e69629d3f6ca40ca3b3fe',
            recipient: '0x6b25532e1060ce10cc3b0a99e5683b91bfde6982',
            destinationCaller: '0x5931822f394babc2aacf4588e98fc77a9f5aa8c9',
            messageBody:
              '0x000000000000000000000000000000003c499c542cef5e3811e1192ce70d8cc03d5c33590000000000000000000000005f2f4771b7dc7e2f7e9c1308b154e1e8957ecab000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000005931822f394babc2aacf4588e98fc77a9f5aa8c9',
            decodedMessageBody: {
              burnToken: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
              mintRecipient: '0x5f2f4771b7dc7e2f7e9c1308b154e1e8957ecab0',
              amount: '1000000',
              messageSender: '0x5931822f394babc2aacf4588e98fc77a9f5aa8c9',
            },
          },
          delayReason: null,
        },
      ],
    }

    mockedFetchJson.mockResolvedValue(mockApiResponse)

    const result = await getUsdcAttestationV2(sourceDomainId, transactionHash)

    // Verify the correct API endpoint was called
    expect(mockedFetch).toHaveBeenCalledWith(
      `https://iris-api.circle.com/v2/messages/${sourceDomainId}?transactionHash=${transactionHash}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    )

    // Verify the response structure and data
    expect(result).toEqual(mockApiResponse)
    expect(result.messages).toHaveLength(1)

    const message = result.messages[0]
    expect(message.status).toBe('complete')
    expect(message.eventNonce).toBe('355252')
    expect(message.cctpVersion).toBe(1)
    expect(message.delayReason).toBeNull()
    expect(message.attestation).toBe(
      '0x31288fbeb9f4d8c6f839d5aeaf9982ef7a373263b431e1cd498e9a46514f01dc119a0f0f05808d998eaed5119df9bd94319f53a17a91558a444d54653b3f43e21c83a8d78d03f39f980b7348e2dc9f12b2db82ab80033226948b99b8e7d7f423847f8a4a944648b71c84fd97aec76efebcb7ba9fda8466b1895ab6f20b20e6c32f1c',
    )

    // Verify decoded message data
    expect(message.decodedMessage).toBeDefined()
    expect(message.decodedMessage!.sourceDomain).toBe('7')
    expect(message.decodedMessage!.destinationDomain).toBe('1')
    expect(message.decodedMessage!.sender).toBe('0x9daf8c91aefae50b9c0e69629d3f6ca40ca3b3fe')
    expect(message.decodedMessage!.recipient).toBe('0x6b25532e1060ce10cc3b0a99e5683b91bfde6982')

    // Verify token transfer details
    expect(message.decodedMessage!.decodedMessageBody).toBeDefined()
    expect(message.decodedMessage!.decodedMessageBody!.burnToken).toBe(
      '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    )
    expect(message.decodedMessage!.decodedMessageBody!.amount).toBe('1000000')
  })

  it('should handle API error responses', async () => {
    const sourceDomainId = 7
    const transactionHash = '0xinvalidhash'

    // Mock fetch to return a 404 response
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: mockedFetchJson,
    })

    await expect(getUsdcAttestationV2(sourceDomainId, transactionHash)).rejects.toThrow(
      'API request failed with status 404: Not Found',
    )
  })

  it('should handle pending attestation status', async () => {
    const sourceDomainId = 7
    const transactionHash = '0xpendingtransaction'

    const mockPendingResponse = {
      messages: [
        {
          message: '0x123456',
          eventNonce: '123',
          cctpVersion: 1,
          status: 'pending_confirmations',
          decodedMessage: {
            sourceDomain: '7',
            destinationDomain: '1',
            nonce: '123',
            sender: '0x1234567890123456789012345678901234567890',
            recipient: '0x0987654321098765432109876543210987654321',
            destinationCaller: '0x1111111111111111111111111111111111111111',
            messageBody: '0x',
          },
          delayReason: null,
        },
      ],
    }

    mockedFetchJson.mockResolvedValue(mockPendingResponse)

    const result = await getUsdcAttestationV2(sourceDomainId, transactionHash)

    expect(result.messages[0].status).toBe('pending_confirmations')
    expect(result.messages[0]).not.toHaveProperty('attestation')
  })

  it('should handle empty messages array', async () => {
    const sourceDomainId = 7
    const transactionHash = '0xnotfound'

    const mockEmptyResponse = {
      messages: [],
    }

    mockedFetchJson.mockResolvedValue(mockEmptyResponse)

    const result = await getUsdcAttestationV2(sourceDomainId, transactionHash)

    expect(result.messages).toHaveLength(0)
  })
})

describe('encodeOffchainTokenData', () => {
  const EVM_TESTNET_SELECTOR = 16015286601757825753n // Ethereum Sepolia
  const SOLANA_DEVNET_SELECTOR = 16423721717087811551n // Solana Devnet

  const mockMessage = '0x000000000000000000050000000000000000000072bba65fc943419a5ad59004'
  const mockAttestation = '0x6e70be5cacd093bca66e53837c51543d1829ee065dd6dfe085f3b706b16d56b8'

  it('should use ABI encoding for EVM destinations', () => {
    const result = encodeOffchainTokenData(EVM_TESTNET_SELECTOR, mockMessage, mockAttestation)

    // Should return ABI-encoded tuple
    expect(result).toMatch(/^0x[0-9a-fA-F]+$/)

    // Decode and verify structure
    const decoded = defaultAbiCoder.decode(['tuple(bytes message, bytes attestation)'], result)

    expect(decoded[0]).toHaveProperty('message', mockMessage)
    expect(decoded[0]).toHaveProperty('attestation', mockAttestation)
  })

  it('should use Borsh encoding for Solana destinations', () => {
    const result = encodeOffchainTokenData(SOLANA_DEVNET_SELECTOR, mockMessage, mockAttestation)

    // Should return hex string
    expect(result).toMatch(/^0x[0-9a-fA-F]+$/)
    expect(result.length).toBeGreaterThan(2) // More than just "0x"

    // Test that it's different from ABI encoding (same inputs, different outputs)
    const evmResult = encodeOffchainTokenData(EVM_TESTNET_SELECTOR, mockMessage, mockAttestation)
    expect(result).not.toBe(evmResult)

    // Verify the result is valid Borsh-encoded data by attempting to decode it
    const resultBuffer = Buffer.from(result.slice(2), 'hex')

    // Define the same schema used in encoding
    const schema = {
      struct: {
        message: {
          struct: {
            data: { array: { type: 'u8' } },
          },
        },
        attestation: { array: { type: 'u8' } },
      },
    }

    // Should be able to deserialize without throwing
    const decoded = deserialize(schema, resultBuffer)

    // Check that decoded is not null
    expect(decoded).not.toBeNull()
    expect(decoded).toBeDefined()

    // Type assertion to tell TypeScript about the structure
    const typedDecoded = decoded as {
      message: { data: number[] }
      attestation: number[]
    }

    // Verify the decoded data matches our input
    const expectedMessageArray = Array.from(Buffer.from(mockMessage.slice(2), 'hex'))
    const expectedAttestationArray = Array.from(Buffer.from(mockAttestation.slice(2), 'hex'))
    expect(typedDecoded.message.data).toEqual(expectedMessageArray)
    expect(typedDecoded.attestation).toEqual(expectedAttestationArray)
  })

  it('should handle empty message and attestation for EVM', () => {
    const result = encodeOffchainTokenData(EVM_TESTNET_SELECTOR, '0x', '0x')

    const decoded = defaultAbiCoder.decode(
      ['tuple(bytes message, bytes attestation)'],
      result,
    ) as unknown as [DecodedCctpData]

    expect(decoded[0].message).toBe('0x')
    expect(decoded[0].attestation).toBe('0x')
  })

  it('should handle empty message and attestation for Solana', () => {
    const result = encodeOffchainTokenData(SOLANA_DEVNET_SELECTOR, '0x', '0x')

    // Should return hex string
    expect(result).toMatch(/^0x[0-9a-fA-F]+$/)
    expect(result.length).toBeGreaterThan(2) // More than just "0x"

    // Test that it's different from ABI encoding
    const evmResult = encodeOffchainTokenData(EVM_TESTNET_SELECTOR, '0x', '0x')
    expect(result).not.toBe(evmResult)

    // Verify it can be decoded back with real Borsh
    const resultBuffer = Buffer.from(result.slice(2), 'hex')

    const schema = {
      struct: {
        message: {
          struct: {
            data: { array: { type: 'u8' } },
          },
        },
        attestation: { array: { type: 'u8' } },
      },
    }

    const decoded = deserialize(schema, resultBuffer)
    expect(decoded).not.toBeNull()
    expect(decoded).toBeDefined()

    const typedDecoded = decoded as {
      message: { data: number[] }
      attestation: number[]
    }

    // Should decode to empty arrays
    expect(typedDecoded.message.data).toEqual([])
    expect(typedDecoded.attestation).toEqual([])
  })

  it('should throw error for invalid hex strings', () => {
    // Test invalid hex for EVM destination
    expect(() => {
      encodeOffchainTokenData(EVM_TESTNET_SELECTOR, '0xZZZ', '0x123')
    }).toThrow()

    expect(() => {
      encodeOffchainTokenData(SOLANA_DEVNET_SELECTOR, '0x123', '0xZZZ')
    }).toThrow()
  })
})
