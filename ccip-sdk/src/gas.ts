import { formatUnits, hexlify, randomBytes, toBigInt } from 'ethers'
import type { Simplify } from 'type-fest'

import type { Chain } from './chain.ts'
import {
  CCIPContractTypeInvalidError,
  CCIPMethodUnsupportedError,
  CCIPOnRampRequiredError,
  CCIPTokenDecimalsInsufficientError,
  CCIPTokenNotInRegistryError,
} from './errors/index.ts'
import type { CCIPMessage_V2_0 } from './evm/messages.ts'
import { discoverOffRamp } from './execution.ts'
import { networkInfo } from './networks.ts'
import { buildMessageForDest } from './requests.ts'
import type { CCIPMessage_V1_6_Solana } from './solana/types.ts'
import type { CCIPMessage, MessageInput } from './types.ts'
import { getDataBytes } from './utils.ts'

/**
 * A subset of {@link MessageInput} for estimating receive execution gas.
 */
export type EstimateMessageInput = Simplify<
  Pick<CCIPMessage, 'receiver' | 'sourceChainSelector'> &
    Partial<Pick<MessageInput, 'data'>> &
    Partial<
      Pick<
        CCIPMessage_V2_0,
        'messageId' | 'sender' | 'onRampAddress' | 'offRampAddress' | 'finality'
      >
    > &
    Partial<
      Pick<CCIPMessage_V1_6_Solana, 'tokenReceiver' | 'accounts' | 'accountIsWritableBitmap'>
    > & {
      /**
       * optional tokenAmounts; `amount` with either source `token` (as in MessageInput) or
       * `{ sourceTokenAddress?, sourcePoolAddress, destTokenAddress }` (as in v1.5..v2.0 tokenAmounts)
       * can be provided
       */
      tokenAmounts?: readonly ({
        amount: bigint
        extraData?: string
      } & (
        | { token: string }
        | {
            sourceTokenAddress?: string
            sourcePoolAddress: string
            destTokenAddress: string
          }
      ))[]
    }
>

/**
 * Options for {@link estimateReceiveExecution} function.
 */
export type EstimateReceiveExecutionOpts = {
  /** Source chain instance (for token data retrieval) */
  source: Chain
  /** Dest chain instance (for token and execution simulation) */
  dest: Chain
  /** source router or onRamp, or dest offRamp contract address */
  routerOrRamp: string
  /** message to be simulated */
  message: Omit<EstimateMessageInput, 'sourceChainSelector'>
}

/**
 * Map source token to its pool address and destination token address.
 *
 * Resolves token routing by querying the TokenAdminRegistry and TokenPool
 * to find the corresponding destination chain token.
 *
 * @param opts - options to convert source to dest token addresses
 * @returns Extended token amount with `sourcePoolAddress`, `sourceTokenAddress`, and `destTokenAddress`
 *
 * @throws {@link CCIPTokenNotInRegistryError} if token is not registered in TokenAdminRegistry
 *
 * @example
 * ```typescript
 * import { sourceToDestTokenAddresses, EVMChain } from '@chainlink/ccip-sdk'
 *
 * const source = await EVMChain.fromUrl('https://rpc.sepolia.org')
 * const tokenAmount = await sourceToDestTokenAddresses({
 *   source,
 *   onRamp: '0xOnRamp...',
 *   destChainSelector: 14767482510784806043n,
 *   sourceTokenAmount: { token: '0xLINK...', amount: 1000000000000000000n },
 * })
 * console.log(`Pool: ${tokenAmount.sourcePoolAddress}`)
 * console.log(`Dest token: ${tokenAmount.destTokenAddress}`)
 * ```
 */
export async function sourceToDestTokenAddresses<S extends { token: string }>({
  source,
  onRamp,
  destChainSelector,
  sourceTokenAmount,
}: {
  /** Source chain instance */
  source: Chain
  /** OnRamp contract address */
  onRamp: string
  /** Destination chain selector */
  destChainSelector: bigint
  /** Token amount object containing `token` and `amount` */
  sourceTokenAmount: S
}): Promise<
  S & {
    sourcePoolAddress: string
    sourceTokenAddress: string
    destTokenAddress: string
  }
> {
  const tokenAdminRegistry = await source.getTokenAdminRegistryFor(onRamp, destChainSelector)
  const sourceTokenAddress = sourceTokenAmount.token
  const { tokenPool: sourcePoolAddress } = await source.getRegistryTokenConfig(
    tokenAdminRegistry,
    sourceTokenAddress,
  )
  if (!sourcePoolAddress)
    throw new CCIPTokenNotInRegistryError(sourceTokenAddress, tokenAdminRegistry)
  const remotes = await source.getTokenPoolRemotes(sourcePoolAddress, destChainSelector)
  return {
    ...sourceTokenAmount,
    sourcePoolAddress,
    sourceTokenAddress,
    destTokenAddress: remotes[networkInfo(destChainSelector).name]!.remoteToken,
  }
}

function getSourceDecimalsFromExtraData(extraData?: string): bigint | undefined {
  if (!extraData) return undefined
  try {
    const bytes = getDataBytes(extraData)
    if (bytes.length !== 32) return undefined
    const decimals = toBigInt(bytes)
    return 0 < decimals && decimals <= 36 ? decimals : undefined
  } catch {
    return undefined
  }
}

