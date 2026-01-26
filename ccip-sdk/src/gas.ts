import { type BytesLike, formatUnits, hexlify, randomBytes } from 'ethers'

import type { Chain } from './chain.ts'
import {
  CCIPContractTypeInvalidError,
  CCIPMethodUnsupportedError,
  CCIPTokenDecimalsInsufficientError,
} from './errors/index.ts'
import { discoverOffRamp } from './execution.ts'
import { sourceToDestTokenAddresses } from './requests.ts'

/**
 * A subset of [[MessageInput]] for estimating receive execution gas.
 */
export type EstimateMessageInput = {
  /** receiver contract address */
  receiver: string
  /** optional messageId; random hash will be passed if omitted */
  messageId?: string
  /** optional sender: zero address will be used if omitted */
  sender?: string
  /** optional data: zero bytes will be used if ommitted */
  data?: BytesLike
  /**
   * optional tokenAmounts; `amount` with either source `token` (as in MessageInput) or
   * `{ sourceTokenAddress?, sourcePoolAddress, destTokenAddress }` (as in v1.5..v1.7 tokenAmounts)
   * can be provided
   */
  tokenAmounts?: readonly ({
    amount: bigint
  } & (
    | { token: string }
    | { sourceTokenAddress?: string; sourcePoolAddress: string; destTokenAddress: string }
  ))[]
}

/**
 * Options for [[estimateReceiveExecution]] function.
 */
export type EstimateReceiveExecutionOpts = {
  /** Source chain instance (for token data retrieval) */
  source: Chain
  /** Dest chain instance (for token and execution simulation) */
  dest: Chain
  /** source router or onRamp, or dest offRamp contract address */
  routerOrRamp: string
  /** message to be simulated */
  message: EstimateMessageInput
}

/**
 * Estimate CCIP gasLimit needed to execute a request on a contract receiver.
 * @param opts - Options for estimation: source and dest chains, router or ramp address, and message
 * @returns Estimated gasLimit.
 */
export async function estimateReceiveExecution({
  source,
  dest,
  routerOrRamp,
  message,
}: EstimateReceiveExecutionOpts) {
  if (!dest.estimateReceiveExecution)
    throw new CCIPMethodUnsupportedError(dest.constructor.name, 'estimateReceiveExecution')

  let onRamp, offRamp: string
  try {
    const tnv = await source.typeAndVersion(routerOrRamp)
    if (!tnv[0].includes('OnRamp'))
      onRamp = await source.getOnRampForRouter(routerOrRamp, dest.network.chainSelector)
    else onRamp = routerOrRamp
    offRamp = await discoverOffRamp(source, dest, onRamp, source)
  } catch {
    const tnv = await dest.typeAndVersion(routerOrRamp)
    if (!tnv[0].includes('OffRamp'))
      throw new CCIPContractTypeInvalidError(routerOrRamp, tnv[2], ['OffRamp'])
    offRamp = routerOrRamp
    onRamp = await dest.getOnRampForOffRamp(offRamp, source.network.chainSelector)
  }

  const destTokenAmounts = await Promise.all(
    (message.tokenAmounts ?? []).map(async (ta) => {
      const tokenAmount =
        'destTokenAddress' in ta
          ? ta
          : await sourceToDestTokenAddresses(source, dest.network.chainSelector, onRamp, ta)
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
    receiver: message.receiver,
    offRamp,
    message: {
      messageId: message.messageId ?? hexlify(randomBytes(32)),
      sender: message.sender,
      data: message.data,
      sourceChainSelector: source.network.chainSelector,
      destTokenAmounts,
    },
  })
}
