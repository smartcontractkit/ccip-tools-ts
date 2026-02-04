import {
  type ChainStatic,
  type ExtraArgs,
  type MessageInput,
  CCIPArgumentInvalidError,
  CCIPTokenNotFoundError,
  ChainFamily,
  estimateReceiveExecution,
  getDataBytes,
  networkInfo,
} from '@chainlink/ccip-sdk/src/index.ts'
import { type BytesLike, formatUnits, toUtf8Bytes } from 'ethers'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { showRequests } from './show.ts'
import { type Ctx, Format } from './types.ts'
import { getCtx, logParsedError, parseTokenAmounts } from './utils.ts'
import { fetchChainsFromRpcs, loadChainWallet } from '../providers/index.ts'

export const command = 'send'
export const describe = 'Send a CCIP message from source to destination chain'

/**
 * Yargs builder for the send command.
 * @param yargs - Yargs instance.
 * @returns Configured yargs instance with command options.
 */
export const builder = (yargs: Argv) =>
  yargs
    .option('source', {
      alias: 's',
      type: 'string',
      demandOption: true,
      describe: 'Source chain: chainId, selector, or name',
    })
    .option('dest', {
      alias: 'd',
      type: 'string',
      demandOption: true,
      describe: 'Destination chain: chainId, selector, or name',
    })
    .option('router', {
      alias: 'r',
      type: 'string',
      demandOption: true,
      describe: 'Router contract address on source',
    })
    .options({
      receiver: {
        alias: 'to',
        type: 'string',
        describe: 'Receiver address on destination; defaults to sender if same chain family',
      },
      data: {
        type: 'string',
        describe: 'Data payload to send (non-hex will be UTF-8 encoded)',
      },
      'gas-limit': {
        alias: ['L', 'compute-units'],
        type: 'number',
        describe: 'Gas limit for receiver callback; defaults to ramp config',
      },
      'estimate-gas-limit': {
        type: 'number',
        describe: 'Estimate gas limit with % margin (e.g., 10 for +10%)',
        conflicts: 'gas-limit',
      },
      'allow-out-of-order-exec': {
        alias: 'ooo',
        type: 'boolean',
        describe: 'Allow out-of-order execution (v1.5+ lanes)',
      },
      'fee-token': {
        type: 'string',
        describe: 'Fee token address or symbol (default: native)',
      },
      'transfer-tokens': {
        alias: 't',
        type: 'array',
        string: true,
        describe: 'Token amounts to transfer: token=amount',
      },
      wallet: {
        alias: 'w',
        type: 'string',
        describe: 'Wallet: ledger[:index] or private key',
      },
      'token-receiver': {
        type: 'string',
        describe: 'Solana token receiver (if different from program receiver)',
      },
      account: {
        alias: 'receiver-object-id',
        type: 'array',
        string: true,
        describe: 'Solana accounts (append =rw for writable) or Sui object IDs',
      },
      'only-get-fee': {
        type: 'boolean',
        describe: 'Print fee and exit',
      },
      'only-estimate': {
        type: 'boolean',
        describe: 'Print gas estimate and exit',
        implies: 'estimate-gas-limit',
      },
      'approve-max': {
        type: 'boolean',
        describe: 'Approve max token amount instead of exact',
      },
      wait: {
        type: 'boolean',
        default: false,
        describe: 'Wait for execution on destination',
      },
      'list-fee-tokens': {
        type: 'boolean',
        default: false,
        describe: 'List available fee tokens for the router and exit',
      },
    })
    .check(
      ({ 'transfer-tokens': transferTokens }) =>
        !transferTokens || transferTokens.every((t) => /^[^=]+=\d+(\.\d+)?$/.test(t)),
    )
    .example([
      [
        'ccip-cli send -s ethereum-testnet-sepolia -d arbitrum-sepolia -r 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 --only-get-fee',
        'Get fee estimate',
      ],
      [
        'ccip-cli send -s ethereum-testnet-sepolia -d arbitrum-sepolia -r 0x0BF3... --to 0xABC... --data "Hello"',
        'Send message with data',
      ],
      [
        'ccip-cli send -s ethereum-mainnet -d arbitrum-mainnet -r 0x80226fc... --list-fee-tokens',
        'List available fee tokens for a router',
      ],
    ])

/**
 * Handler for the send command.
 * @param argv - Command line arguments.
 */
export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  const [ctx, destroy] = getCtx(argv)
  return sendMessage(ctx, argv)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError.call(ctx, err)) ctx.logger.error(err)
    })
    .finally(destroy)
}

