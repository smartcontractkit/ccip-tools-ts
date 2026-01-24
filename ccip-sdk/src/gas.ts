import { type BytesLike, formatUnits, hexlify, randomBytes } from 'ethers'

import type { Chain } from './chain.ts'
import { CCIPMethodUnsupportedError, CCIPTokenDecimalsInsufficientError } from './errors/index.ts'
import { discoverOffRamp } from './execution.ts'
import { sourceToDestTokenAddresses } from './requests.ts'
import type { Lane } from './types.ts'

/**
 * Estimate CCIP gasLimit needed to execute a request on a contract receiver.
 * @param source - Provider for the source chain.
 * @param dest - Provider for the destination chain.
 * @param request - CCIP request info containing `lane` and `message` details.
 * @returns Estimated gasLimit.
 */
export async function estimateExecGasForRequest(
  source: Chain,
  dest: Chain,
  request: {
    lane: Lane
    message: {
      messageId?: string
      sender?: string
      receiver: string
      data?: BytesLike
      tokenAmounts?: readonly ({
        amount: bigint
      } & (
        | { token: string }
        | { sourceTokenAddress?: string; sourcePoolAddress: string; destTokenAddress: string }
      ))[]
    }
  },
) {
  if (!dest.estimateReceiveExecution)
    throw new CCIPMethodUnsupportedError(dest.constructor.name, 'estimateReceiveExecution')

  const offRamp = await discoverOffRamp(source, dest, request.lane.onRamp, source)

  const destTokenAmounts = await Promise.all(
    (request.message.tokenAmounts ?? []).map(async (ta) => {
      const tokenAmount =
        'destTokenAddress' in ta
          ? ta
          : await sourceToDestTokenAddresses(
              source,
              dest.network.chainSelector,
              request.lane.onRamp,
              ta,
            )
      const sourceTokenAddress =
        'token' in ta
          ? ta.token
          : ta.sourceTokenAddress
            ? ta.sourceTokenAddress
            : await source.getTokenForTokenPool(tokenAmount.sourcePoolAddress)
      const [{ decimals: sourceDecimals }, { decimals: destDecimals }] = await Promise.all([
        source.getTokenInfo(sourceTokenAddress),
        dest.getTokenInfo(tokenAmount.destTokenAddress),
      ])
      const destAmount =
        (tokenAmount.amount * 10n ** BigInt(destDecimals)) / 10n ** BigInt(sourceDecimals)
      if (destAmount === 0n)
        throw new CCIPTokenDecimalsInsufficientError(
          tokenAmount.destTokenAddress,
          destDecimals,
          dest.network.name,
          formatUnits(tokenAmount.amount, sourceDecimals),
        )
      return { token: tokenAmount.destTokenAddress, amount: destAmount }
    }),
  )
  return dest.estimateReceiveExecution({
    receiver: request.message.receiver,
    offRamp,
    message: {
      messageId: request.message.messageId ?? hexlify(randomBytes(32)),
      sender: request.message.sender,
      data: request.message.data,
      sourceChainSelector: request.lane.sourceChainSelector,
      destTokenAmounts,
    },
  })
}
