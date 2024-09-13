/* eslint-disable @typescript-eslint/restrict-template-expressions,@typescript-eslint/no-base-to-string */
import { readFile } from 'node:fs/promises'

import { select } from '@inquirer/prompts'
import { parseAbi } from 'abitype'
import type { Addressable, TransactionReceipt } from 'ethers'
import {
  BaseWallet,
  Contract,
  formatUnits,
  hexlify,
  JsonRpcProvider,
  type Provider,
  SigningKey,
  WebSocketProvider,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'
import util from 'util'

import type { CCIPCommit, CCIPExecution, Lane } from './lib/index.js'
import {
  type CCIPRequest,
  type CCIPRequestWithLane,
  chainIdFromSelector,
  chainNameFromId,
  chainNameFromSelector,
  getOnRampStaticConfig,
  getProviderNetwork,
  lazyCached,
  networkInfo,
} from './lib/index.js'

util.inspect.defaultOptions.depth = 4 // print down to tokenAmounts in requests
const RPCS_RE = /\b(http|ws)s?:\/\/\S+/

export async function loadRpcProviders({
  rpcs: rpcsArray,
  'rpcs-file': rpcsPath,
}: {
  rpcs?: string[]
  'rpcs-file'?: string
}): Promise<Record<number, Provider>> {
  const rpcs = new Set<string>(rpcsArray)
  for (const [env, val] of Object.entries(process.env)) {
    if (!env.startsWith('RPC_') || !val || !RPCS_RE.test(val)) continue
    rpcs.add(val)
  }
  if (rpcsPath) {
    try {
      const rpcsFile = await readFile(rpcsPath, 'utf8')
      for (const line of rpcsFile.toString().split(/(?:\r\n|\r|\n)/g)) {
        const match = line.match(RPCS_RE)
        if (!match) continue
        rpcs.add(match[0])
      }
    } catch (_) {
      // ignore if path doesn't exist or can't be read
    }
  }

  const results: Record<number, Provider> = {}
  const promises: Promise<unknown>[] = []
  for (const endpoint of rpcs) {
    const promise = (async () => {
      let provider: Provider
      if (endpoint.startsWith('ws')) {
        provider = await new Promise((resolve, reject) => {
          const provider = new WebSocketProvider(endpoint)
          provider.websocket.onerror = reject
          provider
            ._waitUntilReady()
            .then(() => resolve(provider))
            .catch(reject)
        })
      } else if (endpoint.startsWith('http')) {
        provider = new JsonRpcProvider(endpoint)
      } else {
        throw new Error(
          `Unknown JSON RPC protocol in endpoint (should be wss?:// or https?://): ${endpoint}`,
        )
      }

      try {
        const { chainId } = await getProviderNetwork(provider)
        if (results[chainId] != null) throw new Error('Already raced')
        results[chainId] = provider
      } catch (_) {
        provider.destroy()
      }
    })()
    promises.push(
      promise.catch(
        () => null, // ignore errors
      ),
    )
  }
  await Promise.all(promises)
  return results
}

export async function getTxInAnyProvider(
  providers: Record<number, Provider>,
  txHash: string,
): Promise<TransactionReceipt> {
  return Promise.any(
    Object.values(providers).map((provider) =>
      provider.getTransactionReceipt(txHash).then((receipt) => {
        if (!receipt) {
          throw new Error(`Transaction not found: ${txHash}`)
        } else {
          return receipt
        }
      }),
    ),
  )
}

export function getWallet(): BaseWallet {
  const keyFromEnv = process.env['USER_KEY']
  if (keyFromEnv) {
    return new BaseWallet(
      new SigningKey(hexlify((keyFromEnv.startsWith('0x') ? '' : '0x') + keyFromEnv)),
    )
  }
  throw new Error('Could not get wallet; please, set USER_KEY envvar as a hex-encoded private key')
}

export async function selectRequest<R extends CCIPRequest | CCIPRequestWithLane>(
  requests: R[],
  promptSuffix?: string,
): Promise<R> {
  if (requests.length === 1) return requests[0]
  const answer = await select({
    message: `${requests.length} messageIds found; select one${promptSuffix ? ' ' + promptSuffix : ''}`,
    choices: [
      ...requests.map((req, i) => ({
        value: i,
        name: `${req.log.index} => ${req.message.messageId}`,
        description:
          `sender =\t\t${req.message.sender}
receiver =\t\t${req.message.receiver}
gasLimit =\t\t${req.message.gasLimit}
tokenTransfers =\t[${req.message.tokenAmounts.map(({ token }) => token).join(',')}]` +
          ('lane' in req
            ? `\ndestination =\t\t${chainNameFromId(chainIdFromSelector(req.lane.destChainSelector))} [${chainIdFromSelector(req.lane.destChainSelector)}]`
            : ''),
      })),
      {
        value: -1,
        name: 'Exit',
        description: 'Quit the application',
      },
    ],
  })
  if (answer < 0) throw new Error('User requested exit')
  return requests[answer]
}

export function withDateTimestamp<T extends { readonly timestamp: number }>(
  obj: T,
): Omit<T, 'timestamp'> & { timestamp: Date } {
  return { ...obj, timestamp: new Date(obj.timestamp * 1e3) }
}

export async function withLanes(
  source: Provider,
  requests: CCIPRequest[],
): Promise<CCIPRequestWithLane[]> {
  const requestsWithLane: CCIPRequestWithLane[] = []
  const cache = new Map<string, unknown>()
  for (const request of requests) {
    const lane = await lazyCached(
      request.log.address,
      async () => {
        const [staticConfig] = await getOnRampStaticConfig(source, request.log.address)
        return {
          sourceChainSelector: staticConfig.chainSelector,
          destChainSelector: staticConfig.destChainSelector,
          onRamp: request.log.address,
        }
      },
      cache,
    )

    const requestWithLane: CCIPRequestWithLane = {
      ...request,
      lane,
    }
    requestsWithLane.push(requestWithLane)
  }
  return requestsWithLane
}

export function prettyLane(lane: Lane, version: string) {
  console.info('Lane:')
  const source = networkInfo(lane.sourceChainSelector),
    dest = networkInfo(lane.destChainSelector)
  console.table({
    name: { source: source.name, dest: dest.name },
    chainId: { source: source.chainId, dest: dest.chainId },
    chainSelector: { source: source.chainSelector, dest: dest.chainSelector },
    'onRamp/version': { source: lane.onRamp, dest: version },
  })
}

const TokenABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
])

