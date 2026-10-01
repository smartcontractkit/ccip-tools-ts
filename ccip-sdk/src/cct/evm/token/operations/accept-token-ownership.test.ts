import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { networkInfo } from '../../../../networks.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { AcceptDefaultAdminTransfer } from './accept-default-admin-transfer.ts'
import { type AcceptTokenOwnershipParams, AcceptTokenOwnership } from './accept-token-ownership.ts'

const TOKEN = '0x' + '11'.repeat(20)
const PROPOSED_OWNER = '0x' + '22'.repeat(20)
const SOMEONE_ELSE = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)
/** Byte-parity oracle, independent of the SDK's cached, ABI-derived interfaces. */
const FRESH = new Interface([
  'function acceptOwnership()',
  'function pendingDefaultAdmin() view returns (address newAdmin, uint48 schedule)',
])

const V2 = 'CrossChainToken 2.0.0'
const V1 = 'FactoryBurnMintERC20 1.6.2'

/** EVMChain stub for either token version; v2's `pendingDefaultAdmin()` names `PROPOSED_OWNER`. */
function stubChain({ typeAndVersion = V1 }: { typeAndVersion?: string } = {}): EVMChain {
  return {
    network: networkInfo('ethereum-testnet-sepolia-base-1'),
    provider: {
      call: () =>
        Promise.resolve(FRESH.encodeFunctionResult('pendingDefaultAdmin', [PROPOSED_OWNER, 1n])),
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve(parseTypeAndVersion(typeAndVersion)),
    nextNonce: () => Promise.resolve(0),
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

function fakeSigner(address = PROPOSED_OWNER, waitError?: Error) {
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

const op = new AcceptTokenOwnership()

function generate(chain: EVMChain, overrides: Partial<AcceptTokenOwnershipParams> = {}) {
  return op.generate(chain, { tokenAddress: TOKEN, sender: PROPOSED_OWNER, ...overrides })
}

describe('AcceptTokenOwnership (cct/evm, deprecated alias)', () => {
  describe('pass-through', () => {
    for (const typeAndVersion of [V1, V2]) {
      it(`builds exactly acceptDefaultAdminTransfer (${typeAndVersion})`, async () => {
        const chain = stubChain({ typeAndVersion })
        assert.deepEqual(
          await generate(chain),
          await new AcceptDefaultAdminTransfer().generate(chain, {
            tokenAddress: TOKEN,
            sender: PROPOSED_OWNER,
          }),
        )
      })
    }

    it('keeps the v1 calldata: acceptOwnership()', async () => {
      assert.equal(
        (await generate(stubChain())).transactions[0]!.data,
        FRESH.encodeFunctionData('acceptOwnership'),
      )
    })
  })

  describe('error attribution', () => {
    for (const [param, value] of [
      ['tokenAddress', 'not-an-address'],
      ['tokenAddress', ZeroAddress],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${value} under acceptTokenOwnership`, async () => {
        await assert.rejects(
          () => generate(stubChain(), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'acceptTokenOwnership' &&
            err.context.param === param,
        )
      })
    }

    it('reports a v2 sender that is not the pending admin under acceptTokenOwnership', async () => {
      await assert.rejects(
        () => generate(stubChain({ typeAndVersion: V2 }), { sender: SOMEONE_ELSE }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'acceptTokenOwnership' &&
          err.context.param === 'sender',
      )
    })
  })

  describe('execute', () => {
    const params = { tokenAddress: TOKEN }

    it('signs and submits as the proposed owner, resolving to the tx hash', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps an on-chain revert to CCIPExecTxRevertedError under its own name', async () => {
      await assert.rejects(
        () =>
          op.execute(stubChain(), {
            ...params,
            wallet: fakeSigner(PROPOSED_OWNER, makeError('execution reverted', 'CALL_EXCEPTION')),
          }),
        (err: unknown) =>
          err instanceof CCIPExecTxRevertedError &&
          err.context.operation === 'acceptTokenOwnership',
      )
    })

    it('rejects a non-signer wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, wallet: {} }),
        CCIPWalletInvalidError,
      )
    })

    it('rejects a sender that is not the executing wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, sender: SOMEONE_ELSE, wallet: fakeSigner() }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'sender' &&
          /generateUnsignedAcceptTokenOwnership/.test(err.message),
      )
    })
  })
})
