import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTContractVersionUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import {
  type BeginDefaultAdminTransferParams,
  BeginDefaultAdminTransfer,
} from './begin-default-admin-transfer.ts'

const TOKEN = '0x' + '11'.repeat(20)
const ADMIN = '0x' + '22'.repeat(20)
const NEW_ADMIN = '0x' + '33'.repeat(20)
const OTHER = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
/** Byte-parity oracle, independent of the SDK's cached, ABI-derived interfaces. */
const FRESH = new Interface([
  'function beginDefaultAdminTransfer(address newAdmin)',
  'function transferOwnership(address to)',
  'function defaultAdmin() view returns (address)',
  'function owner() view returns (address)',
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
 * EVMChain stub answering `defaultAdmin()` (v2) and `owner()` (v1) with `admin`, recording each
 * `eth_call` by function name. `typeAndVersion: null` reproduces a v1.5.1 token, which predates
 * the function.
 */
function stubChain({
  typeAndVersion = V2,
  admin = ADMIN,
  calls = [],
}: { typeAndVersion?: string | null; admin?: string; calls?: string[] } = {}): EVMChain {
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
  describe('v2 CrossChainToken', () => {
    it('encodes beginDefaultAdminTransfer(address)', async () => {
      const calls: string[] = []
      const unsigned = await generate(stubChain({ calls }))
      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions[0]!.to, TOKEN)
      assert.equal(unsigned.transactions[0]!.from, ADMIN)
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('beginDefaultAdminTransfer', [NEW_ADMIN]),
      )
      assert.deepEqual(calls, ['defaultAdmin'])
    })

    it('allows zero newAdmin to schedule OpenZeppelin default-admin renunciation', async () => {
      const unsigned = await generate(stubChain(), { newAdmin: ZeroAddress })
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('beginDefaultAdminTransfer', [ZeroAddress]),
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

  describe('v1 FactoryBurnMintERC20', () => {
    for (const [label, typeAndVersion] of [
      ['v1.6.2', V1],
      ['v1.5.1 (typeAndVersion() reverts)', null],
    ] as const) {
      it(`encodes Ownable2Step transferOwnership(newAdmin) on ${label}`, async () => {
        const calls: string[] = []
        const unsigned = await generate(stubChain({ typeAndVersion, calls }))
        assert.equal(unsigned.transactions[0]!.to, TOKEN)
        assert.equal(unsigned.transactions[0]!.from, ADMIN)
        assert.equal(
          unsigned.transactions[0]!.data,
          FRESH.encodeFunctionData('transferOwnership', [NEW_ADMIN]),
        )
        assert.deepEqual(calls, ['owner'])
      })
    }

    it('rejects zero newAdmin, which would retract rather than renounce, before reading owner()', async () => {
      const calls: string[] = []
      await assert.rejects(
        () => generate(stubChain({ typeAndVersion: V1, calls }), { newAdmin: ZeroAddress }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'beginDefaultAdminTransfer' &&
          err.context.param === 'newAdmin' &&
          /cancelDefaultAdminTransfer/.test(err.message),
      )
      assert.deepEqual(calls, [])
    })

    it('still reads owner() without a sender, rejecting a self-transfer', async () => {
      await assert.rejects(
        () => generate(stubChain({ typeAndVersion: V1 }), { newAdmin: ADMIN, sender: undefined }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'newAdmin' &&
          err.message.includes(ADMIN) &&
          /CannotTransferToSelf/.test(err.message),
      )
    })

    it('omits from when sender is not supplied', async () => {
      const unsigned = await generate(stubChain({ typeAndVersion: V1 }), { sender: undefined })
      assert.equal(unsigned.transactions[0]!.from, undefined)
    })

    it('rejects a sender that is not the token owner', async () => {
      await assert.rejects(
        () => generate(stubChain({ typeAndVersion: V1 }), { sender: OTHER }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          err.message.includes(ADMIN),
      )
    })
  })

  describe('validation and version resolution', () => {
    it('rejects invalid addresses before RPC', async () => {
      for (const [param, value] of [
        ['tokenAddress', ZeroAddress],
        ['newAdmin', 'not-an-address'],
        ['sender', 'not-an-address'],
      ] as const) {
        const calls: string[] = []
        await assert.rejects(
          () => generate(stubChain({ calls }), { [param]: value }),
          (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
        )
        assert.deepEqual(calls, [])
      }
    })

    it('rejects an unsupported CrossChainToken version', async () => {
      await assert.rejects(
        () => generate(stubChain({ typeAndVersion: 'CrossChainToken 3.0.0' })),
        (err: unknown) => err instanceof CCTContractVersionUnsupportedError,
      )
    })

    it('surfaces a transient typeAndVersion() failure instead of assuming v1', async () => {
      const chain = stubChain()
      chain.typeAndVersion = () => Promise.reject(makeError('timeout', 'TIMEOUT'))
      await assert.rejects(
        () => generate(chain),
        (err: unknown) => err instanceof Error && /timeout/.test(err.message),
      )
    })
  })

  describe('execute', () => {
    for (const typeAndVersion of [V2, V1]) {
      it(`submits as the current admin (${typeAndVersion})`, async () => {
        const { hash } = await op.execute(stubChain({ typeAndVersion }), {
          tokenAddress: TOKEN,
          newAdmin: NEW_ADMIN,
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
            newAdmin: NEW_ADMIN,
            wallet: fakeSigner(OTHER),
          }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
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
