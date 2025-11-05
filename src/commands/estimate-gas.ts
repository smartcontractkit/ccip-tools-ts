import { ZeroAddress, hexlify, isHexString, toUtf8Bytes } from 'ethers'

import { chainIdFromName, chainSelectorFromId, estimateExecGasForRequest } from '../lib/index.ts'
import type { Providers } from '../providers.ts'
import { parseTokenAmounts, sourceToDestTokenAmounts } from './utils.ts'

export async function estimateGas(
  providers: Providers,
  argv: {
    source: string
    dest: string
    router: string
    receiver: string
    sender?: string
    data?: string
    transferTokens?: string[]
    page: number
  },
) {
  const sourceChainId = isNaN(+argv.source) ? chainIdFromName(argv.source) : +argv.source
  const source = await providers.forChainId(sourceChainId)
  const destChainId = isNaN(+argv.dest) ? chainIdFromName(argv.dest) : +argv.dest
  const dest = await providers.forChainId(destChainId)

  const data = !argv.data
    ? '0x'
    : isHexString(argv.data)
      ? argv.data
      : hexlify(toUtf8Bytes(argv.data))
  let sourceTokenAmounts: { token: string; amount: bigint }[] = []
  if (argv.transferTokens) {
    sourceTokenAmounts = await parseTokenAmounts(source, argv.transferTokens)
  }
  const [tokenAmounts, onRamp] = await sourceToDestTokenAmounts(sourceTokenAmounts, {
    router: argv.router,
    source,
    dest,
  })
  const [lane] = await getOnRampLane(source, onRamp, chainSelectorFromId(destChainId))

  const gas = await estimateExecGasForRequest(
    dest,
    {
      lane,
      message: {
        sender: argv.sender ?? ZeroAddress,
        receiver: argv.receiver,
        data,
        tokenAmounts,
      },
    },
    { page: argv.page },
  )
  console.log('Estimated gas:', gas)
}
