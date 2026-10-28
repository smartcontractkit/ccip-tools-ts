import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTPreconditionError } from '../../../errors.ts'
import {
  type CancelDefaultAdminTransferParams,
  CancelDefaultAdminTransfer,
} from './cancel-default-admin-transfer.ts'

const TOKEN = '0x' + '11'.repeat(20)
const ADMIN = '0x' + '22'.repeat(20)
const OTHER = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const FRESH = new Interface([
  'function cancelDefaultAdminTransfer()',
  'function transferOwnership(address to)',
  'function defaultAdmin() view returns (address)',
  'function owner() view returns (address)',
  'function pendingDefaultAdmin() view returns (address newAdmin, uint48 schedule)',
])

/** `v1` stubs a FactoryBurnMintERC20 1.6.2, whose current admin is `owner()`. */
function stubChain({ schedule = 1n, admin = ADMIN, v1 = false } = {}): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    typeAndVersion: () =>
      Promise.resolve(
        v1
          ? ['FactoryBurnMintERC20', '1.6.2', 'FactoryBurnMintERC20 1.6.2']
          : ['CrossChainToken', '2.0.0', 'CrossChainToken 2.0.0'],
      ),
    provider: {
      call: ({ data }: { data: string }) => {
        const fn = FRESH.getFunction(data.slice(0, 10))!.name
        if (v1) assert.equal(fn, 'owner')
        if (fn === 'defaultAdmin' || fn === 'owner')
          return Promise.resolve(FRESH.encodeFunctionResult(fn, [admin]))
        return Promise.resolve(FRESH.encodeFunctionResult(fn, [OTHER, schedule]))
      },
    },
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(address = ADMIN) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(address),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({ hash: HASH, wait: () => Promise.resolve({ status: 1 }) }),
  }
}

const op = new CancelDefaultAdminTransfer()
function generate(chain: EVMChain, overrides: Partial<CancelDefaultAdminTransferParams> = {}) {
  return op.generate(chain, { tokenAddress: TOKEN, sender: ADMIN, ...overrides })
}

describe('CancelDefaultAdminTransfer (cct/evm)', () => {
  describe('generate', () => {
    it('encodes cancelDefaultAdminTransfer() to a CrossChainToken', async () => {
      const unsigned = await generate(stubChain())
      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions[0]!.to, TOKEN)
      assert.equal(unsigned.transactions[0]!.from, ADMIN)
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('cancelDefaultAdminTransfer'),
      )
    })

    it('encodes Ownable2Step transferOwnership(0x0) to a v1 token', async () => {
      const unsigned = await generate(stubChain({ v1: true }))
      assert.equal(unsigned.transactions[0]!.from, ADMIN)
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('transferOwnership', [ZeroAddress]),
      )
    })
  })

  describe('validation', () => {
    it('rejects invalid addresses before RPC', async () => {
      for (const [param, value] of [
        ['tokenAddress', ZeroAddress],
        ['sender', 'not-an-address'],
      ] as const) {
        await assert.rejects(
          () => generate(stubChain(), { [param]: value }),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
      }
    })
  })

  describe('version and default-admin checks', () => {
    it('rejects a sender that is not the owner of a v1 token', async () => {
      await assert.rejects(
        () => generate(stubChain({ v1: true }), { sender: OTHER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          /current token owner/.test(err.message),
      )
    })

    it('rejects a cancel when no transfer is pending', async () => {
      await assert.rejects(
        () => generate(stubChain({ schedule: 0n })),
        (err: unknown) => err instanceof CCTParamsInvalidError && /no pending/.test(err.message),
      )
    })

    it('rejects a token whose default admin was renounced', async () => {
      await assert.rejects(
        () => generate(stubChain({ admin: ZeroAddress })),
        (err: unknown) =>
          // Thrown, not reported: no earlier plan step can restore a renounced admin.
          err instanceof CCTParamsInvalidError &&
          !(err instanceof CCTPreconditionError) &&
          err.context.param === 'tokenAddress',
      )
    })

    it('rejects a sender that is not the current default admin', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: OTHER }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    it('submits as the current default admin', async () => {
      assert.equal(
        (await op.execute(stubChain(), { tokenAddress: TOKEN, wallet: fakeSigner() })).hash,
        HASH,
      )
    })

    it('submits transferOwnership(0x0) to a v1 token as its owner', async () => {
      assert.equal(
        (await op.execute(stubChain({ v1: true }), { tokenAddress: TOKEN, wallet: fakeSigner() }))
          .hash,
        HASH,
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { tokenAddress: TOKEN, wallet: {} }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
