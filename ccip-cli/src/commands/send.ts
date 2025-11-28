import {
  type AnyMessage,
  type CCIPVersion,
  type ChainStatic,
  type EVMChain,
  type ExtraArgs,
  ChainFamily,
  bigIntReplacer,
  estimateExecGasForRequest,
  fetchCCIPRequestsInTx,
  getDataBytes,
  networkInfo,
  sourceToDestTokenAmounts,
} from '@chainlink/ccip-sdk/src/index.ts'
import { type BytesLike, dataLength, formatUnits, toUtf8Bytes } from 'ethers'
import type { Argv } from 'yargs'

import type { GlobalOpts } from '../index.ts'
import { Format } from './types.ts'
import { logParsedError, parseTokenAmounts, prettyRequest, withDateTimestamp } from './utils.ts'
import { fetchChainsFromRpcs } from '../providers/index.ts'

export const command = 'send <source> <router> <dest>'
export const describe = 'Send a CCIP message from router on source to dest'

export const builder = (yargs: Argv) =>
  yargs
    .positional('source', {
      type: 'string',
      demandOption: true,
      describe: 'source network, chainId or name',
      example: 'ethereum-testnet-sepolia',
    })
    .positional('router', {
      type: 'string',
      demandOption: true,
      describe: 'router contract address on source',
    })
    .positional('dest', {
      type: 'string',
      demandOption: true,
      describe: 'destination network, chainId or name',
      example: 'ethereum-testnet-sepolia-arbitrum-1',
    })
    .options({
      receiver: {
        alias: 'R',
        type: 'string',
        describe:
          'Receiver of the message; defaults to the sender wallet address if same network family',
      },
      data: {
        alias: 'd',
        type: 'string',
        describe: 'Data to send in the message (non-hex will be utf-8 encoded)',
        example: '0x1234',
      },
      'gas-limit': {
        alias: ['L', 'compute-units'],
        type: 'number',
        describe:
          'Gas limit for receiver callback execution; defaults to default configured on ramps',
        default: 0,
      },
      'estimate-gas-limit': {
        type: 'number',
        describe:
          'Estimate gas limit for receiver callback execution; argument is a % margin to add to the estimate',
        example: '10',
        conflicts: 'gas-limit',
      },
      'allow-out-of-order-exec': {
        alias: 'ooo',
        type: 'boolean',
        describe:
          'Allow execution of messages out of order (i.e. sender nonce not enforced, only v1.5+ lanes, mandatory for some dests)',
      },
      'fee-token': {
        type: 'string',
        describe:
          'Address or symbol of the fee token (e.g. LINK address on source); if not provided, will pay in native',
      },
      'transfer-tokens': {
        alias: 't',
        type: 'array',
        string: true,
        describe: 'List of token amounts (on source) to transfer to the receiver',
        example: '0xtoken=0.1',
      },
      wallet: {
        alias: 'w',
        type: 'string',
        describe:
          'Wallet to send transactions with; pass `ledger[:index_or_derivation]` to use Ledger USB hardware wallet, or private key in `USER_KEY` environment variable',
      },
      'token-receiver': {
        type: 'string',
        describe: "Address of the Solana tokenReceiver (if different than program's receiver)",
      },
      account: {
        type: 'array',
        string: true,
        describe:
          'List of accounts needed by Solana receiver program; append `=rw` to specify account as writable; can be specified multiple times',
        example: 'requiredPdaAddress=rw',
      },
      'only-get-fee': {
        type: 'boolean',
        describe: 'Fetch and print the fee for the transaction, then exit',
      },
      'only-estimate': {
        type: 'boolean',
        describe: 'Only estimate dest exec gasLimit',
      },
      'approve-max': {
        type: 'boolean',
        describe:
          "Approve the maximum amount of tokens to transfer; default=false approves only what's needed",
      },
    })
    .check(
      ({ 'transfer-tokens': transferTokens }) =>
        !transferTokens || transferTokens.every((t) => /^[^=]+=\d+(\.\d+)?$/.test(t)),
    )

export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  let destroy
  const destroy$ = new Promise((resolve) => {
    destroy = resolve
  })
  return sendMessage(argv, destroy$)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError(err)) console.error(err)
    })
    .finally(destroy)
}

