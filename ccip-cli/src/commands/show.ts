import util from 'util'

import {
  type CCIPRequest,
  ChainFamily,
  bigIntReplacer,
  discoverOffRamp,
  fetchCCIPMessageById,
  fetchCCIPMessagesInTx,
  networkInfo,
} from '@chainlink/ccip-tools-ts/src/index.ts'
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
        describe: 'Log index of message to select to know more, instead of prompting',
      },
      'id-from-source': {
        type: 'string',
        describe:
          'Search by messageId instead of tx_hash; requires specifying source network (by id or name)',
      },
    })

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
  let source, getChain, tx, request: CCIPRequest
  // messageId not yet implemented for Solana
  if (argv.idFromSource) {
    getChain = fetchChainsFromRpcs(argv, undefined, destroy)
    const sourceNetwork = networkInfo(argv.idFromSource)
    if (sourceNetwork.family === ChainFamily.Solana) {
      throw new Error(
        `Message ID search is not yet supported for Solana networks.\n` +
          `Please use show with Solana transaction signature instead`,
      )
    }
    source = await getChain(sourceNetwork.chainId)
    request = await fetchCCIPMessageById(source, argv.txHash, argv)
  } else {
    const [getChain_, tx$] = fetchChainsFromRpcs(argv, argv.txHash, destroy)
    getChain = getChain_
    tx = await tx$
    source = tx.chain
    request = await selectRequest(await fetchCCIPMessagesInTx(tx), 'to know more', argv)
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
  for await (const receipt of dest.fetchExecutionReceipts(
    offRamp,
    new Set([request.message.header.messageId]),
    {
      startBlock: commit.log.blockNumber,
      page: argv.page,
      commit: commit.report,
    },
  )) {
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
