import { type BytesLike, formatUnits, hexlify, randomBytes } from 'ethers'
import type { Simplify } from 'type-fest'

import type { Chain } from './chain.ts'
import {
  CCIPContractTypeInvalidError,
  CCIPMethodUnsupportedError,
  CCIPOnRampRequiredError,
  CCIPSourcePoolRevertError,
  CCIPTokenDecimalsInsufficientError,
  CCIPTokenDecimalsUnavailableError,
  CCIPTokenNotInRegistryError,
} from './errors/index.ts'
import type { CCIPMessage_V2_0 } from './evm/messages.ts'
import { discoverOffRamp } from './execution.ts'
import type { FinalityRequested } from './extra-args.ts'
import { networkInfo } from './networks.ts'
import { buildMessageForDest } from './requests.ts'
import type { CCIPMessage_V1_6_Solana } from './solana/types.ts'
import type { CCIPMessage, MessageInput, OffchainTokenData } from './types.ts'
import { getDataBytes, getSourceDecimalsFromExtraData, scaleDecimals } from './utils.ts'

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
        /** explicit destination-token decimals, for dest tokens without the optional ERC-20
         * `decimals()` view when their pool cannot declare them either (v1.5.0 pools) */
        destDecimals?: number
      } & (
        | { token: string }
        | {
            sourceTokenAddress?: string
            sourcePoolAddress: string
            destTokenAddress: string
            /** per-token receiver (v2.0 `TokenTransferV1.tokenReceiver`), when known */
            tokenReceiver?: string
          }
      ))[]
      /**
       * Message-level `GenericExtraArgsV3.tokenArgs` — the OnRamp passes it through to
       * `IPoolV2.lockOrBurn`, so pools/hooks branching on it must see the same value here.
       * Empty for legacy V1/V2 extraArgs.
       */
      tokenArgs?: string
      /**
       * Offchain token data (CCTP attestations, bridge proofs), index-aligned with
       * `tokenAmounts`. Only exists post-send — fetch with `source.getOffchainTokenData(request)`
       * when estimating for an already-sent message (e.g. manual execution); enables the
       * destination preflight for pools whose `releaseOrMint` consumes it.
       */
      offchainTokenData?: readonly OffchainTokenData[]
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
 * Candidate message for {@link Chain.getRequiredCCVs} — the fields the destination OffRamp
 * `getCCVsForMessage` resolver reads. `destTokenAmounts` are the already-resolved destination token
 * amounts (as produced by {@link getDestTokenAmount}).
 */
export type GetRequiredCCVsMessage = {
  sourceChainSelector: bigint
  receiver: string
  finality?: FinalityRequested
  sender?: string
  data?: BytesLike
  ccipReceiveGasLimit?: number | bigint
  gasLimit?: number | bigint
  destTokenAmounts?: readonly {
    token?: string
    destTokenAddress?: string
    amount: bigint
    extraData?: string
  }[]
}

