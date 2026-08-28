/**
 * Integration tests for the destination-liquidity preflight — read-only.
 *
 * The pool-direct `releaseOrMint` simulation is a pure `eth_call`, so these run directly against
 * live testnet RPCs (no anvil fork needed): an isolated v2.0 staging lane (Sepolia → Fuji) with a
 * dedicated test token whose dest pool is a healthy `BurnMintTokenPool 2.0.0`.
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
import { useResource } from '../../../scripts/useResource.ts'
import { CCIPDestSimulationUnavailableError } from '../errors/index.ts'
import { estimateReceiveExecution } from '../gas.ts'
import { simulateReleaseOrMint } from './simulate.ts'
import { EVMChain } from './index.ts'

// Live RPCs: the isolated v2.0 staging lane (Sepolia → Fuji) and the LBTC prod-testnet lanes.
await useResource(['sepolia', 'fuji'])

const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://rpc.sepolia.ethpandaops.io'
const SEPOLIA_SELECTOR = 16015286601757825753n

const FUJI_RPC = process.env['RPC_FUJI'] || 'https://api.avax-test.network/ext/bc/C/rpc'

// ── Isolated v2.0 lane (Sepolia -> Fuji) with a dedicated test token and pools ──
// (the dest pool holds MINTER_ROLE on the dest token, so the lane is healthy)
const V2_LANE = {
  srcToken: '0x22C49Ef927eD414aC5B0bEc2b1c2310da9f6DfBb',
  srcPool: '0x760a96123b405828BaF7700bA4e30983a02Cd6b0',
  srcRouter: '0x784d49a71BB4C48eB7dA4cD7e6Ecb424f9b5EAB1', // Sepolia v2.0 router
  srcOnRamp: '0xA94E45744553F4B2bea9DfB8979a02962B980732',
  destToken: '0x20FF9b951E2E63564122c82F619FDFAD04F41960',
  destPool: '0xff3d3F625bb7Ca89A7C069573787D87d2b5C2360', // BurnMintTokenPool 2.0.0
  destOffRamp: '0xE60C1d654283252623e448f53F648663A701CD7b', // OffRamp 2.0.0
  operator: '0x9d087fC03ae39b088326b67fA3C788236645b717',
}

const skip = !!process.env.SKIP_INTEGRATION_TESTS

const testLogger = new Console(process.stdout, process.stderr)
if (!process.env.VERBOSE) testLogger.debug = () => {}

describe(
  'Dest-liquidity preflight integration (live RPC, read-only)',
  { skip, timeout: 300_000 },
  () => {
    let sepoliaChain: EVMChain | undefined
    let fujiChain: EVMChain | undefined

    before(async () => {
      sepoliaChain = await EVMChain.fromProvider(new JsonRpcProvider(SEPOLIA_RPC), {
        apiClient: null,
        logger: testLogger,
      })
      fujiChain = await EVMChain.fromProvider(new JsonRpcProvider(FUJI_RPC), {
        apiClient: null,
        logger: testLogger,
      })
    })

    after(() => {
      sepoliaChain?.provider.destroy()
      fujiChain?.provider.destroy()
    })

    const receiver = '0x1111111111111111111111111111111111111111'

    it('healthy mint pool => sim passes via the IPoolV2 2-arg branch', async () => {
      assert.ok(fujiChain)
      const result = await simulateReleaseOrMint({
        provider: fujiChain.provider,
        pool: V2_LANE.destPool,
        offRamp: V2_LANE.destOffRamp,
        input: {
          originalSender: receiver,
          remoteChainSelector: SEPOLIA_SELECTOR,
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
      assert.ok(fujiChain)
      assert.equal(
        await fujiChain.checkExecute({
          offRamp: V2_LANE.destOffRamp,
          message: {
            sourceChainSelector: SEPOLIA_SELECTOR,
            receiver,
            sender: receiver,
            tokenAmounts: [{ token: V2_LANE.destToken, amount: 10n ** 18n }],
          },
        }),
        true,
      )
    })

    // ── Lombard (LBTC) — attestation-consuming pools, BOTH generations, on live prod-testnet ──
    // LBTC is served on Sepolia by a `LombardTokenPool` and on Fuji by a `LombardTokenPool`;
    // both sit behind v1.x OffRamps, whose 1-arg releaseOrMint decodes the bridge proof from
    // offchainTokenData — so pre-send the preflight must report attestation-required (never a
    // false hard block). Pools/offRamps resolved on-chain.
    const LBTC = '0x107Fc7d90484534704dD2A9e24c7BD45DB4dD1B5'
    const PROD = {
      sepolia: {
        registry: '0x95F29FEE11c5C55d26cCcf1DB6772DE953B37B82',
        router: '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59',
        sourceSelector: 14767482510784806043n, // fuji
        expectPoolType: 'LombardTokenPool', // 2.0.0
      },
      fuji: {
        registry: '0xA92053a4a3922084d992fD2835bdBa4caC6877e6',
        router: '0xF694E193200268f9a4868e4Aa017A0118C9a8177',
        sourceSelector: 16015286601757825753n, // sepolia
        expectPoolType: 'LombardTokenPool', // 2.0.0, still behind a v1.x OffRamp
      },
    } as const

    for (const destName of ['sepolia', 'fuji'] as const) {
      it(`LBTC dest on ${destName} (${PROD[destName].expectPoolType}) => attestation-required pre-send, not a block`, async () => {
        const dest = destName === 'sepolia' ? sepoliaChain : fujiChain
        assert.ok(dest)
        const { registry, router, sourceSelector, expectPoolType } = PROD[destName]
        const { tokenPool } = await dest.getRegistryTokenConfig(registry, LBTC)
        assert.ok(tokenPool, 'LBTC pool registered')
        assert.equal((await dest.typeAndVersion(tokenPool))[0], expectPoolType)
        const offRamps = await dest.getOffRampsForRouter(router, sourceSelector)
        const offRamp = offRamps.at(-1)!
        assert.ok(offRamp, 'offRamp resolved for the lane')
        await assert.rejects(
          () =>
            dest.checkExecute({
              offRamp,
              message: {
                sourceChainSelector: sourceSelector,
                receiver,
                tokenAmounts: [{ token: LBTC, amount: 10n ** 4n }],
              },
            }),
          (err: Error) => {
            assert.ok(err instanceof CCIPDestSimulationUnavailableError, String(err))
            assert.equal(err.reason, 'attestation-required')
            assert.equal(err.isTransient, false)
            return true
          },
        )
      })
    }

    it('estimateReceiveExecution wrapper matches the direct dest-side gas estimate', async () => {
      assert.ok(sepoliaChain && fujiChain)
      const messageId = hexlify(randomBytes(32))
      const sender = V2_LANE.operator
      // full wrapper: source-token mapping + source lockOrBurn sim + checkExecute + gas estimate
      const viaWrapper = await estimateReceiveExecution({
        source: sepoliaChain,
        dest: fujiChain,
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
      const direct = await fujiChain.estimateReceiveExecution({
        offRamp: V2_LANE.destOffRamp,
        message: {
          messageId,
          sender,
          receiver,
          data: '0x',
          sourceChainSelector: SEPOLIA_SELECTOR,
          tokenAmounts: [{ token: V2_LANE.destToken, amount: 10n ** 18n }],
        },
      })
      assert.equal(viaWrapper, direct)
    })
  },
)
