import './index.ts' // Register supported chains
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface } from 'ethers'
import type { PickDeep } from 'type-fest'

import { Chain } from './chain.ts'
import OffRamp_1_6_ABI from './evm/abi/OffRamp_1_6.ts'
import type { CCIPMessage_V1_6_EVM } from './evm/messages.ts'
import { calculateManualExecProof, discoverOffRamp } from './execution.ts'
import { decodeMessage } from './requests.ts'
import {
  type CCIPExecution,
  type CCIPMessage,
  type CCIPRequest,
  type ChainTransaction,
  type CommitReport,
  type ExecutionState,
  type Lane,
  type Log_,
  CCIPVersion,
  ChainFamily,
} from './types.ts'
import { networkInfo } from './utils.ts'

// Mock Chain class for testing
class MockChain extends Chain {
  static family = ChainFamily.EVM
  private mockTypeAndVersion: string
  private mockLogs: Log_[] = []
  private mockBlockTimestamp = 1700000000
  private mockRouterForOnRamp: Map<string, string> = new Map()
  private mockOffRampsForRouter: Map<string, string[]> = new Map()
  private mockOnRampForOffRamp: Map<string, string> = new Map()

  constructor(chainId: number, typeAndVersion: string = 'EVM2EVMOffRamp 1.5.0') {
    super(networkInfo(chainId))
    this.mockTypeAndVersion = typeAndVersion
  }

  setLogs(logs: Log_[]) {
    this.mockLogs = logs
  }

  setRouterForOnRamp(onRamp: string, router: string) {
    this.mockRouterForOnRamp.set(onRamp, router)
  }

  setOffRampsForRouter(router: string, offRamps: string[]) {
    this.mockOffRampsForRouter.set(router, offRamps)
  }

  setOnRampForOffRamp(offRamp: string, onRamp: string) {
    this.mockOnRampForOffRamp.set(offRamp, onRamp)
  }

  async getBlockTimestamp(_block: number | 'finalized'): Promise<number> {
    return this.mockBlockTimestamp
  }

  async getTransaction(_hash: string): Promise<ChainTransaction> {
    return {
      hash: _hash,
      logs: this.mockLogs,
      blockNumber: 1000,
      timestamp: this.mockBlockTimestamp,
      from: '0xSender',
    }
  }

  override async getMessagesInTx(_tx: string | ChainTransaction): Promise<CCIPRequest[]> {
    return []
  }

  override async getMessagesInBatch<
    R extends PickDeep<
      CCIPRequest,
      'lane' | `log.${'topics' | 'address' | 'blockNumber'}` | 'message.sequenceNumber'
    >,
  >(
    _request: R,
    _commit: Pick<CommitReport, 'minSeqNr' | 'maxSeqNr'>,
    _opts?: { page?: number },
  ): Promise<R['message'][]> {
    return []
  }

  async *getLogs(opts: {
    startBlock?: number
    startTime?: number
    endBlock?: number
    address?: string
    topics?: string[] | string[][]
    page?: number
  }): AsyncIterableIterator<Log_> {
    for (const log of this.mockLogs) {
      // Filter by address if specified
      if (opts.address && log.address !== opts.address) {
        continue
      }
      yield log
    }
  }

  async typeAndVersion(_address: string): Promise<[string, string, string]> {
    const parts = this.mockTypeAndVersion.split(' ') as [string, string]
    return [parts[0], parts[1], this.mockTypeAndVersion]
  }

  async getRouterForOnRamp(_onRamp: string, _destChainSelector: bigint): Promise<string> {
    return this.mockRouterForOnRamp.get(_onRamp) || '0xDefaultRouter'
  }

  async getRouterForOffRamp(_offRamp: string, _sourceChainSelector: bigint): Promise<string> {
    return '0xRouter'
  }

  async getNativeTokenForRouter(_router: string): Promise<string> {
    return '0xNativeToken'
  }

  async getOffRampsForRouter(_router: string, _chainSelector: bigint): Promise<string[]> {
    return this.mockOffRampsForRouter.get(_router) || []
  }

  async getOnRampForOffRamp(_offRamp: string, _chainSelector: bigint): Promise<string> {
    return this.mockOnRampForOffRamp.get(_offRamp) || '0xDefaultOnRamp'
  }

