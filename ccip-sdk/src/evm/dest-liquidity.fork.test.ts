/**
 * Fork tests for the destination-liquidity preflight — scenarios that must MUTATE chain state to
 * reproduce, on anvil forks of live testnets (same harness as fork.test.ts):
 *
 * - MINTER_ROLE revoked on the dest token (impersonated admin): the AccessControl revert blocks
 *   the send with a non-transient CCIPDestExecutionRevertError, and recovers once re-granted.
 * - A transfer fee configured on the source pool (impersonated owner): `simulateLockOrBurn`
 *   surfaces the post-fee `destTokenAmount` the OnRamp would emit.
 *
 * Read-only scenarios (healthy sim, checkExecute end-to-end, wrapper/direct gas parity) run
 * against the live RPCs directly in dest-liquidity.integration.test.ts — no fork needed.
 *
 * Forks run at the head block: public testnet RPCs prune historical state, so pinning old
 * blocks would require an archive endpoint.
 */
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { Console } from 'node:console'
import { after, before, describe, it } from 'node:test'

import { Contract, JsonRpcProvider, solidityPackedKeccak256, toBeHex, zeroPadValue } from 'ethers'
import { Instance } from 'prool'

import '../aptos/index.ts' // register chain families for cross-family message decoding
import '../solana/index.ts'
import '../ton/index.ts'
import { rpcEndpoint } from '../../../scripts/test-endpoints.ts'
import { useResource } from '../../../scripts/useResource.ts'
import { CCIPDestExecutionRevertError } from '../errors/index.ts'
import { interfaces } from './const.ts'
import { getErrorData, parseWithFragment } from './errors.ts'
import { findBalancesSlot } from './gas.ts'
import { isTransientReleaseOrMintRevert, simulateReleaseOrMint } from './simulate.ts'
import { EVMChain } from './index.ts'

// Forks run atop live Sepolia/Fuji RPCs (anvil fetches state from the upstream lazily).
await useResource(['sepolia', 'fuji'])

// ── Chain constants ──

const SEPOLIA_RPC = rpcEndpoint('RPC_SEPOLIA', 'https://rpc.sepolia.ethpandaops.io')
const SEPOLIA_CHAIN_ID = 11155111
const SEPOLIA_SELECTOR = 16015286601757825753n

const FUJI_RPC = rpcEndpoint('RPC_FUJI', 'https://api.avax-test.network/ext/bc/C/rpc')
const FUJI_CHAIN_ID = 43113
const FUJI_SELECTOR = 14767482510784806043n

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
  operator: '0x9d087fC03ae39b088326b67fA3C788236645b717', // token admin (holds DEFAULT_ADMIN_ROLE)
}
const MINTER_ROLE = '0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6'

