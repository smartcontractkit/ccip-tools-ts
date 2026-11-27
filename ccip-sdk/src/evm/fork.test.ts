import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { Console } from 'node:console'
import { after, before, beforeEach, describe, it } from 'node:test'

import { Connection } from '@solana/web3.js'
import {
  type JsonRpcApiProvider,
  type JsonRpcProvider,
  AbiCoder,
  Contract,
  Wallet,
  keccak256,
  toBeHex,
} from 'ethers'
import { Instance } from 'prool'
import { createPublicClient, http } from 'viem'

import '../aptos/index.ts' // register Aptos chain family for cross-family message decoding
import { raceRpcEndpoint, reachableEvmForkEndpoint } from '../../../scripts/test-endpoints.ts'
import '../ton/index.ts' // register TON chain family for cross-family message decoding
import {
  type ResourceHandle,
  useResource,
  useResourceForDescribe,
} from '../../../scripts/useResource.ts'
import { CCIPAPIClient } from '../api/index.ts'
import { type Chain, LaneFeature } from '../chain.ts'
import { calculateManualExecProof, discoverOffRamp } from '../execution.ts'
import { networkInfo } from '../networks.ts'
import { SolanaChain } from '../solana/index.ts'
import { type CCIPRequest, type ExecutionInput, CCIPVersion, ExecutionState } from '../types.ts'
import { interfaces } from './const.ts'
import {
  type ExecFixture,
  rankExecFixtures,
  tryExecFixtures,
} from './exec-fixtures.test.helpers.ts'
import { forkProvider } from './fork-retry.test.helpers.ts'
import {
  SOLANA_DEVNET_EXEC_INPUT_TEST_MSG,
  SOLANA_DEVNET_EXEC_TEST_MSG,
  SOLANA_DEVNET_TO_SEPOLIA,
  TON_TO_SEPOLIA,
} from './fork.test.data.ts'
import { ViemTransportProvider } from './viem/client-adapter.ts'
import { EVMChain } from './index.ts'

// Forks fetch live state from the Sepolia and Fuji upstreams, and the execution block
// also reads Solana devnet and the staging CCIP API. Each describe block below acquires
// its whole network set in one atomic call (see `useResource`), so no block ever holds
// one lock while waiting for another.

// ── Chain constants ──

const SEPOLIA_CHAIN_ID = 11155111
const SEPOLIA_SELECTOR = 16015286601757825753n

const FUJI_CHAIN_ID = 43113

const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

// Sepolia → Fuji uses a v2.0 OnRamp. The router contract version is independent.
const SEPOLIA_V2_0_ROUTER = '0x784d49a71BB4C48eB7dA4cD7e6Ecb424f9b5EAB1'
const FUJI_SELECTOR = 14767482510784806043n
const CCIP_MESSAGE_SENT_V2_TOPIC = interfaces.OnRamp_v2_0.getEvent('CCIPMessageSent')!.topicHash
// The source of the historical v1.6 messages in the manual-execution tests.
const SOLANA_DEVNET_SELECTOR = 16423721717087811551n
// Token served by FTF_ENABLED_POOL_SEPOLIA — works with V3 extra args on Sepolia→Fuji v2.0 lane
const FTF_TOKEN_SEPOLIA = '0xa41a773a7b68e80d4760a176cfec8f50e80d65a7'

// ── execute constants ──

// Solana devnet → Sepolia v1.6 message fixtures. The current route is v2.0.
// Public devnet endpoints can prune history, so rank alternative fixtures too.
// Arb-Sep → Fuji v2.0.0 message that FAILED on-chain due to intentional OOG
// (ccipReceive gasLimit=100). CCV verification is COMPLETED so the message is
// readyForManualExecution — re-executing it on a Fuji fork with a higher
// gasLimit succeeds, exercising the API-driven manual-exec recovery path.
const V2_API_EXEC_MSG = {
  messageId: '0x2dedf76b3e16020807ca43a28f3c7210bf4305a6eadf98df9d2c5ceddd4a4f71',
}

// Sepolia → Fuji v1.5.0 message that FAILED on-chain; the staging API serves its
// execution inputs to the API-driven path below.
const V1_5_API_EXEC_MSG = {
  messageId: '0xe654dc68b4d98e8ea2f182ee45d5766af4f62e2417395153a90c4b377d3fcd07',
  offRamp: '0x01e3D835b4C4697D7F81B9d7Abc89A6E478E4a2f',
}

// Source chain selector for the v2.0 fixture's lane (Arbitrum Sepolia, chainId 421614)
const ARB_SEP_SELECTOR = 3478487238524512106n

// Staging CCIP API: validates the pinned execute fixtures and serves the API-driven
// execution inputs. One shared client for the whole execute block — the class docs
// recommend a single instance to avoid duplicate fetch/rate-limit exposure.
const STAGING_API_URL = 'https://api.ccip.cldev.cloud'

// ── Helpers ──

/**
 * An endpoint is healthy for this suite when it still serves at least one of the
 * ranked source transactions. Fixtures are ranked before the probe, so a pinned
 * transaction that a public endpoint has already pruned does not exclude it.
 */
