import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js'
import { memoize } from 'micro-memoize'

import { CCIPWalletInvalidError } from '../../errors/index.ts'
import { ChainFamily } from '../../networks.ts'
import type { SolanaChain } from '../../solana/index.ts'
import type { UnsignedSolanaTx } from '../../solana/types.ts'
import { SolanaOperation } from './operation.ts'
import { SolanaQuery } from './query.ts'

class TestOperation extends SolanaOperation<{ value: string }> {
  readonly name = 'testOperation'
  captured?: string
  validated?: string

  protected override prepare(params: { payer: string; value: string }) {
    this.validated = params.payer
    return params
  }

  protected buildUnsigned(
    _chain: SolanaChain,
    params: { payer: string; value: string },
  ): Promise<UnsignedSolanaTx> {
    this.captured = params.payer
    return Promise.resolve({
      family: ChainFamily.Solana,
      instructions: [new TransactionInstruction({ keys: [], programId: PublicKey.default })],
    })
  }
}

class ParsedTestOperation extends SolanaOperation<
  { value: string },
  UnsignedSolanaTx,
  { payer: string; value: number }
> {
  readonly name = 'parsedTestOperation'
  readonly lifecycle: string[] = []
  captured?: { payer: string; value: number }

  protected override prepare(params: { payer: string; value: string }): {
    payer: string
    value: number
  } {
    this.lifecycle.push(`prepare:${params.value}`)
    return { ...params, value: Number(params.value) }
  }

  protected buildUnsigned(
    _chain: SolanaChain,
    params: { payer: string; value: number },
  ): Promise<UnsignedSolanaTx> {
    this.lifecycle.push(`build:${params.value}`)
    this.captured = params
    return Promise.resolve({
      family: ChainFamily.Solana,
      instructions: [new TransactionInstruction({ keys: [], programId: PublicKey.default })],
    })
  }
}

const mockConnection = {
  getLatestBlockhash: async () => ({
    blockhash: PublicKey.default.toBase58(),
    lastValidBlockHeight: 1,
  }),
  simulateTransaction: async () => ({ value: { err: null, logs: [], unitsConsumed: 1 } }),
  sendTransaction: async () => 'signature',
  confirmTransaction: async () => ({ value: { err: null } }),
}

const chain = {
  logger: console,
  connection: mockConnection,
} as unknown as SolanaChain

describe('SolanaOperation', () => {
  it('prepares once, then builds without mutating input', async () => {
    const op = new ParsedTestOperation()
    const params = { payer: PublicKey.default.toBase58(), value: '42' }

    await op.generate(chain, params)

    assert.deepEqual(op.lifecycle, ['prepare:42', 'build:42'])
    assert.deepEqual(op.captured, { payer: params.payer, value: 42 })
    assert.equal(params.value, '42')
  })

  it('prepares once on signed execution without mutating input', async () => {
    const op = new ParsedTestOperation()
    const wallet = {
      publicKey: Keypair.generate().publicKey,
      signTransaction: async <T>(tx: T) => tx,
    }
    const params = { value: '42', payer: PublicKey.default.toBase58(), wallet }

    await op.execute(chain, params)

    assert.deepEqual(op.lifecycle, ['prepare:42', 'build:42'])
    assert.deepEqual(op.captured, { payer: wallet.publicKey.toBase58(), value: 42 })
    assert.equal(params.value, '42')
    assert.equal(params.payer, PublicKey.default.toBase58())
  })

  it('stops before building when preparation fails', async () => {
    class RejectingOperation extends ParsedTestOperation {
      protected override prepare(params: { payer: string; value: string }): never {
        this.lifecycle.push(`prepare:${params.value}`)
        throw new Error('invalid params')
      }
    }

    const op = new RejectingOperation()

    await assert.rejects(() => op.generate(chain, { payer: 'payer', value: '42' }))
    assert.deepEqual(op.lifecycle, ['prepare:42'])
  })

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

describe('CCT account state freshness', () => {
  const account = new PublicKey(Keypair.generate().publicKey)

  /** A chain whose getAccountInfo is memoized the way SolanaChain's is, over a mutable account. */
  function chainWithMemoizedAccount() {
    const state = { data: 'before' }
    const getAccountInfo = memoize(async (_address: PublicKey) => ({ data: state.data }), {
      async: true,
      expires: 5e3,
      transformKey: ([address]: [PublicKey]) => [address.toBase58()],
    })
    const memoChain = {
      logger: console,
      connection: { ...mockConnection, getAccountInfo },
    } as unknown as SolanaChain
    return { state, memoChain }
  }

  /** Records the account data each build saw. */
  class ReadingOperation extends SolanaOperation<{ value: string }> {
    readonly name = 'readingOperation'
    readonly seen: string[] = []

    protected async buildUnsigned(c: SolanaChain): Promise<UnsignedSolanaTx> {
      this.seen.push((await c.connection.getAccountInfo(account))!.data as unknown as string)
      return {
        family: ChainFamily.Solana,
        instructions: [new TransactionInstruction({ keys: [], programId: PublicKey.default })],
      }
    }
  }

  class ReadingQuery extends SolanaQuery<object, string> {
    readonly name = 'readingQuery'

    protected prepare(params: object) {
      return params
    }

    protected async read(c: SolanaChain): Promise<string> {
      return (await c.connection.getAccountInfo(account))!.data as unknown as string
    }
  }

  const params = { payer: PublicKey.default.toBase58(), value: 'x' }
  const wallet = {
    publicKey: Keypair.generate().publicKey,
    signTransaction: async <T>(tx: T) => tx,
  }

  it('generates against state written since the previous read', async () => {
    const { state, memoChain } = chainWithMemoizedAccount()
    const op = new ReadingOperation()
    await op.generate(memoChain, params)
    state.data = 'after' // e.g. a transaction a Squads vault signed in between
    await op.generate(memoChain, params)
    assert.deepEqual(op.seen, ['before', 'after'])
  })

  it('executes against state written since the previous read', async () => {
    const { state, memoChain } = chainWithMemoizedAccount()
    const op = new ReadingOperation()
    await op.execute(memoChain, { value: 'x', wallet })
    state.data = 'after'
    await op.execute(memoChain, { value: 'x', wallet })
    assert.deepEqual(op.seen, ['before', 'after'])
  })

  it('queries state written since the previous read', async () => {
    const { state, memoChain } = chainWithMemoizedAccount()
    const query = new ReadingQuery()
    assert.equal(await query.query(memoChain, {}), 'before')
    state.data = 'after'
    assert.equal(await query.query(memoChain, {}), 'after')
  })
})
