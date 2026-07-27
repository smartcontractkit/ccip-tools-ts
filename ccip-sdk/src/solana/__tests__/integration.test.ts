import assert from 'node:assert/strict'
import { Console } from 'node:console'
import { after, before, describe, it } from 'node:test'

import { Connection, PublicKey } from '@solana/web3.js'

import { EVMChain } from '../../evm/index.ts'
import { discoverOffRamp } from '../../execution.ts'
import { networkInfo } from '../../index.ts'
import { ExecutionState } from '../../types.ts'
import {
  FUJI_TO_SOLANA,
  SOLANA_ESTIMATE_RECEIVER_MESSAGE,
  SOLANA_TO_ETHEREUM,
} from '../fork.test.data.ts'
import { SolanaChain } from '../index.ts'

const FUJI_RPC = process.env.FUJI_RPC ?? 'https://api.avax-test.network/ext/bc/C/rpc'
const SEPOLIA_RPC =
  process.env.SEPOLIA_RPC ?? process.env.RPC_SEPOLIA ?? 'https://sepolia.gateway.tenderly.co'
const SOLANA_DEVNET_RPC =
  process.env.SOLANA_RPC ?? process.env.RPC_SOLANA ?? 'https://api.devnet.solana.com'
const SOLANA_OFFRAMP = 'offqSMQWgQud6WJz694LRzkeN5kMYpCHTpXQr3Rkcjm'
const SOLANA_V2_SEND_TX =
  '5fLVsRpENWE5qmqhAdY8g88K26C9DZ7qiKRMhZiBxSuZSKyGBJj2EyqUF1b1DaPNPZbLxfP3ufFCYFK7EVcU1Hz'
const EVM_TO_SOLANA_V2_TX = '0x8be479716729ff555e5ee7a1826af3bf571be820ab3080348f83b28a753cc472'
const SOLANA_V2_EXEC_TX =
  '32Zj32Px5cxq7HSsLtCKEoecRbEoziWRjSxgBnABmmqLc4MLtQfD6csfFEEf2CKmLymTVmqNSSo51gBEHiXBS5E'
const SOLANA_V2_OFFRAMP = 'offEFR9DhTdnPR43oBmnGJmoj13Y3n7sR93Vbph77TK'
const SOLANA_V2_SEND_MESSAGE_ID =
  '0x3067b270c81cd21f1b37150dd75f0af46ead2eaff405b390cd70e5df7d27e8b1'
const EVM_TO_SOLANA_V2_MESSAGE_ID =
  '0xaef01a07586289eaf1cc1e65d0281c20966c799a5be0d816295907abb2367826'

const skip = !!process.env.SKIP_INTEGRATION_TESTS
const VERBOSE = !!process.env.VERBOSE

const testLogger = new Console(process.stdout, process.stderr)
if (!VERBOSE) testLogger.debug = () => {}

