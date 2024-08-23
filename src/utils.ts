/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-base-to-string */
import { readFile } from 'node:fs/promises'

import { select } from '@inquirer/prompts'
import type { TransactionReceipt } from 'ethers'
import {
  BaseWallet,
  hexlify,
  JsonRpcProvider,
  type Provider,
  SigningKey,
  WebSocketProvider,
} from 'ethers'
import util from 'util'

import { getProviderNetwork } from './lib/index.js'
import type { CCIPMessage, CCIPRequest, CCIPRequestWithLane } from './lib/types.js'

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
            ? `\ndestination =\t\t${req.lane.dest.name} [${req.lane.dest.chainId}]`
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
