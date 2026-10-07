import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import {
  type AcceptDefaultAdminTransferParams,
  AcceptDefaultAdminTransfer,
} from './accept-default-admin-transfer.ts'

const TOKEN = '0x' + '11'.repeat(20)
const NEW_ADMIN = '0x' + '33'.repeat(20)
const OTHER = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
const FRESH = new Interface([
  'function acceptDefaultAdminTransfer()',
  'function acceptOwnership()',
  'function pendingDefaultAdmin() view returns (address newAdmin, uint48 schedule)',
])

/** `v1` stubs a FactoryBurnMintERC20 1.6.2, whose pending owner has no getter to read. */
function stubChain({
  pendingAdmin = NEW_ADMIN,
  schedule = 1n,
  v1 = false,
}: { pendingAdmin?: string; schedule?: bigint; v1?: boolean } = {}): EVMChain {
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
        assert.ok(!v1, 'a v1 acceptance reads nothing')
        assert.equal(FRESH.getFunction(data.slice(0, 10))!.name, 'pendingDefaultAdmin')
        return Promise.resolve(
          FRESH.encodeFunctionResult('pendingDefaultAdmin', [pendingAdmin, schedule]),
        )
      },
    },
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(address = NEW_ADMIN) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(address),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({ hash: HASH, wait: () => Promise.resolve({ status: 1 }) }),
  }
}

const op = new AcceptDefaultAdminTransfer()
function generate(chain: EVMChain, overrides: Partial<AcceptDefaultAdminTransferParams> = {}) {
  return op.generate(chain, { tokenAddress: TOKEN, sender: NEW_ADMIN, ...overrides })
}

describe('AcceptDefaultAdminTransfer (cct/evm)', () => {
  describe('generate', () => {
    it('encodes acceptDefaultAdminTransfer() to a CrossChainToken', async () => {
      const unsigned = await generate(stubChain())
      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions[0]!.to, TOKEN)
      assert.equal(unsigned.transactions[0]!.from, NEW_ADMIN)
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('acceptDefaultAdminTransfer'),
      )
    })

    it('encodes Ownable2Step acceptOwnership() to a v1 token, leaving sender unchecked', async () => {
      const unsigned = await generate(stubChain({ v1: true }), { sender: OTHER })
      assert.equal(unsigned.transactions[0]!.from, OTHER)
      assert.equal(unsigned.transactions[0]!.data, FRESH.encodeFunctionData('acceptOwnership'))
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

  describe('version and pending-transfer checks', () => {
    it('rejects when no transfer is pending', async () => {
      await assert.rejects(
        () => generate(stubChain({ schedule: 0n })),
        (err: unknown) => err instanceof CCTParamsInvalidError && /no pending/.test(err.message),
      )
    })

    it('rejects a sender that is not the pending default admin', async () => {
      await assert.rejects(
        () => generate(stubChain(), { sender: OTHER }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
      )
    })

    it('gives renounceRole guidance for a pending zero admin even when sender is set', async () => {
      await assert.rejects(
        () => generate(stubChain({ pendingAdmin: ZeroAddress })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'tokenAddress' &&
          /renunciation/.test(err.message),
      )
    })
  })

  describe('execute', () => {
    it('submits as the pending default admin', async () => {
      assert.equal(
        (await op.execute(stubChain(), { tokenAddress: TOKEN, wallet: fakeSigner() })).hash,
        HASH,
      )
    })

    it('submits acceptOwnership() to a v1 token as the wallet', async () => {
      const wallet = fakeSigner(OTHER)
      assert.equal(
        (await op.execute(stubChain({ v1: true }), { tokenAddress: TOKEN, wallet })).hash,
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