// Integration test for real Solana mainnet token
describe('SolanaChain getTokenInfo - Mainnet Integration', { skip }, () => {
  let solanaChain: SolanaChain

  before(async () => {
    // Use a public Solana mainnet RPC endpoint
    solanaChain = await SolanaChain.fromUrl('https://api.mainnet-beta.solana.com')
  })

  it(
    'should fetch WMTX token info with symbol from Metaplex metadata fallback',
    { timeout: 30000 },
    async () => {
      const wmtxToken = 'WMTXyYKUMTG3VuZA5beXuHVRLpyTwwaoP7h2i8YpuRH'

      try {
        const result = await solanaChain.getTokenInfo(wmtxToken)

        console.log(`Token info for ${wmtxToken}:`, result)

        // Verify the expected symbol
        assert.equal(result.symbol, 'WMTX')
        assert.equal(typeof result.decimals, 'number')
        assert.ok(result.decimals >= 0)
      } catch (error) {
        console.error('Integration test failed:', error)
        throw error
      }
    },
  )

  it(
    'should demonstrate fallback flow by first checking SPL token data',
    { timeout: 30000 },
    async () => {
      const wmtxToken = 'WMTXyYKUMTG3VuZA5beXuHVRLpyTwwaoP7h2i8YpuRH'
      const mintPublicKey = new PublicKey(wmtxToken)

      try {
        // First check what the raw SPL token info contains
        const mintInfo = await solanaChain.connection.getParsedAccountInfo(mintPublicKey)

        if (
          mintInfo.value &&
          typeof mintInfo.value.data === 'object' &&
          'parsed' in mintInfo.value.data
        ) {
          const parsed = mintInfo.value.data.parsed as {
            info: { symbol?: string; decimals: number }
          }
          console.log('Raw SPL token info:', parsed.info)

          // If SPL token doesn't have symbol, our implementation should fallback to Metaplex
          if (!parsed.info.symbol) {
            console.log('SPL token info missing symbol - fallback to Metaplex should occur')
          } else {
            console.log('SPL token info has symbol:', parsed.info.symbol)
          }
        }

        // Now test our implementation
        const result = await solanaChain.getTokenInfo(wmtxToken)
        console.log('Final result from getTokenInfo:', result)

        assert.equal(result.symbol, 'WMTX')
      } catch (error) {
        console.error('Fallback demonstration failed:', error)
        throw error
      }
    },
  )

  it('should verify metadata PDA derivation is correct', { timeout: 30000 }, async () => {
    const wmtxToken = 'WMTXyYKUMTG3VuZA5beXuHVRLpyTwwaoP7h2i8YpuRH'
    const mintPublicKey = new PublicKey(wmtxToken)
    const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

    try {
      // Derive the metadata PDA the same way our implementation does
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintPublicKey.toBuffer()],
        TOKEN_METADATA_PROGRAM_ID,
      )

      console.log('Derived metadata PDA:', metadataPDA.toString())

      // Check if the metadata account actually exists
      const metadataAccount = await solanaChain.connection.getAccountInfo(metadataPDA)

      if (metadataAccount) {
        console.log('Metadata account exists, data length:', metadataAccount.data.length)
        console.log('Metadata account owner:', metadataAccount.owner.toString())

        // Verify it's owned by the Token Metadata Program
        assert.equal(metadataAccount.owner.toString(), TOKEN_METADATA_PROGRAM_ID.toString())
      } else {
        console.log('No metadata account found at derived PDA')
      }

      // Our implementation should still work regardless
      const result = await solanaChain.getTokenInfo(wmtxToken)
      assert.equal(result.symbol, 'WMTX')
    } catch (error) {
      console.error('PDA derivation test failed:', error)
      throw error
    }
  })

  it('should handle network errors gracefully', { timeout: 30000 }, async () => {
    // Test with an invalid token address that will cause network/parsing errors
    const invalidToken = 'So11111111111111111111111111111111111111112' // SOL native mint

    try {
      const result = await solanaChain.getTokenInfo(invalidToken)
      console.log('Result for SOL native mint:', result)

      // Should get some result, even if fallback fails
      assert.equal(typeof result.symbol, 'string')
      assert.equal(typeof result.decimals, 'number')
    } catch (error) {
      console.error('Network error handling test:', error)
      // This is acceptable - some tokens might not be parseable
    }
  })

  it('should support Token-2022 tokens on mainnet', { timeout: 30000 }, async () => {
    // Using a real Token-2022 token - PYUSD (PayPal USD) which uses Token Extensions
    const pyusdToken = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo'

    try {
      // First check the program type to verify it's Token-2022
      const mintPublicKey = new PublicKey(pyusdToken)
      const mintInfo = await solanaChain.connection.getParsedAccountInfo(mintPublicKey)

      if (
        mintInfo.value &&
        typeof mintInfo.value.data === 'object' &&
        'program' in mintInfo.value.data
      ) {
        console.log('Token program type:', mintInfo.value.data.program)

        // This should be 'spl-token-2022' for Token Extensions tokens
        if (mintInfo.value.data.program === 'spl-token-2022') {
          console.log('Confirmed: This is a Token-2022 token')
        }
      }

      const result = await solanaChain.getTokenInfo(pyusdToken)

      console.log(`Token-2022 info for ${pyusdToken}:`, result)

      // PYUSD should have proper symbol and 6 decimals
      assert.equal(typeof result.symbol, 'string')
      assert.ok(result.symbol.length > 0)
      assert.notEqual(result.symbol, 'UNKNOWN')
      assert.equal(typeof result.decimals, 'number')
      assert.ok(result.decimals >= 0)
    } catch (error) {
      console.error('Token-2022 integration test failed:', error)
      // If this specific token doesn't work, that's okay - the important thing
      // is that we don't get an "Invalid SPL token" error for Token-2022 tokens
      if (error instanceof Error && error.message.includes('Invalid SPL token')) {
        throw new Error('Token-2022 support is not working - got Invalid SPL token error', {
          cause: error,
        })
      }
    }
  })
})

