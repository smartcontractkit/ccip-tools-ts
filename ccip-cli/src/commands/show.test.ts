import assert from 'node:assert/strict'
import { it } from 'node:test'

import {
  type CCIPExecution,
  type CCIPRequest,
  type CCIPVerifications,
  type Chain,
  type ChainGetter,
  type OffchainTokenData,
  ExecutionState,
  jsonParse,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'

import { showRequests } from './show.ts'
import { type Ctx, Format } from './types.ts'

const sourceNetwork = networkInfo('solana-devnet')
const destNetwork = networkInfo('ethereum-testnet-sepolia')
const sender = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const offRamp = '0x' + 'ab'.repeat(20)
const txHash = '0x' + '22'.repeat(32)
const messageId = '0x' + '42'.repeat(32)
const request = {
  lane: {
    sourceChainSelector: sourceNetwork.chainSelector,
    destChainSelector: destNetwork.chainSelector,
    onRamp: sender,
    version: '1.6.0',
  },
  message: {
    messageId,
    sourceChainSelector: sourceNetwork.chainSelector,
    sender,
    receiver: offRamp,
    data: '0x',
    tokenAmounts: [],
    feeToken: '',
    feeTokenAmount: 0n,
  },
  log: { address: sender, transactionHash: 'solana-tx', index: 0, blockTimestamp: 1_700_000_000 },
  tx: { hash: 'solana-tx', from: sender },
  metadata: { offRamp },
} as unknown as CCIPRequest
const execution = (state: ExecutionState = ExecutionState.Success) =>
  ({
    receipt: { messageId, state },
    log: { address: offRamp, transactionHash: txHash, index: 1, blockTimestamp: 1_700_000_010 },
  }) as CCIPExecution
const commit = {
  report: { merkleRoot: txHash, minSeqNr: 1n, maxSeqNr: 1n },
  log: { address: offRamp, transactionHash: txHash, blockNumber: 1, tx: { from: offRamp } },
} as CCIPVerifications
const attestations: OffchainTokenData[] = [{ _tag: 'usdc', attestation: '0xab' }]
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function fixture(
  config: {
    state?: ExecutionState
    empty?: boolean
    commit?: CCIPVerifications
    attestations?: OffchainTokenData[]
    block?: Promise<number>
  } = {},
) {
  const finality = Promise.withResolvers<unknown>()
  const attestation = Promise.withResolvers<OffchainTokenData[]>()
  const verification = Promise.withResolvers<CCIPVerifications>()
  const exec = Promise.withResolvers<void>()
  const signals: AbortSignal[] = []
  const calls: string[] = []
  const writes: unknown[][] = [],
    infos: unknown[][] = [],
    warnings: unknown[][] = []
  const tables: Record<string, unknown>[] = []
  const ctx: Ctx = {
    abort: new AbortController().signal,
    output: {
      write: (...args) => {
        writes.push(args)
      },
      table: (data) => {
        tables.push(data as Record<string, unknown>)
      },
    },
    logger: {
      debug() {},
      error() {},
      info: (...args) => {
        infos.push(args)
      },
      warn: (...args) => {
        warnings.push(args)
      },
    },
  }
  const take = (signal?: boolean | AbortSignal) => {
    if (signal instanceof AbortSignal) signals.push(signal)
  }
  let receipts!: Parameters<Chain['getExecutionReceipts']>[0]
  const source = {
    network: sourceNetwork,
    waitFinalized: async ({ abort }: Parameters<Chain['waitFinalized']>[0]) => {
      calls.push('finalized')
      take(abort)
      return finality.promise
    },
    getOffchainTokenData: async (
      _request: unknown,
      opts?: Parameters<Chain['getOffchainTokenData']>[1],
    ) => {
      take(opts?.watch)
      return config.attestations ?? attestation.promise
    },
  }
  const dest = {
    network: destNetwork,
    getVerifications: async ({ watch }: Parameters<Chain['getVerifications']>[0]) => {
      calls.push('verifications')
      take(watch)
      return config.commit ?? verification.promise
    },
    getExecutionReceipts: async function* (opts: typeof receipts) {
      calls.push('receipts')
      take(opts.watch)
      receipts = opts
      if (config.empty) return
      await exec.promise
      yield execution(config.state)
    },
    getBlockTimestamp: async () => config.block ?? 1_700_000_005,
  }
  const getChain: ChainGetter = async (id) =>
    (id === sourceNetwork.chainSelector ? source : dest) as unknown as Chain
  const run = (argv: Partial<Parameters<typeof showRequests>[1]>) =>
    showRequests(ctx, { format: Format.log, ...argv } as Parameters<typeof showRequests>[1], {
      request,
      getChain,
    })
  return {
    finality,
    attestation,
    verification,
    exec,
    signals,
    calls,
    writes,
    tables,
    infos,
    warnings,
    run,
    get receipts() {
      return receipts
    },
  }
}
const indexOf = (writes: unknown[][], name: string) => writes.findIndex(([first]) => first === name)

for (const state of [ExecutionState.Success, ExecutionState.Failed]) {
  it(
    `wait: prints first execution (${state}) and cancels unfinished waits`,
    { timeout: 1000 },
    async () => {
      const f = fixture({ state })
      const show = f.run({ wait: true })
      if (state === ExecutionState.Success) f.attestation.resolve(attestations)
      await flush()
      assert.equal(indexOf(f.writes, 'attestations =') >= 0, state === ExecutionState.Success)
      f.exec.resolve()
      await show
      assert.ok(indexOf(f.writes, 'receipt =') >= 0)
      assert.ok(
        f.infos.some(([line]) =>
          String(line).startsWith(state === ExecutionState.Success ? '[SUCCESS]' : '[FAILED]'),
        ),
      )
      assert.equal(f.signals.length, 4)
      assert.ok(f.signals.every((signal) => signal.aborted))
      const count = f.writes.length
      f.attestation.resolve(attestations)
      f.finality.resolve({})
      f.verification.reject(new Error('late'))
      await flush()
      assert.equal(f.writes.length, count)
      assert.deepEqual(f.warnings, [])
    },
  )
}

it('wait: cleans up when no execution is found', async () => {
  const f = fixture({ empty: true })
  await f.run({ wait: true })
  assert.equal(indexOf(f.writes, 'receipt ='), -1)
  assert.deepEqual(f.warnings, [['No execution receipt found for request']])
  assert.equal(f.signals.length, 4)
  assert.ok(f.signals.every((signal) => signal.aborted))
})

it('json: preserves completed commit without waiting for attestation', async () => {
  const f = fixture({ commit })
  const show = f.run({ wait: true, format: Format.json })
  await flush()
  f.exec.resolve()
  await show
  assert.equal(f.writes.length, 1)
  const doc = jsonParse(f.writes[0]![0] as string) as {
    request: CCIPRequest
    verifications: CCIPVerifications
    receipts: unknown[]
    attestations?: unknown
  }
  assert.equal(doc.request.message.messageId, messageId)
  assert.deepEqual(doc.verifications, commit)
  assert.equal(doc.receipts.length, 1)
  assert.equal(doc.attestations, undefined)
  f.attestation.resolve(attestations)
  await flush()
  assert.equal(f.writes.length, 1)
  assert.deepEqual(f.warnings, [])
})

it('pretty: prints receipt without origin lookup and suppresses late verification tables', async () => {
  const block = Promise.withResolvers<number>()
  const f = fixture({ block: block.promise })
  const show = f.run({ wait: true, format: Format.pretty })
  f.verification.resolve(commit)
  await flush()
  f.exec.resolve()
  await show
  assert.ok(f.tables.some((table) => table.state === '✅ success'))
  const counts = [f.tables.length, f.writes.length, f.infos.length]
  block.resolve(1_700_000_005)
  await flush()
  assert.deepEqual([f.tables.length, f.writes.length, f.infos.length], counts)
  assert.ok(f.tables.every((table) => !('merkleRoot' in table)))
  assert.ok(f.infos.every(([line]) => !String(line).startsWith('[BLESSED]')))
  assert.deepEqual(f.warnings, [])
})

it('non-wait: preserves one-shot attestation, commit order, and receipt scan hint', async () => {
  const f = fixture({ attestations, commit })
  f.exec.resolve()
  await f.run({})
  assert.deepEqual(f.calls, ['verifications', 'receipts'])
  assert.equal(f.signals.length, 0)
  assert.equal(f.receipts.verifications, commit)
  const names = ['attestations =', 'Commit (dest):', 'commit =', 'Receipts (dest):', 'receipt =']
  const indices = names.map((name) => indexOf(f.writes, name))
  assert.ok(indices.every((index, n) => index >= 0 && (n === 0 || index > indices[n - 1]!)))
  assert.deepEqual(f.warnings, [])
})
