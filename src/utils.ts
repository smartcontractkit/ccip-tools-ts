/* eslint-disable @typescript-eslint/restrict-template-expressions,@typescript-eslint/no-base-to-string */
import { readFile } from 'node:fs/promises'

import { password, select } from '@inquirer/prompts'
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
  Wallet,
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

function withTimeout<T>(promise: Promise<T>, ms: number, message = 'Timeout'): Promise<T> {
  return Promise.race([
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
    promise,
  ])
}

/**
 * Load providers from a list of RPC endpoints
 *
 * This class manages concurrent access to providers, racing them as soon as they are created for
 * the `getTxReceipt` method, or managing a singleton promise requested with `forChainId` method,
 * resolved to the first RPC responding for that chainId, even before the chainIds of all
 * providers are known.
 * It also ensures that all providers are destroyed when the instance is destroyed.
 *
 * @param argv - Object with either `rpcs` or `rpcs-file` property
 * @returns instance of Providers manager class
 * @throws Error if no providers are found
 **/
export class Providers {
  #endpoints: Promise<Set<string>>
  #providersList?: Promise<Provider[]>
  #providersPromises: Record<number, Promise<Provider>> = {}
  #promisesCallbacks: Record<
    number,
    readonly [resolve: (provider: Provider) => void, reject: (reason: unknown) => void]
  > = {}
  #destroy!: (v: unknown) => void
  destroyed: Promise<unknown> = new Promise((resolve) => {
    this.#destroy = resolve
  })

  constructor(argv: { rpcs: string[] } | { 'rpcs-file': string }) {
    if ('rpcs' in argv) {
      this.#endpoints = Promise.resolve(
        new Set([
          ...argv.rpcs,
          ...Object.entries(process.env)
            .filter(([env, val]) => env.startsWith('RPC_') && val && RPCS_RE.test(val))
            .map(([, val]) => val!),
        ]),
      )
    } else {
      this.#endpoints = readFile(argv['rpcs-file'], 'utf8').then((file) => {
        const rpcs = new Set<string>()
        for (const line of file.toString().split(/(?:\r\n|\r|\n)/g)) {
          const match = line.match(RPCS_RE)
          if (match) rpcs.add(match[0])
        }
        for (const [env, val] of Object.entries(process.env)) {
          if (env.startsWith('RPC_') && val && RPCS_RE.test(val)) rpcs.add(val)
        }
        return rpcs
      })
    }
  }

  destroy() {
    this.#destroy(null)
  }

  /**
   * Trigger fetching providers from RPC endpoints, with their networks in parallel
   **/
  #loadProviders(): Promise<Provider[]> {
    if (this.#providersList) return this.#providersList

    const readyPromises: Promise<unknown>[] = []
    return (this.#providersList = this.#endpoints
      .then((rpcs) =>
        [...rpcs].map((url) => {
          let provider: Provider
          let providerReady: Promise<Provider>
          if (url.startsWith('ws')) {
            const provider_ = new WebSocketProvider(url)
            providerReady = new Promise((resolve, reject) => {
              provider_.websocket.onerror = reject
              provider_
                ._waitUntilReady()
                .then(() => resolve(provider_))
                .catch(reject)
            })
            provider = provider_
          } else if (url.startsWith('http')) {
            provider = new JsonRpcProvider(url)
            providerReady = Promise.resolve(provider)
          } else {
            throw new Error(
              `Unknown JSON RPC protocol in endpoint (should be wss?:// or https?://): ${url}`,
            )
          }

          void this.destroyed.then(() => provider.destroy()) // schedule cleanup
          readyPromises.push(
            // wait for connection and check network in background
            withTimeout(
              providerReady.then((provider) => getProviderNetwork(provider)),
              15e3,
            )
              .then(({ chainId }) => {
                if (chainId in this.#promisesCallbacks) {
                  const [resolve] = this.#promisesCallbacks[chainId]
                  delete this.#promisesCallbacks[chainId]
                  resolve(provider)
                } else if (!(chainId in this.#providersPromises)) {
                  this.#providersPromises[chainId] = Promise.resolve(provider)
                } else {
                  throw new Error(`Raced by a faster provider`)
                }
              })
              .catch((_reason) => {
                // destroy earlier if provider failed to connect, or if raced
                provider.destroy()
              }),
          )
          return provider
        }),
      )
      .finally(() => {
        void Promise.allSettled(readyPromises).then(() => {
          for (const [chainId, [, reject]] of Object.entries(this.#promisesCallbacks)) {
            // if `forChainId` in the meantime requested a provider that was not found, reject it
            reject(
              new Error(
                `Could not find provider for chain "${chainNameFromId(+chainId)}" [${chainId}]`,
              ),
            )
            delete this.#promisesCallbacks[+chainId]
          }
        })
      }))
  }

  /**
   * Ask for a provider for a given chainId, or wait for it to be available
   * @param chainId - chainId to get a provider for
   * @returns Promise for a provider for the given chainId
   **/
  async forChainId(chainId: number): Promise<Provider> {
    if (chainId in this.#providersPromises) return this.#providersPromises[chainId]
    if (!(chainId in this.#promisesCallbacks)) {
      this.#providersPromises[chainId] = new Promise((resolve, reject) => {
        this.#promisesCallbacks[chainId] = [resolve, reject]
      })
      void this.#loadProviders()
    }
    return this.#providersPromises[chainId]
  }

  /**
   * Get transaction receipt from any of the providers;
   * Races them even before network is known, returning first to respond.
   * Continues populating the list of providers in the background after resolved.
   * @param txHash - transaction hash to get receipt for
   * @returns Promise for the transaction receipt, with provider in TransactionReceipt.provider
   **/
  async getTxReceipt(txHash: string): Promise<TransactionReceipt> {
    return this.#loadProviders().then((providers) =>
      Promise.any(
        providers.map((provider) =>
          withTimeout(provider.getTransactionReceipt(txHash), 15e3).then((receipt) => {
            if (!receipt) throw new Error(`Transaction not found: ${txHash}`)
            return receipt
          }),
        ),
      ),
    )
  }
}

export async function getWallet(argv?: { wallet?: string }): Promise<BaseWallet> {
  if (argv?.wallet) {
    let pw = process.env['USER_KEY_PASSWORD']
    if (!pw) pw = await password({ message: 'Enter password for json wallet' })
    return Wallet.fromEncryptedJson(await readFile(argv.wallet, 'utf8'), pw)
  }
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

export const TokenABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
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

  let finalized
  try {
    finalized = await source.getBlock('finalized')
  } catch (_) {
    // no finalized tag support
  }
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
    commitStore: commit.log.address,
    transactionHash: commit.log.transactionHash,
    blockNumber: commit.log.blockNumber,
    timestamp: `${formatDate(timestamp)} (${formatDuration(timestamp - request.timestamp)} after request)`,
  })
}

export function prettyReceipt(receipt: CCIPExecution, request: { timestamp: number }) {
  console.table({
    state: receipt.receipt.state === 2n ? '✅ success' : '❌ failed',
    ...formatData('returnData', receipt.receipt.returnData),
    offRamp: receipt.log.address,
    transactionHash: receipt.log.transactionHash,
    logIndex: receipt.log.index,
    blockNumber: receipt.log.blockNumber,
    timestamp: `${formatDate(receipt.timestamp)} (${formatDuration(receipt.timestamp - request.timestamp)} after request)`,
  })
}
