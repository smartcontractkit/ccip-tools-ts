/**
 * EVMChain caches the `blockTimestamp` that RPCs add to raw logs, to save a getBlock roundtrip.
 * Some RPCs (e.g. Robinhood Chain testnet in eth_getLogs) send it as a `0x0` placeholder: it must
 * not date the block to 1970, or getLogs' `startTime` filter drops the block's logs, and an
 * execution receipt search (`show --no-api`) finds nothing.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type JsonRpcPayload,
  type JsonRpcResult,
  JsonRpcProvider,
  Network,
  toQuantity,
} from 'ethers'

import { networkInfo } from '../index.ts'
import { EVMChain } from './index.ts'

const NETWORK = networkInfo('ethereum-testnet-sepolia')
const ADDRESS = '0x7D6Be73c582Cf0B83ac43aeaD910088819B9CA11'
const TOPIC = '0x8c324ce1367b83031769f6a813e3bb4c117aba2185789d66b98b791405be6df2'
const HEAD = 1_000
const LOG_BLOCK = 950
const BLOCK_TIME = 1_794_312_789
/** Block timestamps: `BLOCK_TIME` at `LOG_BLOCK`, one second per block. */
const timestampOf = (block: number) => BLOCK_TIME + (block - LOG_BLOCK)

/** A JsonRpcProvider that answers from memory, with `logTimestamp` as each log's `blockTimestamp`. */
class StubProvider extends JsonRpcProvider {
  readonly calls: { method: string; params: unknown[] }[] = []
  readonly logTimestamp: string | undefined
  constructor(logTimestamp: string | undefined) {
    super('http://stub.invalid', Network.from(Number(NETWORK.chainId)), {
      staticNetwork: true,
      batchMaxCount: 1,
    })
    this.logTimestamp = logTimestamp
  }
  override _send(payload: JsonRpcPayload | JsonRpcPayload[]): Promise<JsonRpcResult[]> {
    const { id, method, params } = [payload].flat()[0]!
    this.calls.push({ method, params: params as unknown[] })
    return Promise.resolve([{ id, result: this.answer(method, params as unknown[]) }])
  }
  private answer(method: string, params: unknown[]): unknown {
    switch (method) {
      case 'eth_chainId':
        return toQuantity(NETWORK.chainId)
      case 'eth_blockNumber':
        return toQuantity(HEAD)
      case 'eth_getBlockByNumber': {
        const tag = params[0] as string
        const number = tag.startsWith('0x') ? Number(tag) : HEAD
        return {
          hash: '0x' + number.toString(16).padStart(64, '0'),
          parentHash: '0x' + (number - 1).toString(16).padStart(64, '0'),
          number: toQuantity(number),
          timestamp: toQuantity(timestampOf(number)),
          nonce: '0x0000000000000000',
          difficulty: '0x0',
          gasLimit: '0x1c9c380',
          gasUsed: '0x0',
          miner: '0x0000000000000000000000000000000000000000',
          extraData: '0x',
          baseFeePerGas: '0x1',
          transactions: [],
        }
      }
      case 'eth_getLogs': {
        const { fromBlock, toBlock } = params[0] as { fromBlock: string; toBlock: string }
        const to = toBlock.startsWith('0x') ? Number(toBlock) : HEAD
        if (LOG_BLOCK < Number(fromBlock) || LOG_BLOCK > to) return []
        return [
          {
            address: ADDRESS.toLowerCase(),
            topics: [TOPIC],
            data: '0x',
            blockNumber: toQuantity(LOG_BLOCK),
            blockHash: '0x' + LOG_BLOCK.toString(16).padStart(64, '0'),
            transactionHash: '0x' + 'ab'.repeat(32),
            transactionIndex: '0x0',
            logIndex: '0x0',
            removed: false,
            ...(this.logTimestamp !== undefined && { blockTimestamp: this.logTimestamp }),
          },
        ]
      }
      default:
        throw new Error(`unexpected ${method}`)
    }
  }
}

async function collectLogs(provider: StubProvider, startTime: number) {
  const chain = new EVMChain(provider, NETWORK)
  const logs = []
  for await (const log of chain.getLogs({ address: ADDRESS, topics: [TOPIC], startTime }))
    logs.push(log)
  provider.destroy()
  return logs
}

const blockReads = (provider: StubProvider, block: number) =>
  provider.calls.filter(
    (c) => c.method === 'eth_getBlockByNumber' && c.params[0] === toQuantity(block),
  ).length

describe('EVMChain log blockTimestamp cache', () => {
  it('reads the block when a log carries a 0x0 blockTimestamp placeholder', async () => {
    const provider = new StubProvider('0x0')
    // a start time just before the log's block: the log must pass the startTime filter
    const logs = await collectLogs(provider, BLOCK_TIME - 5)
    assert.equal(logs.length, 1)
    assert.equal(logs[0]!.blockTimestamp, BLOCK_TIME)
    assert.equal(blockReads(provider, LOG_BLOCK), 1)
  })

  it("uses a log's positive blockTimestamp without reading the block", async () => {
    const provider = new StubProvider(toQuantity(BLOCK_TIME))
    const logs = await collectLogs(provider, BLOCK_TIME - 5)
    assert.equal(logs.length, 1)
    assert.equal(logs[0]!.blockTimestamp, BLOCK_TIME)
    assert.equal(blockReads(provider, LOG_BLOCK), 0)
  })

  it('reads the block when a log has no blockTimestamp', async () => {
    const provider = new StubProvider(undefined)
    const logs = await collectLogs(provider, BLOCK_TIME - 5)
    assert.equal(logs.length, 1)
    assert.equal(logs[0]!.blockTimestamp, BLOCK_TIME)
    assert.equal(blockReads(provider, LOG_BLOCK), 1)
  })
})