async function solanaDevnetHealthy(url: string, txHashes: readonly string[]): Promise<boolean> {
  const signal = AbortSignal.timeout(20_000)
  for (const txHash of txHashes) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [txHash, { maxSupportedTransactionVersion: 1, commitment: 'confirmed' }],
      }),
      signal,
    })
    if (!response.ok) {
      await response.body?.cancel()
      return false
    }
    const json = (await response.json()) as { result?: unknown }
    if (json.result != null) return true
  }
  return false
}

async function setERC20Balance(
  provider: JsonRpcApiProvider,
  token: string,
  address: string,
  amount: bigint,
  balanceSlot = 0n,
): Promise<void> {
  const storageKey = keccak256(
    AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [address, balanceSlot]),
  )
  await provider.send('anvil_setStorageAt', [token, storageKey, toBeHex(amount, 32)])
  const erc20 = new Contract(token, interfaces.Token, provider)
  const balance: bigint = await erc20.getFunction('balanceOf')(address)
  if (balance !== amount) {
    if (balanceSlot < 20n)
      return setERC20Balance(provider, token, address, amount, balanceSlot + 1n)
    throw new Error(
      `setERC20Balance: no working slot found (last tried ${balanceSlot}, got ${balance}, expected ${amount})`,
    )
  }
}

