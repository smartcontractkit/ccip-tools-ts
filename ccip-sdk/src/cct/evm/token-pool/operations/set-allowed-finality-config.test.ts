import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError, toBeHex } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import {
  type SetAllowedFinalityConfigParams,
  SetAllowedFinalityConfig,
} from './set-allowed-finality-config.ts'

const POOL = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const NOT_OWNER = '0x' + '33'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

const IFACE = new Interface(['function setAllowedFinalityConfig(bytes4 allowedFinality)'])
const dataFor = (allowedFinality: number) =>
  IFACE.encodeFunctionData('setAllowedFinalityConfig', [toBeHex(allowedFinality, 4)])

const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

/** Answers only `owner()`, pinning the owner preflight as this operation's sole contract read. */
function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V2_0_0,
  owner = OWNER,
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  owner?: string
  onCall?: (selector?: string) => void
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[family][version]
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        onCall?.(data.slice(0, 10))
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

const op = new SetAllowedFinalityConfig()
const generate = (chain: EVMChain, overrides: Record<string, unknown> = {}) =>
  op.generate(chain, {
    poolAddress: POOL,
    allowedFinality: { finalityDepth: 5, finalitySafe: true },
    sender: OWNER,
    ...overrides,
  } as SetAllowedFinalityConfigParams)

const UNSUPPORTED = [
  TokenPoolVersion.V1_5_0,
  TokenPoolVersion.V1_5_1,
  TokenPoolVersion.V1_6_1,
] as const

describe('SetAllowedFinalityConfig (cct/evm)', () => {
  describe('generate', () => {
    for (const family of ['BurnMint', 'LockRelease'] as const) {
      it(`encodes finality depth and FCR for a ${family} 2.0.0 pool`, async () => {
        const unsigned = await generate(stubChain({ family }))
        const tx = unsigned.transactions[0]!
        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(tx.to, POOL)
        assert.equal(tx.from, OWNER)
        assert.equal(tx.data, dataFor(0x00010005))
      })
    }

    it('encodes FTF-only and FCR-only configs', async () => {
      assert.equal(
        (await generate(stubChain(), { allowedFinality: { finalityDepth: 7 } })).transactions[0]!
          .data,
        dataFor(7),
      )
      assert.equal(
        (await generate(stubChain(), { allowedFinality: { finalityDepth: 0, finalitySafe: true } }))
          .transactions[0]!.data,
        dataFor(0x00010000),
      )
    })

    it('omits from and skips owner() when sender is not supplied', async () => {
      let calls = 0
      const unsigned = await generate(stubChain({ onCall: () => (calls += 1) }), {
        sender: undefined,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(calls, 1)
    })
  })

  describe('validation', () => {
    for (const [overrides, param] of [
      [{ poolAddress: ZeroAddress }, 'poolAddress'],
      [{ poolAddress: 'bad' }, 'poolAddress'],
      [{ allowedFinality: undefined }, 'allowedFinality'],
      [{ allowedFinality: { finalityDepth: -1 } }, 'allowedFinality.finalityDepth'],
      [{ allowedFinality: { finalityDepth: 65536 } }, 'allowedFinality.finalityDepth'],
      [{ allowedFinality: { finalityDepth: 1.5 } }, 'allowedFinality.finalityDepth'],
      [
        { allowedFinality: { finalityDepth: 1, finalitySafe: 'yes' } },
        'allowedFinality.finalitySafe',
      ],
      [{ sender: 'bad' }, 'sender'],
    ] as const) {
      it(`rejects ${param} before any RPC`, async () => {
        let called = false
        await assert.rejects(
          () => generate(stubChain({ onCall: () => (called = true) }), overrides),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'setAllowedFinalityConfig' &&
            err.context.param === param,
        )
        assert.equal(called, false)
      })
    }
  })

  describe('version and owner checks', () => {
    for (const version of UNSUPPORTED) {
      it(`rejects ${version}`, async () => {
        await assert.rejects(
          () => generate(stubChain({ version })),
          (err: unknown) =>
            err instanceof CCTOperationUnsupportedError && err.context.version === version,
        )
      })
    }

    it('rejects a sender that is not the owner', async () => {
      await assert.rejects(
        () => generate(stubChain({ owner: NOT_OWNER })),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, allowedFinality: { finalityDepth: 5 } }

    it('signs and submits as the owner', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps on-chain reverts', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        CCIPExecTxRevertedError,
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: {} }),
        CCIPWalletInvalidError,
      )
    })

    it('rejects a wallet that is not the owner', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(NOT_OWNER) }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })
  })
})
