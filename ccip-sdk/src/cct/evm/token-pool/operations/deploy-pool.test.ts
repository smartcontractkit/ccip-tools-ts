import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { makeError } from 'ethers'

import { type DeployPoolParams, DeployPool } from './deploy-pool.ts'
import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import BURN_MINT_V1_5_1 from '../../artifacts/bytecode/V1_5_1/burn-mint-token-pool.ts'
import LOCK_RELEASE_V1_5_1 from '../../artifacts/bytecode/V1_5_1/lock-release-token-pool.ts'
import BURN_MINT_V1_6_1 from '../../artifacts/bytecode/V1_6_1/burn-mint-token-pool.ts'
import LOCK_RELEASE_V1_6_1 from '../../artifacts/bytecode/V1_6_1/lock-release-token-pool.ts'
import BURN_MINT_V2_0_0 from '../../artifacts/bytecode/V2_0_0/burn-mint-token-pool.ts'
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
const W_ZERO = '0000000000000000000000000000000000000000000000000000000000000000'
const W_OFF_A0 = '00000000000000000000000000000000000000000000000000000000000000a0'
const W_OFF_C0 = '00000000000000000000000000000000000000000000000000000000000000c0'
const W_EMPTY_ARR = W_ZERO // allowlist length 0

// Golden vectors: pinned constructor-arg encodings for the fixed inputs above. Independent of
// the SDK encoder — they guard each (type, version) init-code against drift.
const BURN_MINT_ALLOWLIST_ARGS = W_TOKEN + W_DECIMALS + W_OFF_A0 + W_RMN + W_ROUTER + W_EMPTY_ARR // BurnMint 1.5.1 / 1.6.1: (token, decimals, allowlist, rmn, router)
const BURN_MINT_V2_ARGS = W_TOKEN + W_DECIMALS + W_HOOKS + W_RMN + W_ROUTER // BurnMint 2.0.0: (token, decimals, hooks, rmn, router)
const LOCK_RELEASE_V1_5_1_ARGS = // (token, decimals, allowlist, rmn, acceptLiquidity, router)
  W_TOKEN + W_DECIMALS + W_OFF_C0 + W_RMN + W_ZERO + W_ROUTER + W_EMPTY_ARR
const LOCK_RELEASE_V1_6_1_ARGS = W_TOKEN + W_DECIMALS + W_OFF_A0 + W_RMN + W_ROUTER + W_EMPTY_ARR // (token, decimals, allowlist, rmn, router)
const LOCK_RELEASE_V2_ARGS = W_TOKEN + W_DECIMALS + W_HOOKS + W_RMN + W_ROUTER + W_LOCKBOX // (token, decimals, hooks, rmn, router, lockBox)

const CASES: { label: string; params: DeployPoolParams; bytecode: string; ctorArgs: string }[] = [
  {
    label: 'BurnMintTokenPool 1.5.1',
    params: { ...COMMON, type: 'BurnMintTokenPool', version: '1.5.1' },
    bytecode: BURN_MINT_V1_5_1,
    ctorArgs: BURN_MINT_ALLOWLIST_ARGS,
  },
  {
    label: 'BurnMintTokenPool 1.6.1',
    params: { ...COMMON, type: 'BurnMintTokenPool', version: '1.6.1' },
    bytecode: BURN_MINT_V1_6_1,
    ctorArgs: BURN_MINT_ALLOWLIST_ARGS,
  },
  {
    label: 'BurnMintTokenPool 2.0.0',
    params: { ...COMMON, type: 'BurnMintTokenPool', version: '2.0.0', advancedPoolHooks: HOOKS },
    bytecode: BURN_MINT_V2_0_0,
    ctorArgs: BURN_MINT_V2_ARGS,
  },
  {
    label: 'LockReleaseTokenPool 1.5.1',
    params: { ...COMMON, type: 'LockReleaseTokenPool', version: '1.5.1' },
    bytecode: LOCK_RELEASE_V1_5_1,
    ctorArgs: LOCK_RELEASE_V1_5_1_ARGS,
  },
  {
    label: 'LockReleaseTokenPool 1.6.1',
    params: { ...COMMON, type: 'LockReleaseTokenPool', version: '1.6.1' },
    bytecode: LOCK_RELEASE_V1_6_1,
    ctorArgs: LOCK_RELEASE_V1_6_1_ARGS,
  },
  {
    label: 'LockReleaseTokenPool 2.0.0',
    params: {
      ...COMMON,
      type: 'LockReleaseTokenPool',
      version: '2.0.0',
      advancedPoolHooks: HOOKS,
      lockBox: LOCK_BOX,
    },
    bytecode: LOCK_RELEASE_V2_0_0,
    ctorArgs: LOCK_RELEASE_V2_ARGS,
  },
]

/** Minimal EVMChain stub — deployPool's build path ignores it; execute uses only these. */
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

