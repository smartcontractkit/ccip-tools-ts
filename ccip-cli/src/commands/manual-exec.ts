/**
 * CCIP CLI Manual Execution Command
 *
 * Manually executes pending or failed CCIP messages on the destination chain.
 * Use this when automatic execution fails or is delayed.
 *
 * @example
 * ```bash
 * # Execute by transaction hash
 * ccip-cli manual-exec 0xSourceTxHash... --wallet $PRIVATE_KEY
 *
 * # Execute by message ID (only needs dest chain RPC)
 * ccip-cli manual-exec 0xMessageId... --wallet $PRIVATE_KEY
 *
 * # Execute with custom gas limit
 * ccip-cli manual-exec 0xSourceTxHash... --gas-limit 500000
 * ```
 *
 * @packageDocumentation
 */

import {
  type CCIPRequest,
  type Chain,
  CCIPAPIClient,
  CCIPArgumentInvalidError,
  CCIPDestSimulationUnavailableError,
  CCIPInteractiveRequiredError,
  CCIPMessageIdNotFoundError,
  CCIPTransactionNotFoundError,
  discoverOffRamp,
  estimateReceiveExecution,
  isSupportedTxHash,
  jsonStringify,
} from '@chainlink/ccip-sdk/src/index.ts'
import { hexlify, isHexString } from 'ethers'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { fetchChainsFromRpcs, loadChainWallet, resolveIndexer } from '../providers/index.ts'
import { assertCoverage, collectDirectVerifications } from '../verifiers/direct.ts'
import { type Ctx, Format } from './types.ts'
import {
  getCtx,
  logParsedError,
  prettyReceipt,
  prettyRequest,
  selectRequest,
  withDateTimestamp,
} from './utils.ts'

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
      describe: 'transaction hash, CCIP message ID (32-byte hex), or Canton update ID',
    })
    .check((argv) => isSupportedTxHash(argv.txHashOrId ?? argv['tx-hash-or-id']))
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
        describe:
          'Override gas limit for tokens releaseOrMint calls (0 keeps original, v1.5..v1.6 only)',
      },
      'tx-gas-limit': {
        alias: 'G',
        type: 'number',
        describe: 'Force execute transaction gasLimit/computeUnits (instead of estimating)',
      },
      'estimate-gas-limit': {
        type: 'number',
        describe:
          'Estimate gas limit for receivers callback; argument is a % margin to add to the estimate',
        example: '10',
        conflicts: 'gas-limit',
      },
      'only-estimate': {
        type: 'boolean',
        describe: 'Print gas estimate and exit',
        implies: 'estimate-gas-limit',
      },
      wallet: {
        alias: 'w',
        type: 'string',
        describe:
          'Wallet to send transactions with; pass `ledger[:index_or_derivation]` for Ledger, `foundry:<name>` or `hardhat:<name>` for named keystores, or private key in `USER_KEY` environment variable',
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
      receiver: {
        type: 'string',
        describe:
          'Canton destination: CCIPReceiver contract ID, party ID (hint::1220…), or keccak256(party) from the message receiver field. Defaults to the message receiver when executing on Canton.',
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
  const { output, logger } = ctx
  const [getChain, tx$] = fetchChainsFromRpcs(ctx, argv, argv.txHashOrId)

  let source: Chain | undefined, offRamp
  let request$: Promise<CCIPRequest> | ReturnType<CCIPAPIClient['getMessageById']> = (async () => {
    const [source_, tx] = await tx$
    source = source_
    const messages = await source_.getMessagesInTx(tx)
    if (argv.interactive === false && argv.logIndex == null && messages.length > 1) {
      throw new CCIPInteractiveRequiredError(
        `Multiple messages found (${messages.length}). Use --log-index to select which message to execute`,
        {
          context: {
            count: messages.length,
            logIndices: messages.map((m) => m.log.index),
            messageIds: messages.map((m) => m.message.messageId),
          },
        },
      )
    }
    return selectRequest(messages, 'to know more', argv)
  })()

  let apiClient
  if (argv.api !== false && isHexString(argv.txHashOrId, 32)) {
    apiClient = CCIPAPIClient.fromUrl(typeof argv.api === 'string' ? argv.api : undefined, ctx)
    request$ = Promise.any([request$, apiClient.getMessageById(argv.txHashOrId)])
  }

  let request
  try {
    request = await request$
    if (
      'offRampAddress' in request.message &&
      typeof request.message.offRampAddress === 'string' &&
      request.message.offRampAddress
    ) {
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
      output.write(logPrefix, withDateTimestamp(request))
      break
    }
    case Format.pretty:
      await prettyRequest.call(ctx, request, source)
      break
    case Format.json:
      break // deferred to combined envelope with receipt
  }

  const dest = await getChain(request.lane.destChainSelector)
  // `--estimate-gas-limit` requires source
  if (argv.estimateGasLimit != null && !source)
    source = await getChain(request.lane.sourceChainSelector)

  // The verification block below lives under `if (source)`, and a bare messageId positional never
  // sets `source`. Without this, --verifier/--ccv-data were silently ignored and execution fell
  // through to `dest.execute({ messageId })` with NO verifications, broadcasting an unverified
  // execute that reverts RequiredCCVMissing and costs gas. Resolve the source chain so the
  // verifier fetch and the coverage assert actually run.
  const verifierEntries = (argv as { verifier?: readonly string[] }).verifier ?? []
  const ccvDataEntries = (argv as { ccvData?: readonly string[] }).ccvData ?? []

  // A messageId positional does not set `source`, so resolve it here to reach the verifier fetch
  // and the coverage assert. It is optional: a v2 execution needs only the encoded message and the
  // OffRamp, both of which the CCIP API returns, so a missing source RPC falls through to the
  // API-only branch below rather than failing.
  if (!source && (verifierEntries.length > 0 || ccvDataEntries.length > 0))
    source = await getChain(request.lane.sourceChainSelector).catch(() => undefined)

  let inputs
  if (source) {
    offRamp ??= await discoverOffRamp(source, dest, request.lane.onRamp, source)
    const indexer = resolveIndexer(argv, dest, logger, source)

    // Source order: the managed sources first, then the verifiers themselves. `--verifier` /
    // `--ccv-data` are a FALLBACK used only when the API/indexer could not cover the required set.
    // That keeps routine calls off partner infrastructure and only discloses the messageId to a
    // verifier operator when there is no alternative. For a CCV no indexer has onboarded the
    // managed sources never cover it, so the fallback always fires.
    let verifications
    if (verifierEntries.length > 0 || ccvDataEntries.length > 0) {
      verifications = await dest
        .getVerifications({ ...argv, indexer, offRamp, request })
        .catch(() => undefined)
      // Only families whose policy is keyed by DEST address can be coverage-checked here.
      // Canton derives `requiredCCVs` from the source-side `message_ccv_addresses` while its
      // results carry dest addresses, so comparing them would reject a complete attestation set.
      const destKeyedPolicy =
        verifications &&
        'verificationPolicy' in verifications &&
        typeof dest.getCCVsForEncodedMessage === 'function'
      if (verifications && 'verificationPolicy' in verifications && destKeyedPolicy) {
        try {
          assertCoverage(verifications.verifications, verifications.verificationPolicy)
          logger.info('managed sources covered the required CCV set; not contacting verifiers')
        } catch {
          logger.info(
            'managed sources did not cover the required CCV set; falling back to --verifier',
          )
          verifications = undefined
        }
      } else if (verifications) {
        // pre-v2 shape carries no policy to check; keep it
        logger.debug('non-v2 verifications; --verifier not applicable')
      }
    }

    if (verifications === undefined && (verifierEntries.length > 0 || ccvDataEntries.length > 0)) {
      // Direct verifier fetch: read attestations from the verifiers themselves rather than the
      // indexer. This is the only path available for a CCV that no indexer has onboarded.
      verifications = await collectDirectVerifications({
        dest,
        offRamp,
        encodedMessage: (request.message as { encodedMessage?: unknown }).encodedMessage,
        messageId: request.message.messageId,
        verifierEntries,
        ccvDataEntries,
        logger,
      })
    } else if (verifications === undefined) {
      verifications = await dest.getVerifications({
        ...argv,
        indexer,
        offRamp,
        request,
      })
    }

    let estimated: number | undefined
    if (argv.estimateGasLimit != null) {
      // post-send the real attestations/proofs exist — fetch them so the destination preflight
      // can simulate attestation-consuming pools (USDC/CCTP, Lombard) with the actual data
      const offchainTokenData = await source.getOffchainTokenData(request).catch((err: unknown) => {
        logger.debug('could not fetch offchainTokenData for estimation:', err)
        return undefined
      })
      try {
        estimated = await estimateReceiveExecution({
          source,
          dest,
          routerOrRamp: offRamp,
          message: { ...request.message, offchainTokenData },
        })
      } catch (err) {
        // inconclusive (dest RPC unreachable, or attestation not yet available): the estimate is
        // a sub-step of manual execution — warn and proceed with the original gasLimit, unless
        // the estimate itself is the deliverable (--only-estimate)
        if (!argv.onlyEstimate && err instanceof CCIPDestSimulationUnavailableError) {
          logger.warn(
            'Destination preflight could not be performed — proceeding with original gasLimit:',
            err.message,
          )
        } else throw err
      }
    }
    if (estimated != null && argv.estimateGasLimit != null) {
      const withBuffer = estimated + Math.ceil((estimated * argv.estimateGasLimit) / 100)
      const origLimit = Number(
        'ccipReceiveGasLimit' in request.message
          ? request.message.ccipReceiveGasLimit
          : 'gasLimit' in request.message
            ? request.message.gasLimit
            : request.message.computeUnits,
      )
      if (origLimit >= withBuffer) {
        logger.warn(
          'Estimated =',
          estimated,
          ...(argv.estimateGasLimit ? ['+', argv.estimateGasLimit, '% =', withBuffer] : []),
          '< original gasLimit =',
          origLimit,
          '. Leaving unchanged.',
        )
      } else {
        if (argv.format !== Format.json)
          output.write(
            'Estimated gasLimit override:',
            estimated,
            ...(argv.estimateGasLimit ? ['+', argv.estimateGasLimit, '% =', withBuffer] : []),
          )
        argv.gasLimit = withBuffer
        argv.tokensGasLimit ??= 0
      }

      if (argv.onlyEstimate) {
        if (argv.format === Format.json) {
          output.write(
            jsonStringify(
              {
                estimated,
                bufferPercent: argv.estimateGasLimit,
                withBuffer,
              },
              2,
            ),
          )
        }
        return
      }
    }

    // Refuse to broadcast `execute(msg, [], [])`: with no attestation for any required CCV the
    // OffRamp reverts RequiredCCVMissing, costing gas and moving the message to FAILURE. Placed
    // after the estimate/`--only-estimate` block so a read-only diagnostic is never blocked by a
    // broadcast-safety check.
    if (
      'verificationPolicy' in verifications &&
      verifications.verificationPolicy.requiredCCVs.length > 0 &&
      verifications.verifications.length === 0
    ) {
      throw new Error(
        `no attestation was found for any of the ${verifications.verificationPolicy.requiredCCVs.length} ` +
          `required CCV(s); OffRamp.execute would revert RequiredCCVMissing. Supply them with ` +
          `--verifier <ccv>=<scheme>://<host>[:port] or --ccv-data <ccv>=<0x-hex>`,
      )
    }

    const input = await source.getExecutionInput({ ...argv, request, verifications })
    inputs = { input, offRamp }
  } else if (verifierEntries.length > 0 || ccvDataEntries.length > 0) {
    // No source chain, but attestations were supplied or can be fetched. A v2 execution needs only
    // the encoded message and the OffRamp, both of which the CCIP API returns, so the source chain
    // is not required: `getExecutionInput` on v2 merges the verifications and reads no chain.
    if (!apiClient) {
      throw new CCIPArgumentInvalidError(
        'rpcs',
        'reading attestations without a source-chain RPC needs the CCIP API; pass --rpcs for the ' +
          'source chain, or drop --no-api',
      )
    }
    const messageId = request.message.messageId
    const execInput = await apiClient.getExecutionInput(messageId)
    offRamp ??= execInput.offRamp
    if (!('encodedMessage' in execInput)) {
      throw new CCIPArgumentInvalidError(
        'txHashOrId',
        'this message predates CCIP v2.0; manual execution needs a source-chain RPC to build its ' +
          'merkle proof. Pass --rpcs for the source chain.',
      )
    }
    const collected = await collectDirectVerifications({
      dest,
      offRamp,
      encodedMessage: execInput.encodedMessage,
      messageId,
      verifierEntries,
      ccvDataEntries,
      logger,
    })
    inputs = { input: { encodedMessage: execInput.encodedMessage, ...collected }, offRamp }
  }

  const [walletAddr, wallet] = await loadChainWallet(dest, argv, logger)
  logger.debug(
    'Loaded wallet:',
    walletAddr,
    'for',
    dest.constructor.name,
    'on network',
    dest.network.name,
  )
  const messageReceiver =
    typeof request.message.receiver === 'string'
      ? request.message.receiver
      : hexlify(request.message.receiver)

  const receipt = await dest.execute({
    ...argv,
    wallet,
    ...(inputs ?? { messageId: request.message.messageId }),
    receiver: argv.receiver ?? messageReceiver,
  })

  switch (argv.format) {
    case Format.log:
      output.write('receipt =', withDateTimestamp(receipt))
      break
    case Format.pretty:
      output.write('Receipt (dest):')
      prettyReceipt.call(
        ctx,
        receipt,
        request,
        receipt.log.tx?.from ??
          (await dest.getTransaction(receipt.log.transactionHash).catch(() => null))?.from,
      )
      break
    case Format.json:
      output.write(jsonStringify({ request, receipt }, 2))
      break
  }
}

// TODO: re-implement executing `sender` queue
