import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

import type { Aptos } from '@aptos-labs/ts-sdk'
import type { SuiGraphQLClient } from '@mysten/sui/graphql'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { Connection } from '@solana/web3.js'
import type { TonClient } from '@ton/ton'
import type { JsonRpcApiProvider } from 'ethers'

import { streamAptosLogs } from './aptos/logs.ts'
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
    await assert.rejects(() => consume(getEvmLogs({}, { provider: {} as JsonRpcApiProvider })), {
      name: 'CCIPLogsRequiresStartError',
    })
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

  it('requires startBlock or startTime for TON logs', async () => {
    await assert.rejects(
      () =>
        consume(
          streamTransactionsForAddress(
            { address: `0:${'1'.repeat(64)}` },
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
            { client: {} as SuiJsonRpcClient, graphqlClient: {} as SuiGraphQLClient },
            { address: '0x1::ccip', topics: ['Foo'] },
          ),
        ),
      { name: 'CCIPLogsRequiresStartError' },
    )
  })
})

describe('EVM logs block tags', () => {
  it('accepts safe as an endBlock tag', async () => {
    const getBlock = mock.fn(async (_block: unknown) => ({ number: 123, timestamp: 1000 }))
    const getLogs = mock.fn(async (_filter: { toBlock?: number }) => [])
    const provider = { getBlock, getLogs } as unknown as JsonRpcApiProvider

    await consume(
      getEvmLogs({ startBlock: 100, endBlock: 'safe' }, { provider, logger: silentLogger }),
    )

    assert.equal(getBlock.mock.calls[0]!.arguments[0], 'safe')
    assert.equal(getLogs.mock.calls[0]!.arguments[0].toBlock, 123)
  })
})
