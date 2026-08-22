import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { Connection } from '@solana/web3.js'
import type { TonClient } from '@ton/ton'
import type { JsonRpcApiProvider } from 'ethers'

import { streamAptosLogs } from './aptos/logs.ts'
import { withSinceStart } from './chain.ts'
import { getEvmLogs } from './evm/logs.ts'
import { getTransactionsForAddress } from './solana/logs.ts'
import { streamSuiLogs } from './sui/events.ts'
import { streamTransactionsForAddress } from './ton/logs.ts'

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

async function consume(iterable: AsyncIterable<unknown>) {
  for await (const _ of iterable) {
    // drain
  }
}

describe('logs start position validation', () => {
  it('requires startBlock or startTime for EVM logs', async () => {
    await assert.rejects(
      () =>
        consume(
          getEvmLogs(
            {},
            {
              provider: {} as JsonRpcApiProvider,
              getBlockInfo: async () => ({
                number: 1000,
                timestamp: Math.floor(Date.now() / 1000),
              }),
            },
          ),
        ),
      {
        name: 'CCIPLogsRequiresStartError',
      },
    )
  })

  it('requires startBlock or startTime for Solana logs', async () => {
    await assert.rejects(
      () =>
        consume(
          getTransactionsForAddress(
            { address: '11111111111111111111111111111111' },
            {
              connection: {} as Connection,
              getTransaction: mock.fn(),
            },
          ),
        ),
      { name: 'CCIPLogsRequiresStartError' },
    )
  })

  it('requires a sinceLt cursor for TON logs', async () => {
    await assert.rejects(
      () =>
        consume(
          streamTransactionsForAddress(
            // sinceLt is required by type (callers resolve startBlock/startTime/since
            // into lt first); the runtime guard covers untyped callers
            { address: `0:${'1'.repeat(64)}` } as never,
            {
              provider: {} as TonClient,
              getTransaction: mock.fn(),
            },
          ),
        ),
      { name: 'CCIPLogsRequiresStartError' },
    )
  })

  it('requires startBlock or startTime for Aptos logs', async () => {
    await assert.rejects(
      () =>
        consume(
          streamAptosLogs({ provider: {} as Aptos }, { address: '0x1::ccip', topics: ['Foo'] }),
        ),
      { name: 'CCIPLogsRequiresStartError' },
    )
  })

  it('requires startBlock or startTime for Sui logs', async () => {
    await assert.rejects(
      () =>
        consume(
          streamSuiLogs(
            { client: {} as SuiJsonRpcClient },
            { address: '0x1::ccip', topics: ['Foo'] },
          ),
        ),
      { name: 'CCIPLogsRequiresStartError' },
    )
  })
})

describe('withSinceStart', () => {
  it('merges since floors with requested starts, largest of each', () => {
    assert.deepEqual(withSinceStart({}), {})
    assert.deepEqual(withSinceStart({ startBlock: 5 }), { startBlock: 5 })
    assert.deepEqual(withSinceStart({ since: { blockNumber: 10 } }), {
      startBlock: 10,
      since: { blockNumber: 10 },
    })
    assert.deepEqual(withSinceStart({ startBlock: 20, since: { blockNumber: 10 } }), {
      startBlock: 20,
      since: { blockNumber: 10 },
    })
    assert.deepEqual(withSinceStart({ startBlock: 5, since: { blockNumber: 10 } }), {
      startBlock: 10,
      since: { blockNumber: 10 },
    })
    assert.deepEqual(withSinceStart({ startTime: 300, since: { blockTimestamp: 200 } }), {
      startTime: 300,
      since: { blockTimestamp: 200 },
    })
    assert.deepEqual(withSinceStart({ startTime: 100, since: { blockTimestamp: 200 } }), {
      startTime: 200,
      since: { blockTimestamp: 200 },
    })
    // both channels merge independently
    assert.deepEqual(
      withSinceStart({ startBlock: 5, since: { blockNumber: 10, blockTimestamp: 200 } }),
      { startBlock: 10, startTime: 200, since: { blockNumber: 10, blockTimestamp: 200 } },
    )
  })

  it('ignores non-finite or non-positive hint floors', () => {
    assert.deepEqual(withSinceStart({ since: {} }), { since: {} })
    assert.deepEqual(withSinceStart({ since: { blockNumber: 0 } }), { since: { blockNumber: 0 } })
    assert.deepEqual(withSinceStart({ since: { blockNumber: Number.NaN } }), {
      since: { blockNumber: Number.NaN },
    })
    assert.deepEqual(withSinceStart({ since: { blockTimestamp: -5 } }), {
      since: { blockTimestamp: -5 },
    })
  })
})

describe('EVM logs block tags', () => {
  it('accepts safe as an endBlock tag', async () => {
    const getBlock = mock.fn(async (_block: unknown) => ({ number: 123, timestamp: 1000 }))
    const getLogs = mock.fn(async (_filter: { toBlock?: number }) => [])
    const provider = { getBlock, getLogs } as unknown as JsonRpcApiProvider

    await consume(
      getEvmLogs(
        { startBlock: 100, endBlock: 'safe' },
        {
          provider,
          logger: silentLogger,
          getBlockInfo: (block) => getBlock(block),
        },
      ),
    )

    // The tag is resolved once to a number (for chunking)…
    assert.equal(getBlock.mock.calls[0]!.arguments[0], 'safe')
    // …but the terminal chunk is fetched against the tag itself, not the number,
    // so a lagging RPC resolves the head rather than rejecting a future toBlock.
    assert.equal(getLogs.mock.calls[0]!.arguments[0].toBlock, 'safe')
  })
})
