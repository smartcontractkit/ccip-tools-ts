import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, ZeroAddress, makeError } from 'ethers'

import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../../../errors/index.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import {
  type TransferTokenOwnershipParams,
  TransferTokenOwnership,
} from './transfer-token-ownership.ts'

const TOKEN = '0x' + '11'.repeat(20)
const OWNER = '0x' + '22'.repeat(20)
const NEW_OWNER = '0x' + '44'.repeat(20)
const NOT_THE_OWNER = '0x' + '88'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

/**
 * Byte-parity oracle: a fresh Interface built from the signature literals, so the assertions are
 * independent of the SDK's cached, ABI-derived interfaces. `owner()` doubles as the stub's
 * response encoder.
 */
const IFACE = new Interface([
  'function transferOwnership(address to)',
  'function owner() view returns (address)',
])
const dataFor = (to: string) => IFACE.encodeFunctionData('transferOwnership', [to])

/**
 * EVMChain stub: `provider.call` answers `owner()` and nothing else, and `typeAndVersion` throws —
 * this op resolves no version, so reaching it would be a bug.
 */
function stubChain({
  owner = OWNER,
  onCall,
}: {
  owner?: string
  onCall?: () => void
} = {}): EVMChain {
  return {
    provider: {
      call: ({ data }: { data: string }) => {
        onCall?.()
        if (data.slice(0, 10) !== IFACE.getFunction('owner')!.selector)
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: TOKEN, data },
            invocation: null,
            revert: null,
          })
        return Promise.resolve(IFACE.encodeFunctionResult('owner', [owner]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.reject(new Error('typeAndVersion must not be read')),
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

describe('TransferTokenOwnership (cct/evm)', () => {
  describe('generate', () => {
    it('encodes transferOwnership(newOwner), identically for v1.5.1 and v1.6.2', async () => {
      const unsigned = await generate(stubChain())
      const tx = unsigned.transactions[0]!

      assert.equal(unsigned.family, ChainFamily.EVM)
      assert.equal(unsigned.transactions.length, 1)
      assert.equal(tx.to, TOKEN)
      assert.equal(tx.from, OWNER)
      assert.equal(tx.data, dataFor(NEW_OWNER))
    })

    it('allows the zero address, which retracts a pending transfer', async () => {
      const unsigned = await generate(stubChain(), { newOwner: ZeroAddress })
      assert.equal(unsigned.transactions[0]!.data, dataFor(ZeroAddress))
    })

    it('reads the owner and nothing else', async () => {
      let calls = 0
      await generate(stubChain({ onCall: () => (calls += 1) }))
      assert.equal(calls, 1)
    })

    it('omits from — and makes no call at all — when sender is not supplied', async () => {
      let calls = 0
      const unsigned = await generate(stubChain({ onCall: () => (calls += 1) }), {
        sender: undefined,
      })
      assert.equal(unsigned.transactions[0]!.from, undefined)
      assert.equal(calls, 0)
    })
  })

  describe('validation', () => {
    for (const [param, value] of [
      ['tokenAddress', 'not-an-address'],
      ['tokenAddress', ZeroAddress],
      ['newOwner', 'not-an-address'],
      ['sender', 'not-an-address'],
    ] as const) {
      it(`rejects ${param} = ${value} before any RPC`, async () => {
        let called = false
        await assert.rejects(
          () => generate(stubChain({ onCall: () => (called = true) }), { [param]: value }),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'transferTokenOwnership' &&
            err.context.param === param,
        )
        assert.equal(called, false)
      })
    }

    it('rejects a self-transfer before any RPC — the token would revert CannotTransferToSelf', async () => {
      let called = false
      await assert.rejects(
        () =>
          generate(stubChain({ onCall: () => (called = true) }), {
            newOwner: OWNER,
            sender: OWNER,
          }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferTokenOwnership' &&
          err.context.param === 'newOwner',
      )
      assert.equal(called, false)
    })
  })

  describe('pre-transaction validation', () => {
    it('rejects a sender that is not the token owner', async () => {
      await assert.rejects(
        () => generate(stubChain({ owner: NOT_THE_OWNER })),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'transferTokenOwnership' &&
          err.context.param === 'sender' &&
          // names the owner it read, so the caller can see which address it needed
          err.message.includes(NOT_THE_OWNER),
      )
    })
  })

  describe('execute', () => {
    const params = { tokenAddress: TOKEN, newOwner: NEW_OWNER }

    it('signs and submits as the owner, resolving to the tx hash', async () => {
      assert.deepEqual(await op.execute(stubChain(), { ...params, wallet: fakeSigner() }), {
        hash: HASH,
      })
    })

    it('maps an on-chain revert to CCIPExecTxRevertedError', async () => {
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

    it('rejects a sender that is not the executing wallet', async () => {
      await assert.rejects(
        () => op.execute(stubChain(), { ...params, sender: NEW_OWNER, wallet: fakeSigner() }),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'sender',
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