  async getOnRampForRouter(_router: string, _destChainSelector: bigint): Promise<string> {
    return '0xOnRamp'
  }

  async getCommitStoreForOffRamp(_offRamp: string): Promise<string> {
    return '0xCommitStore'
  }

  async getSupportedTokens(_address: string, _opts?: { page?: number }): Promise<string[]> {
    return []
  }

  async getRegistryTokenConfig(_registry: string, _token: string): Promise<any> {
    return {}
  }

  async getTokenPoolConfigs(_tokenPool: string): Promise<{
    token: string
    router: string
    typeAndVersion?: string
  }> {
    return { token: '0xToken', router: '0xRouter', typeAndVersion: 'TokenPool 1.5.0' }
  }

  async getTokenPoolRemotes(_pool: string, _remoteChainSelector: bigint): Promise<any> {
    return { remoteToken: '0xRemoteToken', remotePools: [] }
  }

  async getTokenForTokenPool(_tokenPool: string): Promise<string> {
    return '0xToken'
  }

  async getTokenInfo(_token: string): Promise<{ symbol: string; decimals: number; name?: string }> {
    return { symbol: 'TST', decimals: 18, name: 'Test Token' }
  }

  async getBalance(_opts: { token?: string | null; holder: string }): Promise<bigint> {
    return 0n
  }

  async getTokenAdminRegistryFor(_address: string): Promise<string> {
    return '0xTokenAdminRegistry'
  }

  async getWalletAddress(_opts?: { wallet?: unknown }): Promise<string> {
    return '0xWallet'
  }

  async getFee(_opts: any): Promise<bigint> {
    return 1000n
  }

  async getFeeTokens() {
    return {}
  }

  generateUnsignedSendMessage(_opts: any): Promise<never> {
    return Promise.reject(new Error('not implemented'))
  }

  async sendMessage(_opts: any): Promise<CCIPRequest> {
    return Promise.reject(new Error('not implemented'))
  }

  async getOffchainTokenData(_request: CCIPRequest): Promise<any[]> {
    return []
  }

  override generateUnsignedExecuteReport(_opts: any): Promise<never> {
    return Promise.reject(new Error('not implemented'))
  }

  async executeReport(_opts: any): Promise<CCIPExecution> {
    return Promise.reject(new Error('not implemented'))
  }

  static decodeMessage(_log: Log_): CCIPMessage | null {
    return null
  }

  static decodeReceipt(_log: Log_) {
    const iface = new Interface(OffRamp_1_6_ABI)
    try {
      const parsed = iface.parseLog({
        topics: _log.topics as string[],
        data: typeof _log.data === 'string' ? _log.data : '0x',
      })
      if (parsed?.name === 'ExecutionStateChanged') {
        // ExecutionStateChanged(uint64 indexed sourceChainSelector, uint64 indexed sequenceNumber, bytes32 indexed messageId, bytes32 messageHash, uint8 state, bytes returnData, uint256 gasUsed)
        return {
          sourceChainSelector: parsed.args[0] as bigint,
          sequenceNumber: parsed.args[1] as bigint,
          messageId: parsed.args[2] as string,
          messageHash: parsed.args[3] as string,
          state: Number(parsed.args[4]) as ExecutionState,
          returnData: parsed.args[5] as string,
          gasUsed: parsed.args[6] as bigint,
        }
      }
    } catch {
      // ignore
    }
    return null
  }
}

