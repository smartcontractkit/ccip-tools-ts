import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, getCreateAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import CROSS_CHAIN_POOL_TOKEN_V2_0_0_BYTECODE from '../../artifacts/bytecode/V2_0_0/cross-chain-pool-token.ts'
import {
  type DeployCrossChainPoolTokenParams,
  DeployCrossChainPoolToken,
} from './deploy-cross-chain-pool-token.ts'

const SENDER = '0x' + '11'.repeat(20)
const OTHER = '0x' + '99'.repeat(20)
const PREMINT_RECIPIENT = '0x' + '22'.repeat(20)
const RMN_PROXY = '0x' + '33'.repeat(20)
const ROUTER = '0x' + '44'.repeat(20)
const HOOKS = '0x' + '55'.repeat(20)
const DEPLOYED = getCreateAddress({ from: SENDER, nonce: 0 })
const HASH = '0x' + 'ab'.repeat(32)

const INPUTS: DeployCrossChainPoolTokenParams = {
  name: 'Pool Token',
  symbol: 'PT',
  decimals: 18,
  maxSupply: 0n,
  rmnProxy: RMN_PROXY,
  router: ROUTER,
  advancedPoolHooks: HOOKS,
}

// Golden vector: a pinned constructor-arg encoding for INPUTS. Independent of the SDK encoder:
// it guards CrossChainPoolToken's init-code (bytecode + constructor) against drift.
// CrossChainPoolToken ctor: ((name, symbol, maxSupply, preMint, preMintRecipient, decimals,
// ccipAdmin), advancedPoolHooks, rmnProxy, router).
const W_HOOKS = '0000000000000000000000005555555555555555555555555555555555555555'
const CTOR_ARGS =
  '0000000000000000000000000000000000000000000000000000000000000080' +
  W_HOOKS +
  '0000000000000000000000003333333333333333333333333333333333333333' +
  '0000000000000000000000004444444444444444444444444444444444444444' +
  '00000000000000000000000000000000000000000000000000000000000000e0' +
  '0000000000000000000000000000000000000000000000000000000000000120' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000012' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '000000000000000000000000000000000000000000000000000000000000000a' +
  '506f6f6c20546f6b656e00000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000002' +
  '5054000000000000000000000000000000000000000000000000000000000000'
const DEPLOY_DATA = CROSS_CHAIN_POOL_TOKEN_V2_0_0_BYTECODE + CTOR_ARGS

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

