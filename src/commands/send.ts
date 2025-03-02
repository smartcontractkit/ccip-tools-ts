import { Contract, ZeroAddress, hexlify, isHexString, toUtf8Bytes, zeroPadValue } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import TokenABI from '../abi/BurnMintERC677Token.js'
import RouterABI from '../abi/Router.js'
import {
  bigIntReplacer,
  chainIdFromName,
  chainNameFromId,
  chainSelectorFromId,
  encodeExtraArgs,
  estimateExecGasForRequest,
  fetchCCIPMessagesInTx,
} from '../lib/index.js'
import type { Providers } from '../providers.js'
import {
  getWallet,
  parseTokenAmounts,
  prettyRequest,
  sourceToDestTokenAmounts,
  withDateTimestamp,
} from './utils.js'
import { Format } from './types.js'

type AnyMessage = Parameters<TypedContract<typeof RouterABI>['ccipSend']>[1]

export async function sendMessage(
  providers: Providers,
  argv: {
    source: string
    dest: string
    router: string
    receiver?: string
    data?: string
    gasLimit?: number
    estimateGasLimit?: number
    allowOutOfOrderExec?: boolean
    feeToken?: string
    transferTokens?: string[]
    format: Format
    wallet?: string
  },
) {
  const sourceChainId = isNaN(+argv.source) ? chainIdFromName(argv.source) : +argv.source
  const source = await providers.forChainId(sourceChainId)
  const wallet = (await getWallet(argv)).connect(source)

  const destChainId = isNaN(+argv.dest) ? chainIdFromName(argv.dest) : +argv.dest
  const destSelector = chainSelectorFromId(destChainId)

  const router = new Contract(argv.router, RouterABI, wallet) as unknown as TypedContract<
    typeof RouterABI
  >

  let tokenAmounts: { token: string; amount: bigint }[] = []
  if (argv.transferTokens) {
    tokenAmounts = await parseTokenAmounts(source, argv.transferTokens)
  }

  const receiver = argv.receiver ?? wallet.address
  const data = !argv.data
    ? '0x'
    : isHexString(argv.data)
      ? argv.data
      : hexlify(toUtf8Bytes(argv.data))

  if (argv.estimateGasLimit != null) {
    const [destTokenAmounts, onRampAddress] = await sourceToDestTokenAmounts(tokenAmounts, {
      router: argv.router,
      source,
      dest: await providers.forChainId(destChainId),
    })

    const estimated = await estimateExecGasForRequest(
      source,
      await providers.forChainId(destChainId),
      onRampAddress,
      {
        sender: wallet.address,
        receiver,
        data,
        tokenAmounts: destTokenAmounts,
      },
    )
    console.log('Estimated gasLimit:', estimated)
    argv.gasLimit = Math.ceil(estimated * (1 + argv.estimateGasLimit / 100))
  }

  // `--allow-out-of-order-exec` forces EVMExtraArgsV2, which shouldn't work on v1.2 lanes;
  // otherwise, fallsback to EVMExtraArgsV1 (compatible with v1.2 & v1.5)
  const extraArgs = {
    ...(argv.allowOutOfOrderExec != null
      ? { allowOutOfOrderExecution: argv.allowOutOfOrderExec }
      : {}),
    ...(argv.gasLimit != null ? { gasLimit: BigInt(argv.gasLimit) } : {}),
  }

  const message: AnyMessage = {
    receiver: zeroPadValue(receiver, 32), // receiver must be 32B value-encoded
    data,
    extraArgs: encodeExtraArgs(extraArgs),
    feeToken: argv.feeToken || ZeroAddress, // feeToken==ZeroAddress means native
    tokenAmounts,
  }

  // calculate fee
  const fee = await router.getFee(destSelector, message)

  // make sure to approve once per token, for the total amount (including fee, if needed)
  const amountsToApprove = tokenAmounts.reduce(
    (acc, { token, amount }) => ({ ...acc, [token]: (acc[token] ?? 0n) + amount }),
    <Record<string, bigint>>{},
  )
  if (message.feeToken !== ZeroAddress) {
    amountsToApprove[message.feeToken as string] =
      (amountsToApprove[message.feeToken as string] ?? 0n) + fee
  }

  // approve all tokens (including fee token) in parallel
  let nonce = await source.getTransactionCount(wallet.address)
  await Promise.all(
    Object.entries(amountsToApprove).map(async ([token, amount]) => {
      const contract = new Contract(token, TokenABI, wallet) as unknown as TypedContract<
        typeof TokenABI
      >
      const allowance = await contract.allowance(wallet.address, argv.router)
      if (allowance < amount) {
        // optimization: hardcode nonce and gasLimit to send all approvals in parallel without estimating
        const tx = await contract.approve(argv.router, amount, { nonce: nonce++, gasLimit: 50_000 })
        console.log('Approving', amount, token, 'for', argv.router, '=', tx.hash)
        await tx.wait(1, 60_000)
      }
    }),
  )

  const tx = await router.ccipSend(destSelector, message, {
    nonce: nonce++,
    // if native fee, include it in value; otherwise, it's transferedFrom feeToken
    ...(message.feeToken === ZeroAddress ? { value: fee } : {}),
  })
  console.log(
    'Sending message to',
    receiver,
    '@',
    chainNameFromId(destChainId),
    ', tx_hash =',
    tx.hash,
  )

  // print CCIPRequest from tx receipt
  const receipt = (await tx.wait(1, 60_000))!
  const request = (await fetchCCIPMessagesInTx(receipt))[0]

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