describe('calculateManualExecProof', () => {
  const lane: Lane = {
    sourceChainSelector: networkInfo(11155111).chainSelector,
    destChainSelector: networkInfo(421614).chainSelector,
    onRamp: '0x0bf3de8c5d3e8a2b34d2beeb17abfcebaf230733',
    version: CCIPVersion.V1_5,
  }

  const messages: CCIPMessage[] = [
    {
      messageId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      sequenceNumber: 1n,
      nonce: 1n,
      sourceChainSelector: lane.sourceChainSelector,
      sender: '0x1111111111111111111111111111111111111111',
      receiver: '0x2222222222222222222222222222222222222222',
      data: '0x',
      gasLimit: 100000n,
      strict: false,
      feeToken: '0x0000000000000000000000000000000000000000',
      feeTokenAmount: 1000n,
      tokenAmounts: [],
      sourceTokenData: [],
    },
    {
      messageId: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      sequenceNumber: 2n,
      nonce: 2n,
      sourceChainSelector: lane.sourceChainSelector,
      sender: '0x3333333333333333333333333333333333333333',
      receiver: '0x4444444444444444444444444444444444444444',
      data: '0x',
      gasLimit: 200000n,
      strict: false,
      feeToken: '0x0000000000000000000000000000000000000000',
      feeTokenAmount: 2000n,
      tokenAmounts: [],
      sourceTokenData: [],
    },
  ]

  it('should calculate manual execution proof correctly', () => {
    const merkleRoot = '0x9c66d4cfcba6e359f42f096ff16192e16967cea456503c02e738c5646d06cab4'
    const messageId = messages[0]!.messageId

    const result = calculateManualExecProof(messages, lane, messageId, merkleRoot, {
      logger: console,
    })

    assert.ok(result.proofs)
    assert.ok(result.proofFlagBits === 0n)
    assert.ok(result.merkleRoot)
    assert.ok(Array.isArray(result.proofs))
  })

  it('should calculate messageId as root of batch with single message', () => {
    const messageId = messages[0]!.messageId
    const batch = [messages[0]!]

    const result = calculateManualExecProof(batch, lane, messageId, undefined, { logger: console })

    assert.ok(result.proofs)
    assert.equal(result.proofs.length, 0)
    assert.equal(result.proofFlagBits, 0n)
  })

  it('should throw an error if messageId is not in batch', () => {
    const missingMessageId = '0x9999999999999999999999999999999999999999999999999999999999999999'

    assert.throws(
      () =>
        calculateManualExecProof(messages, lane, missingMessageId, undefined, { logger: console }),
      /Could not find.*in batch/,
    )
  })

  it('should throw an error if merkle root does not match', () => {
    const messageId = messages[0]!.messageId
    const wrongMerkleRoot = '0x0000000000000000000000000000000000000000000000000000000000000001'

    assert.throws(
      () =>
        calculateManualExecProof(messages, lane, messageId, wrongMerkleRoot, { logger: console }),
      /Merkle root.*doesn't match/,
    )
  })

  it('should calculate manual execution proof for v1.6 EVM->EVM', () => {
    const merkleRoot1_6 = '0x98d1dd2865db5e42c2133affac02866ed298b51eba78beae5d68054aa25dccca'
    const messages1_6: CCIPMessage[] = [
      {
        data: '0x',
        nonce: 0n,
        messageId: '0x2222222222222222222222222222222222222222222222222222222222222222',
        sequenceNumber: 1n,
        destChainSelector: networkInfo(421614).chainSelector,
        sourceChainSelector: networkInfo(11155111).chainSelector,
        sender: '0x1111111111111111111111111111111111111111',
        feeToken: '0x0000000000000000000000000000000000000000',
        receiver: '0x95b9e79A732C0E03d04a41c30C9DF7852a3D8Da4',
        extraArgs: '0x97a657c90000000000000000000000000000000000000000000000000000000000030d40',
        gasLimit: 200000n,
        tokenAmounts: [],
        feeValueJuels: 1000n,
        feeTokenAmount: 1000n,
        allowOutOfOrderExecution: false,
      } as any,
    ]

    const lane1_6: Lane = {
      sourceChainSelector: networkInfo(11155111).chainSelector,
      destChainSelector: networkInfo(421614).chainSelector,
      onRamp: '0x0bf3de8c5d3e8a2b34d2beeb17abfcebaf230733',
      version: CCIPVersion.V1_6,
    }

    const messageId = messages1_6[0]!.messageId
    const result = calculateManualExecProof(messages1_6, lane1_6, messageId, merkleRoot1_6, {
      logger: console,
    })

    assert.equal(result.proofs.length, 0)
    assert.equal(result.proofFlagBits, 0n)
  })

  it('should calculate Aptos root correctly', () => {
    // Test with actual Aptos message structure from requests.test.ts
    const msgInfoString =
      '{"data":"0x68656c6c6f2066726f6d20636369702d746f6f6c732d7473","extra_args":"0x181dcf10000000000000000000000000000000000000000000000000000000000000000001","fee_token":"0xa","fee_token_amount":"7623325","fee_value_juels":"14445160000000000","header":{"dest_chain_selector":"16015286601757825753","message_id":"0x36ac5c4c91a322b8294d6a32250fe87342d7de19460d6849e7b04b864ab8333d","nonce":"0","sequence_number":"81","source_chain_selector":"743186221051783445"},"receiver":"0x00000000000000000000000089810cb91a5fe67ddf3483182f08e1559a5699de","sender":"0xc7dfb38f07910cba7157db3ead1471ebc5a87f71a5aaad3921637f5371da69d8","token_amounts":[{"amount":"130000","dest_exec_data":"0x905f0100","dest_token_address":"0x000000000000000000000000fd57b4ddbf88a4e07ff4e34c487b99af2fe82a05","extra_data":"0x0000000000000000000000000000000000000000000000000000000000000008","source_pool_address":"0x65ad4cb3142cab5100a4eeed34e2005cbb1fcae42fc688e3c96b0c33ae16e6b9"}]}'

    const message = decodeMessage(msgInfoString) as CCIPMessage_V1_6_EVM

    const lane: Lane = {
      sourceChainSelector: message.sourceChainSelector,
      destChainSelector: message.destChainSelector,
      onRamp: '0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45',
      version: CCIPVersion.V1_6,
    }

    const messageId = message.messageId
    const result = calculateManualExecProof([message], lane, messageId, undefined, {
      logger: console,
    })
    assert.ok(result.merkleRoot)
    assert.equal(
      result.merkleRoot,
      '0x3384a0346bb91a2300fcd58391181950fa15e44c56752757d473204ff759e629',
    )
  })
})