describe('DeployCrossChainPoolToken (cct/evm token-pool operation)', () => {
  describe('generate (golden vector)', () => {
    it('builds a deployment as init-code with no `to`', async () => {
      const unsigned = await new DeployCrossChainPoolToken().generate(stubChain(), {
        ...INPUTS,
        sender: SENDER,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, undefined, 'deployment tx has no `to`')
      assert.equal(tx.from, SENDER)
      assert.equal(tx.chainId, CHAIN_ID, 'pinned to the manager chain')
      assert.ok(
        tx.data!.startsWith(CROSS_CHAIN_POOL_TOKEN_V2_0_0_BYTECODE),
        'data starts with creation bytecode',
      )
      assert.equal(tx.data, DEPLOY_DATA)
    })

    it('defaults advancedPoolHooks to the zero address when omitted', async () => {
      const { advancedPoolHooks: _hooks, ...withoutHooks } = INPUTS
      const unsigned = await new DeployCrossChainPoolToken().generate(stubChain(), withoutHooks)
      assert.equal(unsigned.transactions[0]!.data, DEPLOY_DATA.replace(W_HOOKS, '0'.repeat(64)))
    })

    it('encodes an omitted ccipAdmin as the zero address', async () => {
      const explicit = await new DeployCrossChainPoolToken().generate(stubChain(), {
        ...INPUTS,
        ccipAdmin: ZeroAddress,
      })
      assert.equal(explicit.transactions[0]!.data, DEPLOY_DATA)
    })

    it('omits `from` when no sender is given', async () => {
      const unsigned = await new DeployCrossChainPoolToken().generate(stubChain(), INPUTS)
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })
  })

  describe('validation', () => {
    it('rejects a missing preMintRecipient when preMint > 0', async () => {
      await assert.rejects(
        () => new DeployCrossChainPoolToken().generate(stubChain(), { ...INPUTS, preMint: 1n }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'preMintRecipient',
      )
    })

    it('rejects a preMintRecipient when preMint is 0', async () => {
      await assert.rejects(
        () =>
          new DeployCrossChainPoolToken().generate(stubChain(), {
            ...INPUTS,
            preMintRecipient: PREMINT_RECIPIENT,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'preMintRecipient',
      )
    })

    it('rejects preMint greater than a capped maxSupply', async () => {
      await assert.rejects(
        () =>
          new DeployCrossChainPoolToken().generate(stubChain(), {
            ...INPUTS,
            maxSupply: 10n,
            preMint: 11n,
            preMintRecipient: PREMINT_RECIPIENT,
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'preMint',
      )
    })

    it('rejects an empty name, tagged with the operation and param', async () => {
      await assert.rejects(
        () => new DeployCrossChainPoolToken().generate(stubChain(), { ...INPUTS, name: '' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deployCrossChainPoolToken' &&
          err.context.param === 'name',
      )
    })

    it('rejects decimals outside 0–255', async () => {
      await assert.rejects(
        () => new DeployCrossChainPoolToken().generate(stubChain(), { ...INPUTS, decimals: 256 }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'decimals',
      )
    })

    for (const param of ['rmnProxy', 'router'] as const) {
      it(`rejects the zero address for ${param}`, async () => {
        await assert.rejects(
          () =>
            new DeployCrossChainPoolToken().generate(stubChain(), {
              ...INPUTS,
              [param]: ZeroAddress,
            }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'deployCrossChainPoolToken' &&
            err.context.param === param,
        )
      })
    }

    it('rejects an invalid advancedPoolHooks address', async () => {
      await assert.rejects(
        () =>
          new DeployCrossChainPoolToken().generate(stubChain(), {
            ...INPUTS,
            advancedPoolHooks: 'nope',
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'advancedPoolHooks',
      )
    })

    it('rejects an invalid ccipAdmin', async () => {
      await assert.rejects(
        () =>
          new DeployCrossChainPoolToken().generate(stubChain(), { ...INPUTS, ccipAdmin: 'nope' }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'ccipAdmin',
      )
    })

    it('rejects an invalid sender', async () => {
      await assert.rejects(
        () => new DeployCrossChainPoolToken().generate(stubChain(), { ...INPUTS, sender: 'nope' }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    it('deploys and returns the tx hash, deployed address and verification handle', async () => {
      const result = await new DeployCrossChainPoolToken().execute(stubChain(), {
        ...INPUTS,
        wallet: fakeSigner({ contractAddress: DEPLOYED }),
      })
      assert.deepEqual(result, {
        hash: HASH,
        contractAddress: DEPLOYED,
        verification: {
          contract: 'CrossChainPoolToken',
          encodedConstructorArgs: '0x' + CTOR_ARGS,
        },
      })
    })

    it('rejects a sender that differs from the signing wallet', async () => {
      await assert.rejects(
        () =>
          new DeployCrossChainPoolToken().execute(stubChain(), {
            ...INPUTS,
            sender: OTHER,
            wallet: fakeSigner({ contractAddress: DEPLOYED }),
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deployCrossChainPoolToken' &&
          err.context.param === 'sender',
      )
    })

    it('throws CCTTxFailedError when the receipt carries no contract address', async () => {
      await assert.rejects(
        () =>
          new DeployCrossChainPoolToken().execute(stubChain(), {
            ...INPUTS,
            wallet: fakeSigner({ contractAddress: null }),
          }),
        (err: unknown) =>
          err instanceof CCTTxFailedError &&
          err.context.operation === 'deployCrossChainPoolToken' &&
          !err.isTransient,
      )
    })

    it('throws CCIPExecTxRevertedError when the deployment reverts on-chain', async () => {
      await assert.rejects(
        () =>
          new DeployCrossChainPoolToken().execute(stubChain(), {
            ...INPUTS,
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'deployCrossChainPoolToken',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => new DeployCrossChainPoolToken().execute(stubChain(), { ...INPUTS, wallet: {} }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
