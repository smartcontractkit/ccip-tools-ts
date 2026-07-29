import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, makeError } from 'ethers'

import { type DeployTokenPoolParams, DeployTokenPool } from './deploy-token-pool.ts'
import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import BURN_FROM_MINT_V2_0_0 from '../../artifacts/bytecode/V2_0_0/burn-from-mint-token-pool.ts'
import BURN_MINT_V2_0_0 from '../../artifacts/bytecode/V2_0_0/burn-mint-token-pool.ts'
import BURN_WITH_FROM_MINT_V2_0_0 from '../../artifacts/bytecode/V2_0_0/burn-with-from-mint-token-pool.ts'
import LOCK_RELEASE_V2_0_0 from '../../artifacts/bytecode/V2_0_0/lock-release-token-pool.ts'

const SENDER = '0x' + '11'.repeat(20)
const TOKEN = '0x' + '22'.repeat(20)
const RMN_PROXY = '0x' + '33'.repeat(20)
const ROUTER = '0x' + '44'.repeat(20)
const HOOKS = '0x' + '55'.repeat(20)
const LOCK_BOX = '0x' + '66'.repeat(20)
const DEPLOYED = '0x' + '77'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

const COMMON = { token: TOKEN, localTokenDecimals: 18, rmnProxy: RMN_PROXY, router: ROUTER }

// Word encodings (32-byte, hex) reused across the golden vectors below.
const W_TOKEN = '0000000000000000000000002222222222222222222222222222222222222222'
const W_DECIMALS = '0000000000000000000000000000000000000000000000000000000000000012'
const W_RMN = '0000000000000000000000003333333333333333333333333333333333333333'
const W_ROUTER = '0000000000000000000000004444444444444444444444444444444444444444'
const W_HOOKS = '0000000000000000000000005555555555555555555555555555555555555555'
const W_LOCKBOX = '0000000000000000000000006666666666666666666666666666666666666666'

// Golden vectors: pinned 2.0.0 constructor-arg encodings for the fixed inputs above. Independent
// of the SDK encoder — they guard each pool's init-code against drift. The burn-* variants share
// the `BurnMint` constructor (token, decimals, advancedPoolHooks, rmnProxy, router); LockRelease
// adds `lockBox`.
const BURN_MINT_ARGS = W_TOKEN + W_DECIMALS + W_HOOKS + W_RMN + W_ROUTER
const LOCK_RELEASE_ARGS = W_TOKEN + W_DECIMALS + W_HOOKS + W_RMN + W_ROUTER + W_LOCKBOX

const CASES: {
  label: string
  params: DeployTokenPoolParams
  bytecode: string
  ctorArgs: string
}[] = [
  {
    label: 'BurnMintTokenPool',
    params: { ...COMMON, type: 'BurnMintTokenPool', advancedPoolHooks: HOOKS },
    bytecode: BURN_MINT_V2_0_0,
    ctorArgs: BURN_MINT_ARGS,
  },
  {
    label: 'BurnFromMintTokenPool',
    params: { ...COMMON, type: 'BurnFromMintTokenPool', advancedPoolHooks: HOOKS },
    bytecode: BURN_FROM_MINT_V2_0_0,
    ctorArgs: BURN_MINT_ARGS,
  },
  {
    label: 'BurnWithFromMintTokenPool',
    params: { ...COMMON, type: 'BurnWithFromMintTokenPool', advancedPoolHooks: HOOKS },
    bytecode: BURN_WITH_FROM_MINT_V2_0_0,
    ctorArgs: BURN_MINT_ARGS,
  },
  {
    label: 'LockReleaseTokenPool',
    params: {
      ...COMMON,
      type: 'LockReleaseTokenPool',
      advancedPoolHooks: HOOKS,
      lockBox: LOCK_BOX,
    },
    bytecode: LOCK_RELEASE_V2_0_0,
    ctorArgs: LOCK_RELEASE_ARGS,
  },
]

/** Minimal EVMChain stub — deployTokenPool's build path ignores it; execute uses only these. */
function stubChain(): EVMChain {
  return {
    provider: {} as never,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    nextNonce: async () => 0,
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

/** Fake ethers Signer whose deployment receipt carries `contractAddress`. */
function fakeSigner(opts: { contractAddress?: string | null; waitError?: Error }) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(SENDER),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({
        hash: HASH,
        wait: () =>
          opts.waitError
            ? Promise.reject(opts.waitError)
            : Promise.resolve({
                status: 1,
                contractAddress:
                  opts.contractAddress === undefined ? DEPLOYED : opts.contractAddress,
              }),
      }),
  }
}

