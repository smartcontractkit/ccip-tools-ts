import type { Provider } from 'ethers'

import {
  type CCIPRequest,
  bigIntReplacer,
  chainIdFromName,
  chainIdFromSelector,
  fetchCCIPMessageById,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchCommitReport,
  fetchExecutionReceipts,
} from '../lib/index.js'
import type { Providers } from '../providers.js'
import { Format } from './types.js'
import {
  prettyCommit,
  prettyReceipt,
  prettyRequest,
  selectRequest,
  withDateTimestamp,
} from './utils.js'

export async function showRequests(
  providers: Providers,
  txHash: string,
  argv: { logIndex?: number; idFromSource?: string; format: Format; page: number },
) {
  let source: Provider, request: CCIPRequest
  if (argv.idFromSource) {
    const sourceChainId = isNaN(+argv.idFromSource)
      ? chainIdFromName(argv.idFromSource)
      : +argv.idFromSource
    source = await providers.forChainId(sourceChainId)
    request = await fetchCCIPMessageById(source, txHash)
  } else {
    const tx = await providers.getTxReceipt(txHash)
    source = tx.provider

    if (argv.logIndex != null) {
      request = await fetchCCIPMessageInLog(tx, argv.logIndex)
    } else {
      request = await selectRequest(await fetchCCIPMessagesInTx(tx), 'to know more')
    }
  }

  switch (argv.format) {
    case Format.log:
      console.log(`message ${request.log.index} =`, withDateTimestamp(request))
      break
    case Format.pretty:
      await prettyRequest(source, request)
      break
    case Format.json:
      console.info(JSON.stringify(request, bigIntReplacer, 2))
      break
  }

  const dest = await providers.forChainId(chainIdFromSelector(request.lane.destChainSelector))

  const commit = await fetchCommitReport(dest, request, { page: argv.page })
  switch (argv.format) {
    case Format.log:
      console.log(
        'commit =',
        withDateTimestamp({
          ...commit,
          timestamp: (await dest.getBlock(commit.log.blockNumber))!.timestamp,
        }),
      )
      break
    case Format.pretty:
      await prettyCommit(dest, commit, request)
      break
    case Format.json:
      console.info(JSON.stringify(commit, bigIntReplacer, 2))
      break
  }

  let found = false
  for await (const receipt of fetchExecutionReceipts(dest, [request], {
    fromBlock: commit.log.blockNumber,
    page: argv.page,
  })) {
    switch (argv.format) {
      case Format.log:
        console.log('receipt =', withDateTimestamp(receipt))
        break
      case Format.pretty:
        if (!found) console.info('Receipts (dest):')
        prettyReceipt(
          receipt,
          request,
          (await dest.getTransaction(receipt.log.transactionHash))?.from,
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