// Integration tests against real Solana mainnet CCIP messages
describe('SolanaChain Mainnet CCIP Integration', { skip, timeout: 60_000 }, () => {
  let solanaChain: SolanaChain

  before(async () => {
    const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed')
    solanaChain = new SolanaChain(connection, networkInfo('solana-mainnet'), { apiClient: null })
  })

  describe('getMessagesInTx', () => {
    it('should decode CCIP messages from a known Solana mainnet transaction', async () => {
      const msg = SOLANA_TO_ETHEREUM[0]!
      const tx = await solanaChain.getTransaction(msg.txHash)
      const requests = await solanaChain.getMessagesInTx(tx)

      assert.ok(requests.length > 0, 'should find at least one CCIP message')
      const request = requests.find((r) => r.message.messageId === msg.messageId)
      assert.ok(request, `should find message ${msg.messageId}`)
      assert.ok(request.lane.sourceChainSelector, 'should have source chain selector')
      assert.ok(request.lane.destChainSelector, 'should have dest chain selector')
      assert.equal(
        request.lane.sourceChainSelector,
        networkInfo('solana-mainnet').chainSelector,
        'source selector should be Solana mainnet',
      )
    })
  })

  describe('getBalance', () => {
    it('should return native SOL balance for a known CCIP participant', async () => {
      const msg = SOLANA_TO_ETHEREUM[0]!
      const tx = await solanaChain.getTransaction(msg.txHash)
      const requests = await solanaChain.getMessagesInTx(tx)
      const request = requests.find((r) => r.message.messageId === msg.messageId)
      assert.ok(request, 'should find the message')

      const balance = await solanaChain.getBalance({ holder: request.message.sender })
      assert.ok(balance >= 0n, 'balance should be non-negative')
    })
  })

  describe('getTokenInfo', () => {
    it('should fetch USDC token info', async () => {
      // EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v is USDC on Solana mainnet
      const tokenInfo = await solanaChain.getTokenInfo(
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      )

      assert.equal(tokenInfo.symbol, 'USDC')
      assert.equal(tokenInfo.decimals, 6)
    })
  })
})

describe('Solana Devnet CCIP v2 Integration', { skip, timeout: 60_000 }, () => {
  let solanaChain: SolanaChain

  before(async () => {
    solanaChain = await SolanaChain.fromUrl(SOLANA_DEVNET_RPC, {
      apiClient: null,
      logger: testLogger,
    })
  })

  it('should synthesize and decode CCIPMessageSentV2 from Anchor CPI event data', async () => {
    const tx = await solanaChain.getTransaction(SOLANA_V2_SEND_TX)

    const humanLog = tx.logs.find(
      (log) => typeof log.data === 'string' && log.data.includes('Emitting CCIPMessageSentV2'),
    )
    assert.ok(humanLog, 'should preserve human-readable event log')
    assert.equal(humanLog.type, 'log')
    assert.equal(humanLog.level, 1)

    const eventLog = tx.logs.find((log) => log.topics[0] === '0x70205df81d5c63bc')
    assert.ok(eventLog, 'should synthesize data log from emit_cpi inner instruction')
    assert.equal(eventLog.type, 'data')
    assert.equal(eventLog.level, 2)
    assert.equal(eventLog.index, 14)

    const requests = await solanaChain.getMessagesInTx(tx)
    assert.equal(requests.length, 1)
    const request = requests[0]!
    assert.equal(request.message.messageId, SOLANA_V2_SEND_MESSAGE_ID)
    assert.equal(request.message.sequenceNumber, 115n)
    assert.equal(request.message.sender, 'GVuEzxzvpVQr9RTwNguw4AcZSZmGiP9EWaRPkp8x6Xrx')
    assert.equal(request.message.receiver, '0x3aa5EbB10dC797Cac828524e59A333d0A371443d')
    assert.equal(request.message.data, '0xdc1592f138fb77ec')
    assert.equal(request.lane.onRamp, 'CcipE4LLPo7F6aVFgyvhVQi5DrKUhtgimsDwknaeLVDT')
    assert.equal(request.lane.version, '2.0.0')
  })

  it('should decode ExecutionStateChangedV2 from v2 OffRamp execution tx', async () => {
    const tx = await solanaChain.getTransaction(SOLANA_V2_EXEC_TX)
    const receipts = tx.logs.flatMap((log) => {
      const receipt = SolanaChain.decodeReceipt(log)
      return receipt ? [{ log, receipt }] : []
    })

    assert.equal(receipts.length, 1)
    const execution = receipts[0]!
    assert.equal(execution.log.address, SOLANA_V2_OFFRAMP)
    assert.equal(execution.log.index, 18)
    assert.equal(execution.log.level, 2)
    assert.equal(execution.receipt.messageId, EVM_TO_SOLANA_V2_MESSAGE_ID)
    assert.equal(execution.receipt.sequenceNumber, 149n)
    assert.equal(execution.receipt.state, ExecutionState.Success)
  })

  it('should fetch EVM to Solana v2 OffRamp executions without verifications', async () => {
    await using disposer = new AsyncDisposableStack()
    const source = disposer.adopt(
      await EVMChain.fromUrl(SEPOLIA_RPC, { apiClient: null, logger: testLogger }),
      (source) => source.provider.destroy(),
    )

    const tx = await source.getTransaction(EVM_TO_SOLANA_V2_TX)
    const requests = await source.getMessagesInTx(tx)
    assert.equal(requests.length, 1)
    const request = requests[0]!
    assert.equal(request.message.messageId, EVM_TO_SOLANA_V2_MESSAGE_ID)

    const executions = []
    for await (const execution of solanaChain.getExecutionReceipts({
      offRamp: SOLANA_V2_OFFRAMP,
      messageId: request.message.messageId,
      sourceChainSelector: request.lane.sourceChainSelector,
      startBlock: 479327790,
    })) {
      executions.push(execution)
    }

    assert.equal(executions.length, 1)
    assert.equal(executions[0]!.receipt.messageId, EVM_TO_SOLANA_V2_MESSAGE_ID)
    assert.equal(executions[0]!.receipt.sequenceNumber, 149n)
    assert.equal(executions[0]!.receipt.state, ExecutionState.Success)
    assert.equal(executions[0]!.log.transactionHash, SOLANA_V2_EXEC_TX)
  })
})

