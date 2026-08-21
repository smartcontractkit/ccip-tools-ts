import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { DeployLockbox } from './deploy-lockbox.ts'
import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import ERC20_LOCKBOX_V2_0_0_ABI from '../../artifacts/abi/V2_0_0/erc20-lockbox.ts'
import LOCKBOX_V2_0_0 from '../../artifacts/bytecode/V2_0_0/erc20-lockbox.ts'

const SENDER = '0x' + '11'.repeat(20)
const TOKEN = '0x' + '22'.repeat(20)
const DEPLOYED = '0x' + '77'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

// Golden vector: the ctor arg is a single 32-byte word holding the token address. Computed
// independently with a fresh ethers Interface so it guards the SDK's init-code against drift.
const W_TOKEN = '0000000000000000000000002222222222222222222222222222222222222222'
const CTOR_ARGS = new Interface(ERC20_LOCKBOX_V2_0_0_ABI).encodeDeploy([TOKEN])

/** Minimal EVMChain stub — deployLockbox's build path ignores it; execute uses only these. */
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

describe('DeployLockbox (cct/evm lockbox operation)', () => {
  describe('generate (golden vector)', () => {
    it('builds the lockbox as init-code with no `to`', async () => {
      const unsigned = await new DeployLockbox().generate(stubChain(), {
        token: TOKEN,
        sender: SENDER,
      })

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      const tx = unsigned.transactions[0]!
      assert.equal(tx.to, undefined, 'deployment tx has no `to`')
      assert.equal(tx.from, SENDER)
      assert.ok(tx.data!.startsWith(LOCKBOX_V2_0_0), 'data starts with creation bytecode')
      // Pinned bytes: the constructor arg is exactly the token address, left-padded to 32 bytes.
      assert.equal(CTOR_ARGS, '0x' + W_TOKEN)
      assert.equal(tx.data, LOCKBOX_V2_0_0 + W_TOKEN)
    })

    it('omits `from` when no sender is given', async () => {
      const unsigned = await new DeployLockbox().generate(stubChain(), { token: TOKEN })
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })
  })

  describe('validation', () => {
    it('rejects an invalid token address', async () => {
      await assert.rejects(
        () => new DeployLockbox().generate(stubChain(), { token: 'nope' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'deployLockbox' &&
          err.context.param === 'token',
      )
    })

    it('rejects the zero address for token', async () => {
      await assert.rejects(
        () => new DeployLockbox().generate(stubChain(), { token: ZeroAddress }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'token',
      )
    })

    it('rejects an invalid sender', async () => {
      await assert.rejects(
        () => new DeployLockbox().generate(stubChain(), { token: TOKEN, sender: 'nope' }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    it('deploys and returns the tx hash and deployed address', async () => {
      const result = await new DeployLockbox().execute(stubChain(), {
        token: TOKEN,
        wallet: fakeSigner({ contractAddress: DEPLOYED }),
      })
      assert.deepEqual(result, {
        hash: HASH,
        contractAddress: DEPLOYED,
        verification: { contract: 'ERC20LockBox', encodedConstructorArgs: '0x' + W_TOKEN },
      })
    })

    it('throws CCTTxFailedError when the receipt carries no contract address', async () => {
      await assert.rejects(
        () =>
          new DeployLockbox().execute(stubChain(), {
            token: TOKEN,
            wallet: fakeSigner({ contractAddress: null }),
          }),
        (err: unknown) =>
          err instanceof CCTTxFailedError &&
          err.context.operation === 'deployLockbox' &&
          !err.isTransient,
      )
    })

    it('throws CCIPExecTxRevertedError when the deployment reverts on-chain', async () => {
      await assert.rejects(
        () =>
          new DeployLockbox().execute(stubChain(), {
            token: TOKEN,
            wallet: fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError && err.context.operation === 'deployLockbox',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => new DeployLockbox().execute(stubChain(), { token: TOKEN, wallet: {} }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
