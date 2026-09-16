import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTOperationUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'
import { type WithdrawFeeTokensParams, WithdrawFeeTokens } from './withdraw-fee-tokens.ts'

const POOL = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const FEE_ADMIN = '0x' + '33'.repeat(20)
const RECIPIENT = '0x' + '44'.repeat(20)
const FEE_TOKENS = ['0x' + '55'.repeat(20), '0x' + '66'.repeat(20)]
const HASH = '0x' + 'ab'.repeat(32)

const REFERENCE = new Interface([
  'function withdrawFeeTokens(address[] feeTokens, address recipient)',
])
const DATA = REFERENCE.encodeFunctionData('withdrawFeeTokens', [FEE_TOKENS, RECIPIENT])
const POOL_TYPE: Record<TokenPoolFamily, string> = {
  BurnMint: 'BurnMintTokenPool',
  LockRelease: 'LockReleaseTokenPool',
}

function stubChain({
  family = 'BurnMint',
  version = TokenPoolVersion.V2_0_0,
  owner = OWNER,
  feeAdmin = FEE_ADMIN,
  onCall,
}: {
  family?: TokenPoolFamily
  version?: TokenPoolVersion
  owner?: string
  feeAdmin?: string
  onCall?: () => void
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[family][version]
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        onCall?.()
        const selector = data.slice(0, 10)
        if (selector === iface.getFunction('owner')?.selector)
          return iface.encodeFunctionResult('owner', [owner])
        if (selector === iface.getFunction('getDynamicConfig')?.selector)
          return iface.encodeFunctionResult('getDynamicConfig', [POOL, ZeroAddress, feeAdmin])
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

const op = new WithdrawFeeTokens()
const generate = (chain: EVMChain, overrides: Record<string, unknown> = {}) =>
  op.generate(chain, {
    poolAddress: POOL,
    feeTokens: FEE_TOKENS,
    recipient: RECIPIENT,
    sender: OWNER,
    ...overrides,
  } as WithdrawFeeTokensParams)

const UNSUPPORTED = [
  TokenPoolVersion.V1_5_0,
  TokenPoolVersion.V1_5_1,
  TokenPoolVersion.V1_6_1,
] as const

describe('WithdrawFeeTokens (cct/evm)', () => {
  describe('generate', () => {
    for (const family of ['BurnMint', 'LockRelease'] as const) {
      it(`encodes a ${family} 2.0.0 pool withdrawal`, async () => {
        const unsigned = await generate(stubChain({ family }))
        const tx = unsigned.transactions[0]!
        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(tx.to, POOL)
        assert.equal(tx.from, OWNER)
        assert.equal(tx.data, DATA)
      })
    }

    it('allows the delegated fee admin', async () => {
      assert.equal((await generate(stubChain(), { sender: FEE_ADMIN })).transactions[0]!.data, DATA)
    })

    it('omits from and skips role reads without sender', async () => {
      let calls = 0
      const unsigned = await generate(stubChain({ onCall: () => calls++ }), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(calls, 1)
    })
  })

  describe('validation', () => {
    for (const [overrides, param] of [
      [{ poolAddress: ZeroAddress }, 'poolAddress'],
      [{ feeTokens: [] }, 'feeTokens'],
      [{ feeTokens: [ZeroAddress] }, 'feeTokens[0]'],
      [{ recipient: ZeroAddress }, 'recipient'],
      [{ sender: 'bad' }, 'sender'],
    ] as const) {
      it(`rejects ${param} before any RPC`, async () => {
        let calls = 0
        await assert.rejects(
          () => generate(stubChain({ onCall: () => calls++ }), overrides),
          (error: unknown) =>
            error instanceof CCTParamsInvalidError && error.context.param === param,
        )
        assert.equal(calls, 0)
      })
    }
  })

  describe('version and role checks', () => {
    for (const version of UNSUPPORTED) {
      it(`rejects ${version}`, async () => {
        await assert.rejects(
          () => generate(stubChain({ version })),
          (error: unknown) =>
            error instanceof CCTOperationUnsupportedError && error.context.version === version,
        )
      })
    }

    it('rejects a sender that is neither owner nor fee admin', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: '0x' + '77'.repeat(20) }),
        (error: unknown) =>
          error instanceof CCTParamsInvalidError && error.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    const params = { poolAddress: POOL, feeTokens: FEE_TOKENS, recipient: RECIPIENT }

    it('signs and submits as the fee admin', async () => {
      assert.deepEqual(
        await op.execute(stubChain(), { ...params, wallet: fakeSigner(FEE_ADMIN) }),
        {
          hash: HASH,
        },
      )
    })

    it('maps on-chain reverts', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(OWNER, makeError('reverted', 'CALL_EXCEPTION')),
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
  })
})