describe('DeployTokenPool (cct/evm token-pool operation)', () => {
  describe('generate (golden vectors per deployable type)', () => {
    for (const { label, params, bytecode, ctorArgs } of CASES) {
      it(`builds ${label} as init-code with no \`to\``, async () => {
        const unsigned = await new DeployTokenPool().generate(stubChain(), {
          ...params,
          sender: SENDER,
        })

        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(unsigned.transactions.length, 1)
        const tx = unsigned.transactions[0]!
        assert.equal(tx.to, undefined, 'deployment tx has no `to`')
        assert.equal(tx.from, SENDER)
        assert.ok(tx.data!.startsWith(bytecode), 'data starts with creation bytecode')
        assert.equal(tx.data, bytecode + ctorArgs)
      })
    }

    it('defaults advancedPoolHooks to the zero address when omitted', async () => {
      const unsigned = await new DeployTokenPool().generate(stubChain(), {
        ...COMMON,
        type: 'BurnMintTokenPool',
      })
      const zeroHooks = W_TOKEN + W_DECIMALS + '0'.repeat(64) + W_RMN + W_ROUTER
      assert.equal(unsigned.transactions[0]!.data, BURN_MINT_V2_0_0 + zeroHooks)
    })

    it('omits `from` when no sender is given', async () => {
      const unsigned = await new DeployTokenPool().generate(stubChain(), {
        ...COMMON,
        type: 'BurnMintTokenPool',
        advancedPoolHooks: HOOKS,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })
  })

  describe('validation', () => {
    const base: DeployTokenPoolParams = {
      ...COMMON,
      type: 'BurnMintTokenPool',
      advancedPoolHooks: HOOKS,
    }

    it('rejects an invalid token address', async () => {
      await assert.rejects(
        () => new DeployTokenPool().generate(stubChain(), { ...base, token: 'nope' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deployTokenPool' &&
          err.context.param === 'token',
      )
    })

    it('rejects an invalid router address', async () => {
      await assert.rejects(
        () => new DeployTokenPool().generate(stubChain(), { ...base, router: 'nope' }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'router',
      )
    })

    it('rejects decimals outside 0–255', async () => {
      await assert.rejects(
        () => new DeployTokenPool().generate(stubChain(), { ...base, localTokenDecimals: 256 }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'localTokenDecimals',
      )
    })

    it('rejects an invalid advancedPoolHooks address', async () => {
      await assert.rejects(
        () => new DeployTokenPool().generate(stubChain(), { ...base, advancedPoolHooks: 'nope' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'advancedPoolHooks',
      )
    })

    it('rejects an invalid sender', async () => {
      await assert.rejects(
        () => new DeployTokenPool().generate(stubChain(), { ...base, sender: 'nope' }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects a non-deployable pool type', async () => {
      await assert.rejects(
        () =>
          new DeployTokenPool().generate(stubChain(), {
            ...COMMON,
            type: 'BurnToAddressTokenPool',
          } as unknown as DeployTokenPoolParams),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'type',
      )
    })

    it('rejects the zero address for a LockRelease lockBox', async () => {
      await assert.rejects(
        () =>
          new DeployTokenPool().generate(stubChain(), {
            ...COMMON,
            type: 'LockReleaseTokenPool',
            advancedPoolHooks: HOOKS,
            lockBox: ZeroAddress,
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'lockBox',
      )
    })

    it('rejects an invalid lockBox address', async () => {
      await assert.rejects(
        () =>
          new DeployTokenPool().generate(stubChain(), {
            ...COMMON,
            type: 'LockReleaseTokenPool',
            advancedPoolHooks: HOOKS,
            lockBox: 'nope',
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'lockBox',
      )
    })
    // `lockBox` on a burn pool is a compile-time error (the DeployTokenPoolParams union), so
    // there's no runtime case to test.
  })

  describe('execute', () => {
    const params: DeployTokenPoolParams = {
      ...COMMON,
      type: 'BurnMintTokenPool',
      advancedPoolHooks: HOOKS,
    }

    it('deploys and returns the tx hash and deployed address', async () => {
      const result = await new DeployTokenPool().execute(stubChain(), {
        ...params,
        wallet: fakeSigner({ contractAddress: DEPLOYED }),
      })
      assert.deepEqual(result, { hash: HASH, contractAddress: DEPLOYED })
    })

    it('throws CCTTxFailedError when the receipt carries no contract address', async () => {
      await assert.rejects(
        () =>
          new DeployTokenPool().execute(stubChain(), {
            ...params,
            wallet: fakeSigner({ contractAddress: null }),
          }),
        (err: unknown) =>
          err instanceof CCTTxFailedError &&
          err.context.operation === 'deployTokenPool' &&
          !err.isTransient,
      )
    })

    it('throws CCIPExecTxRevertedError when the deployment reverts on-chain', async () => {
      await assert.rejects(
        () =>
          new DeployTokenPool().execute(stubChain(), {
            ...params,
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'deployTokenPool',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => new DeployTokenPool().execute(stubChain(), { ...params, wallet: {} }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