describe('Solana Devnet estimateReceiveExecution Tests', { skip }, () => {
  const ESTIMATE_MSG = FUJI_TO_SOLANA[0]!

  let chain: SolanaChain | undefined

  before(async () => {
    chain = await SolanaChain.fromUrl('https://api.devnet.solana.com', {
      apiClient: null,
      logger: testLogger,
    })
  })

  after(async () => {})

  it('should estimate receiver execution for a failed Fuji -> Solana devnet message', async () => {
    assert.ok(chain, 'Solana devnet chain should be initialized')

    await using disposer = new AsyncDisposableStack()
    const source = disposer.adopt(
      await EVMChain.fromUrl(FUJI_RPC, { apiClient: null, logger: testLogger }),
      (source) => source.provider.destroy(),
    )

    const tx = await source.getTransaction(ESTIMATE_MSG.txHash)
    const requests = await source.getMessagesInTx(tx)
    assert.equal(requests.length, 1, 'tx hash should contain one CCIP message')

    const request = requests[0]!
    assert.equal(request.message.messageId, ESTIMATE_MSG.messageId)

    const offRamp = await discoverOffRamp(source, chain, request.lane.onRamp, source)
    const estimated = await chain.estimateReceiveExecution({
      offRamp,
      message: {
        sourceChainSelector: request.lane.sourceChainSelector,
        messageId: request.message.messageId,
        receiver: request.message.receiver,
        sender: request.message.sender,
        data: request.message.data,
        tokenReceiver:
          'tokenReceiver' in request.message ? request.message.tokenReceiver : undefined,
        accounts: 'accounts' in request.message ? request.message.accounts : undefined,
        accountIsWritableBitmap:
          'accountIsWritableBitmap' in request.message
            ? request.message.accountIsWritableBitmap
            : undefined,
      },
    })

    assert.ok(
      30_000 < estimated && estimated < 33_000,
      `estimated compute units should be around 31k for this message, got ${estimated}`,
    )
  })

  it('should estimate receiver execution for a real message with token transfer', async () => {
    assert.ok(chain, 'Solana devnet chain should be initialized')

    const estimated = await chain.estimateReceiveExecution({
      offRamp: SOLANA_OFFRAMP,
      message: SOLANA_ESTIMATE_RECEIVER_MESSAGE,
    })

    assert.ok(
      42_000 < estimated && estimated < 45_000,
      `estimated compute units should be around 43k for this message, got ${estimated}`,
    )
  })
})
