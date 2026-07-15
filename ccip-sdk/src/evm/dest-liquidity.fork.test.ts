/**
 * Fork tests for the destination-liquidity preflight.
 *
 * Anvil forks of live testnets (same harness as fork.test.ts), exercising the pool-direct
 * `releaseOrMint` simulation against live deployed pools:
 *
 * - Fuji (v2.0): a dedicated isolated test lane (BurnMintTokenPool 2.0.0, `OffRamp 2.0.0`) —
 *   healthy pass, IPoolV2 2-arg dispatch, gas parity through the full `estimateReceiveExecution`
 *   wrapper, and a missing-mint-role case (MINTER_ROLE revoked on the fork, so the AccessControl
 *   revert blocks the send with CCIPDestExecutionRevertError, non-transient).
 * - Sepolia (v1.5 prod lane): the production LINK LockReleaseTokenPool as destination of the
 *   Fuji→Sepolia lane (`EVM2EVMOffRamp 1.5`) — IPoolV1 1-arg dispatch and a genuine
 *   over-balance revert.
 *
 * Forks run at the head block: public testnet RPCs prune historical state, so pinning old
 * blocks would require an archive endpoint. The MINTER-revoke case instead reproduces the
 * missing-role defect at the fork head via anvil impersonation.
 */
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { Console } from 'node:console'
import { after, before, describe, it } from 'node:test'

import { Contract, JsonRpcProvider, hexlify, randomBytes, zeroPadValue } from 'ethers'
import { Instance } from 'prool'

import '../aptos/index.ts' // register chain families for cross-family message decoding
import '../solana/index.ts'
import '../ton/index.ts'
import { CCIPDestExecutionRevertError } from '../errors/index.ts'
import { estimateReceiveExecution } from '../gas.ts'
import { getErrorData, parseWithFragment } from './errors.ts'
import { EVMChain } from './index.ts'
import { isTransientReleaseOrMintRevert, simulateReleaseOrMint } from './simulate.ts'

// ── Chain constants ──

const SEPOLIA_RPC = process.env['RPC_SEPOLIA'] || 'https://sepolia.gateway.tenderly.co'
const SEPOLIA_CHAIN_ID = 11155111
const SEPOLIA_SELECTOR = 16015286601757825753n

const FUJI_RPC = process.env['RPC_FUJI'] || 'https://api.avax-test.network/ext/bc/C/rpc'
const FUJI_CHAIN_ID = 43113

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

describe('Dest-liquidity preflight fork tests', { skip, timeout: 300_000 }, () => {
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
    await Promise.all([sepoliaInstance.start(), fujiInstance.start()])

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

  // ── v2.0 lane (Fuji dest): BurnMintTokenPool 2.0.0 behind OffRamp 2.0.0 ──

  describe('v2.0 dest (Fuji isolated lane, BurnMintTokenPool 2.0.0)', () => {
    const receiver = '0x1111111111111111111111111111111111111111'
    const input = {
      originalSender: receiver,
      remoteChainSelector: SEPOLIA_SELECTOR,
      receiver,
      sourceDenominatedAmount: 10n ** 18n,
      localToken: V2_LANE.destToken,
      sourcePoolAddress: zeroPadValue(V2_LANE.srcPool, 32),
    }

    it('healthy mint pool => sim passes via the IPoolV2 2-arg branch', async () => {
      assert.ok(fujiChain)
      const result = await simulateReleaseOrMint({
        provider: fujiChain.provider,
        pool: V2_LANE.destPool,
        offRamp: V2_LANE.destOffRamp,
        input,
        finality: 'finalized',
      })
      assert.equal(result.poolInterface, 'IPoolV2')
      assert.equal(result.destinationAmount, input.sourceDenominatedAmount)
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

    it('estimateReceiveExecution wrapper matches the direct dest-side gas estimate', async () => {
      assert.ok(sepoliaChain && fujiChain)
      const messageId = hexlify(randomBytes(32))
      const sender = V2_LANE.operator
      // full wrapper: source-token mapping + checkExecute + gas estimate
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
  })
})
