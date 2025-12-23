import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Cell, Address, Dictionary, beginCell, toNano } from '@ton/core'
import type { KeyPair } from '@ton/crypto'
import type { TonClient4, WalletContractV4 } from '@ton/ton'

import { type ExecutionReport, ChainFamily } from '../types.ts'
import { TONChain } from './index.ts'
import { type CCIPMessage_V1_6_TON, type TONWallet, MANUALLY_EXECUTE_OPCODE } from './types.ts'

describe('TON index unit tests', () => {
  // Test constants from chainlink-ton test suite
  const CHAINSEL_EVM_TEST_90000001 = 909606746561742123n
  const CHAINSEL_TON = 13879075125137744094n
  const EVM_SENDER_ADDRESS_TEST = '0x1a5fdbc891c5d4e6ad68064ae45d43146d4f9f3a'
  const TON_OFFRAMP_ADDRESS_TEST =
    '0:9f2e995aebceb97ae094dbe4cf973cbc8a402b4f0ac5287a00be8aca042d51b9'

  // Shared test data
  const baseExecReport: ExecutionReport<CCIPMessage_V1_6_TON> = {
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

  const mockNetworkInfo = {
    family: ChainFamily.TON,
    chainSelector: CHAINSEL_TON,
    chainId: 'ton-testnet',
    name: 'TON Testnet',
    isTestnet: true,
  }
  describe('executeReport', () => {
    const mockKeyPair: KeyPair = {
      publicKey: Buffer.alloc(32, 0x01),
      secretKey: Buffer.alloc(64, 0x02),
    }
    const mockWalletAddress = Address.parse('EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa')

    function createMockClientAndWallet(opts?: {
      seqno?: number
      shouldFail?: boolean
      txLt?: string
      txHash?: string
    }) {
      let capturedTransfer: {
        seqno: number
        secretKey: Buffer
        messages: Array<{ to: Address; value: bigint; body: Cell }>
      } | null = null

      const mockTxLt = opts?.txLt ?? '12345678'
      const mockTxHash =
        opts?.txHash ?? 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      const currentSeqno = opts?.seqno ?? 0

      const mockOpenedWallet = {
        getSeqno: async () => currentSeqno,
        sendTransfer: async (params: {
          seqno: number
          secretKey: Buffer
          messages: Array<{ info: { dest: Address; value: { coins: bigint } }; body: Cell }>
        }) => {
          if (opts?.shouldFail) {
            throw new Error('Transaction failed')
          }
          capturedTransfer = {
            seqno: params.seqno,
            secretKey: params.secretKey,
            messages: params.messages.map((m) => ({
              to: m.info.dest,
              value: m.info.value.coins,
              body: m.body,
            })),
          }
        },
      }

      const mockOutMessage = {
        info: {
          type: 'internal' as const,
          dest: Address.parse(TON_OFFRAMP_ADDRESS_TEST),
        },
      }

      const mockTx = {
        lt: BigInt(mockTxLt),
        hash: () => Buffer.from(mockTxHash, 'hex'),
        now: Math.floor(Date.now() / 1000),
        outMessages: { values: () => [mockOutMessage] },
        inMessage: { info: { type: 'internal', src: mockWalletAddress } },
      }

      const mockClient = {
        open: () => mockOpenedWallet,
        getLastBlock: async () => ({
          last: { seqno: 12345678 },
          now: Math.floor(Date.now() / 1000),
        }),
        runMethod: async (_seqno: number, _address: Address, method: string) => {
          if (method === 'seqno') {
            // Return seqno+1 to simulate transaction confirmed
            return { reader: { readNumber: () => currentSeqno + 1 } }
          }
          throw new Error(`Unknown method: ${method}`)
        },
        getAccountLite: async () => ({
          account: {
            last: {
              lt: mockTxLt,
              hash: Buffer.from(mockTxHash, 'hex').toString('base64'),
            },
          },
        }),
        getAccountTransactions: async () => [{ tx: mockTx }],
      } as unknown as TonClient4

      const mockWallet: TONWallet = {
        contract: { address: mockWalletAddress } as WalletContractV4,
        keyPair: mockKeyPair,
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
      const tonChain = new TONChain(client, mockNetworkInfo as any)

      await tonChain.executeReport(TON_OFFRAMP_ADDRESS_TEST, baseExecReport, { wallet })

      const captured = getCapturedTransfer()
      assert.ok(captured, 'sendTransfer should be called')
      assert.equal(captured.seqno, 42, 'should use wallet seqno')
      assert.equal(captured.messages.length, 1, 'should send single message')
      assert.equal(
        captured.messages[0].to.toRawString(),
        TON_OFFRAMP_ADDRESS_TEST,
        'should send to offRamp address',
      )
      assert.equal(captured.messages[0].value, toNano('0.3'), 'should send 0.3 TON for gas')
    })

    it('should build Cell body with MANUALLY_EXECUTE_OPCODE', async () => {
      const { client, wallet, getCapturedTransfer } = createMockClientAndWallet()
      const tonChain = new TONChain(client, mockNetworkInfo as any)

      await tonChain.executeReport(TON_OFFRAMP_ADDRESS_TEST, baseExecReport, { wallet })

      const captured = getCapturedTransfer()!
      const slice = captured.messages[0].body.beginParse()

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
      const tonChain = new TONChain(client, mockNetworkInfo as any)

      const result = await tonChain.executeReport(TON_OFFRAMP_ADDRESS_TEST, baseExecReport, {
        wallet,
      })

      const [workchain, address, lt, hash] = result.hash.split(':')
      assert.equal(workchain, '0', 'workchain should be 0')
      assert.equal(address.length, 64, 'address should be 64 hex chars')
      assert.equal(lt, mockTxLt, 'lt should match transaction lt')
      assert.equal(hash, mockTxHash, 'hash should match transaction hash')
    })

    it('should reject non-TON wallet', async () => {
      const { client } = createMockClientAndWallet()
      const tonChain = new TONChain(client, mockNetworkInfo as any)

      await assert.rejects(
        tonChain.executeReport(TON_OFFRAMP_ADDRESS_TEST, baseExecReport, {
          wallet: { invalid: true },
        }),
        /Wallet must be a Signer/,
      )
    })

    it('should reject non-V1.6 execution report', async () => {
      const { client, wallet } = createMockClientAndWallet()
      const tonChain = new TONChain(client, mockNetworkInfo as any)

      const v1_5Report = {
        message: { messageId: '0x' + '1'.repeat(64), strict: false },
        proofs: [],
        proofFlagBits: 0n,
        merkleRoot: '0xce60f1962af3c7c7f9d3e434dea13530564dbff46704d628ff4b2206bbc93289',
        offchainTokenData: [],
      }

      await assert.rejects(
        tonChain.executeReport(TON_OFFRAMP_ADDRESS_TEST, v1_5Report as any, { wallet }),
        /Invalid extraArgs for TON/,
      )
    })

    it('should propagate sendTransfer errors', async () => {
      const { client, wallet } = createMockClientAndWallet({ shouldFail: true })
      const tonChain = new TONChain(client, mockNetworkInfo as any)

      await assert.rejects(
        tonChain.executeReport(TON_OFFRAMP_ADDRESS_TEST, baseExecReport, { wallet }),
        /Transaction failed/,
      )
    })
  })

  describe('generateUnsignedExecuteReport', () => {
    it('should return UnsignedTONTx with family=ton', async () => {
      const tonChain = new TONChain({} as TonClient4, mockNetworkInfo as any)

      const unsigned = await tonChain.generateUnsignedExecuteReport(
        '0:' + 'b'.repeat(64),
        TON_OFFRAMP_ADDRESS_TEST,
        baseExecReport,
      )

      assert.equal(unsigned.family, 'ton')
      assert.equal(unsigned.to, TON_OFFRAMP_ADDRESS_TEST)
      assert.ok(unsigned.body instanceof Object, 'body should be a Cell')
    })

    it('should reject non-V1.6 message format', () => {
      const tonChain = new TONChain({} as TonClient4, mockNetworkInfo as any)

      const v1_5Report = {
        message: { messageId: '0x' + '1'.repeat(64), strict: false },
        proofs: [],
        proofFlagBits: 0n,
        merkleRoot: '0xce60f1962af3c7c7f9d3e434dea13530564dbff46704d628ff4b2206bbc93289',
        offchainTokenData: [],
      }

      assert.throws(
        () =>
          tonChain.generateUnsignedExecuteReport(
            '0:' + 'b'.repeat(64),
            TON_OFFRAMP_ADDRESS_TEST,
            v1_5Report as any,
          ),
        /Invalid extraArgs for TON/,
      )
    })
  })

  describe('typeAndVersion', () => {
    const mockNetworkInfo = {
      family: ChainFamily.TON,
      chainSelector: 13879075125137744094n,
      chainId: 'ton-testnet',
      name: 'TON Testnet',
      isTestnet: true,
    }

    function createMockClient(opts: { contractType: string; version: string }) {
      const typeCell = beginCell().storeStringTail(opts.contractType).endCell()
      const versionCell = beginCell().storeStringTail(opts.version).endCell()

      return {
        getLastBlock: async () => ({ last: { seqno: 12345678 } }),
        runMethod: async (_seqno: number, _address: Address, method: string) => {
          if (method === 'typeAndVersion') {
            let readIndex = 0
            return {
              reader: {
                readCell: () => {
                  readIndex++
                  return readIndex === 1 ? typeCell : versionCell
                },
              },
            }
          }
          throw new Error(`Unknown method: ${method}`)
        },
      } as unknown as TonClient4
    }

    it('should parse OffRamp type and version', async () => {
      const client = createMockClient({
        contractType: 'com.chainlink.ton.ccip.OffRamp',
        version: '1.6.0',
      })
      const tonChain = new TONChain(client, mockNetworkInfo as any)

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
      const tonChain = new TONChain(client, mockNetworkInfo as any)

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
      const tonChain = new TONChain(client, mockNetworkInfo as any)

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
      const tonChain = new TONChain(client, mockNetworkInfo as any)

      const result = await tonChain.typeAndVersion(
        'EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa',
      )

      assert.equal(result[0], 'OffRamp')
      assert.equal(result[1], '1.6.0')
    })
  })
  describe('getTokenInfo', () => {
    const mockNetworkInfo = {
      family: ChainFamily.TON,
      chainSelector: 13879075125137744094n,
      chainId: 'ton-testnet',
      name: 'TON Testnet',
      isTestnet: true,
    }

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
        getLastBlock: async () => ({ last: { seqno: 12345678 } }),
        runMethod: async (_seqno: number, _address: Address, method: string) => {
          if (method === 'get_jetton_data') {
            return {
              reader: {
                readBigNumber: () => opts.totalSupply ?? 1000000000n,
                readAddress: () => mockAddress,
                readCell: () => contentCell,
              },
            }
          }
          throw new Error(`Unknown method: ${method}`)
        },
      } as unknown as TonClient4
    }

    it('should parse onchain jetton metadata with symbol and decimals', async () => {
      const client = createMockClientForJetton({
        contentType: 'onchain',
        symbol: 'USDT',
        decimals: 6,
      })
      const tonChain = new TONChain(client, mockNetworkInfo as any)

      const result = await tonChain.getTokenInfo('EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa')

      assert.equal(result.symbol, 'USDT')
      assert.equal(result.decimals, 6)
    })

    it('should return defaults for onchain metadata without symbol/decimals', async () => {
      const client = createMockClientForJetton({
        contentType: 'onchain',
      })
      const tonChain = new TONChain(client, mockNetworkInfo as any)

      const result = await tonChain.getTokenInfo('EQCVYafY2dq6dxpJXxm0ugndeoCi1uohtNthyotzpcGVmaoa')

      assert.equal(result.symbol, 'JETTON')
      assert.equal(result.decimals, 9)
    })

    it('should return defaults when get_jetton_data fails', async () => {
      const client = {
        getLastBlock: async () => ({ last: { seqno: 12345678 } }),
        runMethod: async () => {
          throw new Error('Contract not found')
        },
      } as unknown as TonClient4

      const tonChain = new TONChain(client, mockNetworkInfo as any)

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
        getLastBlock: async () => ({ last: { seqno: 12345678 } }),
        runMethod: async () => ({
          reader: {
            readBigNumber: () => 1000000000n,
            readAddress: () => mockAddress,
            readCell: () => contentCell,
          },
        }),
      } as unknown as TonClient4

      const tonChain = new TONChain(client, mockNetworkInfo as any)
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

  describe('fetchExecutionReceipts override', () => {
    const mockNetworkInfo = {
      family: ChainFamily.TON,
      chainSelector: 13879075125137744094n,
      chainId: 'ton-testnet',
      name: 'TON Testnet',
      isTestnet: true,
    }

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

      return {
        tx: {
          lt: BigInt(lt),
          hash: () => txHash,
          now: timestamp ?? Math.floor(Date.now() / 1000),
          outMessages: {
            values: () => [
              {
                info: { type: 'external-out' as const },
                body: cell,
              },
            ],
          },
        },
      }
    }

    function createMockClient(transactions: ReturnType<typeof createMockTransaction>[]) {
      // Sort by lt descending (newest first) to match TON API behavior
      const sortedTxs = [...transactions].sort((a, b) => Number(b.tx.lt) - Number(a.tx.lt))
      const latestTx = sortedTxs[0]

      let callCount = 0
      return {
        getLastBlock: async () => ({
          last: { seqno: 12345678 },
          now: Math.floor(Date.now() / 1000),
        }),
        getAccountLite: async () => ({
          account: {
            last: {
              lt: latestTx.tx.lt.toString(),
              hash: latestTx.tx.hash().toString('base64'),
            },
          },
        }),
        getAccountTransactions: async () => {
          // First call returns all transactions, subsequent calls return empty (end of history)
          if (callCount++ === 0) {
            return sortedTxs
          }
          return []
        },
      } as unknown as TonClient4
    }

    const baseRequest = {
      lane: { sourceChainSelector: TEST_SOURCE_CHAIN_SELECTOR },
      message: { messageId: TEST_MESSAGE_ID },
      tx: { timestamp: 0 },
    }

    it('should filter out Untouched state (0)', async () => {
      const mockClient = createMockClient([
        createMockTransaction(0, 1000), // Untouched - should be filtered
        createMockTransaction(2, 1001), // Success - should be yielded
      ])

      const tonChain = new TONChain(mockClient, mockNetworkInfo as any)

      const receipts = []
      for await (const receipt of tonChain.fetchExecutionReceipts(
        TEST_OFFRAMP,
        baseRequest as any,
      )) {
        receipts.push(receipt)
      }

      // Should only have Success, not Untouched
      assert.equal(receipts.length, 1, 'Should have exactly 1 receipt')
      assert.equal(receipts[0].receipt.state, 2, 'Receipt state should be Success (2)')
    })

    it('should filter out InProgress state (1)', async () => {
      const mockClient = createMockClient([
        createMockTransaction(1, 1000), // InProgress - should be filtered
        createMockTransaction(3, 1001), // Failure - should be yielded
      ])

      const tonChain = new TONChain(mockClient, mockNetworkInfo as any)

      const receipts = []
      for await (const receipt of tonChain.fetchExecutionReceipts(
        TEST_OFFRAMP,
        baseRequest as any,
      )) {
        receipts.push(receipt)
      }

      // Should only have Failure, not InProgress
      assert.equal(receipts.length, 1, 'Should have exactly 1 receipt')
      assert.equal(receipts[0].receipt.state, 3, 'Receipt state should be Failure (3)')
    })

    it('should yield both Success and Failure states', async () => {
      // Create transactions with timestamps in the past
      const pastTimestamp = 100 // Fixed timestamp for deterministic testing

      const mockClient = createMockClient([
        createMockTransaction(3, 1000, pastTimestamp), // Failure
        createMockTransaction(2, 1001, pastTimestamp + 1), // Success
      ])

      const tonChain = new TONChain(mockClient, mockNetworkInfo as any)

      // Use startTime before the mock transactions so they are included
      const request = {
        lane: { sourceChainSelector: TEST_SOURCE_CHAIN_SELECTOR },
        message: { messageId: TEST_MESSAGE_ID },
        tx: { timestamp: pastTimestamp - 10 }, // Before mock tx timestamps
      }

      const receipts = []
      for await (const receipt of tonChain.fetchExecutionReceipts(TEST_OFFRAMP, request as any)) {
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
      const otherTx = {
        tx: {
          lt: BigInt(999),
          hash: () => Buffer.alloc(32, 0x99),
          now: Math.floor(Date.now() / 1000),
          outMessages: {
            values: () => [
              {
                info: { type: 'external-out' as const },
                body: otherMessageIdCell,
              },
            ],
          },
        },
      }

      // Sort by lt descending (newest first)
      const sortedTxs = [matchingTx, otherTx].sort((a, b) => Number(b.tx.lt) - Number(a.tx.lt))
      const latestTx = sortedTxs[0]

      let callCount = 0
      const mockClient = {
        getLastBlock: async () => ({
          last: { seqno: 12345678 },
          now: Math.floor(Date.now() / 1000),
        }),
        getAccountLite: async () => ({
          account: {
            last: {
              lt: latestTx.tx.lt.toString(),
              hash: latestTx.tx.hash().toString('base64'),
            },
          },
        }),
        getAccountTransactions: async () => {
          // First call returns all transactions, subsequent calls return empty
          if (callCount++ === 0) {
            return sortedTxs
          }
          return []
        },
      } as unknown as TonClient4

      const tonChain = new TONChain(mockClient, mockNetworkInfo as any)

      const receipts = []
      for await (const receipt of tonChain.fetchExecutionReceipts(
        TEST_OFFRAMP,
        baseRequest as any,
      )) {
        receipts.push(receipt)
      }

      // Should only have the one with matching messageId
      assert.equal(receipts.length, 1, 'Should have exactly 1 receipt')
      assert.equal(receipts[0].receipt.messageId, TEST_MESSAGE_ID)
    })
  })
})
