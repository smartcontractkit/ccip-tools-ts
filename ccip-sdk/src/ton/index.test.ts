import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import { type Cell, Address, Dictionary, beginCell, toNano } from '@ton/core'
import type { TonClient } from '@ton/ton'

import { ChainFamily, networkInfo } from '../index.ts'
import type { ExecutionInput } from '../types.ts'
import { TONChain } from './index.ts'
import { type TONWallet, MANUALLY_EXECUTE_OPCODE } from './types.ts'
import { crc32 } from './utils.ts'
import type { CCIPMessage_V1_6_EVM } from '../evm/messages.ts'
import { util } from '../utils.ts'

// Mock fetch for TON tests that handles lookupBlock (getMCSeqNoByLt) calls
async function mockTonFetch(
  _url: Parameters<typeof fetch>[0],
  opts?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const body = JSON.parse((opts?.body as string | undefined) ?? '{}') as { method?: string }
  if (body.method === 'lookupBlock') {
    return new Response(JSON.stringify({ result: { seqno: 1 } }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (body.method === 'getBlockHeader') {
    return new Response(
      JSON.stringify({
        result: { gen_utime: 1, start_lt: '0', end_lt: '9999999999999999', min_ref_mc_seqno: 1 },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  }
  throw new Error(`Unexpected fetch: ${util.inspect(_url)}, method=${body.method}`)
}

// Masterchain/shard stubs the getLogs completeness path needs: a tip well above the
// mock txs' block (so nothing is held as "unsealed"), and a single root shard covering
// all basechain accounts (its end_lt is served by mockTonFetch's getBlockHeader).
const mockMasterchain = {
  getMasterchainInfo: async () => ({
    workchain: -1,
    shard: '-9223372036854775808',
    latestSeqno: 100,
    rootHash: '',
    fileHash: '',
  }),
  getWorkchainShards: async (seqno: number) => [
    { workchain: 0, shard: '-9223372036854775808', seqno },
  ],
}

describe('TON index unit tests', () => {
  // Test constants from chainlink-ton test suite
  const CHAINSEL_EVM_TEST_90000001 = 909606746561742123n
  const CHAINSEL_TON = 13879075125137744094n
  const EVM_SENDER_ADDRESS_TEST = '0x1a5fdbc891c5d4e6ad68064ae45d43146d4f9f3a'
  const TON_OFFRAMP_ADDRESS_TEST =
    '0:9f2e995aebceb97ae094dbe4cf973cbc8a402b4f0ac5287a00be8aca042d51b9'

  // Shared test data
  const baseExecReport: ExecutionInput<CCIPMessage_V1_6_EVM> = {
    message: {
      messageId: '0x' + '0'.repeat(63) + '1',
      sourceChainSelector: CHAINSEL_EVM_TEST_90000001,
      destChainSelector: CHAINSEL_TON,
      sequenceNumber: 1n,
      nonce: 0n,
      sender: EVM_SENDER_ADDRESS_TEST,
      receiver: 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2',
      data: '0x',
      extraArgs: '0x181dcf10000000000000000000000000000000000000000000000000000000000000000001',
      feeToken: '0x0000000000000000000000000000000000000000',
      feeTokenAmount: 0n,
      feeValueJuels: 0n,
      tokenAmounts: [],
      gasLimit: 200000n,
      allowOutOfOrderExecution: true,
    },
    proofs: [],
    proofFlagBits: 0n,
    merkleRoot: '0xce60f1962af3c7c7f9d3e434dea13530564dbff46704d628ff4b2206bbc93289',
    offchainTokenData: [],
  }

  const mockNetworkInfo = networkInfo('ton-testnet')

  describe('extra args codec', () => {
    it('should round-trip EVM extra args through TONChain static codec', () => {
      const original = { gasLimit: 400_000n, allowOutOfOrderExecution: true }

      const encoded = TONChain.encodeExtraArgs(original)
      const decoded = TONChain.decodeExtraArgs(encoded)

      assert.match(encoded, /^0xb5ee9c72/)
      assert.deepEqual(decoded, { ...original, _tag: 'EVMExtraArgsV2' })
    })

    it('should round-trip SVM extra args through TONChain static codec', () => {
      const original = {
        computeUnits: 250_000n,
        accountIsWritableBitmap: 5n,
        allowOutOfOrderExecution: true,
        tokenReceiver: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        accounts: [
          '11111111111111111111111111111111',
          'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
        ],
      }

      const encoded = TONChain.encodeExtraArgs(original)
      const decoded = TONChain.decodeExtraArgs(encoded)

      assert.match(encoded, /^0xb5ee9c72/)
      assert.deepEqual(decoded, { ...original, _tag: 'SVMExtraArgsV1' })
    })

    it('should round-trip Sui extra args through TONChain static codec', () => {
      const original = {
        gasLimit: 350_000n,
        allowOutOfOrderExecution: false,
        tokenReceiver: '0x1111111111111111111111111111111111111111111111111111111111111111',
        receiverObjectIds: [
          '0x2222222222222222222222222222222222222222222222222222222222222222',
          '0x3333333333333333333333333333333333333333333333333333333333333333',
        ],
      }

      const encoded = TONChain.encodeExtraArgs(original)
      const decoded = TONChain.decodeExtraArgs(encoded)

      assert.match(encoded, /^0xb5ee9c72/)
      assert.deepEqual(decoded, { ...original, _tag: 'SuiExtraArgsV1' })
    })
  })

  describe('execute', { timeout: 10e3 }, () => {
    const mockWalletAddress = Address.parse('EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa')

    // Helper to create a valid ExecutionStateChanged BOC cell for execute tests
    function createExecutionStateChangedCell(
      sourceChainSelector: bigint,
      sequenceNumber: bigint,
      messageId: string,
      state: number,
    ) {
      // messageId is hex string like '0x0000...0001', convert to bigint
      const messageIdBigInt = BigInt(messageId)
      return beginCell()
        .storeUint(sourceChainSelector, 64) // sourceChainSelector
        .storeUint(sequenceNumber, 64) // sequenceNumber
        .storeUint(messageIdBigInt, 256) // messageId
        .storeUint(state, 8) // state: 2 = Success
        .endCell()
    }

    function createMockClientAndWallet(opts?: {
      seqno?: number
      shouldFail?: boolean
      txLt?: string
      txHash?: string
    }) {
      let capturedTransfer: {
        to: string
        body: Cell
        value?: bigint
      } | null = null

      const mockTxLt = opts?.txLt ?? '12345678'
      const mockTxHash =
        opts?.txHash ?? 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      const currentSeqno = opts?.seqno ?? 0

      // Create ExecutionStateChanged cell for the OffRamp address
      // Uses baseExecReport message data: messageId, sourceChainSelector, sequenceNumber
      const execStateCell = createExecutionStateChangedCell(
        CHAINSEL_EVM_TEST_90000001, // sourceChainSelector from baseExecReport
        1n, // sequenceNumber from baseExecReport
        '0x' + '0'.repeat(63) + '1', // messageId from baseExecReport
        2, // state: Success
      )

      const offRampAddress = Address.parse(TON_OFFRAMP_ADDRESS_TEST)

      // Mock transaction for OffRamp containing ExecutionStateChanged external-out message
      // Create dest with crc32 value for ExecutionStateChanged topic
      const execStateChangedCrc = BigInt(crc32('ExecutionStateChanged'))

      const mockOffRampTx = {
        lt: BigInt(mockTxLt),
        prevTransactionLt: 0n, // single tx → account genesis (no predecessor)
        prevTransactionHash: 0n,
        hash: () => Buffer.from(mockTxHash, 'hex'),
        now: Math.floor(Date.now() / 1000),
        address: BigInt('0x' + offRampAddress.hash.toString('hex')),
        outMessages: new Map([
          [
            0,
            {
              info: {
                type: 'external-out' as const,
                src: offRampAddress,
                dest: { value: execStateChangedCrc },
              },
              body: execStateCell,
            },
          ],
        ]),
      }

      const mockClient = {
        parameters: { endpoint: 'http://mock-ton-api' },
        ...mockMasterchain,
        runMethod: async (_address: Address, method: string) => {
          if (method === 'seqno') {
            // Return seqno+1 to simulate transaction confirmed
            return { stack: { readNumber: () => currentSeqno + 1 } }
          }
          throw new Error(`Unknown method: ${method}`)
        },
        getTransactions: async (address: Address) => {
          // Return different transactions based on the address being queried
          const isOffRamp = address.equals(offRampAddress)
          if (isOffRamp) {
            return [mockOffRampTx]
          }
          return []
        },
      } as unknown as TonClient

      const mockWallet: TONWallet = {
        getAddress: () => mockWalletAddress.toString(),
        sendTransaction: async (unsignedTx: { to: string; body: Cell; value?: bigint }) => {
          if (opts?.shouldFail) {
            throw new Error('Transaction failed')
          }
          capturedTransfer = {
            to: unsignedTx.to,
            body: unsignedTx.body,
            value: unsignedTx.value,
          }
          return currentSeqno
        },
      }

      return {
        client: mockClient,
        wallet: mockWallet,
        getCapturedTransfer: () => capturedTransfer,
        mockTxLt,
        mockTxHash,
      }
    }

    it('should send to offRamp with correct value and seqno', async () => {
      const { client, wallet, getCapturedTransfer } = createMockClientAndWallet({ seqno: 42 })
      const tonChain = new TONChain(client, mockNetworkInfo, { fetch: mockTonFetch })

      await tonChain.execute({
        offRamp: TON_OFFRAMP_ADDRESS_TEST,
        input: baseExecReport,
        wallet,
      })

      const captured = getCapturedTransfer()
      assert.ok(captured, 'sendTransaction should be called')
      assert.equal(captured.to, TON_OFFRAMP_ADDRESS_TEST, 'should send to offRamp address')
      assert.ok(captured.body instanceof Object, 'body should be a Cell')
      assert.equal(captured.value, toNano('0.3'), 'should send 0.3 GRAM for gas')
    })

    it('should build Cell body with MANUALLY_EXECUTE_OPCODE', async () => {
      const { client, wallet, getCapturedTransfer } = createMockClientAndWallet()
      const tonChain = new TONChain(client, mockNetworkInfo, { fetch: mockTonFetch })

      await tonChain.execute({
        offRamp: TON_OFFRAMP_ADDRESS_TEST,
        input: baseExecReport,
        wallet,
      })

      const captured = getCapturedTransfer()!
      const slice = captured.body.beginParse()

      assert.equal(
        slice.loadUint(32),
        MANUALLY_EXECUTE_OPCODE,
        'opcode should be MANUALLY_EXECUTE_OPCODE',
      )
      assert.equal(slice.loadUint(64), 0, 'queryId should be 0')
    })

    it('should return tx hash in workchain:address:lt:hash format', async () => {
      const { client, wallet, mockTxLt, mockTxHash } = createMockClientAndWallet({
        txLt: '42317062000001',
        txHash: 'bb94e574159e19660ab558347f59f80fd005b44c544417df38d0dfb08f2bd395',
      })
      const tonChain = new TONChain(client, mockNetworkInfo, { fetch: mockTonFetch })

      const result = await tonChain.execute({
        offRamp: TON_OFFRAMP_ADDRESS_TEST,
        input: baseExecReport,
        wallet,
      })

      const [workchain, address, lt, hash] = result.log.transactionHash.split(':') as [
        string,
        string,
        string,
        string,
      ]
      assert.equal(workchain, '0', 'workchain should be 0')
      assert.equal(address.length, 64, 'address should be 64 hex chars')
      assert.equal(lt, mockTxLt, 'lt should match transaction lt')
      assert.equal(hash, mockTxHash, 'hash should match transaction hash')
    })

    it('should reject non-TON wallet', async () => {
      const { client } = createMockClientAndWallet()
      const tonChain = new TONChain(client, mockNetworkInfo)

      await assert.rejects(
        tonChain.execute({
          offRamp: TON_OFFRAMP_ADDRESS_TEST,
          input: baseExecReport,
          wallet: { invalid: true },
        }),
        /Wallet must be a Signer/,
      )
    })

    it('should propagate sendTransfer errors', async () => {
      const { client, wallet } = createMockClientAndWallet({ shouldFail: true })
      const tonChain = new TONChain(client, mockNetworkInfo)

      await assert.rejects(
        tonChain.execute({
          offRamp: TON_OFFRAMP_ADDRESS_TEST,
          input: baseExecReport,
          wallet,
        }),
        /Transaction failed/,
      )
    })
  })

  describe('generateUnsignedExecute', () => {
    it('should return UnsignedTONTx with family=ton', async () => {
      const tonChain = new TONChain({ getTransactions: async () => [] } as any, mockNetworkInfo)

      const unsigned = await tonChain.generateUnsignedExecute({
        payer: '0:' + 'b'.repeat(64),
        offRamp: TON_OFFRAMP_ADDRESS_TEST,
        input: baseExecReport,
      })

      assert.equal(unsigned.family, ChainFamily.TON)
      assert.equal(unsigned.to, TON_OFFRAMP_ADDRESS_TEST)
      assert.ok(unsigned.body instanceof Object, 'body should be a Cell')
    })
  })

  describe('typeAndVersion', () => {
    const mockNetworkInfo = networkInfo('ton-testnet')

    function createMockClient(opts: { contractType: string; version: string }) {
      const typeCell = beginCell().storeStringTail(opts.contractType).endCell()
      const versionCell = beginCell().storeStringTail(opts.version).endCell()

      return {
        runMethod: async (_address: Address, method: string) => {
          if (method === 'typeAndVersion') {
            let readIndex = 0
            return {
              stack: {
                readCell: () => {
                  readIndex++
                  return readIndex === 1 ? typeCell : versionCell
                },
              },
            }
          }
          throw new Error(`Unknown method: ${method}`)
        },
        getTransactions: async () => [],
      } as unknown as TonClient
    }

    it('should parse OffRamp type and version', async () => {
      const client = createMockClient({
        contractType: 'com.chainlink.ton.ccip.OffRamp',
        version: '1.6.0',
      })
      const tonChain = new TONChain(client, mockNetworkInfo)

      const result = await tonChain.typeAndVersion(
        'EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa',
      )

      assert.equal(result[0], 'OffRamp')
      assert.equal(result[1], '1.6.0')
      assert.equal(result[2], 'OffRamp 1.6.0')
    })

    it('should parse OnRamp type and version', async () => {
      const client = createMockClient({
        contractType: 'com.chainlink.ton.ccip.OnRamp',
        version: '1.6.0',
      })
      const tonChain = new TONChain(client, mockNetworkInfo)

      const result = await tonChain.typeAndVersion(
        'EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa',
      )

      assert.equal(result[0], 'OnRamp')
      assert.equal(result[1], '1.6.0')
      assert.equal(result[2], 'OnRamp 1.6.0')
    })

    it('should parse Router type and version', async () => {
      const client = createMockClient({
        contractType: 'com.chainlink.ton.ccip.Router',
        version: '1.6.0',
      })
      const tonChain = new TONChain(client, mockNetworkInfo)

      const result = await tonChain.typeAndVersion(
        'EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa',
      )

      assert.equal(result[0], 'Router')
      assert.equal(result[1], '1.6.0')
      assert.equal(result[2], 'Router 1.6.0')
    })

    it('should handle version with suffix', async () => {
      const client = createMockClient({
        contractType: 'com.chainlink.ton.ccip.OffRamp',
        version: '1.6.0-dev',
      })
      const tonChain = new TONChain(client, mockNetworkInfo)

      const result = await tonChain.typeAndVersion(
        'EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa',
      )

      assert.equal(result[0], 'OffRamp')
      assert.equal(result[1], '1.6.0')
    })
  })
  describe('getTokenInfo', () => {
    const mockNetworkInfo = networkInfo('ton-testnet')

    function createMockClientForJetton(opts: {
      totalSupply?: bigint
      mintable?: boolean
      contentType: 'onchain' | 'offchain' | 'error'
      symbol?: string
      decimals?: number
      uri?: string
    }) {
      let contentCell: Cell

      if (opts.contentType === 'onchain') {
        // Build onchain metadata dict per TEP-64
        const symbolHash = BigInt(
          '0xb76a7ca153c24671658335bbd08946350ffc621fa1c516e7123095d4ffd5c581',
        )
        const decimalsHash = BigInt(
          '0xee80fd2f1e03480e2282363596ee752d7bb27f50776b95086a0279189675923e',
        )

        const dict = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell())

        if (opts.symbol) {
          const symbolCell = beginCell().storeUint(0, 8).storeStringTail(opts.symbol).endCell()
          dict.set(symbolHash, symbolCell)
        }

        if (opts.decimals !== undefined) {
          const decimalsCell = beginCell()
            .storeUint(0, 8)
            .storeStringTail(opts.decimals.toString())
            .endCell()
          dict.set(decimalsHash, decimalsCell)
        }

        contentCell = beginCell().storeUint(0x00, 8).storeDict(dict).endCell()
      } else if (opts.contentType === 'offchain') {
        contentCell = beginCell()
          .storeUint(0x01, 8)
          .storeStringTail(opts.uri ?? '')
          .endCell()
      } else {
        // Invalid content for error testing
        contentCell = beginCell().endCell()
      }

      const mockAddress = Address.parse('EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa')

      return {
        runMethod: async (_address: Address, method: string) => {
          if (method === 'get_jetton_data') {
            return {
              stack: {
                readBigNumber: () => opts.totalSupply ?? 1000000000n,
                readAddress: () => mockAddress,
                readCell: () => contentCell,
              },
            }
          }
          throw new Error(`Unknown method: ${method}`)
        },
        getTransactions: async () => [],
      } as unknown as TonClient
    }

    it('should parse onchain jetton metadata with symbol and decimals', async () => {
      const client = createMockClientForJetton({
        contentType: 'onchain',
        symbol: 'USDT',
        decimals: 6,
      })
      const tonChain = new TONChain(client, mockNetworkInfo)

      const result = await tonChain.getTokenInfo('EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa')

      assert.equal(result.symbol, 'USDT')
      assert.equal(result.decimals, 6)
    })

    it('should return defaults for onchain metadata without symbol/decimals', async () => {
      const client = createMockClientForJetton({
        contentType: 'onchain',
      })
      const tonChain = new TONChain(client, mockNetworkInfo)

      const result = await tonChain.getTokenInfo('EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa')

      assert.equal(result.symbol, 'JETTON')
      assert.equal(result.decimals, 9)
    })

    it('should return defaults when get_jetton_data fails', async () => {
      const client = {
        runMethod: async () => {
          throw new Error('Contract not found')
        },
        getTransactions: async () => [],
      } as unknown as TonClient

      const tonChain = new TONChain(client, mockNetworkInfo)

      const result = await tonChain.getTokenInfo('EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa')

      assert.equal(result.symbol, '')
      assert.equal(result.decimals, 9)
    })

    it('should handle invalid decimals value gracefully', async () => {
      const decimalsHash = BigInt(
        '0xee80fd2f1e03480e2282363596ee752d7bb27f50776b95086a0279189675923e',
      )

      const dict = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell())
      const decimalsCell = beginCell().storeUint(0, 8).storeStringTail('invalid').endCell()
      dict.set(decimalsHash, decimalsCell)

      const contentCell = beginCell().storeUint(0x00, 8).storeDict(dict).endCell()
      const mockAddress = Address.parse('EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa')

      const client = {
        runMethod: async () => ({
          stack: {
            readBigNumber: () => 1000000000n,
            readAddress: () => mockAddress,
            readCell: () => contentCell,
          },
        }),
        getTransactions: async () => [],
      } as unknown as TonClient

      const tonChain = new TONChain(client, mockNetworkInfo)
      const result = await tonChain.getTokenInfo('EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa')

      // Should use default decimals when parsing fails
      assert.equal(result.decimals, 9)
    })
  })

  describe('getAddress', () => {
    it('should parse 32-byte hash (workchain 0)', () => {
      const hash = '0x' + 'ab'.repeat(32)
      const result = TONChain.getAddress(hash)
      assert.equal(result, `0:${'ab'.repeat(32)}`)
    })

    it('should parse 33-byte format (workchain + hash)', () => {
      const data = Buffer.alloc(33)
      data[0] = 0 // workchain 0
      data.fill(0xab, 1)
      const result = TONChain.getAddress(data)
      assert.equal(result, `0:${'ab'.repeat(32)}`)
    })

    it('should parse 33-byte format with workchain -1', () => {
      const data = Buffer.alloc(33)
      data[0] = 0xff // workchain -1
      data.fill(0xab, 1)
      const result = TONChain.getAddress(data)
      assert.equal(result, `-1:${'ab'.repeat(32)}`)
    })

    it('should parse 36-byte CCIP format', () => {
      const data = Buffer.alloc(36)
      data.writeInt32BE(0, 0) // workchain 0
      data.fill(0xab, 4)
      const result = TONChain.getAddress(data)
      assert.equal(result, `0:${'ab'.repeat(32)}`)
    })

    it('should parse user-friendly address', () => {
      const result = TONChain.getAddress('EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2')
      assert.match(result, /^0:[a-f0-9]{64}$/)
    })

    it('should pass through raw format', () => {
      const raw = `0:${'ab'.repeat(32)}`
      const result = TONChain.getAddress(raw)
      assert.equal(result, raw)
    })

    it('should pass through raw format with workchain -1', () => {
      const raw = `-1:${'ab'.repeat(32)}`
      const result = TONChain.getAddress(raw)
      assert.equal(result, raw)
    })

    it('should canonicalize non-bounceable user-friendly address to raw', () => {
      const raw = `0:${'ab'.repeat(32)}`
      const friendly = Address.parseRaw(raw).toString({ bounceable: false })
      const result = TONChain.getAddress(friendly)
      assert.equal(result, raw)
    })

    it('should canonicalize test-only user-friendly address to raw', () => {
      const raw = `0:${'cd'.repeat(32)}`
      const friendly = Address.parseRaw(raw).toString({
        bounceable: true,
        testOnly: true,
        urlSafe: true,
      })
      const result = TONChain.getAddress(friendly)
      assert.equal(result, raw)
    })

    it('should reject strings that look like raw format but are not valid addresses', () => {
      assert.throws(() => TONChain.getAddress('foo:bar'), /Unsupported data format/)
    })

    it('should throw for invalid length', () => {
      assert.throws(
        () => TONChain.getAddress('0x' + 'ab'.repeat(10)),
        /Invalid TON address bytes length/,
      )
    })
  })

  describe('formatAddress', () => {
    it('should convert raw format to friendly format', () => {
      const raw = `0:${'ab'.repeat(32)}`
      const result = TONChain.formatAddress(raw)
      // Should return friendly format starting with EQ (workchain 0, bounceable)
      assert.match(result, /^EQ/)
      // Verify round-trip: parsing back should give same raw address
      assert.equal(Address.parseRaw(raw).toString(), result)
    })

    it('should convert workchain -1 raw format to friendly format', () => {
      const raw = `-1:${'ab'.repeat(32)}`
      const result = TONChain.formatAddress(raw)
      // Workchain -1 uses Ef prefix (bounceable masterchain)
      assert.match(result, /^Ef/)
    })

    it('should return friendly format unchanged', () => {
      const friendly = 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2'
      const result = TONChain.formatAddress(friendly)
      assert.equal(result, friendly)
    })

    it('should return original if parsing fails', () => {
      const invalid = 'not-a-valid-address'
      const result = TONChain.formatAddress(invalid)
      assert.equal(result, invalid)
    })
  })

  describe('formatTxHash', () => {
    it('should extract hash from composite format', () => {
      const hash = 'abcd1234' + '5'.repeat(56)
      const composite = `0:${'a'.repeat(64)}:12345678:${hash}`
      const result = TONChain.formatTxHash(composite)
      assert.equal(result, hash)
    })

    it('should return raw hash unchanged', () => {
      const hash = 'a'.repeat(64)
      const result = TONChain.formatTxHash(hash)
      assert.equal(result, hash)
    })

    it('should return unknown format unchanged', () => {
      const unknown = 'some-unknown-format'
      const result = TONChain.formatTxHash(unknown)
      assert.equal(result, unknown)
    })

    it('should handle 3-part format (not composite) unchanged', () => {
      const threeParts = `0:${'a'.repeat(64)}:12345`
      const result = TONChain.formatTxHash(threeParts)
      assert.equal(result, threeParts)
    })
  })

  describe('isTxHash', () => {
    it('should accept 64-char hex hash', () => {
      assert.equal(TONChain.isTxHash('a'.repeat(64)), true)
    })

    it('should accept 0x-prefixed hex hash', () => {
      assert.equal(TONChain.isTxHash('0x' + 'a'.repeat(64)), true)
    })

    it('should accept composite format', () => {
      const hash = `0:${'a'.repeat(64)}:12345:${'b'.repeat(64)}`
      assert.equal(TONChain.isTxHash(hash), true)
    })

    it('should accept workchain -1', () => {
      const hash = `-1:${'a'.repeat(64)}:12345:${'b'.repeat(64)}`
      assert.equal(TONChain.isTxHash(hash), true)
    })

    it('should reject invalid formats', () => {
      assert.equal(TONChain.isTxHash('invalid'), false)
      assert.equal(TONChain.isTxHash('0x' + 'g'.repeat(64)), false) // invalid hex
      assert.equal(TONChain.isTxHash(123), false)
      assert.equal(TONChain.isTxHash(null), false)
    })
  })

  describe('getExecutionReceipts override', () => {
    const mockNetworkInfo = networkInfo('ton-testnet')

    const TEST_MESSAGE_ID = '0x' + '1'.repeat(64)
    const TEST_SOURCE_CHAIN_SELECTOR = 16015286601757825753n
    const TEST_OFFRAMP = '0:9f2e995aebceb97ae094dbe4cf973cbc8a402b4f0ac5287a00be8aca042d51b9'

    // Helper to create a valid ExecutionStateChanged BOC cell
    function createExecutionStateChangedCell(state: number) {
      return beginCell()
        .storeUint(TEST_SOURCE_CHAIN_SELECTOR, 64) // sourceChainSelector
        .storeUint(1n, 64) // sequenceNumber
        .storeUint(BigInt(TEST_MESSAGE_ID), 256) // messageId
        .storeUint(state, 8) // state
        .endCell()
    }

    // Helper to create a mock transaction with external-out message containing ExecutionStateChanged
    function createMockTransaction(state: number, lt: number, timestamp?: number) {
      const cell = createExecutionStateChangedCell(state)
      const txHash = Buffer.alloc(32)
      txHash.fill(lt % 256) // Different hash per lt
      const offRampAddress = Address.parse(TEST_OFFRAMP)
      const execStateChangedCrc = BigInt(crc32('ExecutionStateChanged'))

      return {
        tx: {
          lt: BigInt(lt),
          hash: () => txHash,
          now: timestamp ?? Math.floor(Date.now() / 1000),
          address: BigInt('0x' + offRampAddress.hash.toString('hex')),
          outMessages: new Map([
            [
              0,
              {
                info: {
                  type: 'external-out' as const,
                  src: offRampAddress,
                  dest: { value: execStateChangedCrc },
                },
                body: cell,
              },
            ],
          ]),
        },
      }
    }

    function createMockClient(transactions: ReturnType<typeof createMockTransaction>[]) {
      // Sort by lt descending (newest first) to match TON API behavior
      const sortedTxs = [...transactions].sort((a, b) => Number(b.tx.lt) - Number(a.tx.lt))
      // Link each tx to its predecessor (older = next in the desc list) so the getLogs
      // contiguity check sees an unbroken chain; the oldest links to genesis (0).
      sortedTxs.forEach((t, i) => {
        const tx = t.tx as { prevTransactionLt?: bigint; prevTransactionHash?: bigint }
        tx.prevTransactionLt = i < sortedTxs.length - 1 ? sortedTxs[i + 1]!.tx.lt : 0n
        tx.prevTransactionHash = 0n
      })

      let callCount = 0
      return {
        parameters: { endpoint: 'http://mock-ton-api' },
        ...mockMasterchain,
        getTransactions: async () => {
          // First call returns all transactions, subsequent calls return empty (end of history)
          if (callCount++ === 0) {
            return sortedTxs.map((t) => t.tx)
          }
          return []
        },
      } as unknown as TonClient
    }

    const baseRequest = {
      sourceChainSelector: TEST_SOURCE_CHAIN_SELECTOR,
      messageId: TEST_MESSAGE_ID,
      startTime: 1,
    }

    it('should filter out Untouched state (0)', async () => {
      const mockClient = createMockClient([
        createMockTransaction(0, 1000), // Untouched - should be filtered
        createMockTransaction(2, 1001), // Success - should be yielded
      ])

      const tonChain = new TONChain(mockClient, mockNetworkInfo, { fetch: mockTonFetch })

      const receipts = []
      for await (const receipt of tonChain.getExecutionReceipts({
        offRamp: TEST_OFFRAMP,
        ...baseRequest,
      })) {
        receipts.push(receipt)
      }

      // Should only have Success, not Untouched
      assert.equal(receipts.length, 1, 'Should have exactly 1 receipt')
      assert.equal(receipts[0]!.receipt.state, 2, 'Receipt state should be Success (2)')
    })

    it('should yield InProgress state (1) alongside other states', async () => {
      const mockClient = createMockClient([
        createMockTransaction(1, 1000), // InProgress - should be yielded
        createMockTransaction(3, 1001), // Failure - should be yielded
      ])

      const tonChain = new TONChain(mockClient, mockNetworkInfo, { fetch: mockTonFetch })

      const receipts = []
      for await (const receipt of tonChain.getExecutionReceipts({
        offRamp: TEST_OFFRAMP,
        ...baseRequest,
      })) {
        receipts.push(receipt)
      }

      // Both InProgress and Failure are yielded (InProgress fix: cbeae82d)
      assert.equal(receipts.length, 2, 'Should have exactly 2 receipts')
      assert.equal(receipts[0]!.receipt.state, 1, 'First receipt state should be InProgress (1)')
      assert.equal(receipts[1]!.receipt.state, 3, 'Second receipt state should be Failure (3)')
    })

    it('should yield both Success and Failure states', async () => {
      // Create transactions with timestamps in the past
      const pastTimestamp = 100 // Fixed timestamp for deterministic testing

      const mockClient = createMockClient([
        createMockTransaction(3, 1000, pastTimestamp), // Failure
        createMockTransaction(2, 1001, pastTimestamp + 1), // Success
      ])

      const tonChain = new TONChain(mockClient, mockNetworkInfo, { fetch: mockTonFetch })

      // Use startTime before the mock transactions so they are included
      const request = {
        sourceChainSelector: TEST_SOURCE_CHAIN_SELECTOR,
        messageId: TEST_MESSAGE_ID,
        startTime: pastTimestamp - 10, // Before mock tx timestamps
      }

      const receipts = []
      for await (const receipt of tonChain.getExecutionReceipts({
        offRamp: TEST_OFFRAMP,
        ...request,
      })) {
        receipts.push(receipt)
      }

      // Should have both Failure and Success
      assert.equal(receipts.length, 2, 'Should have exactly 2 receipts')
      const states = receipts.map((r) => r.receipt.state)
      assert.ok(states.includes(2), 'Should include Success state (2)')
      assert.ok(states.includes(3), 'Should include Failure state (3)')
    })

    it('should filter by messageId', async () => {
      // Create a cell with a different messageId
      const otherMessageIdCell = beginCell()
        .storeUint(TEST_SOURCE_CHAIN_SELECTOR, 64)
        .storeUint(1n, 64)
        .storeUint(BigInt('0x' + '2'.repeat(64)), 256) // Different messageId
        .storeUint(2, 8) // Success
        .endCell()

      // Create transactions: one with matching messageId, one with different
      const matchingTx = createMockTransaction(2, 1000) // Matching messageId - should be yielded
      const offRampAddress = Address.parse(TEST_OFFRAMP)
      const execStateChangedCrc = BigInt(crc32('ExecutionStateChanged'))
      const otherTx = {
        tx: {
          lt: BigInt(999),
          hash: () => Buffer.alloc(32, 0x99),
          now: Math.floor(Date.now() / 1000),
          address: BigInt('0x' + offRampAddress.hash.toString('hex')),
          outMessages: new Map([
            [
              0,
              {
                info: {
                  type: 'external-out' as const,
                  src: offRampAddress,
                  dest: { value: execStateChangedCrc },
                },
                body: otherMessageIdCell,
              },
            ],
          ]),
        },
      }

      const mockClient = createMockClient([matchingTx, otherTx])

      const tonChain = new TONChain(mockClient, mockNetworkInfo, { fetch: mockTonFetch })

      const receipts = []
      for await (const receipt of tonChain.getExecutionReceipts({
        offRamp: TEST_OFFRAMP,
        ...baseRequest,
      })) {
        receipts.push(receipt)
      }

      // Should only have the one with matching messageId
      assert.equal(receipts.length, 1, 'Should have exactly 1 receipt')
      assert.equal(receipts[0]!.receipt.messageId, TEST_MESSAGE_ID)
    })
  })

  describe('getLogs completeness (only whole, sealed masterchain blocks)', () => {
    const mockNetworkInfo = networkInfo('ton-testnet')
    const OFFRAMP = '0:9f2e995aebceb97ae094dbe4cf973cbc8a402b4f0ac5287a00be8aca042d51b9'
    const ROOT_SHARD = '-9223372036854775808'
    const topicCrc = crc32('ExecutionStateChanged')

    // Each masterchain block N commits account txs up to shard end_lt N*1000. Account txs
    // live at lt = block*1000 + k (k in 1..99), all within block N's shard block.
    const SHARD_END = (seqno: number) => BigInt(seqno * 1000 + 999)
    const blockOf = (lt: bigint) => Math.floor(Number(lt) / 1000)

    function tx(lt: number) {
      const buf = Buffer.alloc(32)
      buf.writeUInt32BE(lt >>> 0, 28)
      const cell = beginCell()
        .storeUint(16015286601757825753n, 64)
        .storeUint(1n, 64)
        .storeUint(BigInt('0x' + '1'.repeat(64)), 256)
        .storeUint(2, 8)
        .endCell()
      return {
        lt: BigInt(lt),
        hash: () => buf,
        now: 100 + lt,
        address: BigInt('0x' + Address.parse(OFFRAMP).hash.toString('hex')),
        outMessages: new Map([
          [
            0,
            {
              info: {
                type: 'external-out' as const,
                src: Address.parse(OFFRAMP),
                dest: { value: BigInt(crc32('ExecutionStateChanged')) },
                createdLt: BigInt(lt),
              },
              body: cell,
            },
          ],
        ]),
      }
    }

    // Build a chain whose masterchain tip is `latest` and whose real account history is
    // `all` (ascending); the client only returns `all \ missing`, so a `missing` lt appears
    // on-chain (its successor still links to it via prevTransactionLt) but isn't indexed yet —
    // i.e. a gap. lookupBlock deliberately UNDER-assigns (returns block-1) to exercise the
    // committingSeqno climb. getTransactions honours the (lt, hash, to_lt, limit) cursor.
    function makeChain(
      latest: number,
      all: number[],
      missing: number[] = [],
      { underAssign = true }: { underAssign?: boolean } = {},
    ) {
      const asc = [...all].sort((a, b) => a - b)
      // Link each lt to its true on-chain predecessor (over the FULL history).
      const prevLt = new Map<bigint, bigint>()
      asc.forEach((lt, i) => prevLt.set(BigInt(lt), i > 0 ? BigInt(asc[i - 1]!) : 0n))
      const present = asc.filter((lt) => !missing.includes(lt))
      const linked = present
        .map(tx)
        .reverse()
        .map((t) => ({ ...t, prevTransactionLt: prevLt.get(t.lt)!, prevTransactionHash: 0n }))

      const fetchImpl = (async (_url: unknown, opts?: { body?: string }) => {
        const body = JSON.parse(opts?.body ?? '{}') as { method?: string; params?: { lt?: string } }
        if (body.method === 'lookupBlock') {
          const block = blockOf(BigInt(body.params!.lt!))
          const seqno = underAssign ? Math.max(1, block - 1) : block // under-assign by 1
          return new Response(JSON.stringify({ result: { seqno } }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error(`unexpected fetch method=${body.method}`)
      }) as unknown as typeof fetch

      const client = {
        parameters: { endpoint: 'http://mock-ton-api' },
        getMasterchainInfo: async () => ({ workchain: -1, shard: ROOT_SHARD, latestSeqno: latest }),
        getWorkchainShards: async (seqno: number) => [{ workchain: 0, shard: ROOT_SHARD, seqno }],
        getTransactions: async (
          _a: Address,
          o: { limit: number; lt?: string; hash?: string; to_lt?: string; inclusive?: boolean },
        ) => {
          let start = 0
          if (o.lt != null) {
            const at = linked.findIndex((t) => t.lt === BigInt(o.lt!))
            start = at < 0 ? linked.length : o.inclusive ? at : at + 1
          }
          let page = linked.slice(start, start + o.limit)
          if (o.to_lt != null) page = page.filter((t) => t.lt >= BigInt(o.to_lt!))
          return page as unknown as Awaited<ReturnType<TonClient['getTransactions']>>
        },
      } as unknown as TonClient

      const chain = new TONChain(client, mockNetworkInfo, { fetch: fetchImpl })
      // The block header (shard end_lt) is fetched via rateLimitedFetch → override it here
      // to serve SHARD_END per seqno, since our fetchImpl only handles lookupBlock.
      ;(
        chain as unknown as {
          getShardBlockEndLt: (w: number, s: string, n: number) => Promise<bigint>
        }
      ).getShardBlockEndLt = async (_w, _s, seqno) => SHARD_END(seqno)
      return chain
    }

    async function collect(chain: TONChain, opts: Record<string, unknown>) {
      const out: { block: number; lt: string }[] = []
      for await (const l of chain.getLogs({
        address: OFFRAMP,
        topics: ['ExecutionStateChanged'],
        finality: -1,
        ...opts,
      } as never)) {
        assert.equal(l.topics[0], topicCrc)
        out.push({ block: l.blockNumber, lt: String(l.index) })
      }
      return out
    }

    it('assigns the authoritative committing seqno despite lookupBlock under-assigning', async () => {
      const chain = makeChain(20, [10_005]) // block 10; lookupBlock returns 9
      const seqno = await (
        chain as unknown as { committingSeqno: (lt: bigint, a: Address) => Promise<number> }
      ).committingSeqno(10_005n, Address.parse(OFFRAMP))
      assert.equal(seqno, 10, 'climbs from the under-assigned 9 to the true committing block 10')
    })

    it('emits sealed blocks but holds the unsealed tip block', async () => {
      // Tip = block 12; conf=1 ⇒ cutoff 11. Txs in blocks 10, 11 (sealed) and 12 (tip).
      const chain = makeChain(12, [10_001, 11_001, 12_001])
      const logs = await collect(chain, { startBlock: 1 })
      assert.deepEqual(
        logs.map((l) => l.block),
        [10, 11],
        'blocks 10 & 11 emitted; the tip block 12 is withheld until sealed',
      )
    })

    it('stops before a block missing a transaction (index lag → chain gap)', async () => {
      // Block 11 should have txs 11_001 and 11_002, but 11_002 is not yet indexed. The gap
      // (11_003.prevTransactionLt points at the missing 11_002) must prevent emitting block
      // 11 at all — only the fully-contiguous block 10 is emitted.
      const chain = makeChain(20, [10_001, 11_001, 11_002, 11_003, 12_001], [11_002])
      const logs = await collect(chain, { startBlock: 1 })
      assert.deepEqual(
        logs.map((l) => l.block),
        [10],
        'a gap in block 11 withholds block 11 and everything after; block 10 still emits',
      )
    })

    it('resumes strictly after the startBlock in account-shard lt space', async () => {
      // startBlock 11 ⇒ resume after block 10's shard end_lt; block 10 txs must be excluded.
      const chain = makeChain(13, [10_001, 11_001, 12_001])
      const logs = await collect(chain, { startBlock: 11 })
      assert.deepEqual(
        logs.map((l) => l.block),
        [11, 12],
        'block 10 (below startBlock) excluded; 11 & 12 are sealed (tip 13)',
      )
    })

    it('scans normally when startBlock commits no transaction (floor lands past it)', async () => {
      // Regression (ton-testnet pollExecutions): a masterchain block that references the
      // same shard block as its predecessor leaves the shard end_lt unchanged, so the
      // resume lt derived from block 10 first commits at block 12, past startBlock 11.
      // That is normal — block 11 commits nothing for this account, so there is nothing
      // to skip — and must not fail the scan (it used to throw "Inconsistent TON cursor",
      // failing the getLogs activity on roughly every other poll).
      const chain = makeChain(13, [12_001])
      ;(
        chain as unknown as {
          getShardBlockEndLt: (w: number, s: string, n: number) => Promise<bigint>
        }
      ).getShardBlockEndLt = async (_w, _s, seqno) => SHARD_END(seqno === 11 ? 10 : seqno)
      const logs = await collect(chain, { startBlock: 11 })
      assert.deepEqual(
        logs.map((l) => l.block),
        [12],
        'the scan proceeds and emits block 12 instead of failing',
      )
    })

    it('stops the scan when a tx commits below startBlock', async () => {
      // The same disagreement from the emit side: the floor checks out, but the tx it
      // returns is assigned a block below startBlock. Emitting it would rewind the poller's
      // watermark over blocks this scan never covered, so the scan stops with nothing.
      const chain = makeChain(13, [11_001, 12_001])
      ;(
        chain as unknown as { committingSeqno: (lt: bigint, a: Address) => Promise<number> }
      ).committingSeqno = async () => 10
      assert.deepEqual(await collect(chain, { startBlock: 11 }), [])
    })

    describe('since resume hint', () => {
      // The composite hash getTransaction stamps: "workchain:address:lt:hash" — the lt in
      // position 2 is the exact per-account cursor the hint resumes from.
      const hintFor = (lt: number, block = blockOf(BigInt(lt)), address = OFFRAMP) => ({
        address,
        blockNumber: block,
        blockTimestamp: 100 + lt,
        transactionHash: `${address}:${lt}:${'ab'.repeat(32)}`,
        index: lt,
      })

      it('resumes strictly after the hinted tx, raising a stale startBlock floor', async () => {
        // startBlock 1 walks from genesis; the hint at 11_001 lifts the floor so block 10
        // is never scanned. Exclusive (matching the (lt, hash) cursor): the hinted tx
        // itself is not re-streamed, but its same-block follower (11_002) still is.
        const chain = makeChain(13, [10_001, 11_001, 11_002, 12_001])
        const logs = await collect(chain, { startBlock: 1, since: hintFor(11_001) })
        assert.deepEqual(
          logs.map((l) => l.lt),
          ['11002', '12001'],
          'block 10 and the hinted tx skipped; the same-block follower still emitted',
        )
      })

      it('skips the shard floor lookup when the hint block covers startBlock', async () => {
        // No lookupBlock under-assignment here, so committingSeqno only touches each tx's
        // own block; the floor lookup for startBlock-1 (=10) is then observable directly.
        const chain = makeChain(13, [11_001, 11_002, 12_001], [], { underAssign: false })
        const shardCalls: number[] = []
        const orig = chain.provider.getWorkchainShards.bind(chain.provider)
        chain.provider.getWorkchainShards = async (seqno: number) => {
          shardCalls.push(seqno)
          return orig(seqno)
        }
        const logs = await collect(chain, { startBlock: 11, since: hintFor(11_001) })
        assert.deepEqual(
          logs.map((l) => l.block),
          [11, 12],
        )
        assert.ok(
          !shardCalls.includes(10),
          `startBlock-1 shard lookup must be skipped, got calls: ${shardCalls.join(',')}`,
        )
      })

      it('runs the floor lookup when the hint is older than startBlock', async () => {
        const chain = makeChain(13, [10_001, 11_001, 12_001], [], { underAssign: false })
        const shardCalls: number[] = []
        const orig = chain.provider.getWorkchainShards.bind(chain.provider)
        chain.provider.getWorkchainShards = async (seqno: number) => {
          shardCalls.push(seqno)
          return orig(seqno)
        }
        const logs = await collect(chain, { startBlock: 11, since: hintFor(10_001) })
        assert.deepEqual(
          logs.map((l) => l.block),
          [11, 12],
          'hint below startBlock has no effect on the results',
        )
        assert.ok(
          shardCalls.includes(10),
          `startBlock-1 shard lookup must still run, got calls: ${shardCalls.join(',')}`,
        )
      })

      it('ignores a malformed or foreign-address hint', async () => {
        const chain = makeChain(13, [11_001, 12_001])
        const bad = await collect(chain, {
          startBlock: 11,
          since: { transactionHash: 'not-a-composite-hash' },
        })
        assert.deepEqual(
          bad.map((l) => l.block),
          [11, 12],
        )
        const foreign = await collect(chain, {
          startBlock: 11,
          since: hintFor(11_001, 11, '0:' + '2'.repeat(64)),
        })
        assert.deepEqual(
          foreign.map((l) => l.block),
          [11, 12],
        )
      })

      it('provides the floor directly on startTime-only scans', async () => {
        const chain = makeChain(13, [10_001, 11_001, 12_001])
        const logs = await collect(chain, { startTime: 1, since: hintFor(11_001) })
        assert.deepEqual(
          logs.map((l) => l.block),
          [12],
          'no startBlock conversion needed: the hint lt is already the floor (exclusive)',
        )
      })
    })
  })

  describe('generateUnsignedSendMessage', () => {
    const sendMockNetworkInfo = networkInfo('ton-testnet')

    function createMockClient(feeToReturn: bigint) {
      const runMethodMock = mock.fn(async (_addr: Address, method: string) => {
        if (method === 'onRamp') {
          return {
            stack: {
              readAddress: () => Address.parse('EQC-GtbjW4hz_gXOiBOxT0_Jj-EYkI_zjQ-H8VyYHH9fbSd6'),
            },
          }
        }
        if (method === 'feeQuoter') {
          return {
            stack: {
              readAddress: () => Address.parse('EQAoCywn6WT8_R_ydtFzcYlcwWTWXG35w4Zbbhye_u2I0RnI'),
            },
          }
        }
        if (method === 'validatedFee') {
          return { stack: { readBigNumber: () => feeToReturn } }
        }
        throw new Error(`Unknown method: ${method}`)
      })

      return {
        client: {
          runMethod: runMethodMock,
          getTransactions: async () => [],
        } as unknown as TonClient,
        runMethodMock,
      }
    }

    it('should return UnsignedTONTx with family=TON', async () => {
      const { client } = createMockClient(1_000_000_000n)
      const chain = new TONChain(client, sendMockNetworkInfo)

      const unsigned = await chain.generateUnsignedSendMessage({
        router: 'EQDWS-oJCjyrf-6c1wF5eGP7b2qNWn7wUqS3dlNgb_YzKNHG',
        destChainSelector: 16015286601757825753n,
        sender: 'EQDnhv_asmNh0FRlrwsT023NC4C_JgxBc8cMgKlwiVuU_zuT',
        message: {
          receiver: '0x40d7c009d073e0d740ed2c50ca0a48c84a3f8b47',
          data: '0x1234',
          extraArgs: { gasLimit: 200_000n, allowOutOfOrderExecution: true },
        },
      })

      assert.equal(unsigned.family, ChainFamily.TON)
      assert.ok(unsigned.to)
      assert.ok(unsigned.body)
      assert.ok(unsigned.value !== undefined && unsigned.value > 0n)
    })

    it('should skip fee quote when fee is provided', async () => {
      const { client, runMethodMock } = createMockClient(1_000_000_000n)
      const chain = new TONChain(client, sendMockNetworkInfo)

      await chain.generateUnsignedSendMessage({
        router: 'EQDWS-oJCjyrf-6c1wF5eGP7b2qNWn7wUqS3dlNgb_YzKNHG',
        destChainSelector: 16015286601757825753n,
        sender: 'EQDnhv_asmNh0FRlrwsT023NC4C_JgxBc8cMgKlwiVuU_zuT',
        message: {
          receiver: '0x40d7c009d073e0d740ed2c50ca0a48c84a3f8b47',
          data: '0x',
          fee: 5_000_000_000n,
          extraArgs: { gasLimit: 200_000n, allowOutOfOrderExecution: true },
        },
      })

      const validatedFeeCalls = runMethodMock.mock.calls.filter(
        (c: { arguments: [Address, string] }) => c.arguments[1] === 'validatedFee',
      )
      assert.equal(validatedFeeCalls.length, 0)
    })
  })

  describe('getBalance', () => {
    const mockNetworkInfo = networkInfo('ton-testnet')
    const TON_FAUCET = 'EQAuz15H1ZHrZ_psVrAra7HealMIVeFq0wguqlmFno1f3EJj'
    const USDT_TESTNET = 'kQD0GKBM8ZbryVk2aESmzfU6b9b_8era_IkvBSELujFZPsyy'

    it('should return native GRAM balance when no token specified', async () => {
      const mockClient = {
        getContractState: async () => ({ balance: 1_500_000_000n }),
        getTransactions: async () => [],
      } as unknown as TonClient

      const chain = new TONChain(mockClient, mockNetworkInfo)
      const balance = await chain.getBalance({
        holder: TON_FAUCET,
      })

      assert.equal(balance, 1_500_000_000n)
    })

    it('should return jetton balance when token specified', async () => {
      const mockJettonWallet = Address.parse('EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa')
      const mockClient = {
        runMethod: async (_addr: Address, method: string) => {
          if (method === 'get_wallet_address') {
            return { stack: { readAddress: () => mockJettonWallet } }
          }
          if (method === 'get_wallet_data') {
            return { stack: { readBigNumber: () => 500_000_000n } }
          }
          throw new Error(`Unknown method: ${method}`)
        },
        getTransactions: async () => [],
      } as unknown as TonClient

      const chain = new TONChain(mockClient, mockNetworkInfo)
      const balance = await chain.getBalance({
        holder: TON_FAUCET,
        token: USDT_TESTNET,
      })

      assert.equal(balance, 500_000_000n)
    })

    it('should return 0n when jetton wallet does not exist', async () => {
      const mockJettonWallet = Address.parse('EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa')
      const mockClient = {
        runMethod: async (_addr: Address, method: string) => {
          if (method === 'get_wallet_address') {
            return { stack: { readAddress: () => mockJettonWallet } }
          }
          if (method === 'get_wallet_data') {
            throw new Error('Account not found')
          }
          throw new Error(`Unknown method: ${method}`)
        },
        getTransactions: async () => [],
      } as unknown as TonClient

      const chain = new TONChain(mockClient, mockNetworkInfo)
      const balance = await chain.getBalance({
        holder: TON_FAUCET,
        token: USDT_TESTNET,
      })

      assert.equal(balance, 0n)
    })
  })
})
