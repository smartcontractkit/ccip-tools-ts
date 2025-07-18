import { type Provider, isHexString } from 'ethers'

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
  fetchSolanaCCIPMessagesInTx,
  getSomeBlockNumberBefore,
} from '../lib/index.ts'
import type { Providers } from '../providers.ts'
import { Format } from './types.ts'
import {
  prettyCommit,
  prettyReceipt,
  prettyRequest,
  selectRequest,
  withDateTimestamp,
} from './utils.ts'

export async function showRequests(
  providers: Providers,
  txHash: string,
  argv: { logIndex?: number; idFromSource?: string; format: Format; page: number },
) {
  // messageId not yet implemented for Solana
  if (argv.idFromSource) {
    const sourceNetwork = argv.idFromSource.toLowerCase()
    if (sourceNetwork.includes('solana')) {
      throw new Error(
        `Message ID search is not yet supported for Solana networks.\n` +
          `Please use show with Solana transaction signature instead`,
      )
    }
  }

  // detect txHash type and route accordingly
  // TODO: we may want to provide more arguments and be able to determine more reliably
  if (isHexString(txHash, 32)) {
    return showEVMRequests(providers, txHash, argv)
  } else {
    return showSolanaRequests(providers, txHash, argv)
  }
}

async function showEVMRequests(
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

  await displayRequest(request, argv, source)

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

  await displayExecutionReceipts(dest, request, commit.log.blockNumber, argv)
}

async function showSolanaRequests(
  providers: Providers,
  signature: string,
  argv: { logIndex?: number; idFromSource?: string; format: Format; page: number },
) {
  // Parse CCIP events from transaction (if any)
  const { parsedTransaction } = await providers.getSolanaTransaction(signature)
  const ccipMessages = await fetchSolanaCCIPMessagesInTx(signature, parsedTransaction)

  // We expect to find exactly 1 message for Solana
  if (ccipMessages.length === 0) {
    throw new Error('No CCIP messages found in this Solana transaction')
  }
  if (ccipMessages.length > 1) {
    console.warn(`Expected to find 1 CCIP message, found ${ccipMessages.length}. Using first one.`)
  }

  const request = ccipMessages[0]

  await displayRequest(request, argv)

  // Try to fetch commit report and execution receipts from destination chain
  const dest = await providers.forChainId(chainIdFromSelector(request.lane.destChainSelector))

  // Fetch and display commit report
  const startBlock = await getSomeBlockNumberBefore(dest, request.timestamp)
  try {
    const commit = await fetchCommitReport(dest, request, { page: argv.page, startBlock })
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
  } catch (error) {
    console.warn(
      `Could not fetch commit report: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // Fetch and display execution receipts
  await displayExecutionReceipts(dest, request, startBlock, argv)
}

// Add this new function:
async function displayRequest(
  request: CCIPRequest,
  argv: { format: Format },
  sourceProvider?: Provider,
) {
  switch (argv.format) {
    case Format.log: {
      const logPrefix = 'log' in request ? `message ${request.log.index} = ` : 'message = '
      console.log(logPrefix, withDateTimestamp(request))
      break
    }
    case Format.pretty:
      await prettyRequest(sourceProvider || null, request)
      break
    case Format.json:
      console.info(JSON.stringify(request, bigIntReplacer, 2))
      break
  }
}

async function displayExecutionReceipts(
  dest: Provider,
  request: CCIPRequest,
  fromBlock: number | undefined,
  argv: { format: Format; page: number },
) {
  let found = false
  for await (const receipt of fetchExecutionReceipts(dest, [request], {
    fromBlock,
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
