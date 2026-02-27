/**
 * CCIP CLI Manual Execution Command
 *
 * Manually executes pending or failed CCIP messages on the destination chain.
 * Use this when automatic execution fails or is delayed.
 *
 * @example
 * ```bash
 * # Execute a stuck message
 * ccip-cli manual-exec 0xSourceTxHash... --wallet $PRIVATE_KEY
 *
 * # Execute with custom gas limit
 * ccip-cli manual-exec 0xSourceTxHash... --gas-limit 500000
 *
 * # Execute all messages in sender queue
 * ccip-cli manual-exec 0xSourceTxHash... --sender-queue
 * ```
 *
 * @packageDocumentation
 */

import {
  type CCIPRequest,
  type Chain,
  CCIPAPIClient,
  CCIPMessageIdNotFoundError,
  CCIPTransactionNotFoundError,
  bigIntReplacer,
  discoverOffRamp,
  estimateReceiveExecution,
  isSupportedTxHash,
} from '@chainlink/ccip-sdk/src/index.ts'
import { isHexString } from 'ethers'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { type Ctx, Format } from './types.ts'
import {
  getCtx,
  logParsedError,
  prettyReceipt,
  prettyRequest,
  selectRequest,
  withDateTimestamp,
} from './utils.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../providers/index.ts'

// const MAX_QUEUE = 1000
// const MAX_EXECS_IN_BATCH = 1
// const MAX_PENDING_TXS = 25

export const command = ['manualExec <tx-hash-or-id>', 'manual-exec <tx-hash-or-id>']
export const describe = 'Execute manually pending or failed messages'

/**
 * Yargs builder for the manual-exec command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .positional('tx-hash-or-id', {
      type: 'string',
      demandOption: true,
      describe: 'transaction hash of the request (source) message',
    })
    .check(({ 'tx-hash-or-id': txHashOrId }) => isSupportedTxHash(txHashOrId))
    .options({
      'log-index': {
        type: 'number',
        describe: 'Log index of message to execute (if more than one in request tx)',
      },
      'gas-limit': {
        alias: ['L', 'compute-units'],
        type: 'number',
        describe: 'Override gas limit or compute units for receivers callback (0 keeps original)',
      },
      'tokens-gas-limit': {
        type: 'number',
        describe: 'Override gas limit for tokens releaseOrMint calls (0 keeps original)',
      },
      'estimate-gas-limit': {
        type: 'number',
        describe:
          'Estimate gas limit for receivers callback; argument is a % margin to add to the estimate',
        example: '10',
        conflicts: 'gas-limit',
      },
      wallet: {
        alias: 'w',
        type: 'string',
        describe:
          'Wallet to send transactions with; pass `ledger[:index_or_derivation]` to use Ledger USB hardware wallet, or private key in `USER_KEY` environment variable',
      },
      'force-buffer': {
        type: 'boolean',
        describe: 'Forces the usage of buffering for Solana execution.',
      },
      'force-lookup-table': {
        type: 'boolean',
        describe: 'Forces the creation & usage of an ad-hoc lookup table for Solana execution.',
      },
      'clear-leftover-accounts': {
        type: 'boolean',
        describe:
          'Clears buffers (if a previous attempt was aborted) or any ALT owned by this sender.',
      },
      'receiver-object-ids': {
        type: 'array',
        describe: 'Receiver object IDs for Sui execution (if executing on Sui destination)',
        string: true,
        example: '--receiver-object-ids 0xabc... 0xdef...',
      },
    })

/**
 * Handler for the manual-exec command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  // argv.senderQueue
  //   ? manualExecSenderQueue(providers, argv.tx_hash, argv)
  //   : manualExec(argv, destroy$)
  return manualExec(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

async function manualExec(
  ctx: Ctx,
  argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts,
) {
  const { logger } = ctx
  const [getChain, tx$] = fetchChainsFromRpcs(ctx, argv, argv.txHashOrId)

  let source: Chain | undefined, offRamp
  let request$: Promise<CCIPRequest> | ReturnType<CCIPAPIClient['getMessageById']> = (async () => {
    const [source_, tx] = await tx$
    source = source_
    return selectRequest(await source_.getMessagesInTx(tx), 'to know more', argv)
  })()

  let apiClient
  if (argv.api !== false && isHexString(argv.txHashOrId, 32)) {
    apiClient = CCIPAPIClient.fromUrl(typeof argv.api === 'string' ? argv.api : undefined, ctx)
    request$ = Promise.any([request$, apiClient.getMessageById(argv.txHashOrId)])
  }

  let request
  try {
    request = await request$
    if ('offRampAddress' in request.message) {
      offRamp = request.message.offRampAddress
    }
  } catch (err) {
    if (err instanceof AggregateError && err.errors.length === 2) {
      if (!(err.errors[0] instanceof CCIPTransactionNotFoundError)) throw err.errors[0] as Error
      else if (!(err.errors[1] instanceof CCIPMessageIdNotFoundError)) throw err.errors[1] as Error
    }
    throw err
  }

  switch (argv.format) {
    case Format.log: {
      const logPrefix = 'log' in request ? `message ${request.log.index} = ` : 'message = '
      logger.log(logPrefix, withDateTimestamp(request))
      break
    }
    case Format.pretty:
      await prettyRequest.call(ctx, request, source)
      break
    case Format.json:
      logger.info(JSON.stringify(request, bigIntReplacer, 2))
      break
  }

  const dest = await getChain(request.lane.destChainSelector)

  let inputs
  if (source) {
    offRamp ??= await discoverOffRamp(source, dest, request.lane.onRamp, source)
    const verifications = await dest.getVerifications({ ...argv, offRamp, request })

    if (argv.estimateGasLimit != null) {
      let estimated = await estimateReceiveExecution({
        source,
        dest,
        routerOrRamp: offRamp,
        message: request.message,
      })
      logger.info('Estimated gasLimit override:', estimated)
      estimated += Math.ceil((estimated * argv.estimateGasLimit) / 100)
      const origLimit = Number(
        'ccipReceiveGasLimit' in request.message
          ? request.message.ccipReceiveGasLimit
          : 'gasLimit' in request.message
            ? request.message.gasLimit
            : request.message.computeUnits,
      )
      if (origLimit >= estimated) {
        logger.warn(
          'Estimated +',
          argv.estimateGasLimit,
          '% =',
          estimated,
          '< original gasLimit =',
          origLimit,
          '. Leaving unchanged.',
        )
      } else {
        argv.gasLimit = estimated
      }
    }

    const input = await source.getExecutionInput({ ...argv, request, verifications })
    inputs = { input, offRamp }
  }

  const [, wallet] = await loadChainWallet(dest, argv)
  const receipt = await dest.execute({
    ...argv,
    wallet,
    ...(inputs ?? { messageId: request.message.messageId }),
  })

  switch (argv.format) {
    case Format.log:
      logger.log('receipt =', withDateTimestamp(receipt))
      break
    case Format.pretty:
      logger.info('Receipt (dest):')
      prettyReceipt.call(
        ctx,
        receipt,
        request,
        receipt.log.tx?.from ??
          (await dest.getTransaction(receipt.log.transactionHash).catch(() => null))?.from,
      )
      break
    case Format.json:
      logger.info(JSON.stringify(receipt, bigIntReplacer, 2))
      break
  }
}

// TODO: re-implement executing `sender` queue