/**
 * If given a `{token, amount}` and no `source` (e.g. when called from Chain.estimateReceiveExecution),
 * assume it's already a dest tokenAmount and return as-is.
 * Otherwise, if given a source tokenAmount, resolve the corresponding destTokenAddress and adjust
 * the amount for decimals difference.
 * @param opts - options to get destination token amount
 * @returns dest `token` and adjusted `amount` for the given source token amount
 */
export async function getDestTokenAmount({
  source,
  onRamp,
  dest,
  tokenAmount,
}: {
  source?: Chain
  onRamp?: string
  dest: Chain
  tokenAmount: NonNullable<EstimateMessageInput['tokenAmounts']>[number]
}): Promise<{ token: string; amount: bigint }> {
  let sourceTokenAddress, sourcePoolAddress, destTokenAddress
  if ('destTokenAddress' in tokenAmount) {
    ;({ destTokenAddress, sourcePoolAddress, sourceTokenAddress } = tokenAmount)
  } else if (!source)
    return tokenAmount // if we don't have a source, assume we were already given a dest `{token, amount}`
  else {
    ;({ destTokenAddress, sourceTokenAddress, sourcePoolAddress } =
      await sourceToDestTokenAddresses({
        source,
        onRamp: onRamp!,
        destChainSelector: dest.network.chainSelector,
        sourceTokenAmount: tokenAmount,
      }))
  }

  const { decimals: destDecimals } = await dest.getTokenInfo(destTokenAddress)
  const sourceDecimals =
    getSourceDecimalsFromExtraData(tokenAmount.extraData) ??
    (source
      ? (
          await source.getTokenInfo(
            sourceTokenAddress ?? (await source.getTokenForTokenPool(sourcePoolAddress)),
          )
        ).decimals
      : destDecimals)

  const destAmount =
    (tokenAmount.amount * BigInt(10) ** BigInt(destDecimals)) / BigInt(10) ** BigInt(sourceDecimals)
  if (destAmount === 0n)
    throw new CCIPTokenDecimalsInsufficientError(
      destTokenAddress,
      destDecimals,
      dest.network.name,
      formatUnits(tokenAmount.amount, sourceDecimals),
    )

  return { token: destTokenAddress, amount: destAmount }
}

/**
 * Estimate CCIP gasLimit needed to execute a request on a contract receiver.
 *
 * @param opts - {@link EstimateReceiveExecutionOpts} for estimation
 * @returns Estimated execution gas (base transaction cost subtracted)
 *
 * @throws {@link CCIPMethodUnsupportedError} if dest chain doesn't support estimation
 * @throws {@link CCIPContractTypeInvalidError} if routerOrRamp is not a valid contract type
 * @throws {@link CCIPTokenDecimalsInsufficientError} if dest token has insufficient decimals
 * @throws {@link CCIPOnRampRequiredError} if no OnRamp found for the given OffRamp and source chain
 *
 * @example
 * ```typescript
 * import { estimateReceiveExecution, EVMChain } from '@chainlink/ccip-sdk'
 *
 * const source = await EVMChain.fromUrl('https://rpc.sepolia.org')
 * const dest = await EVMChain.fromUrl('https://rpc.fuji.avax.network')
 *
 * const gasLimit = await estimateReceiveExecution({
 *   source,
 *   dest,
 *   routerOrRamp: '0xRouter...',
 *   message: {
 *     sender: '0x...',
 *     receiver: '0x...',
 *     data: '0x...',
 *     tokenAmounts: [],
 *   },
 * })
 * console.log('Estimated gas:', gasLimit)
 * ```
 */
export async function estimateReceiveExecution({
  source,
  dest,
  routerOrRamp,
  message,
}: EstimateReceiveExecutionOpts) {
  let onRamp: string, offRamp: string
  if (message.onRampAddress) onRamp = message.onRampAddress
  if (message.offRampAddress) offRamp = message.offRampAddress
  if (!onRamp! || !offRamp!)
    try {
      const [type] = await source.typeAndVersion(routerOrRamp)
      if (!type.includes('OnRamp'))
        onRamp = await source.getOnRampForRouter(routerOrRamp, dest.network.chainSelector)
      else onRamp = routerOrRamp
      offRamp ||= await discoverOffRamp(source, dest, onRamp, source)
    } catch (sourceErr) {
      try {
        const [type, , tnv] = await dest.typeAndVersion(routerOrRamp)
        if (!type.includes('OffRamp'))
          throw new CCIPContractTypeInvalidError(routerOrRamp, tnv, ['OffRamp'])
        offRamp = routerOrRamp
        const onRamps = await dest.getOnRampsForOffRamp(offRamp, source.network.chainSelector)
        if (!onRamps.length) throw new CCIPOnRampRequiredError()
        onRamp = onRamps[onRamps.length - 1]!
      } catch {
        throw sourceErr // re-throw original error
      }
    }

  const destTokenAmounts = await Promise.all(
    (message.tokenAmounts ?? []).map(async (tokenAmount) =>
      getDestTokenAmount({ source, dest, onRamp, tokenAmount }),
    ),
  )
  const payload = {
    offRamp,
    message: {
      ...buildMessageForDest({ ...message, tokenAmounts: destTokenAmounts }, dest.network.family),
      messageId: message.messageId ?? hexlify(randomBytes(32)),
      sourceChainSelector: source.network.chainSelector,
    },
  }
  await dest.checkExecute(payload)

  if (!dest.estimateReceiveExecution)
    throw new CCIPMethodUnsupportedError(dest.constructor.name, 'estimateReceiveExecution')

  return dest.estimateReceiveExecution(payload)
}
