import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { makeError } from 'ethers'

import { submit } from './submit.ts'
import { CCIPExecTxRevertedError, CCIPWalletInvalidError } from '../../errors/index.ts'
import type { EVMChain } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import { ChainFamily } from '../../networks.ts'
import { CCTTxFailedError, CCTTxNotConfirmedError } from '../errors.ts'

const TAR = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

const UNSIGNED: UnsignedEVMTx = {
  family: ChainFamily.EVM,
  transactions: [{ to: TAR, data: '0x1234' }],
}

function stubChain(): EVMChain {
  return {
    provider: {} as never,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    nextNonce: async () => 0,
    rollbackNonce: () => {},
  } as unknown as EVMChain
}

/**
 * Fake ethers Signer. `wait` resolves to `receipt` (or rejects with `waitError`);
 * `submitError` makes both send and sign paths reject (pre-broadcast failure).
 */
function fakeSigner(opts: {
  receipt?: { status: number; contractAddress?: string | null } | null
  waitError?: Error
  submitError?: Error
}) {
  const fail = opts.submitError
  return {
    signTransaction: () => (fail ? Promise.reject(fail) : Promise.resolve('0x')),
    getAddress: () => Promise.resolve('0x' + '55'.repeat(20)),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: (_tx: unknown) =>
      fail
        ? Promise.reject(fail)
        : Promise.resolve({
            hash: HASH,
            wait: (_c?: number, _t?: number) =>
              opts.waitError
                ? Promise.reject(opts.waitError)
                : Promise.resolve(opts.receipt ?? null),
          }),
  }
}

describe('submit (sign-and-confirm pipeline)', () => {
  it('returns the broadcast response and mined receipt', async () => {
    const { response, receipt } = await submit(
      stubChain(),
      fakeSigner({ receipt: { status: 1, contractAddress: null } }),
      UNSIGNED,
      'setPool',
    )
    assert.equal(response.hash, HASH)
    assert.equal(receipt.status, 1)
  })

  it('throws CCIPExecTxRevertedError (non-transient) when wait() throws CALL_EXCEPTION', async () => {
    await assert.rejects(
      () =>
        submit(
          stubChain(),
          fakeSigner({ waitError: makeError('execution reverted', 'CALL_EXCEPTION') }),
          UNSIGNED,
          'setPool',
        ),
      (err: unknown) =>
        err instanceof CCIPExecTxRevertedError &&
        err.context.operation === 'setPool' &&
        err.context.txHash === HASH &&
        !err.isTransient &&
        err.message.includes('reverted'),
    )
  })

  it('throws CCTTxNotConfirmedError (transient) when wait() throws TRANSACTION_REPLACED', async () => {
    await assert.rejects(
      () =>
        submit(
          stubChain(),
          fakeSigner({ waitError: makeError('transaction replaced', 'TRANSACTION_REPLACED') }),
          UNSIGNED,
          'setPool',
        ),
      (err: unknown) =>
        err instanceof CCTTxNotConfirmedError && err.context.txHash === HASH && err.isTransient,
    )
  })

  it('throws CCTTxNotConfirmedError (transient, keeps hash) when no receipt arrives', async () => {
    await assert.rejects(
      () => submit(stubChain(), fakeSigner({ receipt: null }), UNSIGNED, 'setPool'),
      (err: unknown) =>
        err instanceof CCTTxNotConfirmedError && err.context.txHash === HASH && err.isTransient,
    )
  })

  it('throws CCTTxNotConfirmedError (transient, keeps hash) on confirmation timeout', async () => {
    await assert.rejects(
      () =>
        submit(
          stubChain(),
          fakeSigner({ waitError: makeError('timed out', 'TIMEOUT') }),
          UNSIGNED,
          'setPool',
        ),
      (err: unknown) =>
        err instanceof CCTTxNotConfirmedError && err.context.txHash === HASH && err.isTransient,
    )
  })

  it('throws a transient CCTTxFailedError when submission fails with a network error', async () => {
    await assert.rejects(
      () =>
        submit(
          stubChain(),
          fakeSigner({ submitError: makeError('network down', 'NETWORK_ERROR') }),
          UNSIGNED,
          'setPool',
        ),
      (err: unknown) => err instanceof CCTTxFailedError && err.isTransient,
    )
  })

  it('rejects a non-signer wallet', async () => {
    await assert.rejects(
      () => submit(stubChain(), {}, UNSIGNED, 'setPool'),
      (err: unknown) => err instanceof CCIPWalletInvalidError,
    )
  })
})
