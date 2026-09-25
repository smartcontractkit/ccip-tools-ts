/**
 * Integration tests for the destination-liquidity preflight — read-only.
 *
 * The pool-direct `releaseOrMint` simulation is a pure `eth_call`, so these run directly against
 * live RPCs (no anvil fork needed): a CCIP 2.0 lane (Arbitrum One → Ethereum) whose dest pool is a
 * healthy `BurnMintTokenPool 2.0.0`, plus the Lombard (LBTC) prod lanes between Ethereum and
 * Monad.
 *
 * Deliberately none of these networks is Sepolia or Fuji: those two are the hubs every other live
 * suite locks (see `useResource`), so keeping this one off them lets it run in parallel with the
 * rest of CI instead of queueing behind them.
 *
 * Scenarios that must MUTATE chain state to reproduce (role revocation, fee configs, drained
 * liquidity) live in dest-liquidity.fork.test.ts instead.
 */
import assert from 'node:assert/strict'
import { Console } from 'node:console'
import { after, before, describe, it } from 'node:test'

import { JsonRpcProvider, hexlify, randomBytes, zeroPadValue } from 'ethers'

import '../aptos/index.ts' // register chain families for cross-family message decoding
import '../solana/index.ts'
import '../ton/index.ts'
import { rpcEndpoint } from '../../../scripts/test-endpoints.ts'
import { useResource } from '../../../scripts/useResource.ts'
import { CCIPDestSimulationUnavailableError } from '../errors/index.ts'
import { estimateReceiveExecution } from '../gas.ts'
import { CCIPVersion } from '../types.ts'
import { simulateReleaseOrMint } from './simulate.ts'
import { EVMChain } from './index.ts'

// Live RPCs: the CCIP 2.0 lane (Arbitrum -> Ethereum) and the LBTC prod lanes (Ethereum <-> Monad).
await useResource(['ethereum-mainnet', 'monad-mainnet', 'arbitrum-mainnet'])

const ETHEREUM_RPC = rpcEndpoint('RPC_ETHEREUM_MAINNET')
const ETHEREUM_SELECTOR = 5009297550715157269n

// this suite issues no eth_getLogs at all (only eth_call/eth_chainId), so the
// width never bites here.
const MONAD_RPC = rpcEndpoint('RPC_MONAD_MAINNET')
const MONAD_SELECTOR = 8481857512324358265n

const ARBITRUM_RPC = rpcEndpoint('RPC_ARBITRUM_MAINNET')
const ARBITRUM_SELECTOR = 4949039107694359620n

// ── CCIP 2.0 lane (Arbitrum One -> Ethereum) with a v2.0 mint/burn test token and pools ──
// (the dest pool holds mint authority on the dest token, so the lane is healthy)
const V2_LANE = {
  srcToken: '0x83cB78b9009d48C57F29A453dd5bc774b1545682', // TESTTR on Arbitrum One
  srcPool: '0xE70aE419e514Dfd12a7413D6CeD75Fc98b588Cf6', // BurnMintTokenPool 2.0.0
  srcRouter: '0x141fa059441E0ca23ce184B6A78bafD2A517DdE8', // Arbitrum v2.0 Router
  srcOnRamp: '0x7B73923E101950eFe098C2Eca74C8320b2813f48', // OnRamp 2.0.0
  destToken: '0x5904eBd0519028ca1550FBE96466B4b226f0C328', // TESTTR on Ethereum
  destPool: '0x6eC2a0B3E92819A881f30e70478320BCEaAA4FF1', // BurnMintTokenPool 2.0.0
  destOffRamp: '0x408428bca0e24A25ac8baAc1b70f64AF257717c3', // OffRamp 2.0.0
}

const skip = !!process.env.SKIP_INTEGRATION_TESTS

const testLogger = new Console(process.stdout, process.stderr)
if (!process.env.VERBOSE) testLogger.debug = () => {}

