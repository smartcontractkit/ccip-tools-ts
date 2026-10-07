import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type ParamType, Interface, ZeroAddress, getAddress } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import { networkInfo } from '../../../networks.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../../errors.ts'
import ADVANCED_POOL_HOOKS_V2_0_0_ABI from '../artifacts/abi/V2_0_0/advanced-pool-hooks.ts'
import type { AdvancedPoolHooksTarget } from './contracts.ts'
import { ApplyCCVConfigUpdates } from './operations/apply-ccv-config-updates.ts'
import { GetAllAdvancedPoolHooksAuthorizedCallers } from './operations/get-all-advanced-pool-hooks-authorized-callers.ts'
import { GetAllCCVConfigs } from './operations/get-all-ccv-configs.ts'
import { GetCCVConfig } from './operations/get-ccv-config.ts'
import { GetPolicyEngine } from './operations/get-policy-engine.ts'
import { GetRequiredCCVs } from './operations/get-required-ccvs.ts'
import { GetThresholdAmount } from './operations/get-threshold-amount.ts'
import { SetPolicyEngine } from './operations/set-policy-engine.ts'
import { SetThresholdAmount } from './operations/set-threshold-amount.ts'
import { UpdateAdvancedPoolHooksAuthorizedCallers } from './operations/update-authorized-callers.ts'

const HOOKS = getAddress('0x' + '11'.repeat(20))
/** A contract that is not `AdvancedPoolHooks`. */
const NOT_HOOKS = getAddress('0x' + '22'.repeat(20))
const CALLER = getAddress('0x' + '33'.repeat(20))
const POOL = getAddress('0x' + 'f0'.repeat(20))
const IFACE = new Interface(ADVANCED_POOL_HOOKS_V2_0_0_ABI)
const POOL_IFACE = new Interface(['function getAdvancedPoolHooks() view returns (address)'])

/** The zero value of an ABI output, so every hooks getter answers without per-op stubbing. */
function zeroOf(param: ParamType): unknown {
  if (param.baseType === 'array') return []
  if (param.baseType === 'tuple') return param.components!.map(zeroOf)
  if (param.baseType === 'address') return ZeroAddress
  if (param.baseType === 'bool') return false
  return 0n
}

/**
 * {@link POOL} (a v2.0.0 pool) is bound to {@link HOOKS}, which answer every getter with zero
 * values; any other address reports a pool type. `calls` records every RPC as `kind:address`.
 */
function stubChain() {
  const calls: string[] = []
  const chain = {
    provider: {
      call: ({ to, data }: { to: string; data: string }) => {
        calls.push(`call:${getAddress(to)}`)
        if (getAddress(to) === POOL)
          return Promise.resolve(POOL_IFACE.encodeFunctionResult('getAdvancedPoolHooks', [HOOKS]))
        assert.equal(getAddress(to), HOOKS, 'hooks ops must read and write only the hooks')
        const fn = IFACE.getFunction(data.slice(0, 10))!
        return Promise.resolve(IFACE.encodeFunctionResult(fn, fn.outputs.map(zeroOf)))
      },
    },
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: (address: string) => {
      calls.push(`typeAndVersion:${getAddress(address)}`)
      return Promise.resolve(
        getAddress(address) === HOOKS
          ? ['AdvancedPoolHooks', '2.0.0']
          : ['BurnMintTokenPool', '2.0.0'],
      )
    },
    nextNonce: async () => 0,
    rollbackNonce: () => {},
  } as unknown as EVMChain
  return { chain, calls, poolCalls: () => calls.filter((c) => c.endsWith(POOL)) }
}

/** Every hooks op (deploy aside), run against a target with the minimal params it needs. */
const OPS: [string, (chain: EVMChain, target: AdvancedPoolHooksTarget) => Promise<unknown>][] = [
  [
    'applyCCVConfigUpdates',
    (chain, target) =>
      new ApplyCCVConfigUpdates().generate(chain, { ...target, ccvConfigArgs: [] }),
  ],
  ['getAllCCVConfigs', (chain, target) => new GetAllCCVConfigs().query(chain, target)],
  [
    'getCCVConfig',
    (chain, target) => new GetCCVConfig().query(chain, { ...target, remoteChainSelector: 1n }),
  ],
  [
    'getRequiredCCVs',
    (chain, target) =>
      new GetRequiredCCVs().query(chain, {
        ...target,
        remoteChainSelector: 1n,
        amount: 1n,
        direction: 'outbound',
      }),
  ],
  ['getPolicyEngine', (chain, target) => new GetPolicyEngine().query(chain, target)],
  [
    'setPolicyEngine',
    (chain, target) =>
      new SetPolicyEngine().generate(chain, { ...target, newPolicyEngine: ZeroAddress }),
  ],
  ['getThresholdAmount', (chain, target) => new GetThresholdAmount().query(chain, target)],
  [
    'setThresholdAmount',
    (chain, target) => new SetThresholdAmount().generate(chain, { ...target, thresholdAmount: 1n }),
  ],
  [
    'updateAdvancedPoolHooksAuthorizedCallers',
    (chain, target) =>
      new UpdateAdvancedPoolHooksAuthorizedCallers().generate(chain, {
        ...target,
        addedCallers: [CALLER],
      }),
  ],
  [
    'getAllAdvancedPoolHooksAuthorizedCallers',
    (chain, target) => new GetAllAdvancedPoolHooksAuthorizedCallers().query(chain, target),
  ],
]

/**
 * Every hooks op takes the hooks directly or a pool bound to them. The direct route must never
 * touch the pool, so hooks can be configured before binding or in a batch that re-points it.
 */
describe('AdvancedPoolHooks target: advancedPoolHooks or poolAddress', () => {
  for (const [name, run] of OPS) {
    describe(name, () => {
      it('addressing the hooks directly matches the pool route, without reading the pool', async () => {
        const direct = stubChain()
        const viaPool = stubChain()
        assert.deepEqual(
          await run(direct.chain, { advancedPoolHooks: HOOKS }),
          await run(viaPool.chain, { poolAddress: POOL }),
        )
        assert.deepEqual(direct.poolCalls(), [])
        assert.notDeepEqual(viaPool.poolCalls(), [])
      })

      it('rejects a direct target that is not AdvancedPoolHooks', async () => {
        await assert.rejects(
          () => run(stubChain().chain, { advancedPoolHooks: NOT_HOOKS }),
          CCTContractTypeInvalidError,
        )
      })

      const invalid: [string, string, unknown][] = [
        ['both targets', 'poolAddress', { poolAddress: POOL, advancedPoolHooks: HOOKS }],
        ['neither target', 'poolAddress', {}],
        ['a zero advancedPoolHooks', 'advancedPoolHooks', { advancedPoolHooks: ZeroAddress }],
        ['a malformed poolAddress', 'poolAddress', { poolAddress: 'nope' }],
      ]
      for (const [label, param, target] of invalid) {
        it(`rejects ${label} before any RPC`, async () => {
          const { chain, calls } = stubChain()
          await assert.rejects(
            () => run(chain, target as AdvancedPoolHooksTarget),
            (err: unknown) =>
              err instanceof CCTParamsInvalidError &&
              err.context.operation === name &&
              err.context.param === param,
          )
          assert.deepEqual(calls, [])
        })
      }
    })
  }
})
