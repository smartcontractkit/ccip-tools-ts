import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTContractVersionUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import {
  type CancelDefaultAdminTransferParams,
  CancelDefaultAdminTransfer,
} from './cancel-default-admin-transfer.ts'

const TOKEN = '0x' + '11'.repeat(20)
const ADMIN = '0x' + '22'.repeat(20)
const OTHER = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
/** Byte-parity oracle, independent of the SDK's cached, ABI-derived interfaces. */
const FRESH = new Interface([
  'function cancelDefaultAdminTransfer()',
  'function transferOwnership(address to)',
  'function defaultAdmin() view returns (address)',
  'function owner() view returns (address)',
  'function pendingDefaultAdmin() view returns (address newAdmin, uint48 schedule)',
])

const V2 = 'CrossChainToken 2.0.0'
const V1 = 'FactoryBurnMintERC20 1.6.2'

const revert = () =>
  makeError('execution reverted', 'CALL_EXCEPTION', {
    action: 'call',
    data: '0x',
    reason: null,
    transaction: { to: TOKEN, data: '0x' },
    invocation: null,
    revert: null,
  })

/**
 * EVMChain stub answering `defaultAdmin()` / `owner()` with `admin` and `pendingDefaultAdmin()`
 * with `schedule`, recording each `eth_call` by function name. `typeAndVersion: null` reproduces
 * a v1.5.1 token, which predates the function.
 */
function stubChain({
  typeAndVersion = V2,
  schedule = 1n,
  admin = ADMIN,
  calls = [],
}: {
  typeAndVersion?: string | null
  schedule?: bigint
  admin?: string
  calls?: string[]
} = {}): EVMChain {
  return {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    typeAndVersion: () =>
      typeAndVersion
        ? Promise.resolve(parseTypeAndVersion(typeAndVersion))
        : Promise.reject(revert()),
    provider: {
      call: ({ data }: { data: string }) => {
        const fn = FRESH.getFunction(data.slice(0, 10))!.name
        calls.push(fn)
        if (fn === 'pendingDefaultAdmin')
          return Promise.resolve(FRESH.encodeFunctionResult(fn, [OTHER, schedule]))
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

const op = new CancelDefaultAdminTransfer()
function generate(chain: EVMChain, overrides: Partial<CancelDefaultAdminTransferParams> = {}) {
  return op.generate(chain, { tokenAddress: TOKEN, sender: ADMIN, ...overrides })
}

describe('CancelDefaultAdminTransfer (cct/evm)', () => {
  describe('v2 CrossChainToken', () => {
    it('encodes cancelDefaultAdminTransfer()', async () => {
      const unsigned = await generate(stubChain())
      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions[0]!.to, TOKEN)
      assert.equal(unsigned.transactions[0]!.from, ADMIN)
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('cancelDefaultAdminTransfer'),
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

  describe('v1 FactoryBurnMintERC20', () => {
    for (const [label, typeAndVersion] of [
      ['v1.6.2', V1],
      ['v1.5.1 (typeAndVersion() reverts)', null],
    ] as const) {
      it(`encodes Ownable2Step transferOwnership(0x0) on ${label}, gated on owner()`, async () => {
        const calls: string[] = []
        const unsigned = await generate(stubChain({ typeAndVersion, calls }))
        assert.equal(unsigned.transactions[0]!.to, TOKEN)
        assert.equal(unsigned.transactions[0]!.from, ADMIN)
        assert.equal(
          unsigned.transactions[0]!.data,
          FRESH.encodeFunctionData('transferOwnership', [ZeroAddress]),
        )
        assert.deepEqual(calls, ['owner'])
      })
    }

    it('reads nothing without a sender: the pending owner has no getter', async () => {
      const calls: string[] = []
      const unsigned = await generate(stubChain({ typeAndVersion: V1, calls }), {
        sender: undefined,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.deepEqual(calls, [])
    })

    it('rejects a sender that is not the token owner', async () => {
      await assert.rejects(
        () => generate(stubChain({ typeAndVersion: V1 }), { sender: OTHER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'cancelDefaultAdminTransfer' &&
          err.context.param === 'sender' &&
          err.message.includes(ADMIN),
      )
    })
  })

  describe('validation and version resolution', () => {
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

    it('rejects an unsupported CrossChainToken version', async () => {
      await assert.rejects(
        () => generate(stubChain({ typeAndVersion: 'CrossChainToken 3.0.0' })),
        (err: unknown) => err instanceof CCTContractVersionUnsupportedError,
      )
    })
  })

  describe('execute', () => {
    for (const typeAndVersion of [V2, V1]) {
      it(`submits as the current admin (${typeAndVersion})`, async () => {
        const { hash } = await op.execute(stubChain({ typeAndVersion }), {
          tokenAddress: TOKEN,
          wallet: fakeSigner(),
        })
        assert.equal(hash, HASH)
      })
    }

    it('rejects a wallet that is not the v1 owner', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain({ typeAndVersion: V1 }), {
            tokenAddress: TOKEN,
            wallet: fakeSigner(OTHER),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
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
