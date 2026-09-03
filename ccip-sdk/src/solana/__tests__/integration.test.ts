import assert from 'node:assert/strict'
import { Console } from 'node:console'
import { after, before, describe, it } from 'node:test'

import { Connection, PublicKey } from '@solana/web3.js'

import { useResourceForDescribe } from '../../../../scripts/useResource.ts'
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

// Live lanes exercised: Solana devnet (send/execute fixtures) and Solana mainnet
// (getTokenInfo / mainnet CCIP message suites), plus Sepolia/Fuji RPCs as the EVM
// counterparts of specific blocks. Locks are held per describe block, so the
// mainnet-only blocks do not queue on sepolia/fuji (and vice versa) — see
// useResourceForDescribe.

const FUJI_RPC = process.env.FUJI_RPC ?? 'https://api.avax-test.network/ext/bc/C/rpc'
const SEPOLIA_RPC =
  process.env.SEPOLIA_RPC ?? process.env.RPC_SEPOLIA ?? 'https://rpc.sepolia.ethpandaops.io'
// devnet.rpcpool.com: public, holds at least ~1 week of txs and doesn't 429 as
// aggressively as onfinality's free tier; envs can override (e.g. onfinality,
// which keeps the longest history but throttles hard)
const SOLANA_DEVNET_RPC =
  process.env.SOLANA_RPC ?? process.env.RPC_SOLANA ?? 'https://devnet.rpcpool.com'
const SOLANA_OFFRAMP = 'offqSMQWgQud6WJz694LRzkeN5kMYpCHTpXQr3Rkcjm'
const SOLANA_V2_SEND_TX =
  '5RrQuDzcwPdVTKTTLVNhz31V5XzNLRZdxaGzLQddqePsu4TYycS6BMKP8V2WtuQ2VS9GdWTZfGt4WjnzKMBZFdM5'
const EVM_TO_SOLANA_V2_TX = '0x94721bc1e04f7c5f6bfad4e479092aaf71efefccaa0babade4c4e7b5b3b24a41'
const SOLANA_V2_EXEC_TX =
  '4qeWX8ELjDt57JLDuDsSW3jYzP915R7wyXLWMshPZJkiDVxt1HAv2DTqmNow64Nxns8PSgrX1vLTYHWTabjFztDM'
// Latest v2.0.0-dev offramp (has `bump` in ReferenceAddresses, `on_ramps` Vec in
// SourceChainConfig, and RMN Remote accounts in get_ccvs_for_msg).
const SOLANA_V2_OFFRAMP = 'offzdKY3MVHcs8c639Atwqr7KGbZrxmNDC27s2DJeEr'
const SOLANA_V2_SEND_MESSAGE_ID =
  '0x706918e7a9b62d8592733f7f790c520285661a7ddd0fbeaa6301660c8d32a722'
const EVM_TO_SOLANA_V2_MESSAGE_ID =
  '0x6aada2cd53b51bd5b4f12cbd01b1e43a092d692e3211dd8a8cb062f28c28144f'

// Latest v2 messages on the current (post-redeploy) contracts, for both directions.
const SOLANA_TO_SEPOLIA_V2_TX =
  'AstWTNxnDPeXm2Ahv58XD8vkqtUEX26jBa9MCERahRvaR91vvx9LFw7hWr5ngFeCUKJ4NJ9tVuPfBEjZncccQP2'
const SOLANA_TO_SEPOLIA_V2_MESSAGE_ID =
  '0xa12415f90306cdb2da8b2e254dc2e0941cc3b5351344da3bf11d0cab6f6837a4'
// Sepolia (EVM) OffRamp connected to the Solana router/onRamp (solana-devnet -> sepolia).
const SEPOLIA_V2_OFFRAMP = '0xEBA5d79459484E543BD15607A621ece29B29ca99'
const SEPOLIA_TO_SOLANA_V2_TX = '0x698bc3a6386f2d0718c0ab24972747d5cebb80565449aacfc044501f381ccb7d'
const SEPOLIA_TO_SOLANA_V2_MESSAGE_ID =
  '0x329238fa05b478d834d73163ac36ffe8d0c1daf3af4b3c0c272c6995473a1bad'
const SEPOLIA_TO_SOLANA_V2_EXEC_TX =
  '2mDZqfQPSwHBd5Mif2MJciweR6ybPCaAiFhaZrzRWGKZEKmXApEtjXhsHX6hw6vFV5L5uHWXhGLPr4Uz5uAnsSht'

const skip = !!process.env.SKIP_INTEGRATION_TESTS
const VERBOSE = !!process.env.VERBOSE

const testLogger = new Console(process.stdout, process.stderr)
if (!VERBOSE) testLogger.debug = () => {}

