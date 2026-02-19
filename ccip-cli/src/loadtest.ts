import { ChainFamily, networkInfo } from '@chainlink/ccip-sdk/src/index.ts'
import { formatUnits, toUtf8Bytes } from 'ethers'

import { getCtx } from './commands/utils.ts'
import { fetchChainsFromRpcs, loadChainWallet } from './providers/index.ts'

const DEST = networkInfo('ethereum-testnet-sepolia-base-1')
const RECEIVER = '0x'
const RPCS_FILE = '../../.env'
const RPCS = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://avalanche-fuji-c-chain-rpc.publicnode.com',
]
const PRIVATE_KEYS = {
  [ChainFamily.Solana]: process.env['PRIVATE_KEY_SOLANA'],
  [ChainFamily.Aptos]: process.env['PRIVATE_KEY_APTOS'],
  [ChainFamily.EVM]: process.env['PRIVATE_KEY'],
}

// mapping of source_network_name to its router
const SOURCES: Record<string, string> = {
  'avalanche-testnet-fuji': '0xF694E193200268f9a4868e4Aa017A0118C9a8177',
}
// per source:
const MAX_COUNT = 100
const MAX_INFLIGHT = 10 // inflight on RPC (tx to be accepted/included), not on CCIP
const MAX_PER_SECOND = 1

/** like Promise.all, but receives Promise factories and spawn a maximum number of them in parallel */
function promiseAllMax<T>(
  promises: readonly (() => Promise<T>)[],
  maxParallelJobs: number,
  cancel?: Promise<unknown>,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const results = new Array(promises.length) as T[]
    let completed = 0
    let started = 0
    let rejected = false

    if (promises.length === 0) {
      resolve([])
      return
    }

    const startNext = () => {
      if (rejected || started >= promises.length) return

      const index = started++
      const promiseFactory = promises[index]!

      promiseFactory()
        .then((result) => {
          if (rejected) return
          results[index] = result
          completed++

          if (completed === promises.length) {
            resolve(results)
          } else {
            startNext()
          }
        })
        .catch((err) => {
          rejected = true
          reject(err as Error)
        })
    }

    // Handle cancellation
    void cancel?.then(() => {
      if (!rejected && completed < promises.length) {
        rejected = true
        // eslint-disable-next-line no-restricted-syntax
        reject(new Error('Cancelled'))
      }
    })

    // Start up to maxParallelJobs promises
    for (let i = 0; i < maxParallelJobs && i < promises.length; i++) {
      startNext()
    }
  })
}

async function main() {
  const [ctx] = getCtx({ verbose: !!process.env['CCIP_VERBOSE'] })
  const { logger } = ctx
  const getChain = fetchChainsFromRpcs(ctx, {
    noApi: true,
    rpcsFile: RPCS_FILE,
    rpcs: RPCS,
  })
  const allLanes = []
  for (const [name, router] of Object.entries(SOURCES)) {
    const source = await getChain(name)
    const [walletAddr, wallet] = await loadChainWallet(source, {
      wallet: PRIVATE_KEYS[source.network.family as keyof typeof PRIVATE_KEYS],
    })
    const initialBalance = await source.getBalance({ holder: walletAddr })
    const nativeToken = await source.getNativeTokenForRouter(router)
    const nativeInfo = await source.getTokenInfo(nativeToken)
    const symbol = nativeInfo.symbol.startsWith('W')
      ? nativeInfo.symbol.substring(1)
      : nativeInfo.symbol
    logger.info(
      `Initial balance of ${walletAddr} @ ${name}:`,
      initialBalance,
      '=',
      formatUnits(initialBalance, nativeInfo.decimals),
      symbol,
    )

    const startTime = performance.now()
    let inflight = 0,
      completed = 0
    const tasks = Array.from({ length: MAX_COUNT }, (_, i) => async () => {
      const deltaMs = performance.now() - startTime
      const delay = (1e3 * completed) / MAX_PER_SECOND - deltaMs
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))

      inflight++
      const req = await source.sendMessage({
        router,
        destChainSelector: DEST.chainSelector,
        message: {
          receiver: RECEIVER,
          data: toUtf8Bytes(`ccip-cli load test: ${i + 1}/${MAX_COUNT}`),
          extraArgs: { gasLimit: 0n },
        },
        wallet,
      })
      inflight--
      completed++
      logger.info(`[${i + 1}] LOAD TEST`, name, '=>', DEST.name, {
        inflight,
        completed,
        total: MAX_COUNT,
        messageId: req.message.messageId,
        tx: req.log.transactionHash,
      })
    })
    allLanes.push(
      promiseAllMax(tasks, MAX_INFLIGHT).then(async () => {
        const finalBalance = await source.getBalance({ holder: walletAddr })
        logger.info(
          `Final balance of ${walletAddr} @ ${name}:`,
          finalBalance,
          '=',
          formatUnits(finalBalance, nativeInfo.decimals),
          symbol,
          ', spent =',
          formatUnits(initialBalance - finalBalance, nativeInfo.decimals),
        )
        const delta = (performance.now() - startTime) / 1e3
        logger.warn(
          `[${name}] Sent`,
          completed,
          `requests in`,
          delta,
          `seconds =~`,
          completed / delta,
          `reqs/s`,
        )
      }),
    )
  }
  await Promise.all(allLanes)
}

await main()
