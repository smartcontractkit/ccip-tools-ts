import util from 'util'

import {
  type CCIPRequest,
  type ChainTransaction,
  bigIntReplacer,
  discoverOffRamp,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { Format } from './types.ts'
import {
  logParsedError,
  prettyCommit,
  prettyReceipt,
  prettyRequest,
  selectRequest,
  withDateTimestamp,
} from './utils.ts'
import { fetchChainsFromRpcs } from '../providers/index.ts'

export const command = ['show <tx-hash>', '* <tx-hash>']
export const describe = 'Show details of a CCIP request'

/**
 * Yargs builder for the show command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .positional('tx-hash', {
      type: 'string',
      demandOption: true,
      describe: 'transaction hash of the request (source) message',
    })
    .options({
      'log-index': {
        type: 'number',
        describe:
          'Pre-select a message request by logIndex, if more than one in tx; by default, a selection menu is shown',
      },
      'id-from-source': {
        type: 'string',
        describe:
          'Search by messageId instead of txHash; requires `[onRamp@]sourceNetwork` (onRamp address may be required in some chains)',
      },
    })

/**
 * Handler for the show command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  let destroy
  const destroy$ = new Promise((resolve) => {
    destroy = resolve
  })
  return showRequests(argv, destroy$)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError(err)) console.error(err)
    })
    .finally(destroy)
}

async function showRequests(argv: Parameters<typeof handler>[0], destroy: Promise<unknown>) {
  let source, getChain, tx: ChainTransaction, request: CCIPRequest
  // messageId not yet implemented for Solana
  if (argv.idFromSource) {
    getChain = fetchChainsFromRpcs(argv, undefined, destroy)
    let idFromSource, onRamp
    if (argv.idFromSource.includes('@')) {
      ;[onRamp, idFromSource] = argv.idFromSource.split('@')
    } else idFromSource = argv.idFromSource
    const sourceNetwork = networkInfo(idFromSource)
    source = await getChain(sourceNetwork.chainId)
    if (!source.fetchRequestById)
      throw new Error(`fetchRequestById not implemented for ${source.constructor.name}`)
    request = await source.fetchRequestById(argv.txHash, onRamp, argv)
  } else {
    const [getChain_, tx$] = fetchChainsFromRpcs(argv, argv.txHash, destroy)
    getChain = getChain_
    ;[source, tx] = await tx$
    request = await selectRequest(await source.fetchRequestsInTx(tx), 'to know more', argv)
  }

  const offchainTokenData = await source.fetchOffchainTokenData(request)

  switch (argv.format) {
    case Format.log: {
      console.log(
        `message ${request.log.index} =`,
        withDateTimestamp(request),
        '\nattestations =',
        offchainTokenData,
      )
      break
    }
    case Format.pretty:
      await prettyRequest(source, request, offchainTokenData)
      break
    case Format.json:
      console.info(JSON.stringify({ ...request, offchainTokenData }, bigIntReplacer, 2))
      break
  }
  if (request.tx.error) throw new Error(`Request tx reverted: ${util.inspect(request.tx.error)}`)

  const dest = await getChain(request.lane.destChainSelector)
  const offRamp = await discoverOffRamp(source, dest, request.lane.onRamp)
  const commitStore = await dest.getCommitStoreForOffRamp(offRamp)

  const commit = await dest.fetchCommitReport(commitStore, request, argv)
  switch (argv.format) {
    case Format.log:
      console.log('commit =', commit)
      break
    case Format.pretty:
      await prettyCommit(dest, commit, request)
      break
    case Format.json:
      console.info(JSON.stringify(commit, bigIntReplacer, 2))
      break
  }

  let found = false
  for await (const receipt of dest.fetchExecutionReceipts(offRamp, request, commit, argv)) {
    switch (argv.format) {
      case Format.log:
        console.log('receipt =', withDateTimestamp(receipt))
        break
      case Format.pretty:
        if (!found) console.info('Receipts (dest):')
        prettyReceipt(
          receipt,
          request,
          receipt.log.tx?.from ??
            (await dest.getTransaction(receipt.log.transactionHash).catch(() => null))?.from,
        )
        break
      case Format.json:
        console.info(JSON.stringify(receipt, bigIntReplacer, 2))
        break
    }
    found = true
  }
  if (!found) console.warn(`No execution receipt found for request`)
}