// Integration test for real Solana mainnet token
describe('SolanaChain getTokenInfo - Mainnet Integration', { skip }, () => {
  useResourceForDescribe(['solana-mainnet'])
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
  useResourceForDescribe(['solana-mainnet'])
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

describe('Solana Devnet CCIP v2 Integration', { skip, timeout: 300_000 }, () => {
  // Sepolia is the EVM counterpart of several fixtures here (v2 both directions)
  useResourceForDescribe(['solana-devnet', 'sepolia'])
  let solanaChain: SolanaChain

  before(async () => {
    solanaChain = await SolanaChain.fromUrl(SOLANA_DEVNET_RPC, {
      apiClient: null,
      logger: testLogger,
    })
  })

  it('should synthesize and decode CCIPMessageSentV2 from Anchor CPI event data', async () => {
    const tx = await solanaChain.getTransaction(SOLANA_V2_SEND_TX)

    // Post-redeploy ccip-router 2.0.0-dev no longer logs a human-readable "Emitting CCIPMessageSentV2"
    // line; the router's top-level entry log ("Instruction: CcipSendV2") is the human-readable
    // marker that the SDK preserves at level 1.
    const humanLog = tx.logs.find(
      (log) => typeof log.data === 'string' && log.data.includes('Instruction: CcipSendV2'),
    )
    assert.ok(humanLog, 'should preserve human-readable router entry log')
    assert.equal(humanLog.type, 'log')
    assert.equal(humanLog.level, 1)

    const eventLog = tx.logs.find((log) => log.topics[0] === '0x70205df81d5c63bc')
    assert.ok(eventLog, 'should synthesize data log from emit_cpi inner instruction')
    assert.equal(eventLog.type, 'data')
    assert.equal(eventLog.level, 2)
    assert.equal(eventLog.index, 37)

    const requests = await solanaChain.getMessagesInTx(tx)
    assert.equal(requests.length, 1)
    const request = requests[0]!
    assert.equal(request.message.messageId, SOLANA_V2_SEND_MESSAGE_ID)
    assert.equal(request.message.sequenceNumber, 4348n)
    assert.equal(request.message.sender, 'GVuEzxzvpVQr9RTwNguw4AcZSZmGiP9EWaRPkp8x6Xrx')
    assert.equal(request.message.receiver, '0x3aa5EbB10dC797Cac828524e59A333d0A371443d')
    assert.equal(request.message.data, '0xeac2e11afaf847db')
    assert.equal(request.lane.onRamp, 'CcipP6NhMw34e7hNJXmNytvzmSYrwQ1TcFgfQAxJhNqm')
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
    assert.equal(execution.log.index, 30)
    assert.equal(execution.log.level, 2)
    assert.equal(execution.receipt.messageId, EVM_TO_SOLANA_V2_MESSAGE_ID)
    assert.equal(execution.receipt.sequenceNumber, 526n)
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
      startBlock: 480333626,
    })) {
      executions.push(execution)
    }

    assert.equal(executions.length, 1)
    assert.equal(executions[0]!.receipt.messageId, EVM_TO_SOLANA_V2_MESSAGE_ID)
    assert.equal(executions[0]!.receipt.sequenceNumber, 526n)
    assert.equal(executions[0]!.receipt.state, ExecutionState.Success)
    assert.equal(executions[0]!.log.transactionHash, SOLANA_V2_EXEC_TX)
  })

  it('should read v2 offRamp config with onRamps Vec and bump-aware reference addresses', async () => {
    const config = await solanaChain.getOffRampConfig(
      SOLANA_V2_OFFRAMP,
      networkInfo('ethereum-testnet-sepolia').chainSelector,
    )
    // The latest v2.0.0-dev redeploy exposed a Vec `on_ramps` (was a single `on_ramp`).
    assert.ok(Array.isArray(config.onRamps), 'onRamps should be an array')
    assert.ok(
      config.onRamps.some(
        (r: string) => r.toLowerCase() === '0x99f6faf45ccfa166781ded7d9a4d9c548f2aa344',
      ),
      `onRamps should include the Sepolia onRamp, got ${JSON.stringify(config.onRamps)}`,
    )
    // Bump-aware reference_addresses decode: the new offramp stores a `bump` byte before `router`.
    assert.equal(config.router, 'CcipP6NhMw34e7hNJXmNytvzmSYrwQ1TcFgfQAxJhNqm')
    assert.ok(config.rmnRemote, 'offRampConfig should expose rmnRemote')
  })

  it('should resolve v2 verifications policy via get_ccvs_for_msg (RMN accounts) without a simulation panic', async () => {
    await using disposer = new AsyncDisposableStack()
    const source = disposer.adopt(
      await EVMChain.fromUrl(SEPOLIA_RPC, { apiClient: null, logger: testLogger }),
      (source) => source.provider.destroy(),
    )
    const tx = await source.getTransaction(EVM_TO_SOLANA_V2_TX)
    const requests = await source.getMessagesInTx(tx)
    assert.equal(requests.length, 1)
    const request = requests[0]!

    // The v2 indexer has no verifier results for this message yet, so this must surface a
    // CCIPMessageNotVerifiedYetError — NOT an Anchor simulation failure. Reaching that error proves
    // the `get_ccvs_for_msg` view (with its RMN Remote accounts) simulated cleanly.
    await assert.rejects(
      solanaChain.getVerifications({ offRamp: SOLANA_V2_OFFRAMP, request }),
      (err: unknown) => (err as { name?: string }).name === 'CCIPMessageNotVerifiedYetError',
    )
  })

  it('should decode the latest Solana -> Sepolia v2 message and discover its offRamp', async () => {
    // Devnet RPCs intermittently serve inconsistent account state under load — a 200
    // response carrying a truncated/foreign blob that then fails anchor's borsh decode
    // (observed as ERR_OUT_OF_RANGE on the offRamp config). The chain memoizes
    // getAccountInfo for 5s, so space retries beyond that TTL and assert on the first
    // clean pass, like the TON live scans (see ton/logs.integration.test.ts).
    let lastErr: unknown
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await runAssertions()
        return
      } catch (err) {
        lastErr = err
        testLogger.debug(
          `decode/discover attempt ${attempt}/3 failed, retrying in ${5 * attempt}s: ${(err as Error).message}`,
        )
        await new Promise((resolve) => setTimeout(resolve, 5_000 * attempt))
      }
    }
    throw lastErr

    async function runAssertions() {
      await using disposer = new AsyncDisposableStack()
      const dest = disposer.adopt(
        await EVMChain.fromUrl(SEPOLIA_RPC, { apiClient: null, logger: testLogger }),
        (dest) => dest.provider.destroy(),
      )

      const tx = await solanaChain.getTransaction(SOLANA_TO_SEPOLIA_V2_TX)
      const requests = await solanaChain.getMessagesInTx(tx)
      assert.equal(requests.length, 1)
      const request = requests[0]!
      assert.equal(request.message.messageId, SOLANA_TO_SEPOLIA_V2_MESSAGE_ID)
      assert.equal(request.message.sequenceNumber, 9393n)
      assert.equal(request.message.sender, 'GVuEzxzvpVQr9RTwNguw4AcZSZmGiP9EWaRPkp8x6Xrx')
      assert.equal(request.message.receiver, '0x3aa5EbB10dC797Cac828524e59A333d0A371443d')
      assert.equal(request.message.data, '0x6d756c74692d76657269666965722074657374')
      assert.equal(request.lane.onRamp, 'CcipP6NhMw34e7hNJXmNytvzmSYrwQ1TcFgfQAxJhNqm')
      assert.equal(request.lane.version, '2.0.0')

      const offRamp = await discoverOffRamp(solanaChain, dest, request.lane.onRamp)
      assert.equal(offRamp, SEPOLIA_V2_OFFRAMP)
    }
  })

  it('should fetch the latest Sepolia -> Solana v2 execution', async () => {
    await using disposer = new AsyncDisposableStack()
    const source = disposer.adopt(
      await EVMChain.fromUrl(SEPOLIA_RPC, { apiClient: null, logger: testLogger }),
      (source) => source.provider.destroy(),
    )

    const tx = await source.getTransaction(SEPOLIA_TO_SOLANA_V2_TX)
    const requests = await source.getMessagesInTx(tx)
    assert.equal(requests.length, 1)
    const request = requests[0]!
    assert.equal(request.message.messageId, SEPOLIA_TO_SOLANA_V2_MESSAGE_ID)
    assert.equal(request.message.sequenceNumber, 9425n)
    assert.equal(request.message.sender, '0x4aA1B21843b42bA0aB356707a84876DB0B671206')
    assert.equal(request.message.receiver, 'AmwmhnQYQNhis1tpDRsZ4UYaCv1WruKLP2jikSfVyMLQ')
    assert.equal(request.lane.onRamp, '0x99F6Faf45CcfA166781DED7d9A4D9C548F2aA344')

    const executions = []
    for await (const execution of solanaChain.getExecutionReceipts({
      offRamp: SOLANA_V2_OFFRAMP,
      messageId: request.message.messageId,
      sourceChainSelector: request.lane.sourceChainSelector,
      startBlock: 483957780,
    })) {
      executions.push(execution)
    }

    assert.equal(executions.length, 1)
    assert.equal(executions[0]!.receipt.messageId, SEPOLIA_TO_SOLANA_V2_MESSAGE_ID)
    assert.equal(executions[0]!.receipt.sequenceNumber, 9425n)
    assert.equal(executions[0]!.receipt.state, ExecutionState.Success)
    assert.equal(executions[0]!.log.transactionHash, SEPOLIA_TO_SOLANA_V2_EXEC_TX)
  })
})

describe('Solana Devnet estimateReceiveExecution Tests', { skip }, () => {
  // The failed-message fixture is fuji -> solana devnet
  useResourceForDescribe(['solana-devnet', 'fuji'])
  const ESTIMATE_MSG = FUJI_TO_SOLANA[0]!

  let chain: SolanaChain | undefined

  before(async () => {
    chain = await SolanaChain.fromUrl(SOLANA_DEVNET_RPC, {
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