async function sendMessage(
  ctx: Ctx,
  argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts,
) {
  const { logger } = ctx
  const sourceNetwork = networkInfo(argv.source)
  const destNetwork = networkInfo(argv.dest)
  const getChain = fetchChainsFromRpcs(ctx, argv)
  const source = await getChain(sourceNetwork.name)

  // Handle --list-fee-tokens flag
  if (argv.listFeeTokens) {
    const feeTokens = await source.getFeeTokens(argv.router)
    switch (argv.format) {
      case Format.pretty:
        logger.info('Fee Tokens:')
        logger.table(feeTokens)
        break
      case Format.json:
        logger.log(JSON.stringify(feeTokens, null, 2))
        break
      default:
        logger.log('feeTokens:', feeTokens)
    }
    return
  }

  let data: BytesLike | undefined
  if (argv.data) {
    try {
      data = getDataBytes(argv.data)
    } catch (_) {
      data = toUtf8Bytes(argv.data)
    }
  }

  const tokenAmounts: { token: string; amount: bigint }[] = argv.transferTokens?.length
    ? await parseTokenAmounts(source, argv.transferTokens)
    : []

  let receiver = argv.receiver
  let accounts,
    accountIsWritableBitmap = 0n
  if (destNetwork.family === ChainFamily.Solana) {
    // parse accounts with or without `=rw` suffix
    if (argv.account?.length) {
      accounts = argv.account.map((account, i) => {
        if (account.endsWith('=rw')) {
          accountIsWritableBitmap |= 1n << BigInt(i)
          account = account.substring(0, account.length - 3)
        }
        return account
      })
    }
  }

  let walletAddress, wallet
  if (!receiver) {
    if (sourceNetwork.family !== destNetwork.family)
      throw new CCIPArgumentInvalidError('receiver', 'required for cross-family transfers')
    ;[walletAddress, wallet] = await loadChainWallet(source, argv)
    receiver = walletAddress // send to self if same family
  }

  if (argv.estimateGasLimit != null || argv.onlyEstimate) {
    // TODO: implement for all chain families
    const dest = await getChain(destNetwork.chainSelector)

    if (!walletAddress) {
      try {
        ;[walletAddress, wallet] = await loadChainWallet(source, argv)
      } catch {
        // pass undefined sender for default
      }
    }
    const estimated = await estimateReceiveExecution({
      source,
      dest,
      routerOrRamp: argv.router,
      message: {
        sender: walletAddress,
        receiver,
        data,
        tokenAmounts,
      },
    })
    argv.gasLimit = Math.ceil(estimated * (1 + (argv.estimateGasLimit ?? 0) / 100))
    logger.log(
      'Estimated gasLimit for sender =',
      walletAddress,
      ':',
      estimated,
      ...(argv.estimateGasLimit ? ['+', argv.estimateGasLimit, '% =', argv.gasLimit] : []),
    )
    if (argv.onlyEstimate) return
  }

  // builds a catch-all extraArgs object, which can be massaged by
  // [[Chain.buildMessageForDest]] to create suitable extraArgs with defaults if needed
  const extraArgs = {
    ...(argv.allowOutOfOrderExec != null && {
      allowOutOfOrderExecution: !!argv.allowOutOfOrderExec,
    }),
    ...(argv.gasLimit == null
      ? {}
      : destNetwork.family === ChainFamily.Solana
        ? { computeUnits: BigInt(argv.gasLimit) }
        : { gasLimit: BigInt(argv.gasLimit) }),
    ...(!!argv.tokenReceiver && { tokenReceiver: argv.tokenReceiver }),
    ...(!!accounts && { accounts, accountIsWritableBitmap }), // accounts also used as Sui receiverObjectIds
  }

  let feeToken, feeTokenInfo
  if (argv.feeToken) {
    try {
      feeToken = (source.constructor as ChainStatic).getAddress(argv.feeToken)
      feeTokenInfo = await source.getTokenInfo(feeToken)
    } catch (_) {
      const feeTokens = await source.getFeeTokens(argv.router)
      logger.debug('supported feeTokens:', feeTokens)
      for (const [token, info] of Object.entries(feeTokens)) {
        if (info.symbol === 'UNKNOWN' || info.symbol !== argv.feeToken) continue
        feeToken = token
        feeTokenInfo = info
        break
      }
      if (!feeTokenInfo) throw new CCIPTokenNotFoundError(argv.feeToken)
    }
  } else {
    const nativeToken = await source.getNativeTokenForRouter(argv.router)
    feeTokenInfo = await source.getTokenInfo(nativeToken)
  }

  const message: MessageInput = {
    receiver,
    data,
    extraArgs: extraArgs as ExtraArgs,
    feeToken, // feeToken==ZeroAddress means native
    tokenAmounts,
  }

  // calculate fee
  const fee = await source.getFee({
    ...argv,
    destChainSelector: destNetwork.chainSelector,
    message,
  })

  logger.info(
    'Fee:',
    fee,
    '=',
    formatUnits(fee, feeTokenInfo.decimals),
    !argv.feeToken && feeTokenInfo.symbol.startsWith('W')
      ? feeTokenInfo.symbol.substring(1)
      : feeTokenInfo.symbol,
  )
  if (argv.onlyGetFee) return

  if (!walletAddress) [walletAddress, wallet] = await loadChainWallet(source, argv)
  const request = await source.sendMessage({
    ...argv,
    destChainSelector: destNetwork.chainSelector,
    message: { ...message, fee },
    wallet,
  })
  logger.info(
    '🚀 Sending message to',
    receiver,
    '@',
    destNetwork.name,
    ', tx =>',
    request.tx.hash,
    ', messageId =>',
    request.message.messageId,
  )
  await showRequests(ctx, {
    ...argv,
    txHash: request.tx.hash,
    'tx-hash': request.tx.hash,
    'id-from-source': undefined,
    idFromSource: undefined,
    'log-index': undefined,
    logIndex: undefined,
  })
}
