import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import { SolanaOperation } from './operation.ts'
import { CCIPWalletInvalidError } from '../../errors/index.ts'
import { ChainFamily } from '../../networks.ts'
import type { SolanaChain } from '../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../solana/types.ts'

class TestOperation extends SolanaOperation<{ value: string }> {
  readonly name = 'testOperation'
  captured?: string
  validated?: string

  protected validate(params: { payer: string }): void {
    this.validated = params.payer
  }

  protected buildUnsigned(
    _chain: SolanaChain,
    params: { payer: string; value: string },
  ): Promise<UnsignedSolanaTx> {
    this.captured = params.payer
    return Promise.resolve({ family: ChainFamily.Solana, instructions: [] })
  }
}

type TestTx = UnsignedSolanaTx & { lookupTableAddress: string }
type TestResult = { hash: string; lookupTableAddress: string }

class TestResultOperation extends SolanaOperation<{ value: string }, TestTx, TestResult> {
  readonly name = 'testResultOperation'

  protected validate(): void {}

  protected buildUnsigned(): Promise<TestTx> {
    return Promise.resolve({
      family: ChainFamily.Solana,
      instructions: [],
      lookupTableAddress: 'lookup-table',
    })
  }

  protected override resultFromGenerated(hash: { hash: string }, tx: TestTx): TestResult {
    return { ...hash, lookupTableAddress: tx.lookupTableAddress }
  }
}

const chain = { logger: console, connection: {} } as unknown as SolanaChain

describe('SolanaOperation', () => {
  it('uses wallet public key as payer without mutating caller params', async () => {
    const op = new TestOperation()
    const wallet = {
      publicKey: Keypair.generate().publicKey,
      signTransaction: async <T>(tx: T) => tx,
    }
    const params = { value: 'x', payer: PublicKey.default.toBase58(), wallet }

    await op.execute(chain, params)

    assert.equal(op.validated, wallet.publicKey.toBase58())
    assert.equal(op.captured, wallet.publicKey.toBase58())
    assert.equal(params.payer, PublicKey.default.toBase58())
  })

  it('does not require payer on signed execution params', async () => {
    const op = new TestOperation()
    const wallet = {
      publicKey: Keypair.generate().publicKey,
      signTransaction: async <T>(tx: T) => tx,
    }

    await op.execute(chain, { value: 'x', wallet })

    assert.equal(op.captured, wallet.publicKey.toBase58())
  })

  it('lets operations add generated data to execute results', async () => {
    const op = new TestResultOperation()
    const wallet = {
      publicKey: Keypair.generate().publicKey,
      signTransaction: async <T>(tx: T) => tx,
    }

    const result = await op.execute(chain, { value: 'x', wallet })

    assert.equal(result.lookupTableAddress, 'lookup-table')
  })

  it('rejects invalid wallets before validation or building unsigned txs', async () => {
    const op = new TestOperation()

    await assert.rejects(
      () => op.execute(chain, { value: 'x', wallet: {} }),
      (err: unknown) => err instanceof CCIPWalletInvalidError,
    )
    assert.equal(op.validated, undefined)
    assert.equal(op.captured, undefined)
  })
})
