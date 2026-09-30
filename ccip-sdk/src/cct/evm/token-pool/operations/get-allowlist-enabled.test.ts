import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Interface, ZeroAddress, getAddress, makeError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { ADVANCED_POOL_HOOKS_INTERFACE } from '../../advanced-pool-hooks/contracts.ts'
import { TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import { GetAllowlistEnabled } from './get-allowlist-enabled.ts'

const POOL = '0x' + '11'.repeat(20)
const HOOKS = '0x' + '44'.repeat(20)
const ENTRY = getAddress('0x' + 'a1'.repeat(20))

/**
 * A `BurnMintTokenPool <version>` at {@link POOL}. The allowlist getters answer only on the
 * holder (the pool before v2.0.0, `hooks` from v2.0.0, where the pool answers
 * `getAdvancedPoolHooks()`), so a read aimed at the wrong contract reverts. `onCall` counts RPCs.
 */
function stubChain({
  version = TokenPoolVersion.V2_0_0,
  hooks = HOOKS,
  enabled = true,
  entries = [ENTRY.toLowerCase()],
  onCall,
}: {
  version?: TokenPoolVersion
  hooks?: string
  enabled?: boolean
  entries?: string[]
  onCall?: () => void
} = {}): EVMChain {
  const pool = TOKEN_POOL_INTERFACES.BurnMint[version]
  const v2 = version === TokenPoolVersion.V2_0_0
  const [holder, iface] = v2 ? [hooks, ADVANCED_POOL_HOOKS_INTERFACE] : [POOL, pool]
  const results: [string, Interface, string, unknown][] = [
    ...(v2
      ? [[POOL, pool, 'getAdvancedPoolHooks', hooks] as [string, Interface, string, unknown]]
      : []),
    [holder, iface, 'getAllowListEnabled', enabled],
    [holder, iface, 'getAllowList', entries],
  ]
  return {
    provider: {
      call: async ({ to, data }: { to: string; data: string }) => {
        onCall?.()
        for (const [address, contract, fn, result] of results)
          if (
            getAddress(to) === getAddress(address) &&
            data.startsWith(contract.getFunction(fn)!.selector)
          )
            return contract.encodeFunctionResult(fn, [result])
        throw makeError('execution reverted', 'CALL_EXCEPTION')
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      onCall?.()
      return Promise.resolve(parseTypeAndVersion(`BurnMintTokenPool ${version}`))
    },
  } as unknown as EVMChain
}

const LEGACY_VERSIONS = [
  TokenPoolVersion.V1_5_0,
  TokenPoolVersion.V1_5_1,
  TokenPoolVersion.V1_6_1,
] as const

const op = new GetAllowlistEnabled()

describe('GetAllowlistEnabled (cct/evm)', () => {
  for (const version of [...LEGACY_VERSIONS, TokenPoolVersion.V2_0_0]) {
    for (const enabled of [true, false]) {
      it(`reads ${enabled} from the holder of a ${version} pool`, async () => {
        assert.equal(
          await op.query(stubChain({ version, enabled }), { poolAddress: POOL }),
          enabled,
        )
      })
    }
  }

  it('reads false for a 2.0.0 pool with no hooks bound, with no getter call', async () => {
    let calls = 0
    const chain = stubChain({ hooks: ZeroAddress, onCall: () => calls++ })
    assert.equal(await op.query(chain, { poolAddress: POOL }), false)
    assert.equal(calls, 2) // typeAndVersion + getAdvancedPoolHooks
  })

  it('rejects an invalid poolAddress before any RPC', async () => {
    let calls = 0
    await assert.rejects(
      () => op.query(stubChain({ onCall: () => calls++ }), { poolAddress: 'nope' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'getAllowlistEnabled' &&
        err.context.param === 'poolAddress',
    )
    assert.equal(calls, 0)
  })
})
