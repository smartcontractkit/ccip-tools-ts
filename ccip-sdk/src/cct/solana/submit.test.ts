import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  SendTransactionError,
  TransactionExpiredTimeoutError,
  TransactionInstruction,
} from '@solana/web3.js'

import { ChainFamily } from '../../networks.ts'
import type { SolanaChain } from '../../solana/index.ts'
import { CCTTxFailedError, CCTTxNotConfirmedError } from '../errors.ts'
import { createCCTSubmitError, submit } from './submit.ts'

const OP = 'setPool'

describe('Submit error mapping (cct/solana)', () => {
  it('maps post-broadcast confirmation errors with a signature to not-confirmed', () => {
    const cause = Object.assign(new Error('transaction was not confirmed'), {
      signature: 'abc',
    })
    const err = createCCTSubmitError(OP, cause)

    assert.ok(err instanceof CCTTxNotConfirmedError)
    assert.equal(err.isTransient, true)
    assert.equal(err.context.txHash, 'abc')
  })

  it('maps web3.js transaction expiry errors to not-confirmed', () => {
    const err = createCCTSubmitError(OP, new TransactionExpiredTimeoutError('def', 30))

    assert.ok(err instanceof CCTTxNotConfirmedError)
    assert.equal(err.context.txHash, 'def')
  })

  it('maps SendTransactionError with a signature to not-confirmed', () => {
    const cause = new SendTransactionError({
      action: 'send',
      signature: 'ghi',
      transactionMessage: 'block height exceeded',
    })
    const err = createCCTSubmitError(OP, cause)

    assert.ok(err instanceof CCTTxNotConfirmedError)
    assert.equal(err.context.txHash, 'ghi')
  })

  it('maps signed on-chain failures to permanent tx failed', () => {
    const cause = Object.assign(new Error('custom program error: 0x1'), {
      signature: 'jkl',
    })
    const err = createCCTSubmitError(OP, cause)

    assert.ok(err instanceof CCTTxFailedError)
    assert.equal(err.isTransient, false)
    assert.equal(err.context.txHash, undefined)
  })

  it('maps SendTransactionError with an empty signature to transient tx failed', () => {
    const cause = new SendTransactionError({
      action: 'simulate',
      signature: '',
      transactionMessage: 'blockhash not found',
    })
    const err = createCCTSubmitError(OP, cause)

    assert.ok(err instanceof CCTTxFailedError)
    assert.equal(err.isTransient, true)
  })

  it('maps pre-broadcast transient errors to transient tx failed', () => {
    const err = createCCTSubmitError(OP, new Error('blockhash not found'))

    assert.ok(err instanceof CCTTxFailedError)
    assert.equal(err.isTransient, true)
  })

  it('maps program errors to permanent tx failed', () => {
    const err = createCCTSubmitError(OP, new Error('custom program error: 0x1'))

    assert.ok(err instanceof CCTTxFailedError)
    assert.equal(err.isTransient, false)
  })

  it('does not submit a slice when its simulation rejects', async () => {
    let sends = 0
    const chain = {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      connection: {
        simulateTransaction: async () => ({
          value: { err: { InstructionError: [2, { Custom: 4 }] }, logs: [] },
        }),
        sendTransaction: async () => {
          sends++
          return 'unused'
        },
      },
    } as unknown as SolanaChain
    const wallet = {
      publicKey: Keypair.generate().publicKey,
      signTransaction: async <T>(tx: T) => tx,
    }

    await assert.rejects(
      submit(
        chain,
        wallet,
        {
          family: ChainFamily.Solana,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }),
            ComputeBudgetProgram.setComputeUnitLimit({ units: 2 }),
          ],
          mainIndex: 0,
        },
        OP,
      ),
      CCTTxFailedError,
    )
    assert.equal(sends, 0)
  })

  it('reports confirmed slices when a later slice fails', async () => {
    const hash = 'confirmed-slice'
    let simulations = 0
    const simulationLookupCounts: number[] = []
    const lookupAddress = Keypair.generate().publicKey
    const lookupTable = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: {
        deactivationSlot: 0xffff_ffff_ffff_ffffn,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: undefined,
        addresses: [lookupAddress],
      },
    })
    const chain = {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      connection: {
        simulateTransaction: async (tx: { message: { addressTableLookups: unknown[] } }) => {
          simulationLookupCounts.push(tx.message.addressTableLookups.length)
          return {
            value: {
              err: ++simulations === 1 ? null : { InstructionError: [1, { Custom: 4 }] },
              logs: [],
            },
          }
        },
        getLatestBlockhash: async () => ({
          blockhash: Keypair.generate().publicKey.toBase58(),
          lastValidBlockHeight: 1,
        }),
        sendTransaction: async () => hash,
        confirmTransaction: async () => ({ value: { err: null } }),
      },
    } as unknown as SolanaChain
    const wallet = {
      publicKey: Keypair.generate().publicKey,
      signTransaction: async <T>(tx: T) => tx,
    }
    const instruction = () =>
      new TransactionInstruction({
        programId: Keypair.generate().publicKey,
        keys: [{ pubkey: lookupAddress, isSigner: false, isWritable: false }],
        data: Buffer.alloc(700),
      })

    await assert.rejects(
      submit(
        chain,
        wallet,
        {
          family: ChainFamily.Solana,
          instructions: [instruction(), instruction()],
          lookupTables: [lookupTable],
          mainIndex: 0,
        },
        OP,
      ),
      (error: unknown) =>
        error instanceof CCTTxFailedError &&
        error.message.startsWith('partially applied: 1 transaction(s) confirmed;') &&
        Array.isArray(error.context.committedHashes) &&
        error.context.committedHashes[0] === hash,
    )
    assert.deepEqual(simulationLookupCounts, [1, 1])
  })
})
