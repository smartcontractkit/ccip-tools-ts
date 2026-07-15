import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { makeError } from 'ethers'

import { DeployToken } from './deploy-token.ts'
import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import { BURN_MINT_ERC677_BYTECODE } from '../bytecode.ts'

const SENDER = '0x' + '11'.repeat(20)
const DEPLOYED = '0x' + '77'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

// Golden vector: pinned constructor-arg encoding for the fixed inputs below. Independent of
// the SDK encoder — guards the init-code (bytecode + BurnMintERC677 constructor) against drift.
const INPUTS = { name: 'CCIP Test Token', symbol: 'CCIPT', decimals: 18, maxSupply: 0n }
const EXPECTED_CTOR_ARGS =
  '0000000000000000000000000000000000000000000000000000000000000080' +
  '00000000000000000000000000000000000000000000000000000000000000c0' +
  '0000000000000000000000000000000000000000000000000000000000000012' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '000000000000000000000000000000000000000000000000000000000000000f' +
  '43434950205465737420546f6b656e0000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000005' +
  '4343495054000000000000000000000000000000000000000000000000000000'
const EXPECTED_DEPLOY_DATA = BURN_MINT_ERC677_BYTECODE + EXPECTED_CTOR_ARGS

/** Minimal EVMChain stub — deployToken's build path ignores it; execute uses only these. */
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

describe('DeployToken (cct/evm token operation)', () => {
  describe('generate', () => {
    it('builds a deployment as init-code with no `to` (golden vector)', async () => {
      const unsigned = await new DeployToken().generate(stubChain(), { ...INPUTS, sender: SENDER })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)

      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, undefined, 'deployment tx has no `to`')
      assert.equal(tx.from, SENDER)
      assert.ok(
        tx.data!.startsWith(BURN_MINT_ERC677_BYTECODE),
        'data starts with creation bytecode',
      )
      assert.equal(tx.data, EXPECTED_DEPLOY_DATA)
    })

    it('omits `from` when no sender is given', async () => {
      const unsigned = await new DeployToken().generate(stubChain(), INPUTS)
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })

    it('rejects an empty name, tagged with the operation and param', async () => {
      await assert.rejects(
        () => new DeployToken().generate(stubChain(), { ...INPUTS, name: '' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deployToken' &&
          err.context.param === 'name',
      )
    })

    it('rejects an empty symbol', async () => {
      await assert.rejects(
        () => new DeployToken().generate(stubChain(), { ...INPUTS, symbol: '' }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'symbol',
      )
    })

    it('rejects decimals outside 0–255', async () => {
      await assert.rejects(
        () => new DeployToken().generate(stubChain(), { ...INPUTS, decimals: 256 }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'decimals',
      )
    })

    it('rejects a non-integer decimals', async () => {
      await assert.rejects(
        () => new DeployToken().generate(stubChain(), { ...INPUTS, decimals: 1.5 }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'decimals',
      )
    })

    it('rejects a negative maxSupply', async () => {
      await assert.rejects(
        () => new DeployToken().generate(stubChain(), { ...INPUTS, maxSupply: -1n }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'maxSupply',
      )
    })

    it('rejects a maxSupply above uint256 max', async () => {
      await assert.rejects(
        () => new DeployToken().generate(stubChain(), { ...INPUTS, maxSupply: 2n ** 256n }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'maxSupply',
      )
    })
  })

  describe('execute', () => {
    it('deploys and returns the tx hash and deployed address', async () => {
      const result = await new DeployToken().execute(stubChain(), {
        ...INPUTS,
        wallet: fakeSigner({ contractAddress: DEPLOYED }),
      })
      assert.deepEqual(result, { hash: HASH, contractAddress: DEPLOYED })
    })

    it('throws CCTTxFailedError when the receipt carries no contract address', async () => {
      await assert.rejects(
        () =>
          new DeployToken().execute(stubChain(), {
            ...INPUTS,
            wallet: fakeSigner({ contractAddress: null }),
          }),
        (err: unknown) =>
          err instanceof CCTTxFailedError &&
          err.context.operation === 'deployToken' &&
          !err.isTransient,
      )
    })

    it('throws CCIPExecTxRevertedError when the deployment reverts on-chain', async () => {
      await assert.rejects(
        () =>
          new DeployToken().execute(stubChain(), {
            ...INPUTS,
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'deployToken' &&
          err.context.txHash === HASH,
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => new DeployToken().execute(stubChain(), { ...INPUTS, wallet: {} }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