function isAnvilAvailable(): boolean {
  try {
    execSync('anvil --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

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

describe(
  'Dest-liquidity preflight fork tests',
  {
    skip,
    // The 300s default was measured-exceeded on CI: one scenario alone took
    // 283s there (anvil relays every uncached call to the upstream testnet RPC
    // through the job's throttled egress, each lazy state fetch 1s+), then the
    // whole suite was cancelled at the parent ceiling. 600s matches the CI
    // NETWORK_LOCK_TIMEOUT_MS headroom; node --test reports a suite timeout as
    // `cancelled` (not `fail`), which the PR report counts as not-passed too.
    timeout: 600_000,
  },
  () => {
    let sepoliaChain: EVMChain | undefined
    let fujiChain: EVMChain | undefined
    let sepoliaInstance: ReturnType<typeof Instance.anvil> | undefined
    let fujiInstance: ReturnType<typeof Instance.anvil> | undefined

    before(async () => {
      const forkOpts = { retries: 8, timeout: 60_000, forkRetryBackoff: 1_000 } as const
      // ports offset from fork.test.ts so both files can run in the same `node --test` run
      sepoliaInstance = Instance.anvil(
        { forkUrl: SEPOLIA_RPC, chainId: SEPOLIA_CHAIN_ID, port: 8656, ...forkOpts },
        {},
      )
      fujiInstance = Instance.anvil(
        { forkUrl: FUJI_RPC, chainId: FUJI_CHAIN_ID, port: 8655, ...forkOpts },
        {},
      )
      await Promise.all([startForkWithRetries(sepoliaInstance), startForkWithRetries(fujiInstance)])

      const sepoliaProvider = new JsonRpcProvider(
        `http://${sepoliaInstance.host}:${sepoliaInstance.port}`,
      )
      const fujiProvider = new JsonRpcProvider(`http://${fujiInstance.host}:${fujiInstance.port}`)
      sepoliaChain = await EVMChain.fromProvider(sepoliaProvider, {
        apiClient: null,
        logger: testLogger,
      })
      fujiChain = await EVMChain.fromProvider(fujiProvider, { apiClient: null, logger: testLogger })
    })

    after(async () => {
      sepoliaChain?.provider.destroy()
      fujiChain?.provider.destroy()
      await Promise.all([sepoliaInstance?.stop(), fujiInstance?.stop()])
    })

    describe('v2.0 lane state-manipulation scenarios', () => {
      const receiver = '0x1111111111111111111111111111111111111111'
      const input = {
        originalSender: receiver,
        remoteChainSelector: SEPOLIA_SELECTOR,
        receiver,
        sourceDenominatedAmount: 10n ** 18n,
        localToken: V2_LANE.destToken,
        sourcePoolAddress: zeroPadValue(V2_LANE.srcPool, 32),
      }

      it('MINTER_ROLE revoked on the fork => classified as authority, checkExecute throws', async () => {
        assert.ok(fujiChain)
        const provider = fujiChain.provider as JsonRpcProvider
        // revoke the pool's MINTER_ROLE on the fork to reproduce a missing-role misconfiguration
        await provider.send('anvil_impersonateAccount', [V2_LANE.operator])
        await provider.send('anvil_setBalance', [V2_LANE.operator, '0x1000000000000000000'])
        const token = new Contract(
          V2_LANE.destToken,
          [
            'function revokeRole(bytes32 role, address account)',
            'function hasRole(bytes32, address) view returns (bool)',
          ],
          await provider.getSigner(V2_LANE.operator),
        )
        await (
          (await token.getFunction('revokeRole')(MINTER_ROLE, V2_LANE.destPool)) as {
            wait: () => Promise<unknown>
          }
        ).wait()
        assert.equal(await token.getFunction('hasRole')(MINTER_ROLE, V2_LANE.destPool), false)

        // the primitive throws the raw revert; the SDK's standard parse names it
        let revertData: string | undefined
        await assert.rejects(
          () =>
            simulateReleaseOrMint({
              provider: fujiChain!.provider,
              pool: V2_LANE.destPool,
              offRamp: V2_LANE.destOffRamp,
              input,
            }),
          (err) => {
            revertData = getErrorData(err)
            return true
          },
        )
        assert.ok(revertData, 'revert data extracted')
        assert.equal(parseWithFragment(revertData)?.[0].name, 'AccessControlUnauthorizedAccount')
        // a mint-authority failure needs a role grant, so it must NOT be flagged transient
        assert.equal(isTransientReleaseOrMintRevert(revertData), false)

        // and checkExecute BLOCKS the send with the generic revert error, carrying the raw revert
        await assert.rejects(
          () =>
            fujiChain!.checkExecute({
              offRamp: V2_LANE.destOffRamp,
              message: {
                sourceChainSelector: SEPOLIA_SELECTOR,
                receiver,
                tokenAmounts: [{ token: V2_LANE.destToken, amount: 10n ** 18n }],
              },
            }),
          (err: CCIPDestExecutionRevertError) => {
            assert.ok(err instanceof CCIPDestExecutionRevertError)
            assert.equal(
              parseWithFragment(String(err.context['revert']))?.[0].name,
              'AccessControlUnauthorizedAccount',
            )
            assert.equal(err.isTransient, false)
            return true
          },
        )
        // restore for any later test
        const signer = await provider.getSigner(V2_LANE.operator)
        const tokenAdmin = new Contract(
          V2_LANE.destToken,
          ['function grantRole(bytes32 role, address account)'],
          signer,
        )
        await (
          (await tokenAdmin.getFunction('grantRole')(MINTER_ROLE, V2_LANE.destPool)) as {
            wait: () => Promise<unknown>
          }
        ).wait()
        await provider.send('anvil_stopImpersonatingAccount', [V2_LANE.operator])
        // recovery: once the role is granted back, the same checkExecute passes again
        assert.equal(
          await fujiChain.checkExecute({
            offRamp: V2_LANE.destOffRamp,
            message: {
              sourceChainSelector: SEPOLIA_SELECTOR,
              receiver,
              tokenAmounts: [{ token: V2_LANE.destToken, amount: 10n ** 18n }],
            },
          }),
          true,
        )
      })

      it('LockRelease dest drained on the fork => typed transient block (heuristic deferred, sim decides)', async () => {
        // prod LnM lane: Sepolia dest pool is a LockReleaseTokenPoolAndProxy 1.5.0 holding its
        // liquidity on the previousPool. Drain the previousPool's token balance on the fork: the
        // releaseOrMint simulation (the oracle the balance heuristic defers to) must then revert,
        // blocking with a typed, transient error.
        assert.ok(sepoliaChain)
        const provider = sepoliaChain.provider as JsonRpcProvider
        const LNM = '0x466D489b6d36E7E3b824ef491C225F5830E81cC1'
        const REGISTRY = '0x95F29FEE11c5C55d26cCcf1DB6772DE953B37B82'
        const ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
        const { tokenPool } = await sepoliaChain.getRegistryTokenConfig(REGISTRY, LNM)
        assert.ok(tokenPool)
        const { previousPool } = await sepoliaChain.getTokenPoolConfig(tokenPool)
        assert.ok(previousPool, 'LnM AndProxy has a previousPool (holds the liquidity)')
        const offRamps = await sepoliaChain.getOffRampsForRouter(ROUTER, FUJI_SELECTOR)
        const offRamp = offRamps.at(-1)!
        const message = {
          sourceChainSelector: FUJI_SELECTOR,
          receiver: '0x1111111111111111111111111111111111111111',
          tokenAmounts: [{ token: LNM, amount: 10n ** 16n }] as const,
        }
        // sanity: with liquidity in place, the (drained-holder-aware) preflight passes
        assert.equal(await sepoliaChain.checkExecute({ offRamp, message }), true)
        // drain: zero the previousPool's token balance via storage override
        const slot = await findBalancesSlot(LNM, provider)
        await provider.send('anvil_setStorageAt', [
          LNM,
          solidityPackedKeccak256(['uint256', 'uint256'], [previousPool, slot]),
          toBeHex(0n, 32),
        ])
        await assert.rejects(
          () => sepoliaChain!.checkExecute({ offRamp, message }),
          (err: CCIPDestExecutionRevertError) => {
            assert.ok(err instanceof CCIPDestExecutionRevertError, String(err))
            // the raw revert is carried for the caller to parse (legacy pools revert with plain
            // ERC20 Error(string) reasons here, which read non-transient — same verdict class the
            // pre-existing CCIPInsufficientBalanceError heuristic produced)
            assert.ok(err.context['revert'], 'raw revert carried')
            return true
          },
        )
      })

      it('fee-charging source pool (fee config set on the fork) => post-fee destTokenAmount surfaced', async () => {
        assert.ok(sepoliaChain)
        const provider = sepoliaChain.provider as JsonRpcProvider
        const srcPool = new Contract(
          V2_LANE.srcPool,
          interfaces.TokenPool_v2_0,
          provider,
        ) as Contract & { owner(): Promise<string> }
        const owner = await srcPool.owner()
        await provider.send('anvil_impersonateAccount', [owner])
        await provider.send('anvil_setBalance', [owner, '0x1000000000000000000'])
        // configure a 1% finality transfer fee for the Fuji lane, like a fee-charging v2 pool
        const asOwner = srcPool.connect(await provider.getSigner(owner)) as Contract
        await (
          (await asOwner.getFunction('applyTokenTransferFeeConfigUpdates')(
            [
              {
                destChainSelector: FUJI_SELECTOR,
                tokenTransferFeeConfig: {
                  destGasOverhead: 90_000,
                  destBytesOverhead: 32,
                  finalityFeeUSDCents: 0,
                  fastFinalityFeeUSDCents: 0,
                  finalityTransferFeeBps: 100, // 1%
                  fastFinalityTransferFeeBps: 100,
                  isEnabled: true,
                },
              },
            ],
            [], // disableTokenTransferFeeConfigs
          )) as { wait: () => Promise<unknown> }
        ).wait()
        await provider.send('anvil_stopImpersonatingAccount', [owner])

        // the OnRamp writes lockOrBurn's post-fee destTokenAmount into the emitted message —
        // simulateLockOrBurn must surface exactly that
        const amount = 10n ** 18n
        const result = await sepoliaChain.simulateLockOrBurn({
          onRamp: V2_LANE.srcOnRamp,
          destChainSelector: FUJI_SELECTOR,
          token: V2_LANE.srcToken,
          amount,
          originalSender: V2_LANE.operator,
          receiver,
        })
        assert.equal(result.destTokenAmount, (amount * 9900n) / 10000n)
        assert.equal(result.sourcePoolAddress, V2_LANE.srcPool)
      })
    })
  },
)