function isAnvilAvailable(): boolean {
  try {
    execSync('anvil --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// ── Tests ──

const skip = !!process.env.SKIP_INTEGRATION_TESTS || !isAnvilAvailable()

const testLogger = new Console(process.stdout, process.stderr)
if (!process.env.VERBOSE) testLogger.debug = () => {}

// Anvil's genesis fetch is a single request to the fork URL, so a public testnet
// RPC storming the CI egress (429/5xx for minutes) aborts startup with "failed to
// create genesis" before the per-request fork resilience below can help. Retry the
// whole start with backoff so a transient storm doesn't down the suite.
async function startForkWithRetries(instance: ReturnType<typeof Instance.anvil>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await instance.start()
      return
    } catch (err) {
      await instance.stop().catch(() => {})
      if (attempt === 4) throw err
      testLogger.debug(
        `anvil start failed (attempt ${attempt}/4, retrying in ${10 * attempt}s): ${(err as Error).message}`,
      )
      await new Promise((resolve) => setTimeout(resolve, 10_000 * attempt))
    }
  }
}

// Generous describe-level budget: a throttled public fork upstream can stall a single
// test 10x+ (one execute test hit 155s under an RPC storm while its normal runtime is
// ~12s). The per-test timeouts below bound each test, so a stall fails that test loudly
// instead of blowing the describe budget and CANCELLING all remaining suites (node
// --test reports the rest as "did not finish before its parent"). 600s matches
// dest-liquidity.fork.test.ts.
describe('EVM Fork Tests', { skip, timeout: 600_000 }, () => {
  let sepoliaChain: EVMChain | undefined
  let wallet: Wallet
  let sepoliaInstance: ReturnType<typeof Instance.anvil> | undefined
  let sepoliaFork: Promise<void> | undefined

  // Fork-resilience options: anvil fetches historical blocks/state from the upstream
  // RPC lazily, and that upstream can stop answering a request. Anvil does not retry a
  // timed-out request: it returns a fork error after `timeout`, and the fork provider or
  // `withForkRetry` sends the request again. A 60s timeout made each hung read cost 60s
  // and timed out tests in CI. 15s is well above a normal fork read. `retries` and
  // `forkRetryBackoff` apply to rate-limit answers. (Leave anvil's rate limiter on —
  // disabling it floods the upstream and gets the fork throttled at startup.)
  const forkOpts = {
    retries: 8,
    timeout: 15_000,
    forkRetryBackoff: 1_000,
  } as const

  // The Sepolia fork serves the sendMessage, execute and Viem blocks, so the first block
  // to run starts it and the file-level `after` stops it. Each block holds the Sepolia
  // lock only while it reads the fork, and reuses the same process instead of paying a
  // second genesis fetch. (The former Arb-Sepolia fork was started but used by no test;
  // its genesis/state fetches only added public-RPC load and a flaky startup dependency.)
  function ensureSepoliaFork(): Promise<void> {
    sepoliaFork ??= (async () => {
      // Pass {} as prool options so no startup timer is set on the Instance.
      // Without the second arg, prool extracts timeout from the first arg (Anvil CLI params),
      // sets a 60s timer, and after stop() resets startResolver, the timer fires on the new
      // unlistened resolver → unhandled rejection → test file fails even when tests pass.
      // Bind the first configured endpoint that answers the fork's block and state
      // reads: a dead or stalling endpoint would otherwise fail every fork read.
      const sepoliaRpc = await reachableEvmForkEndpoint('RPC_SEPOLIA', SEPOLIA_CHAIN_ID)
      sepoliaInstance = Instance.anvil(
        { forkUrl: sepoliaRpc, chainId: SEPOLIA_CHAIN_ID, port: 8646, ...forkOpts },
        {},
      )
      await startForkWithRetries(sepoliaInstance)

      const sepoliaProvider = await forkProvider(sepoliaInstance, { logger: testLogger })
      sepoliaChain = await EVMChain.fromProvider(sepoliaProvider, {
        apiClient: null,
        logger: testLogger,
      })
      wallet = new Wallet(ANVIL_PRIVATE_KEY, sepoliaProvider)
    })()
    return sepoliaFork
  }

  after(async () => {
    sepoliaChain?.provider.destroy()
    await sepoliaInstance?.stop()
  })

  // ── State-mutating tests (sendMessage / execute / ViemTransportProvider) ──

  describe('sendMessage', () => {
    useResourceForDescribe(['sepolia'])
    before(ensureSepoliaFork)

    it(
      'sends via a v2.0 lane and returns the decoded CCIPMessageSent',
      { timeout: 120_000 },
      async () => {
        assert.ok(sepoliaChain, 'chain should be initialized')
        const receiver = await wallet.getAddress()
        const onRamp = await sepoliaChain.getOnRampForRouter(SEPOLIA_V2_0_ROUTER, FUJI_SELECTOR)
        assert.equal((await sepoliaChain.typeAndVersion(onRamp))[1], CCIPVersion.V2_0)

        const request = await sepoliaChain.sendMessage({
          router: SEPOLIA_V2_0_ROUTER,
          destChainSelector: FUJI_SELECTOR,
          message: { receiver, data: '0x1337' },
          wallet,
        })

        assert.equal(request.lane.version, CCIPVersion.V2_0)
        assert.equal(request.lane.sourceChainSelector, SEPOLIA_SELECTOR)
        assert.equal(request.lane.destChainSelector, FUJI_SELECTOR)
        assert.equal(request.lane.onRamp, onRamp)
        assert.match(request.message.messageId, /^0x[0-9a-f]{64}$/i)
        assert.equal(request.message.receiver, receiver)
        assert.equal(request.message.data, '0x1337')
        assert.equal(request.log.topics[0], CCIP_MESSAGE_SENT_V2_TOPIC)
        assert.equal(request.log.transactionHash, request.tx.hash)
      },
    )

    it('approves and sends a token on a v2.0 lane', { timeout: 120_000 }, async () => {
      assert.ok(sepoliaChain, 'chain should be initialized')
      const receiver = await wallet.getAddress()
      const token = FTF_TOKEN_SEPOLIA
      const amount = 10n ** 17n
      const provider = sepoliaChain.provider
      await setERC20Balance(provider, token, receiver, amount)
      const erc20 = new Contract(token, interfaces.Token, provider)
      assert.equal(await erc20.getFunction('allowance')(receiver, SEPOLIA_V2_0_ROUTER), 0n)

      const request = await sepoliaChain.sendMessage({
        router: SEPOLIA_V2_0_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        message: { receiver, tokenAmounts: [{ token, amount }], extraArgs: { gasLimit: 0n } },
        wallet,
      })

      assert.equal(request.lane.version, CCIPVersion.V2_0)
      assert.equal(request.log.topics[0], CCIP_MESSAGE_SENT_V2_TOPIC)
      assert.equal(await erc20.getFunction('balanceOf')(receiver), 0n)
      assert.equal(request.message.tokenAmounts.length, 1)
      const [transfer] = request.message.tokenAmounts
      assert.ok(transfer && 'sourceTokenAddress' in transfer)
      assert.equal(transfer.sourceTokenAddress.toLowerCase(), token)
      assert.ok(transfer.amount > 0n && transfer.amount <= amount, 'amount net of pool fee')
    })
  })

  describe('execute', () => {
    const stagingApi = new CCIPAPIClient(STAGING_API_URL, { logger: testLogger })

    // Fixture candidates: each pin first, then the lane's newest failed messages to
    // the same receiver (see exec-fixtures.test.helpers.ts). Keep the historical
    // versions for execution: a lane upgrade does not change the OffRamp or the
    // execution input of an existing message. `usedIds` is shared by the three groups
    // below, so a message one test executed (or found unusable) is not tried again.
    const usedIds = new Set<string>()
    // Every API client in this block is the explicit staging client; the SDK's default
    // prod client is never used, so none of these groups needs the `api` lock.

    describe('direct Solana proofs (Solana devnet -> Sepolia)', () => {
      // Acquire the complete source/destination set atomically. Release it before
      // execution, then take only Sepolia: no lock is held while waiting for another.
      let directResources: ResourceHandle | undefined
      const acquireDirectResources = async () => {
        directResources ??= await useResource(['sepolia', 'solana-devnet', 'api-staging'])
      }
      const releaseDirectResources = async () => {
        const resources = directResources
        directResources = undefined
        await resources?.release()
      }
      const executeOnSepolia = async (
        opts: Parameters<EVMChain['execute']>[0],
      ): ReturnType<EVMChain['execute']> => {
        await releaseDirectResources()
        const sepoliaResource = await useResource(['sepolia'])
        try {
          assert.ok(sepoliaChain, 'dest chain should be initialized')
          return await sepoliaChain.execute(opts)
        } finally {
          await sepoliaResource.release()
        }
      }

      let execFixtures: ExecFixture[] // Solana-devnet -> Sepolia v1.6, manual path
      let execInputFixtures: ExecFixture[] // second Solana-devnet -> Sepolia v1.6
      let solanaSourceChain: SolanaChain | undefined

      before(async () => {
        await acquireDirectResources()
        // Rank first: the devnet probe below uses the ranked transactions, not only the
        // pin, whose tx a public endpoint may already have pruned.
        const [ranked] = await Promise.all([
          Promise.all([
            rankExecFixtures({
              api: stagingApi,
              pinned: SOLANA_DEVNET_EXEC_TEST_MSG,
              version: CCIPVersion.V1_6,
              sourceSelector: SOLANA_DEVNET_SELECTOR,
              destSelector: SEPOLIA_SELECTOR,
            }),
            rankExecFixtures({
              api: stagingApi,
              pinned: SOLANA_DEVNET_EXEC_INPUT_TEST_MSG,
              version: CCIPVersion.V1_6,
              sourceSelector: SOLANA_DEVNET_SELECTOR,
              destSelector: SEPOLIA_SELECTOR,
            }),
          ]),
          ensureSepoliaFork(),
        ])
        ;[execFixtures, execInputFixtures] = ranked

        // Probe the first few distinct ranked txs; keep the pin as a fallback.
        const probeTxHashes = [
          ...new Set(
            [...execFixtures, ...execInputFixtures]
              .map((fixture) => fixture.txHash)
              .filter((txHash): txHash is string => !!txHash),
          ),
        ].slice(0, 3)
        const solanaRpc = await raceRpcEndpoint(
          'RPC_SOLANA_DEVNET',
          (url) =>
            solanaDevnetHealthy(
              url,
              probeTxHashes.length > 0 ? probeTxHashes : [SOLANA_DEVNET_EXEC_TEST_MSG.txHash],
            ),
          { ordered: true },
        )
        solanaSourceChain = new SolanaChain(
          new Connection(solanaRpc, { commitment: 'confirmed' }),
          networkInfo('solana-devnet'),
          { apiClient: null, logger: testLogger },
        )
      })
      beforeEach(acquireDirectResources)
      after(releaseDirectResources)

      it(
        'should manually execute a failed v1.6 message (Solana -> Sepolia)',
        { timeout: 120_000 },
        async () => {
          await tryExecFixtures(execFixtures, usedIds, async (fixture) => {
            // A transient execution retry has released the source locks; reacquire them.
            await acquireDirectResources()
            assert.ok(solanaSourceChain, 'source chain should be initialized')
            assert.ok(sepoliaChain, 'dest chain should be initialized')
            assert.ok(fixture.txHash, 'fixture should include the source transaction')
            // 1. Get source transaction and extract CCIPRequest (direct solana
            // devnet reads — no fork relay, full history)
            const tx = await solanaSourceChain.getTransaction(fixture.txHash)
            const requests: CCIPRequest[] = await solanaSourceChain.getMessagesInTx(tx)
            const request = requests.find((r) => r.message.messageId === fixture.messageId)
            assert.ok(request, 'should find the expected message')

            // 2. Use the API's OffRamp hint; discover it live if the API omits it.
            const offRamp: string =
              fixture.offRamp ??
              (await discoverOffRamp(
                solanaSourceChain,
                sepoliaChain,
                request.lane,
                solanaSourceChain,
              ))
            assert.ok(offRamp, 'offRamp should be resolved')

            // 3. Get commit store and commit report
            const verifications: Awaited<ReturnType<Chain['getVerifications']>> =
              await sepoliaChain.getVerifications({ offRamp, request })
            assert.ok('report' in verifications, 'commit should have a merkle root')
            assert.ok(verifications.report.merkleRoot, 'commit should have a merkle root')

            // 4. Get all messages in the commit batch from source
            const messagesInBatch = await solanaSourceChain.getMessagesInBatch(
              request,
              verifications.report,
            )

            // 5. Calculate manual execution proof
            const execReportProof = calculateManualExecProof(
              messagesInBatch,
              request.lane,
              request.message.messageId,
              verifications.report.merkleRoot,
              solanaSourceChain,
            )

            // 6. Get offchain token data
            const offchainTokenData = await solanaSourceChain.getOffchainTokenData(request)

            // 7. Build execution report and execute
            const input = {
              ...execReportProof,
              message: request.message,
              offchainTokenData,
            } as ExecutionInput
            const execution = await executeOnSepolia({
              offRamp,
              input,
              wallet,
              gasLimit: 500_000,
            })

            assert.equal(
              execution.receipt.messageId,
              fixture.messageId,
              'receipt messageId should match',
            )
            assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
            assert.ok(
              execution.log.blockTimestamp > 0,
              'execution should have a positive timestamp',
            )
            assert.ok(
              execution.receipt.state === ExecutionState.Success,
              'execution state should be Success',
            )
          })
        },
      )

      it(
        'should execute via getExecutionInput (Solana -> Sepolia)',
        { timeout: 120_000 },
        async () => {
          await tryExecFixtures(execInputFixtures, usedIds, async (fixture) => {
            await acquireDirectResources()
            assert.ok(solanaSourceChain, 'source chain should be initialized')
            assert.ok(sepoliaChain, 'dest chain should be initialized')
            assert.ok(fixture.txHash, 'fixture should include the source transaction')
            // 1. Get source transaction and extract CCIPRequest (direct solana devnet
            // reads — no fork relay, full history)
            const tx = await solanaSourceChain.getTransaction(fixture.txHash)
            const requests: CCIPRequest[] = await solanaSourceChain.getMessagesInTx(tx)
            const request = requests.find((r) => r.message.messageId === fixture.messageId)
            assert.ok(request, 'should find the expected message')

            // 2. Use the API's OffRamp hint; discover it live if the API omits it.
            const offRamp: string =
              fixture.offRamp ??
              (await discoverOffRamp(
                solanaSourceChain,
                sepoliaChain,
                request.lane,
                solanaSourceChain,
              ))
            assert.ok(offRamp, 'offRamp should be resolved')

            // 3. Get verifications from destination chain
            const verifications: Awaited<ReturnType<Chain['getVerifications']>> =
              await sepoliaChain.getVerifications({ offRamp, request })

            // 4. Build execution input via getExecutionInput (replaces manual proof +
            // offchain steps)
            const input = await solanaSourceChain.getExecutionInput({ request, verifications })

            // 5. Execute on destination
            const execution = await executeOnSepolia({
              offRamp,
              input,
              wallet,
              gasLimit: 500_000,
            })

            console.log(
              `  executed ${fixture.messageId.slice(0, 10)}… → state=${execution.receipt.state}`,
            )
            assert.equal(
              execution.receipt.messageId,
              fixture.messageId,
              'receipt messageId should match',
            )
            assert.ok(execution.log.transactionHash, 'execution log should have a transaction hash')
            assert.ok(
              execution.log.blockTimestamp > 0,
              'execution should have a positive timestamp',
            )
            assert.ok(
              execution.receipt.state === ExecutionState.Success,
              'execution state should be Success',
            )
          })
        },
      )
    })

    describe('API-driven execution on Fuji (Arb-Sep / Sepolia sources)', () => {
      // Fuji fork and staging API. No Sepolia lock: this group only executes on Fuji.
      useResourceForDescribe(['fuji', 'api-staging'])

      let v2ApiFixtures: ExecFixture[] // Arb-Sep -> Fuji v2.0, API-driven
      let v1_5ApiFixtures: ExecFixture[] // Sepolia -> Fuji v1.5, API-driven
      let fujiInstance: ReturnType<typeof Instance.anvil> | undefined

      before(async () => {
        ;[v2ApiFixtures, v1_5ApiFixtures] = await Promise.all([
          rankExecFixtures({
            api: stagingApi,
            pinned: V2_API_EXEC_MSG,
            version: CCIPVersion.V2_0,
            sourceSelector: ARB_SEP_SELECTOR,
            destSelector: FUJI_SELECTOR,
          }),
          rankExecFixtures({
            api: stagingApi,
            pinned: V1_5_API_EXEC_MSG,
            version: CCIPVersion.V1_5,
            sourceSelector: SEPOLIA_SELECTOR,
            destSelector: FUJI_SELECTOR,
          }),
        ])

        // The official Fuji RPC fallback (api.avax-test.network) sits behind Cloudflare, which answers
        // bursty fork traffic with hard 1015 bans that outlast anvil's retries — reproduced
        // locally as fork transport errors and empty-revert "missing revert data" call
        // failures (the same signatures as CI run 39058311489). Bound the fork's upstream
        // request rate: CUPS paces by per-request compute-unit weights (common reads cost
        // ~17-42 CU, so 100 CUPS ≈ low single-digit requests/s), only the API-driven execute
        // tests hit this fork, and the retained retry opts ride out the occasional blip.
        const fujiForkOpts = { ...forkOpts, computeUnitsPerSecond: 100 } as const
        // A fork reads state lazily for the whole suite: probe an OffRamp 1000 blocks
        // back, which covers the 600s budget (~410 blocks) plus 256 blockhash ancestors.
        const fujiRpc = await raceRpcEndpoint(
          'RPC_FUJI',
          async (url) => {
            const chain = await EVMChain.fromUrl(url, {
              apiClient: null,
              abort: AbortSignal.timeout(10_000),
            })
            try {
              return (
                (await chain.provider.getCode(
                  V1_5_API_EXEC_MSG.offRamp,
                  (await chain.provider.getBlockNumber()) - 1000,
                )) !== '0x'
              )
            } finally {
              chain.destroy()
            }
          },
          { ordered: true },
        )
        fujiInstance = Instance.anvil(
          { forkUrl: fujiRpc, chainId: FUJI_CHAIN_ID, port: 8645, ...fujiForkOpts },
          {},
        )
        await startForkWithRetries(fujiInstance)
      })

      after(async () => {
        await fujiInstance?.stop()
      })

      it(
        'should execute a v2.0 message via API-driven path (Arb-Sep -> Fuji)',
        { timeout: 120_000 },
        async () => {
          assert.ok(fujiInstance, 'fuji anvil should be running')

          // Create a fuji chain with staging API client (execution-inputs endpoint)
          const fujiProvider = await forkProvider(fujiInstance, { logger: testLogger })
          const fujiWithApi = await EVMChain.fromProvider(fujiProvider, {
            apiClient: stagingApi,
            logger: testLogger,
          })
          const w = new Wallet(ANVIL_PRIVATE_KEY, fujiProvider)

          try {
            await tryExecFixtures(v2ApiFixtures, usedIds, async (fixture) => {
              // Execute via messageId only — triggers API-driven path
              const execution = await fujiWithApi.execute({
                messageId: fixture.messageId,
                wallet: w,
                gasLimit: 500_000,
              })

              console.log(
                `  executed ${fixture.messageId.slice(0, 10)}… via API → state=${execution.receipt.state}`,
              )
              assert.equal(
                execution.receipt.messageId,
                fixture.messageId,
                'receipt messageId should match',
              )
              assert.ok(execution.log.transactionHash, 'should have tx hash')
              assert.ok(execution.log.blockTimestamp > 0, 'should have timestamp')
              assert.equal(execution.receipt.state, ExecutionState.Success)
            })
          } finally {
            fujiWithApi.provider.destroy()
          }
        },
      )

      it(
        'should execute a v1.5 message via API-driven path (Sepolia -> Fuji)',
        { timeout: 120_000 },
        async () => {
          assert.ok(fujiInstance, 'fuji anvil should be running')

          const fujiProvider = await forkProvider(fujiInstance, { logger: testLogger })
          const fujiWithApi = await EVMChain.fromProvider(fujiProvider, {
            apiClient: stagingApi,
            logger: testLogger,
          })
          const w = new Wallet(ANVIL_PRIVATE_KEY, fujiProvider)

          try {
            await tryExecFixtures(v1_5ApiFixtures, usedIds, async (fixture) => {
              const execution = await fujiWithApi.execute({
                messageId: fixture.messageId,
                wallet: w,
                gasLimit: 500_000,
              })

              console.log(
                `  executed ${fixture.messageId.slice(0, 10)}… via API (v1.5 Sepolia→Fuji) → state=${execution.receipt.state}`,
              )
              assert.equal(
                execution.receipt.messageId,
                fixture.messageId,
                'receipt messageId should match',
              )
              assert.ok(execution.log.transactionHash, 'should have tx hash')
              assert.ok(execution.log.blockTimestamp > 0, 'should have timestamp')
              assert.equal(execution.receipt.state, ExecutionState.Success)
            })
          } finally {
            fujiWithApi.provider.destroy()
          }
        },
      )
    })

    describe('API-driven execution on Sepolia (TON / Solana sources)', () => {
      // Sepolia fork and staging API. The source data comes from the API, so this group
      // does not need the Solana devnet lock.
      useResourceForDescribe(['sepolia', 'api-staging'])

      let solanaApiFixtures: ExecFixture[] // Solana-devnet -> Sepolia v1.6, API-driven

      before(async () => {
        const [ranked] = await Promise.all([
          rankExecFixtures({
            api: stagingApi,
            pinned: SOLANA_DEVNET_TO_SEPOLIA[0]!,
            version: CCIPVersion.V1_6,
            sourceSelector: SOLANA_DEVNET_SELECTOR,
            destSelector: SEPOLIA_SELECTOR,
          }),
          ensureSepoliaFork(),
        ])
        solanaApiFixtures = ranked
      })

      // TON-source messages were historically problematic due to data quality issues
      // on AtlasDB. This test verifies the API workaround that resolves the issue.
      it(
        'should execute a TON-source message via API-driven path (TON -> Sepolia)',
        { timeout: 120_000 },
        async () => {
          assert.ok(sepoliaInstance, 'sepolia anvil should be running')

          const messageId = '0xe913d21d8bc14316286646539db34bc7dd14b11c6ae3b0c307e7e52f6af02805'

          const sepoliaProvider = await forkProvider(sepoliaInstance, { logger: testLogger })
          const sepoliaWithApi = await EVMChain.fromProvider(sepoliaProvider, {
            apiClient: stagingApi,
            logger: testLogger,
          })
          const w = new Wallet(ANVIL_PRIVATE_KEY, sepoliaProvider)

          // Execute via messageId only — triggers API-driven path
          const execution = await sepoliaWithApi.execute({
            messageId,
            wallet: w,
            gasLimit: 500_000,
          })

          console.log(
            `  executed ${messageId.slice(0, 10)}… via API (TON source) → state=${execution.receipt.state}`,
          )
          assert.equal(execution.receipt.messageId, messageId, 'receipt messageId should match')
          assert.ok(execution.log.transactionHash, 'should have tx hash')
          assert.ok(execution.log.blockTimestamp > 0, 'should have timestamp')
          assert.equal(execution.receipt.state, ExecutionState.Success)

          sepoliaWithApi.provider.destroy()
        },
      )

      // Another problematic TON-source message with gasLimit=1 and data payload.
      // Validates the API-driven manual execution path for TON → Sepolia.
      it(
        'should execute a problematic TON-source message via API-driven path (TON -> Sepolia, gasLimit=1)',
        { timeout: 120_000 },
        async () => {
          assert.ok(sepoliaInstance, 'sepolia anvil should be running')

          const msg = TON_TO_SEPOLIA[0]!

          const sepoliaProvider = await forkProvider(sepoliaInstance, { logger: testLogger })
          const sepoliaWithApi = await EVMChain.fromProvider(sepoliaProvider, {
            apiClient: stagingApi,
            logger: testLogger,
          })
          const w = new Wallet(ANVIL_PRIVATE_KEY, sepoliaProvider)

          const execution = await sepoliaWithApi.execute({
            messageId: msg.messageId,
            wallet: w,
            gasLimit: 500_000,
          })

          console.log(
            `  executed ${msg.messageId.slice(0, 10)}… via API (TON source, gasLimit=1) → state=${execution.receipt.state}`,
          )
          assert.equal(execution.receipt.messageId, msg.messageId, 'receipt messageId should match')
          assert.ok(execution.log.transactionHash, 'should have tx hash')
          assert.ok(execution.log.blockTimestamp > 0, 'should have timestamp')
          assert.equal(execution.receipt.state, ExecutionState.Success)

          sepoliaWithApi.provider.destroy()
        },
      )

      // Solana Devnet → Sepolia messages through the API-driven manual-exec path.
      // - The pin's lane.version was once reported as "1.6.2"; the CCIPVersion enum only
      //   knows "1.6.0", so the SDK must normalize patch-level versions (e.g. for the leaf
      //   hasher in calculateManualExecProof).
      // - Its router (Ccip842…, also the pin's onRamp) is a ccip-router 2.0.0 that keeps
      //   serving 1.6 lanes. From 2026-11-05 to 2026-11-09 the API reported "2.0.0" for
      //   these 1.6 messages and answered HTTP 500 on execution-inputs. rankExecFixtures
      //   keeps only messages the API reports as v1.6, so a repeat of that regression
      //   shows as "0 ranked", not as an HTTP 500.
      // The pin goes first, then the lane's newest failed messages (shared `usedIds`).
      it(
        'should execute a Solana-source message via API-driven path (Solana Devnet -> Sepolia)',
        { timeout: 120_000 },
        async () => {
          assert.ok(sepoliaInstance, 'sepolia anvil should be running')

          const sepoliaProvider = await forkProvider(sepoliaInstance, { logger: testLogger })
          const sepoliaWithApi = await EVMChain.fromProvider(sepoliaProvider, {
            apiClient: stagingApi,
            logger: testLogger,
          })
          const w = new Wallet(ANVIL_PRIVATE_KEY, sepoliaProvider)

          try {
            await tryExecFixtures(solanaApiFixtures, usedIds, async (fixture) => {
              const execution = await sepoliaWithApi.execute({
                messageId: fixture.messageId,
                wallet: w,
                gasLimit: 500_000,
              })

              console.log(
                `  executed ${fixture.messageId.slice(0, 10)}… via API (Solana source) → state=${execution.receipt.state}`,
              )
              assert.equal(
                execution.receipt.messageId,
                fixture.messageId,
                'receipt messageId should match',
              )
              assert.ok(execution.log.transactionHash, 'should have tx hash')
              assert.ok(execution.log.blockTimestamp > 0, 'should have timestamp')
              assert.equal(execution.receipt.state, ExecutionState.Success)
            })
          } finally {
            sepoliaWithApi.provider.destroy()
          }
        },
      )
    })
  })

  describe('ViemTransportProvider — revert data forwarding', () => {
    useResourceForDescribe(['sepolia'])
    before(ensureSepoliaFork)

    // Triggers a real pool-capacity revert through the viem adapter and asserts the
    // SDK's error-decoding machinery recovers the custom error name + args.
    // Pre-fix (before Patch B): `ViemTransportProvider._send` drops viem's error.data;
    // `EVMChain.parse(err)` only sees the calldata selector and returns `method: "ccipSend"`
    // with no `revert` key.
    // Post-fix: the walk preserves error.data; `parseWithFragment` matches the selector
    // against the pool ABI and returns `TokenMaxCapacityExceeded` with decoded args.
    // BigInt-safe JSON stringifier — `parsed` contains decoded revert args as bigints.
    const stringifyParsed = (v: unknown): string =>
      JSON.stringify(v, (_, val) => (typeof val === 'bigint' ? val.toString() : val))

    // Reads the pool's current outbound capacity through the SDK and returns 10× it, so
    // the post-fee amount still exceeds capacity regardless of the pool's transfer-fee
    // config. The pool deducts a percentage fee BEFORE the rate-limit check, so sending
    // exactly `capacity + 1` underflows capacity after the fee and is accepted. Keeps
    // the test dynamic across rate-limit reconfigs on the upstream pool.
    const overCapacityAmount = async (): Promise<bigint> => {
      assert.ok(sepoliaChain, 'sepolia chain should be initialized for capacity probe')
      const features = await sepoliaChain.getLaneFeatures({
        router: SEPOLIA_V2_0_ROUTER,
        destChainSelector: FUJI_SELECTOR,
        token: FTF_TOKEN_SEPOLIA,
      })
      const rateLimits = features[LaneFeature.RATE_LIMITS]
      assert.ok(rateLimits?.capacity, 'pool must have rate-limit capacity configured')
      return rateLimits.capacity * 10n + 1n
    }

    // Each test in this block submits real txs through a dedicated `EVMChain` instance
    // so nonce caches start empty and re-fetch from the fork. The shared `sepoliaChain`
    // used elsewhere in the suite holds cached nonces from prior tests, which become
    // stale once other chains on the same fork consume nonces for this wallet.

    it(
      'decodes TokenMaxCapacityExceeded custom error on pool-capacity revert',
      { timeout: 120_000 },
      async () => {
        assert.ok(sepoliaInstance, 'sepolia anvil should be running')
        const anvilUrl = `http://${sepoliaInstance.host}:${sepoliaInstance.port}`
        const walletAddress = await wallet.getAddress()

        // Amount = 10× pool's outbound capacity (see overCapacityAmount). Dynamic so the
        // test survives rate-limit reconfig upstream. `sendMessage` handles approve internally.
        const oversizedAmount = await overCapacityAmount()
        const ethersProvider = wallet.provider as JsonRpcProvider
        await setERC20Balance(ethersProvider, FTF_TOKEN_SEPOLIA, walletAddress, oversizedAmount)

        // Build a viem PublicClient pointed at the same Anvil fork, wrap with
        // ViemTransportProvider, and bind a Wallet to it. Every RPC call
        // (estimateGas, eth_call, eth_sendTransaction) now flows through the adapter.
        const viemClient = createPublicClient({
          chain: { id: SEPOLIA_CHAIN_ID, name: 'Sepolia Fork' } as never,
          transport: http(anvilUrl),
        })
        const viemProvider = new ViemTransportProvider(viemClient as never)
        const viemWallet = new Wallet(ANVIL_PRIVATE_KEY, viemProvider)
        const viemChain = await EVMChain.fromProvider(viemProvider, {
          apiClient: null,
          logger: testLogger,
        })
        // Bypass SDK preflight so the on-chain TokenMaxCapacityExceeded revert reaches EVMChain.parse.
        viemChain.checkSendMessage = async () => true as const

        let caught: unknown
        try {
          await viemChain.sendMessage({
            router: SEPOLIA_V2_0_ROUTER,
            destChainSelector: FUJI_SELECTOR,
            message: {
              receiver: walletAddress,
              tokenAmounts: [{ token: FTF_TOKEN_SEPOLIA, amount: oversizedAmount }],
              extraArgs: { gasLimit: 0n },
            },
            wallet: viemWallet,
          })
        } catch (err) {
          caught = err
        }

        assert.ok(caught, 'sendMessage should throw on over-capacity amount')

        const parsed = EVMChain.parse(caught)
        assert.ok(parsed, 'EVMChain.parse should return a decoded envelope')

        const flat = stringifyParsed(parsed)
        assert.match(
          flat,
          /TokenMaxCapacityExceeded/,
          `viem-adapter path should surface the decoded custom error name. Parsed: ${flat}`,
        )

        viemChain.provider.destroy()
      },
    )

    // Cross-check: same over-capacity send via the ethers-direct chain (sepoliaChain)
    // must produce an equivalent decoded output. Proves the viem adapter achieves
    // functional parity with the ethers-direct baseline.
    it(
      'produces equivalent decoded output on ethers-direct path',
      { timeout: 120_000 },
      async () => {
        assert.ok(sepoliaInstance, 'sepolia anvil should be running')
        const walletAddress = await wallet.getAddress()

        const oversizedAmount = await overCapacityAmount()
        const ethersProvider = wallet.provider as JsonRpcProvider
        await setERC20Balance(ethersProvider, FTF_TOKEN_SEPOLIA, walletAddress, oversizedAmount)

        // Dedicated EVMChain for this test (see describe-block preamble).
        const provider = await forkProvider(sepoliaInstance, { logger: testLogger })
        const ethersChainLocal = await EVMChain.fromProvider(provider, {
          apiClient: null,
          logger: testLogger,
        })
        // Bypass SDK preflight so the on-chain TokenMaxCapacityExceeded revert reaches EVMChain.parse.
        ethersChainLocal.checkSendMessage = async () => true as const
        const ethersWalletLocal = new Wallet(ANVIL_PRIVATE_KEY, ethersChainLocal.provider)

        let caught: unknown
        try {
          await ethersChainLocal.sendMessage({
            router: SEPOLIA_V2_0_ROUTER,
            destChainSelector: FUJI_SELECTOR,
            message: {
              receiver: walletAddress,
              tokenAmounts: [{ token: FTF_TOKEN_SEPOLIA, amount: oversizedAmount }],
              extraArgs: { gasLimit: 0n },
            },
            wallet: ethersWalletLocal,
          })
        } catch (err) {
          caught = err
        }

        assert.ok(caught, 'sendMessage should throw on oversized amount (ethers-direct)')
        const parsed = EVMChain.parse(caught)
        assert.ok(parsed, 'EVMChain.parse should decode the revert on ethers-direct path')

        const flat = stringifyParsed(parsed)
        assert.match(
          flat,
          /TokenMaxCapacityExceeded/,
          `ethers-direct path should surface the decoded custom error name. Parsed: ${flat}`,
        )

        ethersChainLocal.provider.destroy()
      },
    )
  })
})
