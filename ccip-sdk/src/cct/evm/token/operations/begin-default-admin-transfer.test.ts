import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../../../errors.ts'
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
  'function defaultAdmin() view returns (address)',
])

function stubChain({ admin = ADMIN } = {}): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve(['CrossChainToken', '2.0.0', 'CrossChainToken 2.0.0']),
    provider: {
      call: ({ data }: { data: string }) => {
        assert.equal(FRESH.getFunction(data.slice(0, 10))!.name, 'defaultAdmin')
        return Promise.resolve(FRESH.encodeFunctionResult('defaultAdmin', [admin]))
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
    it('rejects a contract that is not a CrossChainToken', async () => {
      const chain = stubChain()
      chain.typeAndVersion = () => Promise.resolve(['FactoryBurnMintERC20', '1.6.2', ''])
      await assert.rejects(
        () => generate(chain),
        (err: unknown) => err instanceof CCTContractTypeInvalidError,
      )
    })

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
