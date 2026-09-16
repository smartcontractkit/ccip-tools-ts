import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TokenPoolVersion } from '../contracts.ts'
import { type AcceptPoolOwnershipParams, AcceptPoolOwnership } from './accept-pool-ownership.ts'

const POOL = '0x' + '11'.repeat(20)
const PROPOSED_OWNER = '0x' + '22'.repeat(20)
const SOMEONE_ELSE = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/**
 * Byte-parity oracle: a fresh Interface built from the signature literal, so the assertion is
 * independent of the SDK's cached, ABI-derived interfaces.
 */
const IFACE = new Interface(['function acceptOwnership()'])
const EXPECTED = IFACE.encodeFunctionData('acceptOwnership', [])

/** Pool type reported by `typeAndVersion` for each ABI family. */
const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

/**
 * EVMChain stub: `typeAndVersion` reports the requested family/version and every `provider.call`
 * reverts, which is what pins "this op reads nothing but typeAndVersion".
 */
function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V1_5_0,
  type,
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  /** Overrides the reported pool type, to exercise an address that is not a pool at all. */
  type?: string
  onCall?: (kind: 'call' | 'typeAndVersion') => void
} = {}): EVMChain {
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        onCall?.('call')
        throw makeError('execution reverted', 'CALL_EXCEPTION', {
          action: 'call',
          data: '0x',
          reason: null,
          transaction: { to: POOL, data },
          invocation: null,
          revert: null,
        })
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      onCall?.('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type ?? POOL_TYPE[family]} ${version}`))
    },
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(address = PROPOSED_OWNER, waitError?: Error) {
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

const op = new AcceptPoolOwnership()

function generate(chain: EVMChain, overrides: Partial<AcceptPoolOwnershipParams> = {}) {
  return op.generate(chain, { poolAddress: POOL, sender: PROPOSED_OWNER, ...overrides })
}

/** Every pool version: `acceptOwnership()` survived unchanged into 2.0.0. */
const VERSIONS = Object.values(TokenPoolVersion)

describe('AcceptPoolOwnership (cct/evm)', () => {
  describe('generate', () => {
    for (const version of VERSIONS) {
      for (const family of ['BurnMint', 'LockRelease'] as const) {
        it(`encodes acceptOwnership() for a ${family} ${version} pool`, async () => {
          const unsigned = await generate(stubChain({ family, version }))
          const tx = unsigned.transactions[0]!

          assert.equal(unsigned.family, ChainFamily.EVM)
          assert.equal(unsigned.transactions.length, 1)
          assert.equal(tx.to, POOL)
          assert.equal(tx.from, PROPOSED_OWNER)
          assert.equal(tx.data, EXPECTED)
        })
      }
    }

    it('reads only typeAndVersion — the pending owner has no getter to check against', async () => {
      const seen: string[] = []
      await generate(stubChain({ onCall: (kind) => seen.push(kind) }))
      assert.deepEqual(seen, ['typeAndVersion'])
    })

    it('omits from when sender is not supplied', async () => {
      const unsigned = await generate(stubChain(), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(unsigned.transactions[0]!.data, EXPECTED)
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['poolAddress', 'not-an-address'],
      ['poolAddress', ZeroAddress],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${value} before any RPC`, async () => {
        let called = false
        await assert.rejects(
          () => generate(stubChain({ onCall: () => (called = true) }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'acceptPoolOwnership' &&
            err.context.param === param,
        )
        assert.equal(called, false)
      })
    }
  })

  describe('type dispatch', () => {
    it('rejects an address whose typeAndVersion is not a supported pool', async () => {
      await assert.rejects(
        () => generate(stubChain({ type: 'NotATokenPool' })),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError && err.context.actual === 'NotATokenPool',
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL }

    it('signs and submits as the proposed owner, resolving to the tx hash', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps an on-chain revert — e.g. MustBeProposedOwner — to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(PROPOSED_OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'acceptPoolOwnership',
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
        () => op.execute(stubChain(), { ...params, sender: SOMEONE_ELSE, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('accepts any signer — the proposed owner cannot be verified before broadcast', async () => {
      assert.deepEqual(
        await op.execute(stubChain(), { ...params, wallet: fakeSigner(SOMEONE_ELSE) }),
        { hash: HASH },
      )
    })
  })
})
