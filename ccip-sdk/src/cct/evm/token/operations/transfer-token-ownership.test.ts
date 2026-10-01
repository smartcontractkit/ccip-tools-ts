import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { BeginDefaultAdminTransfer } from './begin-default-admin-transfer.ts'
import { CancelDefaultAdminTransfer } from './cancel-default-admin-transfer.ts'
import {
  type TransferTokenOwnershipParams,
  TransferTokenOwnership,
} from './transfer-token-ownership.ts'

const TOKEN = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const NEW_OWNER = '0x' + '44'.repeat(20)
const NOT_THE_OWNER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
/** Byte-parity oracle, independent of the SDK's cached, ABI-derived interfaces. */
const FRESH = new Interface([
  'function transferOwnership(address to)',
  'function cancelDefaultAdminTransfer()',
  'function owner() view returns (address)',
  'function defaultAdmin() view returns (address)',
  'function pendingDefaultAdmin() view returns (address newAdmin, uint48 schedule)',
])

const V2 = 'CrossChainToken 2.0.0'
const V1 = 'FactoryBurnMintERC20 1.6.2'

/**
 * EVMChain stub for either token version: `owner()` / `defaultAdmin()` answer `owner`, and v2's
 * `pendingDefaultAdmin()` answers `schedule`.
 */
function stubChain({
  typeAndVersion = V1,
  owner = OWNER,
  schedule = 1n,
}: { typeAndVersion?: string; owner?: string; schedule?: bigint } = {}): EVMChain {
  return {
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    provider: {
      call: ({ data }: { data: string }) => {
        const fn = FRESH.getFunction(data.slice(0, 10))!.name
        if (fn === 'pendingDefaultAdmin')
          return Promise.resolve(FRESH.encodeFunctionResult(fn, [NEW_OWNER, schedule]))
        return Promise.resolve(FRESH.encodeFunctionResult(fn, [owner]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve(parseTypeAndVersion(typeAndVersion)),
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(address = OWNER, waitError?: Error) {
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

const op = new TransferTokenOwnership()

function generate(chain: EVMChain, overrides: Partial<TransferTokenOwnershipParams> = {}) {
  return op.generate(chain, {
    tokenAddress: TOKEN,
    newOwner: NEW_OWNER,
    sender: OWNER,
    ...overrides,
  })
}

describe('TransferTokenOwnership (cct/evm, deprecated alias)', () => {
  describe('pass-through', () => {
    for (const typeAndVersion of [V1, V2]) {
      it(`builds exactly beginDefaultAdminTransfer for a non-zero newOwner (${typeAndVersion})`, async () => {
        const chain = stubChain({ typeAndVersion })
        assert.deepEqual(
          await generate(chain),
          await new BeginDefaultAdminTransfer().generate(chain, {
            tokenAddress: TOKEN,
            newAdmin: NEW_OWNER,
            sender: OWNER,
          }),
        )
      })

      it(`builds exactly cancelDefaultAdminTransfer for a zero newOwner (${typeAndVersion})`, async () => {
        const chain = stubChain({ typeAndVersion })
        assert.deepEqual(
          await generate(chain, { newOwner: ZeroAddress }),
          await new CancelDefaultAdminTransfer().generate(chain, {
            tokenAddress: TOKEN,
            sender: OWNER,
          }),
        )
      })
    }

    it('keeps the v1 calldata: transferOwnership(newOwner), and transferOwnership(0x0) to retract', async () => {
      const chain = stubChain()
      assert.equal(
        (await generate(chain)).transactions[0]!.data,
        FRESH.encodeFunctionData('transferOwnership', [NEW_OWNER]),
      )
      assert.equal(
        (await generate(chain, { newOwner: ZeroAddress })).transactions[0]!.data,
        FRESH.encodeFunctionData('transferOwnership', [ZeroAddress]),
      )
    })

    it('cancels on v2 for a zero newOwner, rather than scheduling renunciation', async () => {
      const unsigned = await generate(stubChain({ typeAndVersion: V2 }), { newOwner: ZeroAddress })
      assert.equal(
        unsigned.transactions[0]!.data,
        FRESH.encodeFunctionData('cancelDefaultAdminTransfer'),
      )
      await assert.rejects(
        () => generate(stubChain({ typeAndVersion: V2, schedule: 0n }), { newOwner: ZeroAddress }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferTokenOwnership' &&
          /no pending default-admin transfer to cancel/.test(err.message),
      )
    })
  })

  describe('error attribution', () => {
    it('reports a v1 self-transfer under transferTokenOwnership / newOwner', async () => {
      await assert.rejects(
        () => generate(stubChain(), { newOwner: OWNER, sender: undefined }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferTokenOwnership' &&
          err.context.param === 'newOwner' &&
          /CannotTransferToSelf/.test(err.message),
      )
    })

    it('reports a sender that is not the current admin, on either version', async () => {
      for (const typeAndVersion of [V1, V2])
        await assert.rejects(
          () => generate(stubChain({ typeAndVersion, owner: NOT_THE_OWNER })),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'transferTokenOwnership' &&
            err.context.param === 'sender' &&
            err.message.includes(NOT_THE_OWNER),
        )
    })

    for (const [param, value] of [
      ['tokenAddress', 'not-an-address'],
      ['tokenAddress', ZeroAddress],
      ['newOwner', 'not-an-address'],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${value} before any RPC`, async () => {
        let called = false
        const chain = stubChain()
        chain.typeAndVersion = () => {
          called = true
          return Promise.reject(new Error('unexpected RPC'))
        }
        await assert.rejects(
          () => generate(chain, { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'transferTokenOwnership' &&
            err.context.param === param,
        )
        assert.equal(called, false)
      })
    }
  })

  describe('execute', () => {
    const params = { tokenAddress: TOKEN, newOwner: NEW_OWNER }

    it('signs and submits as the owner, resolving to the tx hash', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps an on-chain revert to CCIPExecTxRevertedError under its own name', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'transferTokenOwnership',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: {} }),
        CCIPWalletInvalidError,
      )
    })

    it('rejects a wallet that is not the token owner', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: fakeSigner(NOT_THE_OWNER) }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferTokenOwnership' &&
          err.context.param === 'sender',
      )
    })
  })
})
