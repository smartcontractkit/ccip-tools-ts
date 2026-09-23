import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import {
  type UpdateAdvancedPoolHooksParams,
  UpdateAdvancedPoolHooks,
} from './update-advanced-pool-hooks.ts'

const POOL = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const NOT_OWNER = '0x' + '33'.repeat(20)
const HOOKS = '0x' + '44'.repeat(20)
const OLD_HOOKS = '0x' + '55'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/** Independent oracle, built from the signature alone rather than the vendored pool ABI. */
const IFACE = new Interface(['function updateAdvancedPoolHooks(address newHook)'])
const dataFor = (hooks: string) => IFACE.encodeFunctionData('updateAdvancedPoolHooks', [hooks])

const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

/**
 * Answers `getAdvancedPoolHooks()` and `owner()` only, so any other read this operation might
 * make would surface as a CALL_EXCEPTION rather than pass silently.
 */
function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V2_0_0,
  owner = OWNER,
  currentHooks = OLD_HOOKS,
  hooksTypeAndVersion = 'AdvancedPoolHooks 2.0.0',
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  owner?: string
  currentHooks?: string
  /** `typeAndVersion` reported by the bind target; `null` makes the probe call fail (an EOA). */
  hooksTypeAndVersion?: string | null
  onCall?: (selector?: string) => void
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[family][version]
  const v2 = TOKEN_POOL_INTERFACES[family][TokenPoolVersion.V2_0_0]
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        const selector = data.slice(0, 10)
        onCall?.(selector)
        if (selector === v2.getFunction('getAdvancedPoolHooks')!.selector)
          return v2.encodeFunctionResult('getAdvancedPoolHooks', [currentHooks])
        if (selector === iface.getFunction('owner')!.selector)
          return iface.encodeFunctionResult('owner', [owner])
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
    typeAndVersion: (address: string) => {
      onCall?.()
      if (getAddress(address) !== getAddress(POOL)) {
        // The bind-target probe. A non-CCIP address has no typeAndVersion() to decode.
        if (hooksTypeAndVersion === null)
          return Promise.reject(makeError('could not decode result data', 'BAD_DATA'))
        return Promise.resolve(parseTypeAndVersion(hooksTypeAndVersion))
      }
      return Promise.resolve(parseTypeAndVersion(`${POOL_TYPE[family]} ${version}`))
    },
    nextNonce: async () => 0,
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(address = OWNER, waitError?: Error) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(address),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({
        hash: HASH,
        wait: () => (waitError ? Promise.reject(waitError) : Promise.resolve({ status: 1 })),
      }),
  }
}

const op = new UpdateAdvancedPoolHooks()
const generate = (chain: EVMChain, overrides: Record<string, unknown> = {}) =>
  op.generate(chain, {
    poolAddress: POOL,
    advancedPoolHooks: HOOKS,
    sender: OWNER,
    ...overrides,
  } as UpdateAdvancedPoolHooksParams)

