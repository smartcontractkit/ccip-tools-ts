import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, getCreateAddress } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import USDC_TOKEN_POOL_PROXY_V2_0_0 from '../../artifacts/bytecode/V2_0_0/usdc-token-pool-proxy.ts'
import {
  type DeployUSDCTokenPoolProxyParams,
  DeployUSDCTokenPoolProxy,
} from './deploy-usdc-token-pool-proxy.ts'

const SENDER = '0x' + '11'.repeat(20)
const OTHER = '0x' + '99'.repeat(20)
const DEPLOYED = getCreateAddress({ from: SENDER, nonce: 0 })
const HASH = '0x' + 'ab'.repeat(32)

// Distinct fixtures per slot: a swapped pool slot, or token/router/verifier, must fail byte parity.
const PARAMS: DeployUSDCTokenPoolProxyParams = {
  token: '0x' + '22'.repeat(20),
  pools: {
    cctpV1Pool: '0x' + '31'.repeat(20),
    cctpV2Pool: '0x' + '32'.repeat(20),
    cctpV2PoolWithCCV: '0x' + '33'.repeat(20),
    siloedLockReleasePool: '0x' + '34'.repeat(20),
  },
  router: '0x' + '44'.repeat(20),
  cctpVerifier: '0x' + '55'.repeat(20),
}

// Golden vector from an oracle built off the constructor signature in USDCTokenPoolProxy.sol,
// not the SDK's vendored ABI.
const ORACLE = new Interface([
  'constructor(address,(address,address,address,address),address,address)',
])
const CTOR_ARGS = ORACLE.encodeDeploy([
  PARAMS.token,
  [
    PARAMS.pools.cctpV1Pool,
    PARAMS.pools.cctpV2Pool,
    PARAMS.pools.cctpV2PoolWithCCV,
    PARAMS.pools.siloedLockReleasePool,
  ],
  PARAMS.router,
  PARAMS.cctpVerifier,
])

/** Base Sepolia; the chain the stub manager is on. Every built tx must be pinned to it. */
const CHAIN_ID = Number(networkInfo('ethereum-testnet-sepolia-base-1').chainId)

/** Minimal EVMChain stub: the build path ignores it; execute uses only these. */
function stubChain(): EVMChain {
  return {
    provider: {} as never,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: { chainId: CHAIN_ID },
    nextNonce: async () => 0,
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

/** Fake ethers Signer whose deployment receipt carries `contractAddress`. */
function fakeSigner(contractAddress: string | null = DEPLOYED) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(SENDER),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({
        hash: HASH,
        wait: () => Promise.resolve({ status: 1, contractAddress }),
      }),
  }
}

const op = new DeployUSDCTokenPoolProxy()

/** Asserts `generate` rejects before building, blaming `param`. */
async function rejectsParam(params: unknown, param: string) {
  await assert.rejects(
    () => op.generate(stubChain(), params as DeployUSDCTokenPoolProxyParams),
    (err: unknown) =>
      err instanceof CCTParamsInvalidError &&
      err.context.operation === 'deployUSDCTokenPoolProxy' &&
      err.context.param === param,
  )
}

describe('DeployUSDCTokenPoolProxy (cct/evm usdc-token-pool-proxy operation)', () => {
  describe('generate (golden vector)', () => {
    it('builds the proxy as init-code with no `to`, pinned to the chain', async () => {
      const unsigned = await op.generate(stubChain(), { ...PARAMS, sender: SENDER })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, undefined, 'deployment tx has no `to`')
      assert.equal(tx.from, SENDER)
      assert.equal(tx.chainId, CHAIN_ID, 'pinned to the manager chain')
      assert.equal(tx.data, USDC_TOKEN_POOL_PROXY_V2_0_0 + CTOR_ARGS.slice(2))
    })

    it('omits `from` when no sender is given', async () => {
      const unsigned = await op.generate(stubChain(), PARAMS)
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })

    it('accepts all four pool slots at zero, since the constructor only requires token, router and verifier', async () => {
      const pools = {
        cctpV1Pool: ZeroAddress,
        cctpV2Pool: ZeroAddress,
        cctpV2PoolWithCCV: ZeroAddress,
        siloedLockReleasePool: ZeroAddress,
      }
      const unsigned = await op.generate(stubChain(), { ...PARAMS, pools })
      assert.ok(unsigned.transactions[0]!.data!.startsWith(USDC_TOKEN_POOL_PROXY_V2_0_0))
    })
  })

  describe('validation', () => {
    // the constructor reverts AddressCannotBeZero on each of these
    for (const param of ['token', 'router', 'cctpVerifier'] as const) {
      it(`rejects a zero ${param}, which would revert AddressCannotBeZero`, async () => {
        await rejectsParam({ ...PARAMS, [param]: ZeroAddress }, param)
      })
    }

    it('rejects an invalid pool slot, blaming that slot', async () => {
      await rejectsParam(
        { ...PARAMS, pools: { ...PARAMS.pools, cctpV2PoolWithCCV: 'nope' } },
        'pools.cctpV2PoolWithCCV',
      )
    })

    it('rejects a missing pool slot rather than encoding undefined', async () => {
      const { siloedLockReleasePool: _, ...pools } = PARAMS.pools
      await rejectsParam({ ...PARAMS, pools }, 'pools.siloedLockReleasePool')
    })

    for (const [label, pools] of [
      ['missing', undefined],
      ['an array', [ZeroAddress, ZeroAddress, ZeroAddress, ZeroAddress]],
    ] as const) {
      it(`rejects pools given as ${label}`, async () => {
        await rejectsParam({ ...PARAMS, pools }, 'pools')
      })
    }

    it('rejects an invalid sender', async () => {
      await rejectsParam({ ...PARAMS, sender: 'nope' }, 'sender')
    })
  })

  describe('execute', () => {
    it('deploys and returns the tx hash, deployed address and verification input', async () => {
      const result = await op.execute(stubChain(), { ...PARAMS, wallet: fakeSigner() })
      assert.deepEqual(result, {
        hash: HASH,
        contractAddress: DEPLOYED,
        verification: { contract: 'USDCTokenPoolProxy', encodedConstructorArgs: CTOR_ARGS },
      })
    })

    it('rejects a sender that differs from the signing wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...PARAMS, sender: OTHER, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    for (const [label, contractAddress] of [
      ['no', null],
      ['an unexpected', OTHER],
    ] as const) {
      it(`throws CCTTxFailedError when the receipt carries ${label} contract address`, async () => {
        await assert.rejects(
          () => op.execute(stubChain(), { ...PARAMS, wallet: fakeSigner(contractAddress) }),
          (err: unknown) =>
            err instanceof CCTTxFailedError &&
            err.context.operation === 'deployUSDCTokenPoolProxy' &&
            !err.isTransient,
        )
      })
    }

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...PARAMS, wallet: {} }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