async function sendMessage(
  argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts,
  destroy: Promise<unknown>,
) {
  const sourceNetwork = networkInfo(argv.source)
  const destNetwork = networkInfo(argv.dest)
  const getChain = fetchChainsFromRpcs(argv, undefined, destroy)
  const source = await getChain(sourceNetwork.name)

  let data: BytesLike
  if (argv.data) {
    try {
      data = getDataBytes(argv.data)
    } catch (_) {
      data = toUtf8Bytes(argv.data)
    }
  } else {
    data = '0x'
  }

  const tokenAmounts: { token: string; amount: bigint }[] = argv.transferTokens?.length
    ? await parseTokenAmounts(source, argv.transferTokens)
    : []

  let receiver = argv.receiver
  let tokenReceiver
  let accounts,
    accountIsWritableBitmap = 0n
  if (destNetwork.family === ChainFamily.Solana) {
    if (argv.tokenReceiver) tokenReceiver = argv.tokenReceiver
    else if (!tokenAmounts.length) {
      tokenReceiver = '11111111111111111111111111111111'
    } else if (!dataLength(data)) {
      // sending tokens without data, i.e. not for a receiver contract
      tokenReceiver = receiver
      receiver = '11111111111111111111111111111111'
    } else {
      throw new Error('--token-receiver is required when sending tokens with data')
    }

    if (argv.account) {
      accounts = argv.account.map((account, i) => {
        if (account.endsWith('=rw')) {
          accountIsWritableBitmap |= 1n << BigInt(i)
          account = account.substring(0, account.length - 3)
        }
        return account
      })
    } else accounts = [] as string[]
  } else if (argv.tokenReceiver || argv.account?.length) {
    throw new Error('--token-receiver and --account intended only for Solana dest')
  }

  if (!receiver) {
    if (sourceNetwork.family !== destNetwork.family)
      throw new Error('--receiver is required when sending to a different chain family')
    receiver = await source.getWalletAddress(argv) // send to self if same family
  }

  if (argv.estimateGasLimit != null || argv.onlyEstimate) {
    // TODO: implement for all chain families
    if (destNetwork.family !== ChainFamily.EVM)
      throw new Error(`Estimating gasLimit supported only on EVM, got=${destNetwork.family}`)
    const dest = (await getChain(destNetwork.chainSelector)) as unknown as EVMChain
    const onRamp = await source.getOnRampForRouter(argv.router, destNetwork.chainSelector)
    const lane = {
      sourceChainSelector: source.network.chainSelector,
      destChainSelector: destNetwork.chainSelector,
      onRamp,
      version: (await source.typeAndVersion(onRamp))[1] as CCIPVersion,
    }
    const destTokenAmounts = await sourceToDestTokenAmounts(
      source,
      destNetwork.chainSelector,
      onRamp,
      tokenAmounts,
    )

    const estimated = await estimateExecGasForRequest(source, dest, {
      lane,
      message: {
        sender: await source.getWalletAddress(argv),
        receiver,
        data,
        tokenAmounts: destTokenAmounts,
      },
    })
    console.log('Estimated gasLimit:', estimated)
    argv.gasLimit = Math.ceil(estimated * (1 + (argv.estimateGasLimit ?? 0) / 100))
    if (argv.onlyEstimate) return
  }

  // `--allow-out-of-order-exec` forces EVMExtraArgsV2, which shouldn't work on v1.2 lanes;
  // otherwise, fallsback to EVMExtraArgsV1 (compatible with v1.2 & v1.5)
  const extraArgs = {
    ...(argv.allowOutOfOrderExec != null || destNetwork.family !== ChainFamily.EVM
      ? { allowOutOfOrderExecution: !!argv.allowOutOfOrderExec }
      : {}),
    ...(destNetwork.family === ChainFamily.Solana
      ? { computeUnits: BigInt(argv.gasLimit) }
      : { gasLimit: BigInt(argv.gasLimit) }),
    ...(tokenReceiver ? { tokenReceiver } : {}),
    ...(accounts ? { accounts, accountIsWritableBitmap } : {}),
  }

  let feeToken, feeTokenInfo
  if (argv.feeToken) {
    try {
      feeToken = (source.constructor as ChainStatic).getAddress(argv.feeToken)
      feeTokenInfo = await source.getTokenInfo(feeToken)
    } catch (_) {
      const feeTokens = await source.listFeeTokens(argv.router)
      console.debug('supported feeTokens:', feeTokens)
      for (const [token, info] of Object.entries(feeTokens)) {
        if (info.symbol === 'UNKNOWN' || info.symbol !== argv.feeToken) continue
        feeToken = token
        feeTokenInfo = info
        break
      }
      if (!feeTokenInfo) throw new Error(`Fee token "${argv.feeToken}" not found`)
    }
  } else {
    const nativeToken = await source.getNativeTokenForRouter(argv.router)
    feeTokenInfo = await source.getTokenInfo(nativeToken)
  }

  const message: AnyMessage = {
    receiver,
    data,
    extraArgs: extraArgs as ExtraArgs,
    feeToken, // feeToken==ZeroAddress means native
    tokenAmounts,
  }

  // calculate fee
  const fee = await source.getFee(argv.router, destNetwork.chainSelector, message)

  console.info(
    'Fee:',
    fee,
    '=',
    formatUnits(fee, feeTokenInfo.decimals),
    !argv.feeToken && feeTokenInfo.symbol.startsWith('W')
      ? feeTokenInfo.symbol.substring(1)
      : feeTokenInfo.symbol,
  )
  if (argv.onlyGetFee) return

  const tx = await source.sendMessage(
    argv.router,
    destNetwork.chainSelector,
    { ...message, fee },
    argv,
  )
  console.log(
    '🚀 Sending message to',
    tokenReceiver || receiver,
    '@',
    destNetwork.name,
    ', tx =>',
    tx.hash,
  )

  // print CCIPRequest from tx receipt
  const request = (await fetchCCIPRequestsInTx(tx))[0]

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
}
