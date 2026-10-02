import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import {
  type BeginDefaultAdminTransferParams,
  BeginDefaultAdminTransfer,
} from './begin-default-admin-transfer.ts'

const TOKEN = '0x' + '11'.repeat(20)
const ADMIN = '0x' + '22'.repeat(20)
const NEW_ADMIN = '0x' + '33'.repeat(20)
const OTHER = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const FRESH = new Interface([
  'function beginDefaultAdminTransfer(address newAdmin)',
  'function transferOwnership(address to)',
  'function defaultAdmin() view returns (address)',
  'function owner() view returns (address)',
])

/** `v1` stubs a FactoryBurnMintERC20 1.6.2, whose current admin is `owner()`. */
function stubChain({ admin = ADMIN, v1 = false } = {}): EVMChain {
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
        assert.equal(fn, v1 ? 'owner' : 'defaultAdmin')
        return Promise.resolve(FRESH.encodeFunctionResult(fn, [admin]))
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

const op = new BeginDefaultAdminTransfer()
function generate(chain: EVMChain, overrides: Partial<BeginDefaultAdminTransferParams> = {}) {
  return op.generate(chain, {
    tokenAddress: TOKEN,
    newAdmin: NEW_ADMIN,
    sender: ADMIN,
    ...overrides,
  })
}

describe('BeginDefaultAdminTransfer (cct/evm)', () => {
  describe('generate', () => {
    it('encodes beginDefaultAdminTransfer(address) to a CrossChainToken', async () => {
      const unsigned = await generate(stubChain())
      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions[0]!.to, TOKEN)
      assert.equal(unsigned.transactions[0]!.from, ADMIN)
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('beginDefaultAdminTransfer', [NEW_ADMIN]),
      )
    })

    it('allows zero newAdmin to schedule OpenZeppelin default-admin renunciation', async () => {
      const unsigned = await generate(stubChain(), { newAdmin: ZeroAddress })
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('beginDefaultAdminTransfer', [ZeroAddress]),
      )
    })

    it('encodes Ownable2Step transferOwnership(address) to a v1 token', async () => {
      const unsigned = await generate(stubChain({ v1: true }))
      assert.equal(unsigned.transactions[0]!.from, ADMIN)
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('transferOwnership', [NEW_ADMIN]),
      )
    })
  })

  describe('validation', () => {
    it('rejects invalid addresses before RPC', async () => {
      for (const [param, value] of [
        ['tokenAddress', ZeroAddress],
        ['newAdmin', 'not-an-address'],
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
    for (const [label, overrides, param, message] of [
      ['zero newAdmin, which would retract', { newAdmin: ZeroAddress }, 'newAdmin', /cancel/],
      ['newAdmin that already owns it', { newAdmin: ADMIN, sender: undefined }, 'newAdmin', /Self/],
      ['sender that is not its owner', { sender: OTHER }, 'sender', /current token owner/],
    ] as const) {
      it(`rejects, on a v1 token, a ${label}`, async () => {
        await assert.rejects(
          () => generate(stubChain({ v1: true }), overrides),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.param === param &&
            message.test(err.message),
        )
      })
    }

    it('rejects a token whose default admin was renounced', async () => {
      await assert.rejects(
        () => generate(stubChain({ admin: ZeroAddress }), { sender: undefined }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'tokenAddress',
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
        (
          await op.execute(stubChain(), {
            tokenAddress: TOKEN,
            newAdmin: NEW_ADMIN,
            wallet: fakeSigner(),
          })
        ).hash,
        HASH,
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { tokenAddress: TOKEN, newAdmin: NEW_ADMIN, wallet: {} }),
        (err: unknown) => err instanceof CCIPWalletInvalidError,
      )
    })
  })
})