describe(
  'Dest-liquidity preflight integration (live RPC, read-only)',
  { skip, timeout: 300_000 },
  () => {
    let ethereumChain: EVMChain | undefined
    let monadChain: EVMChain | undefined
    let arbitrumChain: EVMChain | undefined

    before(async () => {
      ethereumChain = await EVMChain.fromProvider(new JsonRpcProvider(ETHEREUM_RPC), {
        apiClient: null,
        logger: testLogger,
      })
      monadChain = await EVMChain.fromProvider(new JsonRpcProvider(MONAD_RPC), {
        apiClient: null,
        logger: testLogger,
      })
      arbitrumChain = await EVMChain.fromProvider(new JsonRpcProvider(ARBITRUM_RPC), {
        apiClient: null,
        logger: testLogger,
      })
    })

    after(() => {
      ethereumChain?.provider.destroy()
      monadChain?.provider.destroy()
      arbitrumChain?.provider.destroy()
    })

    const receiver = '0x1111111111111111111111111111111111111111'

    it('healthy mint pool => sim passes via the IPoolV2 2-arg branch', async () => {
      assert.ok(ethereumChain)
      const result = await simulateReleaseOrMint({
        provider: ethereumChain.provider,
        pool: V2_LANE.destPool,
        offRamp: V2_LANE.destOffRamp,
        input: {
          originalSender: receiver,
          remoteChainSelector: ARBITRUM_SELECTOR,
          receiver,
          sourceDenominatedAmount: 10n ** 18n,
          localToken: V2_LANE.destToken,
          sourcePoolAddress: zeroPadValue(V2_LANE.srcPool, 32),
        },
        finality: 'finalized',
      })
      assert.equal(result.poolInterface, 'IPoolV2')
      assert.equal(result.destinationAmount, 10n ** 18n)
    })

    it('checkExecute passes end-to-end on the healthy lane', async () => {
      assert.ok(ethereumChain)
      assert.equal(
        await ethereumChain.checkExecute({
          offRamp: V2_LANE.destOffRamp,
          message: {
            sourceChainSelector: ARBITRUM_SELECTOR,
            receiver,
            sender: receiver,
            tokenAmounts: [{ token: V2_LANE.destToken, amount: 10n ** 18n }],
          },
        }),
        true,
      )
    })

    // ── Lombard (LBTC) — attestation-consuming pools, on the live prod Ethereum <-> Monad lanes ──
    // LBTC is served on both ends by a Lombard pool whose 1-arg releaseOrMint decodes the bridge
    // proof from offchainTokenData — so pre-send the preflight must report attestation-required
    // (never a false hard block). Pools/offRamps resolved on-chain.
    //
    // The registry entry migrates with the pool deployment: this test asserted
    // `LombardTokenPoolV2 1.6.1` when it was written and both lanes now answer
    // `LombardTokenPool 2.1.0` (2026-09). Both are the attestation-consuming Lombard class the
    // preflight classifies by (see EVMChain.destPoolRequiresOffchainTokenData), so the class is
    // what this test asserts; the version read is reported in the failure message.
    const LOMBARD_POOL_TYPES: readonly string[] = ['LombardTokenPool', 'LombardTokenPoolV2']
    const PROD = {
      ethereum: {
        token: '0x8236a87084f8B84306f72007F36F2618A5634494', // LBTC on Ethereum
        registry: '0xb22764f98dD05c789929716D677382Df22C05Cb6',
        router: '0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D',
        sourceSelector: MONAD_SELECTOR,
      },
      monad: {
        token: '0xecAc9C5F704e954931349Da37F60E39f515c11c1', // LBTC on Monad
        registry: '0x11ACd984DD680363117B310f6ebdf78fD6c0195f',
        router: '0x33566fE5976AAa420F3d5C64996641Fc3858CaDB',
        sourceSelector: ETHEREUM_SELECTOR,
      },
    } as const

    for (const destName of ['ethereum', 'monad'] as const) {
      it(`LBTC dest on ${destName} (Lombard pool) => attestation-required pre-send, not a block`, async () => {
        const dest = destName === 'ethereum' ? ethereumChain : monadChain
        assert.ok(dest)
        const { token, registry, router, sourceSelector } = PROD[destName]
        const { tokenPool } = await dest.getRegistryTokenConfig(registry, token)
        assert.ok(tokenPool, 'LBTC pool registered')
        const [poolType, poolVersion] = await dest.typeAndVersion(tokenPool)
        assert.ok(
          LOMBARD_POOL_TYPES.includes(poolType),
          `expected an attestation-consuming Lombard pool, got ${poolType} ${poolVersion}`,
        )
        // The verdict follows the OFF-RAMP generation, not the pool: a pre-2.0 offRamp dispatches
        // to the pool's 1-arg releaseOrMint, which `abi.decode`s the bridge proof out of
        // `offchainTokenData`, while a 2.0 OffRamp hardcodes `offchainTokenData: ""` (minting is
        // verifier-side) and so simulates normally. The router registers one offRamp per
        // generation for this lane (three as of 2026-09, as the lane migrates), so resolve them
        // by version — `.at(-1)` silently picked the newest, which is exactly the one whose
        // verdict is the opposite — and assert both sides of that behavior.
        const offRamps: { offRamp: string; version: string }[] = []
        for (const offRamp of await dest.getOffRampsForRouter(router, sourceSelector)) {
          const [, version] = await dest.typeAndVersion(offRamp)
          offRamps.push({ offRamp, version })
        }
        assert.ok(offRamps.length > 0, `no offRamp registered for source ${sourceSelector}`)

        const message = () => ({
          sourceChainSelector: sourceSelector,
          receiver,
          tokenAmounts: [{ token, amount: 10n ** 4n }],
        })
        const legacy = offRamps.filter(({ version }) => version < CCIPVersion.V2_0)
        assert.ok(
          legacy.length > 0,
          `expected a pre-2.0 offRamp on the lane, got ${
            offRamps.map(({ version }) => version).join(', ') || 'none'
          }`,
        )
        for (const { offRamp } of legacy) {
          await assert.rejects(
            () => dest.checkExecute({ offRamp, message: message() }),
            (err: Error) => {
              assert.ok(err instanceof CCIPDestSimulationUnavailableError, String(err))
              assert.equal(err.reason, 'attestation-required')
              assert.equal(err.isTransient, false)
              return true
            },
          )
        }
        for (const { offRamp } of offRamps.filter(({ version }) => version >= CCIPVersion.V2_0)) {
          // not a false block: the 2.0 OffRamp never consumes offchain token data
          assert.equal(await dest.checkExecute({ offRamp, message: message() }), true)
        }
      })
    }

    it('estimateReceiveExecution wrapper matches the direct dest-side gas estimate', async () => {
      assert.ok(arbitrumChain && ethereumChain)
      const messageId = hexlify(randomBytes(32))
      const sender = receiver
      // full wrapper: source-token mapping + source lockOrBurn sim + checkExecute + gas estimate
      const viaWrapper = await estimateReceiveExecution({
        source: arbitrumChain,
        dest: ethereumChain,
        routerOrRamp: V2_LANE.srcRouter,
        message: {
          messageId,
          sender,
          receiver,
          data: '0x',
          onRampAddress: V2_LANE.srcOnRamp,
          offRampAddress: V2_LANE.destOffRamp,
          tokenAmounts: [{ token: V2_LANE.srcToken, amount: 10n ** 18n }],
        },
      })
      // direct dest-side estimate (the function the wrapper delegates the gas number to)
      const direct = await ethereumChain.estimateReceiveExecution({
        offRamp: V2_LANE.destOffRamp,
        message: {
          messageId,
          sender,
          receiver,
          data: '0x',
          sourceChainSelector: ARBITRUM_SELECTOR,
          tokenAmounts: [{ token: V2_LANE.destToken, amount: 10n ** 18n }],
        },
      })
      assert.equal(viaWrapper, direct)
    })
  },
)