describe('discoverOffRamp', () => {
  it('should discover offRamp correctly', async () => {
    const sourceChain = new MockChain(11155111)
    const destChain = new MockChain(421614)
    const onRamp = '0xOnRamp'

    // Setup mocks for the discovery flow
    sourceChain.setRouterForOnRamp(onRamp, '0xSourceRouter')
    sourceChain.setOffRampsForRouter('0xSourceRouter', ['0xSourceOffRamp'])
    sourceChain.setOnRampForOffRamp('0xSourceOffRamp', '0xDestOnRamp')

    destChain.setRouterForOnRamp('0xDestOnRamp', '0xDestRouter')
    destChain.setOffRampsForRouter('0xDestRouter', ['0xDestOffRamp'])
    destChain.setOnRampForOffRamp('0xDestOffRamp', onRamp)

    const result = await discoverOffRamp(sourceChain, destChain, onRamp)

    assert.equal(result, '0xDestOffRamp')
  })

  it('should throw an error if no offRamp is found', async () => {
    const sourceChain = new MockChain(11155111)
    const destChain = new MockChain(421614)
    const onRamp = '0x1111111111111111111111111111111111111111'

    // Setup mocks - the loop will find destOffRamp but onRamp won't match
    sourceChain.setRouterForOnRamp(onRamp, '0x2222222222222222222222222222222222222222')
    sourceChain.setOffRampsForRouter('0x2222222222222222222222222222222222222222', [
      '0x3333333333333333333333333333333333333333',
    ])
    sourceChain.setOnRampForOffRamp(
      '0x3333333333333333333333333333333333333333',
      '0x4444444444444444444444444444444444444444',
    )

    destChain.setRouterForOnRamp(
      '0x4444444444444444444444444444444444444444',
      '0x5555555555555555555555555555555555555555',
    )
    destChain.setOffRampsForRouter('0x5555555555555555555555555555555555555555', [
      '0x6666666666666666666666666666666666666666',
    ])
    destChain.setOnRampForOffRamp(
      '0x6666666666666666666666666666666666666666',
      '0x7777777777777777777777777777777777777777',
    ) // This won't match the onRamp we're looking for

    await assert.rejects(
      async () => await discoverOffRamp(sourceChain, destChain, onRamp),
      /No matching offRamp found/,
    )
  })
})
