import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, getAddress, makeError } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import { GetAdvancedPoolHooks } from './get-advanced-pool-hooks.ts'

const POOL = '0x' + '11'.repeat(20)
const HOOKS_LOWER = '0x' + '44'.repeat(20)

const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

/** Answers only `getAdvancedPoolHooks()`, pinning it as this query's sole contract read. */
function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V2_0_0,
  hooks = HOOKS_LOWER,
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  hooks?: string
  onCall?: (selector?: string) => void
} = {}): EVMChain {
  const v2 = TOKEN_POOL_INTERFACES[family][TokenPoolVersion.V2_0_0]
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        const selector = data.slice(0, 10)
        onCall?.(selector)
        if (selector === v2.getFunction('getAdvancedPoolHooks')!.selector)
          return v2.encodeFunctionResult('getAdvancedPoolHooks', [hooks])
        throw makeError('execution reverted', 'CALL_EXCEPTION', {
          action: 'call',
          data: '0x',
          reason: null,
          transaction: { to: null, data },
          invocation: null,
          revert: null,
        })
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      onCall?.()
      return Promise.resolve(parseTypeAndVersion(`${POOL_TYPE[family]} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new GetAdvancedPoolHooks()

describe('GetAdvancedPoolHooks (cct/evm)', () => {
  it('returns the bound hooks contract, checksummed', async () => {
    const hooks = await op.query(stubChain(), { poolAddress: POOL })
    assert.equal(hooks, getAddress(HOOKS_LOWER))
  })

  it('returns the zero address when no hooks are bound', async () => {
    const hooks = await op.query(stubChain({ hooks: ZeroAddress }), { poolAddress: POOL })
    assert.equal(hooks, ZeroAddress)
  })

  it('reads a LockRelease pool through the same v2.0.0 base selector', async () => {
    const hooks = await op.query(stubChain({ family: 'LockRelease' }), { poolAddress: POOL })
    assert.equal(hooks, getAddress(HOOKS_LOWER))
  })

  it('makes exactly one contract read beyond the type/version probe', async () => {
    const seen: (string | undefined)[] = []
    await op.query(stubChain({ onCall: (s) => seen.push(s) }), { poolAddress: POOL })
    const selector =
      TOKEN_POOL_INTERFACES.BurnMint[TokenPoolVersion.V2_0_0].getFunction(
        'getAdvancedPoolHooks',
      )!.selector
    assert.deepEqual(seen, [undefined, selector])
  })

  it('rejects an invalid poolAddress before any RPC', async () => {
    let called = false
    await assert.rejects(
      () => op.query(stubChain({ onCall: () => (called = true) }), { poolAddress: 'nope' }),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'getAdvancedPoolHooks' &&
        err.context.param === 'poolAddress',
    )
    assert.equal(called, false)
  })

  for (const version of [
    TokenPoolVersion.V1_5_0,
    TokenPoolVersion.V1_5_1,
    TokenPoolVersion.V1_6_1,
  ]) {
    it(`rejects a v${version} pool with CCTOperationUnsupportedError`, async () => {
      await assert.rejects(
        () => op.query(stubChain({ version }), { poolAddress: POOL }),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'getAdvancedPoolHooks',
      )
    })
  }
})
