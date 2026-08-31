import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { type SetRateLimitAdminParams, SetRateLimitAdmin } from './set-rate-limit-admin.ts'
import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'

const POOL = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const NEW_ADMIN = '0x' + '44'.repeat(20)
const NOT_THE_OWNER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived interfaces.
 */
const IFACE = new Interface(['function setRateLimitAdmin(address rateLimitAdmin)'])
const dataFor = (admin: string) => IFACE.encodeFunctionData('setRateLimitAdmin', [admin])

/** Pool type reported by `typeAndVersion` for each ABI family. */
const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

/**
 * EVMChain stub: `typeAndVersion` reports the requested family/version, and `provider.call`
 * answers `owner()` (the only read this op makes) off the pool's own Interface. Every other
 * selector reverts, which is what pins "no other RPC".
 */
function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V1_5_0,
  owner = OWNER,
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  owner?: string
  onCall?: () => void
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[family][version]
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        onCall?.()
        if (data.slice(0, 10) !== iface.getFunction('owner')!.selector)
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: null, data },
            invocation: null,
            revert: null,
          })
        return iface.encodeFunctionResult('owner', [owner])
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      onCall?.()
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

const op = new SetRateLimitAdmin()

function generate(chain: EVMChain, overrides: Partial<SetRateLimitAdminParams> = {}) {
  return op.generate(chain, {
    poolAddress: POOL,
    newRateLimitAdmin: NEW_ADMIN,
    sender: OWNER,
    ...overrides,
  })
}

/** Versions that still declare `setRateLimitAdmin`; 2.0.0 removed it. */
const SUPPORTED = [
  TokenPoolVersion.V1_5_0,
  TokenPoolVersion.V1_5_1,
  TokenPoolVersion.V1_6_1,
] as const

describe('SetRateLimitAdmin (cct/evm)', () => {
  describe('generate', () => {
    for (const version of SUPPORTED) {
      for (const family of ['BurnMint', 'LockRelease'] as const) {
        it(`encodes setRateLimitAdmin(admin) for a ${family} ${version} pool`, async () => {
          const unsigned = await generate(stubChain({ family, version }))
          const tx = unsigned.transactions[0]!

          assert.equal(unsigned.family, ChainFamily.EVM)
          assert.equal(unsigned.transactions.length, 1)
          assert.equal(tx.to, POOL)
          assert.equal(tx.from, OWNER)
          assert.equal(tx.data, dataFor(NEW_ADMIN))
        })
      }

      it(`emits identical calldata for both ABI families at ${version}`, async () => {
        const [burnMint, lockRelease] = await Promise.all([
          generate(stubChain({ family: 'BurnMint', version })),
          generate(stubChain({ family: 'LockRelease', version })),
        ])
        assert.equal(burnMint.transactions[0]!.data, lockRelease.transactions[0]!.data)
      })
    }

    it('allows the zero address to clear the rate-limit admin role', async () => {
      const unsigned = await generate(stubChain(), { newRateLimitAdmin: ZeroAddress })
      assert.equal(unsigned.transactions[0]!.data, dataFor(ZeroAddress))
    })

    it('omits from — and skips the owner read — when sender is not supplied', async () => {
      let calls = 0
      const unsigned = await generate(stubChain({ onCall: () => (calls += 1) }), {
        sender: undefined,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      // typeAndVersion only; no owner() round trip
      assert.equal(calls, 1)
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['poolAddress', 'not-an-address'],
      ['poolAddress', ZeroAddress],
      ['newRateLimitAdmin', 'not-an-address'],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${value} before any RPC`, async () => {
        let called = false
        await assert.rejects(
          () => generate(stubChain({ onCall: () => (called = true) }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'setRateLimitAdmin' &&
            err.context.param === param,
        )
        assert.equal(called, false)
      })
    }
  })

  describe('version dispatch', () => {
    for (const version of SUPPORTED) {
      it(`supports ${version}`, async () => {
        const unsigned = await generate(stubChain({ version }))
        assert.equal(unsigned.transactions[0]!.data, dataFor(NEW_ADMIN))
      })
    }

    it('rejects a 2.0.0 pool — the selector was removed, use setDynamicConfig', async () => {
      await assert.rejects(
        () => generate(stubChain({ version: TokenPoolVersion.V2_0_0 })),
        (err: unknown) =>
          err instanceof CCTOperationUnsupportedError &&
          err.context.operation === 'setRateLimitAdmin' &&
          err.context.version === TokenPoolVersion.V2_0_0,
      )
    })

    it('reports 2.0.0 unsupported for the LockRelease family too', async () => {
      await assert.rejects(
        () => generate(stubChain({ family: 'LockRelease', version: TokenPoolVersion.V2_0_0 })),
        CCTOperationUnsupportedError,
      )
    })
  })

  describe('pre-transaction validation', () => {
    it('rejects a sender that is not the pool owner', async () => {
      await assert.rejects(
        () => generate(stubChain({ owner: NOT_THE_OWNER })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setRateLimitAdmin' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, newRateLimitAdmin: NEW_ADMIN }

    it('signs and submits as the owner, resolving to the tx hash', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps an on-chain revert to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'setRateLimitAdmin',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: {} }),
        CCIPWalletInvalidError,
      )
    })

    it('rejects a sender that is not the executing wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, sender: NEW_ADMIN, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a wallet that is not the pool owner', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(NEW_ADMIN) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'setRateLimitAdmin' &&
          err.context.param === 'sender' &&
          // names the owner it read, so the caller can see which address it needed
          err.message.includes(OWNER),
      )
    })
  })
})