async function formatToken(
  provider: Provider,
  { token, amount }: { token: string | Addressable; amount: bigint },
): Promise<string> {
  const [decimals_, symbol] = await lazyCached(`token ${token}`, async () => {
    const contract = new Contract(token, TokenABI, provider) as unknown as TypedContract<
      typeof TokenABI
    >
    return Promise.all([contract.decimals(), contract.symbol()] as const)
  })
  const decimals = Number(decimals_)
  return `${formatUnits(amount, decimals)} ${symbol}`
}

function formatArray<T>(name: string, values: readonly T[]): Record<string, T> {
  if (values.length <= 1) return { [name]: values[0] }
  return Object.fromEntries(values.map((v, i) => [`${name}[${i}]`, v] as const))
}

function formatData(name: string, data: string): Record<string, string> {
  const split = []
  if (data.length <= 66) split.push(data)
  else
    for (let i = data.length; i > 2; i -= 64) {
      split.unshift(data.substring(Math.max(i - 64, 0), i))
    }
  return formatArray(name, split)
}

function formatDate(timestamp: number) {
  return new Date(timestamp * 1e3).toISOString().substring(0, 19).replace('T', ' ')
}

function formatDuration(secs: number) {
  if (secs < 0) secs = -secs
  const time = {
    d: Math.floor(secs / 86400),
    h: Math.floor(secs / 3600) % 24,
    m: Math.floor(secs / 60) % 60,
    s: Math.floor(secs) % 60,
  }
  return Object.entries(time)
    .filter((val) => val[1] !== 0)
    .map(([key, val]) => `${val}${key}${key === 'd' ? ' ' : ''}`)
    .join('')
}

export async function prettyRequest<R extends CCIPRequest | CCIPRequestWithLane>(
  source: Provider,
  request: R,
) {
  if ('lane' in request) {
    prettyLane(request.lane, request.version)
  }
  console.info('Request:')

  const finalized = await source.getBlock('finalized')
  console.table({
    messageId: request.message.messageId,
    sender: request.message.sender,
    receiver: request.message.receiver,
    sequenceNumber: Number(request.message.sequenceNumber),
    nonce: Number(request.message.nonce),
    gasLimit: Number(request.message.gasLimit),
    strict: request.message.strict,
    transactionHash: request.log.transactionHash,
    logIndex: request.log.index,
    blockNumber: request.log.blockNumber,
    timestamp: formatDate(request.timestamp),
    finalized:
      finalized &&
      (finalized.timestamp < request.timestamp
        ? formatDuration(request.timestamp - finalized.timestamp) + ' left'
        : true),
    fee: await formatToken(source, {
      token: request.message.feeToken,
      amount: request.message.feeTokenAmount,
    }),
    ...formatArray(
      'tokens',
      await Promise.all(request.message.tokenAmounts.map(formatToken.bind(null, source))),
    ),
    ...formatData('data', request.message.data),
  })
}

export async function prettyCommit(
  dest: Provider,
  commit: CCIPCommit,
  request: { timestamp: number },
) {
  console.info('Commit:')
  const timestamp = (await dest.getBlock(commit.log.blockNumber))!.timestamp
  console.table({
    merkleRoot: commit.report.merkleRoot,
    'interval.min': Number(commit.report.interval.min),
    'interval.max': Number(commit.report.interval.max),
    ...Object.fromEntries(
      commit.report.priceUpdates.tokenPriceUpdates.map(
        ({ sourceToken, usdPerToken }) =>
          [`tokenPrice[${sourceToken}]`, `${formatUnits(usdPerToken)} USD`] as const,
      ),
    ),
    ...Object.fromEntries(
      commit.report.priceUpdates.gasPriceUpdates.map(({ destChainSelector, usdPerUnitGas }) => {
        const execLayerGas = usdPerUnitGas % (1n << 112n)
        const daLayerGas = usdPerUnitGas / (1n << 112n)
        return [
          `gasPrice[${chainNameFromSelector(destChainSelector)}]`,
          `${formatUnits(execLayerGas)}` +
            (daLayerGas > 0 ? ` (DA: ${formatUnits(daLayerGas)})` : ''),
        ] as const
      }),
    ),
    transactionHash: commit.log.transactionHash,
    blockNumber: commit.log.blockNumber,
    timestamp: `${formatDate(timestamp)} (${formatDuration(timestamp - request.timestamp)} after request)`,
  })
}

export function prettyReceipt(receipt: CCIPExecution, request: { timestamp: number }) {
  console.table({
    state: receipt.receipt.state === 2n ? '✅ success' : '❌ failed',
    ...formatData('returnData', receipt.receipt.returnData),
    transactionHash: receipt.log.transactionHash,
    logIndex: receipt.log.index,
    blockNumber: receipt.log.blockNumber,
    timestamp: `${formatDate(receipt.timestamp)} (${formatDuration(receipt.timestamp - request.timestamp)} after request)`,
  })
}