/** Resolved CCV requirements returned by {@link Chain.getRequiredCCVs}. */
export type GetRequiredCCVsResult = {
  requiredCCVs: readonly string[]
  optionalCCVs: readonly string[]
  optionalThreshold: number
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
    destPoolAddresses: string[]
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
  const remote = remotes[networkInfo(destChainSelector).name]!
  return {
    ...sourceTokenAmount,
    sourcePoolAddress,
    sourceTokenAddress,
    destTokenAddress: remote.remoteToken,
    destPoolAddresses: remote.remotePools,
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
  offRamp,
  tokenAmount,
}: {
  source?: Chain
  onRamp?: string
  dest: Chain
  /** dest OffRamp — resolves the dest pool from the dest registry when the source can't */
  offRamp?: string
  tokenAmount: NonNullable<EstimateMessageInput['tokenAmounts']>[number]
}): Promise<{ token: string; amount: bigint }> {
  let sourceTokenAddress, sourcePoolAddress, destTokenAddress, destPoolAddresses
  if ('destTokenAddress' in tokenAmount) {
    ;({ destTokenAddress, sourcePoolAddress, sourceTokenAddress } = tokenAmount)
  } else if (!source) return tokenAmount // if we don't have a source, assume we were already given a dest `{token, amount}`
  else {
    ;({ destTokenAddress, sourceTokenAddress, sourcePoolAddress, destPoolAddresses } =
      await sourceToDestTokenAddresses({
        source,
        onRamp: onRamp!,
        destChainSelector: dest.network.chainSelector,
        sourceTokenAmount: tokenAmount,
      }))
  }

  // dest decimals: the token's own (optional) view, else the dest pool's declared decimals —
  // the authoritative source for tokens without the ERC-20 `decimals()` view, since the pool
  // uses exactly these decimals for its own release conversion — else the caller-declared
  // `destDecimals` (e.g. ccip-cli `token=amount:src[:dest]`)
  const destDecimals = await getDestTokenDecimals({
    dest,
    destTokenAddress,
    destPoolAddresses,
    offRamp,
    destDecimals: tokenAmount.destDecimals,
  })
  const sourceDecimals =
    getSourceDecimalsFromExtraData(tokenAmount.extraData) ??
    (source
      ? (
          await source.getTokenInfo(
            sourceTokenAddress ?? (await source.getTokenForTokenPool(sourcePoolAddress)),
          )
        ).decimals
      : destDecimals)

  const destAmount = scaleDecimals(tokenAmount.amount, sourceDecimals, destDecimals)
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
 * Resolve a destination token's decimals: its own (optional) ERC-20 `decimals()` view first,
 * else the decimals its destination pool declares (`getTokenDecimals()`, pool v1.5.1+) — the
 * authoritative fallback for tokens that don't implement the optional view, since the pool uses
 * exactly these decimals for its own release conversion — else the caller-declared
 * `destDecimals`. The pool is the source-resolved `destPoolAddresses` when available, else
 * resolved from the dest registry via `offRamp`.
 * @throws The original {@link CCIPTokenDecimalsUnavailableError} when nothing can declare them
 */
async function getDestTokenDecimals({
  dest,
  destTokenAddress,
  destPoolAddresses,
  offRamp,
  destDecimals,
}: {
  dest: Chain
  destTokenAddress: string
  destPoolAddresses?: readonly string[]
  offRamp?: string
  destDecimals?: number
}): Promise<number> {
  try {
    return (await dest.getTokenInfo(destTokenAddress)).decimals
  } catch (err) {
    if (!(err instanceof CCIPTokenDecimalsUnavailableError)) throw err
    if (dest.getTokenPoolDecimals) {
      // source-resolved pools first (pre-send); multiple may be configured — the last is the
      // active one, so try each until one declares
      for (const pool of destPoolAddresses ?? []) {
        try {
          return await dest.getTokenPoolDecimals(pool)
        } catch {
          // try the next pool
        }
      }
      // no source-resolved pools (post-send shape): resolve the pool from the dest registry.
      // Best-effort — a failure here (unregistered token, transport) must not mask the
      // caller-declared fallback below
      if (offRamp) {
        const pool = await dest
          .getTokenAdminRegistryFor(offRamp)
          .then((registry) => dest.getRegistryTokenConfig(registry, destTokenAddress))
          .then(({ tokenPool }) => tokenPool)
          .catch(() => undefined)
        if (pool) {
          try {
            return await dest.getTokenPoolDecimals(pool)
          } catch {
            // fall through to the caller-declared decimals
          }
        }
      }
    }
    if (destDecimals != null) return destDecimals
    throw err
  }
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

  const resolvedTokenAmounts = await Promise.all(
    (message.tokenAmounts ?? []).map(async (tokenAmount) => {
      const destTokenAmount = await getDestTokenAmount({
        source,
        dest,
        onRamp,
        offRamp,
        tokenAmount,
      })
      let forCheck: NonNullable<EstimateMessageInput['tokenAmounts']>[number] = destTokenAmount
      let destForEstimate = destTokenAmount
      if ('sourcePoolAddress' in tokenAmount) {
        // post-send (an already-emitted message, e.g. manual-exec): the emitted fields are the
        // authoritative truth — pass them through verbatim; never re-derive the source pool from
        // current dest config (it may have migrated) nor re-simulate lockOrBurn
        forCheck = tokenAmount
      } else if (tokenAmount.extraData && getDataBytes(tokenAmount.extraData).length) {
        // caller-supplied source pool data: keep it for the check (it declares the source
        // decimals / pool payload the amount is denominated in)
        forCheck = {
          token: destTokenAmount.token,
          amount: tokenAmount.amount,
          extraData: tokenAmount.extraData,
        }
      } else if (source.simulateLockOrBurn) {
        // pre-send: obtain the pool-reported destPoolData and post-fee destTokenAmount from the
        // source pool's lockOrBurn, so the destination releaseOrMint simulation consumes the same
        // message the OnRamp would actually emit
        try {
          const {
            sourcePoolAddress,
            destPoolData,
            destTokenAmount: postFeeAmount,
          } = await source.simulateLockOrBurn({
            onRamp,
            destChainSelector: dest.network.chainSelector,
            token: tokenAmount.token,
            amount: tokenAmount.amount,
            originalSender: message.sender,
            receiver: message.receiver,
            tokenReceiver: message.tokenReceiver,
            tokenArgs: message.tokenArgs,
            finality: message.finality,
          })
          forCheck = {
            // the OnRamp writes the pool-returned post-fee amount into the emitted message
            amount: postFeeAmount,
            sourceTokenAddress: tokenAmount.token,
            sourcePoolAddress,
            destTokenAddress: destTokenAmount.token,
            extraData: destPoolData,
          }
          if (postFeeAmount !== tokenAmount.amount && tokenAmount.amount > 0n)
            // scale the dest-denominated estimate amount by the same fee ratio
            destForEstimate = {
              token: destTokenAmount.token,
              amount: (destTokenAmount.amount * postFeeAmount) / tokenAmount.amount,
            }
        } catch (err) {
          // a genuine source-side gate blocks the send (ccipSend would revert the same way);
          // anything else (transport, state-override artifacts) falls back to the decimals default
          if (err instanceof CCIPSourcePoolRevertError) throw err
          source.logger.debug(
            `lockOrBurn simulation unavailable for token=${tokenAmount.token}; using decimals default:`,
            err,
          )
        }
      }
      return { dest: destForEstimate, forCheck }
    }),
  )
  const destTokenAmounts = resolvedTokenAmounts.map(({ dest }) => dest)
  // one resolution pass, two payloads: the check consumes the source-pool-reported shape
  // (source-denominated post-fee amount + pool destPoolData, or the emitted fields verbatim),
  // while the gas estimate keeps the dest-denominated tokenAmounts `buildMessageForDest` shaped
  const baseMessage = {
    ...buildMessageForDest({ ...message, tokenAmounts: destTokenAmounts }, dest.network.family),
    messageId: message.messageId ?? hexlify(randomBytes(32)),
    sourceChainSelector: source.network.chainSelector,
  }
  await dest.checkExecute({
    offRamp,
    message: {
      ...baseMessage,
      tokenAmounts: resolvedTokenAmounts.map(({ forCheck }) => forCheck),
      // the resolved OnRamp lets the dest OffRamp's allowed-onRamps lane gate run pre-send too
      onRampAddress: onRamp,
      // post-send only (fetched from the source request); enables the destination preflight for
      // attestation-consuming pools
      offchainTokenData: message.offchainTokenData,
    },
  })

  if (!dest.estimateReceiveExecution)
    throw new CCIPMethodUnsupportedError(dest.constructor.name, 'estimateReceiveExecution')

  return dest.estimateReceiveExecution({ offRamp, message: baseMessage })
}

/**
 * Resolve the CCVs the destination will require for a candidate message, and whether its finality is
 * accepted, via the OffRamp's `getCCVsForMessage` view (a read; no send). Resolves the onRamp/offRamp from
 * `routerOrRamp` like {@link estimateReceiveExecution}, maps token amounts to their destination
 * counterparts, then queries the resolver. A disallowed finality throws `CCIPFinalityNotAllowedError`.
 *
 * The set is sender-scoped: pass the real `sender`. It is informative only — comparing it against the
 * source-engaged set is left to the caller, since source and destination CCVs are distinct per-chain
 * contracts with no on-chain address link.
 *
 * @param opts - {@link EstimateReceiveExecutionOpts} (source, dest, routerOrRamp, message)
 * @returns `{ requiredCCVs, optionalCCVs, optionalThreshold }`.
 */
export async function getRequiredCCVs({
  source,
  dest,
  routerOrRamp,
  message,
}: EstimateReceiveExecutionOpts): Promise<GetRequiredCCVsResult> {
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
      getDestTokenAmount({ source, dest, onRamp, offRamp, tokenAmount }),
    ),
  )

  if (!dest.getRequiredCCVs)
    throw new CCIPMethodUnsupportedError(dest.constructor.name, 'getRequiredCCVs')

  return dest.getRequiredCCVs({
    offRamp,
    message: {
      sourceChainSelector: source.network.chainSelector,
      receiver: message.receiver,
      finality: message.finality,
      sender: message.sender,
      data: message.data,
      destTokenAmounts,
    },
  })
}
