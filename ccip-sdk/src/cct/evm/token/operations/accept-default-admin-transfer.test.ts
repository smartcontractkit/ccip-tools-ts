import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily, networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTContractVersionUnsupportedError, CCTParamsInvalidError } from '../../../errors.ts'
import {
  type AcceptDefaultAdminTransferParams,
  AcceptDefaultAdminTransfer,
} from './accept-default-admin-transfer.ts'

const TOKEN = '0x' + '11'.repeat(20)
const NEW_ADMIN = '0x' + '33'.repeat(20)
const OTHER = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
/** Byte-parity oracle, independent of the SDK's cached, ABI-derived interfaces. */
const FRESH = new Interface([
  'function acceptDefaultAdminTransfer()',
  'function acceptOwnership()',
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
 * EVMChain stub answering v2's `pendingDefaultAdmin()`, recording each `eth_call` by function
 * name. `typeAndVersion: null` reproduces a v1.5.1 token, which predates the function.
 */
function stubChain({
  typeAndVersion = V2,
  pendingAdmin = NEW_ADMIN,
  schedule = 1n,
  calls = [],
}: {
  typeAndVersion?: string | null
  pendingAdmin?: string
  schedule?: bigint
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
        assert.equal(fn, 'pendingDefaultAdmin')
        return Promise.resolve(FRESH.encodeFunctionResult(fn, [pendingAdmin, schedule]))
      },
    },
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(address = NEW_ADMIN, waitError?: Error) {
  return {
    signTransaction: () => Promise.resolve('0x'),
    getAddress: () => Promise.resolve(address),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: () =>
      Promise.resolve({
        hash: HASH,
        wait: () => (waitError ? Promise.reject(waitError) : Promise.resolve({ status: 1 })),
      }),
  }
}

const op = new AcceptDefaultAdminTransfer()
function generate(chain: EVMChain, overrides: Partial<AcceptDefaultAdminTransferParams> = {}) {
  return op.generate(chain, { tokenAddress: TOKEN, sender: NEW_ADMIN, ...overrides })
}

describe('AcceptDefaultAdminTransfer (cct/evm)', () => {
  describe('v2 CrossChainToken', () => {
    it('encodes acceptDefaultAdminTransfer()', async () => {
      const unsigned = await generate(stubChain())
      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions[0]!.to, TOKEN)
      assert.equal(unsigned.transactions[0]!.from, NEW_ADMIN)
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('acceptDefaultAdminTransfer'),
      )
    })

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

  describe('v1 FactoryBurnMintERC20', () => {
    for (const [label, typeAndVersion] of [
      ['v1.6.2', V1],
      ['v1.5.1 (typeAndVersion() reverts)', null],
    ] as const) {
      it(`encodes Ownable2Step acceptOwnership() on ${label}, reading nothing else`, async () => {
        const calls: string[] = []
        const unsigned = await generate(stubChain({ typeAndVersion, calls }))
        assert.equal(unsigned.transactions[0]!.to, TOKEN)
        assert.equal(unsigned.transactions[0]!.from, NEW_ADMIN)
        assert.equal(unsigned.transactions[0]!.data, FRESH.encodeFunctionData('acceptOwnership'))
        // the pending owner is a private slot with no getter
        assert.deepEqual(calls, [])
      })
    }

    it('does not check sender, which cannot be compared to an unreadable pending owner', async () => {
      const unsigned = await generate(stubChain({ typeAndVersion: V1 }), { sender: OTHER })
      assert.equal(unsigned.transactions[0]!.from, OTHER)
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
      it(`submits as the pending admin (${typeAndVersion})`, async () => {
        const { hash } = await op.execute(stubChain({ typeAndVersion }), {
          tokenAddress: TOKEN,
          wallet: fakeSigner(),
        })
        assert.equal(hash, HASH)
      })
    }

    it('maps a v1 on-chain revert (wallet not the proposed owner) to CCIPExecTxRevertedError', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain({ typeAndVersion: V1 }), {
            tokenAddress: TOKEN,
            wallet: fakeSigner(OTHER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'acceptDefaultAdminTransfer',
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