describe('DeployPool (cct/evm token-pool operation)', () => {
  describe('generate (golden vectors per type × version)', () => {
    for (const { label, params, bytecode, ctorArgs } of CASES) {
      it(`builds ${label} as init-code with no \`to\``, async () => {
        const unsigned = await new DeployPool().generate(stubChain(), { ...params, sender: SENDER })

        assert.equal(unsigned.family, ChainFamily.EVM)
        assert.equal(unsigned.transactions.length, 1)
        const tx = unsigned.transactions[0]!
        assert.equal(tx.to, undefined, 'deployment tx has no `to`')
        assert.equal(tx.from, SENDER)
        assert.ok(tx.data!.startsWith(bytecode), 'data starts with creation bytecode')
        assert.equal(tx.data, bytecode + ctorArgs)
      })
    }

    it('defaults to version 2.0.0 when version is omitted', async () => {
      const omitted = await new DeployPool().generate(stubChain(), {
        ...COMMON,
        type: 'BurnMintTokenPool',
        advancedPoolHooks: HOOKS,
      })
      assert.equal(omitted.transactions[0]!.data, BURN_MINT_V2_0_0 + BURN_MINT_V2_ARGS)
    })

    it('omits `from` when no sender is given', async () => {
      const unsigned = await new DeployPool().generate(stubChain(), {
        ...COMMON,
        type: 'BurnMintTokenPool',
        version: '1.6.1',
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })
  })

  describe('validation', () => {
    const base: DeployPoolParams = { ...COMMON, type: 'BurnMintTokenPool', version: '2.0.0' }

    it('rejects an invalid token address', async () => {
      await assert.rejects(
        () => new DeployPool().generate(stubChain(), { ...base, token: 'nope' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deployPool' &&
          err.context.param === 'token',
      )
    })

    it('rejects an invalid router address', async () => {
      await assert.rejects(
        () => new DeployPool().generate(stubChain(), { ...base, router: 'nope' }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'router',
      )
    })

    it('rejects decimals outside 0–255', async () => {
      await assert.rejects(
        () => new DeployPool().generate(stubChain(), { ...base, localTokenDecimals: 256 }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'localTokenDecimals',
      )
    })

    it('rejects an invalid sender', async () => {
      await assert.rejects(
        () => new DeployPool().generate(stubChain(), { ...base, sender: 'nope' }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('rejects an unsupported (non-deployable) version', async () => {
      await assert.rejects(
        () =>
          new DeployPool().generate(stubChain(), {
            ...COMMON,
            type: 'BurnMintTokenPool',
            version: '1.5.0',
          } as unknown as DeployPoolParams),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'version',
      )
    })

    it('rejects allowlist at 2.0.0 (not a constructor arg)', async () => {
      await assert.rejects(
        () => new DeployPool().generate(stubChain(), { ...base, allowlist: [SENDER] }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'allowlist',
      )
    })

    it('rejects advancedPoolHooks below 2.0.0', async () => {
      await assert.rejects(
        () =>
          new DeployPool().generate(stubChain(), {
            ...COMMON,
            type: 'BurnMintTokenPool',
            version: '1.6.1',
            advancedPoolHooks: HOOKS,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'advancedPoolHooks',
      )
    })

    it('rejects lockBox for a non-LockRelease/2.0.0 pool', async () => {
      await assert.rejects(
        () => new DeployPool().generate(stubChain(), { ...base, lockBox: LOCK_BOX }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'lockBox',
      )
    })

    it('rejects acceptLiquidity outside LockRelease 1.5.1', async () => {
      await assert.rejects(
        () =>
          new DeployPool().generate(stubChain(), {
            ...COMMON,
            type: 'BurnMintTokenPool',
            version: '1.5.1',
            acceptLiquidity: true,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'acceptLiquidity',
      )
    })

    it('rejects an invalid allowlist entry, tagged with its index', async () => {
      await assert.rejects(
        () =>
          new DeployPool().generate(stubChain(), {
            ...COMMON,
            type: 'BurnMintTokenPool',
            version: '1.6.1',
            allowlist: [SENDER, 'nope'],
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'allowlist[1]',
      )
    })
  })

  describe('execute', () => {
    const params: DeployPoolParams = {
      ...COMMON,
      type: 'BurnMintTokenPool',
      version: '2.0.0',
      advancedPoolHooks: HOOKS,
    }

    it('deploys and returns the tx hash and deployed address', async () => {
      const result = await new DeployPool().execute(stubChain(), {
        ...params,
        wallet: fakeSigner({ contractAddress: DEPLOYED }),
      })
      assert.deepEqual(result, { hash: HASH, address: DEPLOYED })
    })

    it('throws CCTTxFailedError when the receipt carries no contract address', async () => {
      await assert.rejects(
        () =>
          new DeployPool().execute(stubChain(), {
            ...params,
            wallet: fakeSigner({ contractAddress: null }),
          }),
        (err: unknown) =>
          err instanceof CCTTxFailedError &&
          err.context.operation === 'deployPool' &&
          !err.isTransient,
      )
    })

    it('throws CCIPExecTxRevertedError when the deployment reverts on-chain', async () => {
      await assert.rejects(
        () =>
          new DeployPool().execute(stubChain(), {
            ...params,
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'deployPool',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => new DeployPool().execute(stubChain(), { ...params, wallet: {} }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