describe('UpdateAdvancedPoolHooks (cct/evm)', () => {
  describe('generate (golden vector)', () => {
    it('encodes updateAdvancedPoolHooks against the pool', async () => {
      const unsigned = await generate(stubChain())

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, POOL)
      assert.equal(tx.from, OWNER)
      assert.equal(tx.data, dataFor(HOOKS))
    })

    it('encodes a detach (zero address), which leaves the pool enforcing nothing', async () => {
      const unsigned = await generate(stubChain(), { advancedPoolHooks: ZeroAddress })
      assert.equal(unsigned.transactions[0]!.data, dataFor(ZeroAddress))
    })

    it('works the same on a LockRelease pool — the selector is on the v2.0.0 base', async () => {
      const unsigned = await generate(stubChain({ family: 'LockRelease' }))
      assert.equal(unsigned.transactions[0]!.data, dataFor(HOOKS))
    })

    it('omits `from` when no sender is given, and then skips the owner read', async () => {
      const seen: (string | undefined)[] = []
      const unsigned = await op.generate(stubChain({ onCall: (s) => seen.push(s) }), {
        poolAddress: POOL,
        advancedPoolHooks: HOOKS,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      const ifaceV2 = TOKEN_POOL_INTERFACES.BurnMint[TokenPoolVersion.V2_0_0]
      assert.ok(!seen.includes(ifaceV2.getFunction('owner')!.selector), 'no owner read')
    })
  })

  describe('validation', () => {
    it('rejects an invalid poolAddress before any RPC', async () => {
      let called = false
      await assert.rejects(
        () => generate(stubChain({ onCall: () => (called = true) }), { poolAddress: 'nope' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'updateAdvancedPoolHooks' &&
          err.context.param === 'poolAddress',
      )
      assert.equal(called, false)
    })

    it('rejects the zero address for poolAddress — it is the tx destination', async () => {
      await assert.rejects(
        () => generate(stubChain(), { poolAddress: ZeroAddress }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'poolAddress',
      )
    })

    it('rejects an invalid advancedPoolHooks', async () => {
      await assert.rejects(
        () => generate(stubChain(), { advancedPoolHooks: 'nope' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'advancedPoolHooks',
      )
    })

    it('rejects an invalid sender', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: 'nope' }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })
  })

  describe('no-op re-point', () => {
    it('rejects re-pointing a pool at the hooks it is already bound to', async () => {
      await assert.rejects(
        () => generate(stubChain({ currentHooks: HOOKS })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'updateAdvancedPoolHooks' &&
          err.context.param === 'advancedPoolHooks' &&
          (err.context.reason as string).includes(getAddress(HOOKS)),
      )
    })

    it('compares checksummed, so a lower-case input is still caught', async () => {
      await assert.rejects(
        () =>
          generate(stubChain({ currentHooks: HOOKS }), { advancedPoolHooks: HOOKS.toLowerCase() }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'advancedPoolHooks',
      )
    })

    it('rejects detaching an already-unbound pool, without calling zero "bound"', async () => {
      await assert.rejects(
        () =>
          generate(stubChain({ currentHooks: ZeroAddress }), { advancedPoolHooks: ZeroAddress }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'advancedPoolHooks' &&
          (err.context.reason as string).startsWith('no hooks are bound'),
      )
    })

    it('allows binding hooks to a pool that currently has none', async () => {
      const unsigned = await generate(stubChain({ currentHooks: ZeroAddress }))
      assert.equal(unsigned.transactions[0]!.data, dataFor(HOOKS))
    })
  })

  describe('bind-target probe', () => {
    it('rejects an EOA / undeployed address, which would brick every transfer', async () => {
      await assert.rejects(
        () => generate(stubChain({ hooksTypeAndVersion: null })),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError &&
          err.context.address === HOOKS &&
          err.context.expected === 'AdvancedPoolHooks',
      )
    })

    it('rejects a contract that is not an AdvancedPoolHooks', async () => {
      await assert.rejects(
        () => generate(stubChain({ hooksTypeAndVersion: 'BurnMintTokenPool 2.0.0' })),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError && err.context.actual === 'BurnMintTokenPool',
      )
    })

    it('rejects the AdvancedPoolHooksExtractor, a neighbouring contract', async () => {
      await assert.rejects(
        () => generate(stubChain({ hooksTypeAndVersion: 'AdvancedPoolHooksExtractor 2.0.0' })),
        (err: unknown) => err instanceof CCTContractTypeInvalidError,
      )
    })

    it('accepts a newer hooks version — the type is pinned, the version is not', async () => {
      const unsigned = await generate(stubChain({ hooksTypeAndVersion: 'AdvancedPoolHooks 2.1.0' }))
      assert.equal(unsigned.transactions[0]!.data, dataFor(HOOKS))
    })

    it('skips the probe for a detach — the zero address is not a bind target', async () => {
      const unsigned = await generate(
        stubChain({ currentHooks: OLD_HOOKS, hooksTypeAndVersion: null }),
        { advancedPoolHooks: ZeroAddress },
      )
      assert.equal(unsigned.transactions[0]!.data, dataFor(ZeroAddress))
    })
  })

  describe('version dispatch', () => {
    for (const version of [
      TokenPoolVersion.V1_5_0,
      TokenPoolVersion.V1_5_1,
      TokenPoolVersion.V1_6_1,
    ]) {
      it(`rejects a v${version} pool with CCTOperationUnsupportedError`, async () => {
        await assert.rejects(
          () => generate(stubChain({ version })),
          (err: unknown) =>
            err instanceof CCTOperationUnsupportedError &&
            err.context.operation === 'updateAdvancedPoolHooks',
        )
      })
    }

    it('reports the unsupported version before spending a read on the binding or the owner', async () => {
      const seen: (string | undefined)[] = []
      await assert.rejects(
        () =>
          generate(stubChain({ version: TokenPoolVersion.V1_5_1, onCall: (s) => seen.push(s) })),
        CCTOperationUnsupportedError,
      )
      assert.deepEqual(seen, [undefined], 'only the typeAndVersion probe ran')
    })
  })

  describe('owner preflight', () => {
    it('rejects a sender that is not the pool owner', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: NOT_OWNER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'updateAdvancedPoolHooks' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    it('signs and submits as the pool owner', async () => {
      const result = await op.execute(stubChain(), {
        poolAddress: POOL,
        advancedPoolHooks: HOOKS,
        wallet: fakeSigner(),
      })
      assert.deepEqual(result, { hash: HASH })
    })

    it('rejects a sender that is not the signing wallet, naming the offline escape hatch', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            poolAddress: POOL,
            advancedPoolHooks: HOOKS,
            sender: NOT_OWNER,
            wallet: fakeSigner(OWNER),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          (err.context.reason as string).includes('generateUnsignedUpdateAdvancedPoolHooks'),
      )
    })

    it('surfaces an on-chain revert as CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            poolAddress: POOL,
            advancedPoolHooks: HOOKS,
            wallet: fakeSigner(OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'updateAdvancedPoolHooks',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            poolAddress: POOL,
            advancedPoolHooks: HOOKS,
            wallet: {},
          }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
