import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type TransactionRequest, makeError } from 'ethers'

import {
  CCIPExecTxRevertedError,
  CCIPWalletChainMismatchError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import type { EVMChain } from '../../evm/index.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import { ChainFamily, networkInfo } from '../../networks.ts'
import { CCTTxFailedError, CCTTxNotConfirmedError } from '../errors.ts'
import { submit } from './submit.ts'

const TAR = '0x' + '44'.repeat(20)
const HASH = '0x' + 'ab'.repeat(32)

const UNSIGNED: UnsignedEVMTx = {
  family: ChainFamily.EVM,
  transactions: [{ to: TAR, data: '0x1234' }],
}

/** Base Sepolia; the chain the stub manager is on. Every built tx must be pinned to it. */
const CHAIN_ID = Number(networkInfo('ethereum-testnet-sepolia-base-1').chainId)

/** Ethereum Sepolia; the chain the wallet is wrongly connected to. */
const OTHER_CHAIN_ID = Number(networkInfo('ethereum-testnet-sepolia').chainId)

/** Counters proving a rejected submission touched neither the nonce cache nor the wallet. */
type Spy = { nonces: number; rollbacks: number; signed: number; sent: number }

function spy(): Spy {
  return { nonces: 0, rollbacks: 0, signed: 0, sent: 0 }
}

function stubChain(s: Spy = spy()): EVMChain {
  return {
    provider: {} as never,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: { chainId: CHAIN_ID, name: 'base-sepolia' },
    nextNonce: async () => {
      s.nonces++
      return 0
    },
    rollbackNonce: () => {
      s.rollbacks++
    },
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
  /** Chain ids the provider reports, one per read (last repeats), as a switching wallet would. */
  providerChainIds?: number[]
  spy?: Spy
}) {
  const fail = opts.submitError
  const s = opts.spy
  let networkCalls = 0
  const ids = opts.providerChainIds
  return {
    ...(ids && {
      provider: {
        _detectNetwork: () =>
          Promise.resolve({ chainId: BigInt(ids[Math.min(networkCalls++, ids.length - 1)]!) }),
      },
    }),
    signTransaction: () => {
      if (s) s.signed++
      return fail ? Promise.reject(fail) : Promise.resolve('0x')
    },
    getAddress: () => Promise.resolve('0x' + '55'.repeat(20)),
    populateTransaction: (tx: unknown) => Promise.resolve({ ...(tx as object) }),
    sendTransaction: (_tx: unknown) => {
      if (s) s.sent++
      return fail
        ? Promise.reject(fail)
        : Promise.resolve({
            hash: HASH,
            wait: (_c?: number, _t?: number) =>
              opts.waitError
                ? Promise.reject(opts.waitError)
                : Promise.resolve(opts.receipt ?? null),
          })
    },
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

  describe('wallet chain binding', () => {
    it('rejects a wallet connected to another chain, naming both chain ids', async () => {
      const s = spy()
      await assert.rejects(
        () =>
          submit(
            stubChain(s),
            fakeSigner({ providerChainIds: [OTHER_CHAIN_ID], spy: s }),
            UNSIGNED,
            'setPool',
          ),
        (err: unknown) =>
          err instanceof CCIPWalletChainMismatchError &&
          err.context.expected === CHAIN_ID &&
          err.context.actual === OTHER_CHAIN_ID,
      )
    })

    it('signs nothing, broadcasts nothing and consumes no nonce on mismatch', async () => {
      const s = spy()
      await assert.rejects(() =>
        submit(
          stubChain(s),
          fakeSigner({ providerChainIds: [OTHER_CHAIN_ID], spy: s }),
          UNSIGNED,
          'setPool',
        ),
      )
      assert.deepEqual(s, { nonces: 0, rollbacks: 0, signed: 0, sent: 0 })
    })

    it('does not wrap the mismatch in CCTTxFailedError', async () => {
      await assert.rejects(
        () =>
          submit(
            stubChain(),
            fakeSigner({ providerChainIds: [OTHER_CHAIN_ID] }),
            UNSIGNED,
            'setPool',
          ),
        (err: unknown) =>
          err instanceof CCIPWalletChainMismatchError && !(err instanceof CCTTxFailedError),
      )
    })

    it('submits when the wallet is on the manager chain', async () => {
      const { response } = await submit(
        stubChain(),
        fakeSigner({ providerChainIds: [CHAIN_ID], receipt: { status: 1 } }),
        UNSIGNED,
        'setPool',
      )
      assert.equal(response.hash, HASH)
    })

    it('rejects a wallet that switches networks after the first submission', async () => {
      const s = spy()
      const wallet = fakeSigner({
        providerChainIds: [CHAIN_ID, OTHER_CHAIN_ID],
        receipt: { status: 1 },
        spy: s,
      })
      await submit(stubChain(s), wallet, UNSIGNED, 'setPool')
      assert.equal(s.sent, 1, 'first submission goes through')

      await assert.rejects(
        () => submit(stubChain(s), wallet, UNSIGNED, 'setPool'),
        (err: unknown) => err instanceof CCIPWalletChainMismatchError,
      )
      assert.equal(s.sent, 1, 'second submission never broadcast')
    })

    it("hands the builder's chainId to the signer rather than dropping it", async () => {
      const populated: TransactionRequest[] = []
      const wallet = {
        ...fakeSigner({ providerChainIds: [CHAIN_ID], receipt: { status: 1 } }),
        populateTransaction: (tx: TransactionRequest) => {
          populated.push(tx)
          return Promise.resolve({ ...tx })
        },
      }
      await submit(
        stubChain(),
        wallet,
        { family: ChainFamily.EVM, transactions: [{ to: TAR, data: '0x1234', chainId: CHAIN_ID }] },
        'setPool',
      )
      assert.equal(populated[0]!.chainId, CHAIN_ID)
    })
  })
})
