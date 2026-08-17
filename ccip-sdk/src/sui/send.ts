/**
 * Sui CCIP send operations — getFee, getFeeTokens, and unsigned send message generation.
 *
 * @packageDocumentation
 */

import { bcs } from '@mysten/sui/bcs'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { type TransactionArgument, Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { hexlify } from 'ethers'

import { getCcipStateAddress } from './discovery.ts'
import { getLatestPackageId, getObjectRef } from './objects.ts'
import type { TokenInfo } from '../chain.ts'
import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import { ChainFamily } from '../networks.ts'
import { encodeMoveExtraArgs } from '../shared/bcs-codecs.ts'
import type { AnyMessage, WithLogger } from '../types.ts'
import { encodeAddressToAny, getDataBytes } from '../utils.ts'
import type { UnsignedSuiTx } from './types.ts'

/** Coin type of the Sui native token. */
const SUI_COIN_TYPE = '0x2::sui::SUI'
/** Well-known Sui Clock shared object ID. */
const SUI_CLOCK_OBJECT_ID = '0x6'
/** Well-known Sui DenyList shared object ID (used by managed token pools). */
const SUI_DENY_LIST_OBJECT_ID = '0x403'

/**
 * Resolves a coin type string (e.g. "0x2::sui::SUI") to its CoinMetadata
 * object ID. The onramp `get_fee` expects `&CoinMetadata<T>` object refs
 * for both the fee token and the token_addresses vector.
 */
export async function resolveCoinMetadataId(
  client: SuiJsonRpcClient,
  coinType: string,
): Promise<string> {
  // TODO: Sui is resolving to the migrated registry instead of the metadata
  if (coinType === '0x2::sui::SUI') {
    return '0x587c29de216efd4219573e08a1f6964d4fa7cb714518c2c8a0f29abfa264327d'
  }
  const metadata = await client.getCoinMetadata({ coinType })
  if (!metadata?.id) {
    throw new CCIPError(CCIPErrorCode.UNKNOWN, `No CoinMetadata object found for ${coinType}`)
  }
  return metadata.id
}

/**
 * Gets the fee for sending a CCIP message on Sui.
 *
 * Calls the onramp's `get_fee` view function via devInspectTransactionBlock.
 * The onramp signature is:
 * `get_fee<T>(ref, clock, dest_chain_selector, receiver, data,
 *             token_addresses: vector<address>  // CoinMetadata object IDs
 *             token_amounts: vector<u64>,
 *             fee_token: &CoinMetadata<T>,
 *             extra_args: vector<u8>) -> u64`
 *
 * @param ctx - Sui RPC client and logger.
 * @param router - Onramp package address (e.g. "0xpkg::onramp").
 * @param destChainSelector - Destination chain selector.
 * @param message - CCIP message to send.
 * @returns Fee amount in the fee token's smallest unit.
 */
export async function getFee(
  ctx: { client: SuiJsonRpcClient } & WithLogger,
  router: string,
  destChainSelector: bigint,
  message: AnyMessage,
): Promise<bigint> {
  const { client, logger = console } = ctx

  // Resolve to the latest package (old versions are version-gated)
  const latestRouter = await getLatestPackageId(router, client)
  const target = `${latestRouter}::get_fee`

  // Get the CCIP object ref
  const ccip = await getCcipStateAddress(latestRouter, client)
  const ccipObjectRef = await getObjectRef(ccip, client)

  // Determine the fee token coin type and its CoinMetadata object ID
  const feeTokenCoinType = message.feeToken || '0x2::sui::SUI'
  const feeCoinMetadataId = await resolveCoinMetadataId(client, feeTokenCoinType)

  // Resolve each token to its CoinMetadata object ID.
  // The onramp expects CoinMetadata object IDs, not coin type strings.
  // If the token is a coin type string (contains "::"), resolve it;
  // otherwise it's already an object ID.
  const tokenCoinMetadataIds = await Promise.all(
    (message.tokenAmounts ?? []).map((ta) =>
      ta.token.includes('::') ? resolveCoinMetadataId(client, ta.token) : ta.token,
    ),
  )
  const tokenAmounts = (message.tokenAmounts ?? []).map((ta) => ta.amount.toString())

  const receiver = encodeAddressToAny(message.receiver)
  const data = getDataBytes(message.data || '0x')
  const extraArgs = getDataBytes(encodeMoveExtraArgs(message.extraArgs))

  const tx = new Transaction()
  tx.moveCall({
    target,
    function: 'get_fee',
    typeArguments: [feeTokenCoinType],
    arguments: [
      tx.object(ccipObjectRef),
      tx.object('0x6'), // Clock object
      tx.pure.u64(destChainSelector.toString()),
      tx.pure.vector('u8', receiver),
      tx.pure.vector('u8', data),
      tx.pure.vector('address', tokenCoinMetadataIds),
      tx.pure.vector('u64', tokenAmounts),
      tx.object(feeCoinMetadataId),
      tx.pure.vector('u8', extraArgs),
    ],
  })

  const result = await client.devInspectTransactionBlock({
    sender: normalizeSuiAddress('0x0'),
    transactionBlock: tx,
  })

  if (result.effects.status.status !== 'success' || !result.results?.[0]?.returnValues?.[0]) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      `Failed to call ${target}: ${result.effects.status.error || 'No return value'}`,
    )
  }

  // Parse the u64 return value (8 bytes, little-endian)
  const [dataBytes] = result.results[0].returnValues[0]
  const feeBytes = new Uint8Array(dataBytes)
  const fee = new DataView(feeBytes.buffer, feeBytes.byteOffset).getBigUint64(0, true)

  logger.debug('getFee result:', fee.toString())

  return fee
}

/**
 * Gets the supported fee tokens for a Sui CCIP deployment.
 *
 * Calls the fee_quoter's `get_fee_tokens` view function via devInspectTransactionBlock,
 * then resolves each token address to its TokenInfo.
 *
 * @param ctx - Sui RPC client and logger.
 * @param router - Onramp package address.
 * @param getTokenInfo - Function to resolve token address to TokenInfo.
 * @returns Record of token addresses to TokenInfo.
 */
export async function getFeeTokens(
  ctx: { client: SuiJsonRpcClient } & WithLogger,
  router: string,
  getTokenInfo: (token: string) => Promise<TokenInfo>,
): Promise<Record<string, TokenInfo>> {
  const { client, logger = console } = ctx

  const latestRouter = await getLatestPackageId(router, client)
  const ccip = await getCcipStateAddress(latestRouter, client)
  const ccipObjectRef = await getObjectRef(ccip, client)

  // fee_quoter lives in the ccip package
  const ccipBarePackage = ccip.split('::')[0]!
  const target = `${ccipBarePackage}::fee_quoter::get_fee_tokens`

  const tx = new Transaction()
  tx.moveCall({
    target: target,
    arguments: [tx.object(ccipObjectRef)],
  })

  const result = await client.devInspectTransactionBlock({
    sender: normalizeSuiAddress('0x0'),
    transactionBlock: tx,
  })

  if (result.effects.status.status !== 'success' || !result.results?.[0]?.returnValues?.[0]) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      `Failed to call ${target}: ${result.effects.status.error || 'No return value'}`,
    )
  }

  // Parse the returned vector<address> — each address is 32 bytes
  const [dataBytes] = result.results[0].returnValues[0]
  const bytes = new Uint8Array(dataBytes)

  // BCS vector<address>: length (ULEB128) followed by 32-byte addresses
  let offset = 0
  let length = 0
  while (offset < bytes.length) {
    const byte = bytes[offset]!
    length = (length << 7) | (byte & 0x7f)
    offset++
    if (!(byte & 0x80)) break
  }

  const tokens: string[] = []
  for (let i = 0; i < length; i++) {
    const addrBytes = bytes.slice(offset, offset + 32)
    offset += 32
    tokens.push(normalizeSuiAddress(hexlify(addrBytes)))
  }

  logger.debug('getFeeTokens result:', tokens)

  return Object.fromEntries(
    await Promise.all(tokens.map(async (token) => [token, await getTokenInfo(token)] as const)),
  )
}

/** BCS codec for the token_admin_registry TokenConfig struct. */
const TokenConfigCodec = bcs.struct('TokenConfig', {
  token_pool_package_id: bcs.Address,
  token_pool_module: bcs.String,
  token_type: bcs.String,
  administrator: bcs.Address,
  pending_administrator: bcs.Address,
  token_pool_type_proof: bcs.String,
  lock_or_burn_params: bcs.vector(bcs.Address),
  release_or_mint_params: bcs.vector(bcs.Address),
})

/** Source-side token pool configuration resolved from the token admin registry. */
export type SourceTokenConfig = {
  tokenPoolPackageId: string
  tokenPoolModule: string
  tokenType: string
  tokenPoolStateAddress: string
  tokenStateAddress?: string
}

/**
 * Resolves the source-side token pool configuration for a coin, via the
 * token_admin_registry's `get_token_config_struct` view. Used to build the
 * pool `lock_or_burn` call for token transfers.
 *
 * @param client - Sui RPC client.
 * @param ccipPackageId - Latest CCIP package ID (bare, no module suffix).
 * @param ccipObjectRef - CCIPObjectRef shared object ID.
 * @param coinMetadataId - CoinMetadata object ID of the transferred token.
 * @returns Pool package/module and state object addresses.
 * @throws {@link CCIPError} if the token is not registered in the registry.
 */
export async function getSourceTokenConfig(
  client: SuiJsonRpcClient,
  ccipPackageId: string,
  ccipObjectRef: string,
  coinMetadataId: string,
): Promise<SourceTokenConfig> {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ccipPackageId}::token_admin_registry::get_token_config_struct`,
    arguments: [tx.object(ccipObjectRef), tx.pure.address(coinMetadataId)],
  })

  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: normalizeSuiAddress('0x0'),
  })

  const returnValues = result.results?.[0]?.returnValues
  if (result.effects.status.status !== 'success' || !returnValues?.length) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      `Failed to call get_token_config_struct for ${coinMetadataId}: ${result.effects.status.error || 'No return value'}`,
    )
  }

  const config = TokenConfigCodec.parse(new Uint8Array(returnValues[0]![0]))

  // An unregistered token returns a zeroed struct.
  if (/^0x0+$/.test(config.token_pool_package_id)) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      `Token ${coinMetadataId} is not registered in the token admin registry`,
    )
  }

  // lock_or_burn_params layout (see ccip-starter-kit getTokenConfig):
  // - managed_token_pool: [?, ?, tokenState(idx2), tokenPoolState(idx3)]
  // - burn_mint / lock_release: [?, tokenPoolState(idx1)]
  const isManaged = config.token_pool_module === 'managed_token_pool'
  const tokenPoolStateAddress = isManaged
    ? config.lock_or_burn_params[3]
    : config.lock_or_burn_params[1]
  const tokenStateAddress = isManaged ? config.lock_or_burn_params[2] : undefined

  if (!tokenPoolStateAddress) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      `No token pool state address in lock_or_burn_params for ${coinMetadataId}`,
    )
  }

  return {
    tokenPoolPackageId: config.token_pool_package_id,
    tokenPoolModule: config.token_pool_module,
    tokenType: config.token_type,
    tokenPoolStateAddress,
    ...(tokenStateAddress ? { tokenStateAddress } : {}),
  }
}

/**
 * Finds a sender-owned coin of a given type with balance >= minBalance and
 * returns its object ID. Used to source the fee coin and transferred token coins.
 *
 * @param client - Sui RPC client.
 * @param coinType - Fully-qualified coin type (e.g. "0x2::sui::SUI").
 * @param minBalance - Minimum required balance (smallest unit).
 * @param owner - Owner address.
 * @returns The coin object ID.
 * @throws {@link CCIPError} if no suitable coin is found.
 */
export async function getCoinWithBalance(
  client: SuiJsonRpcClient,
  coinType: string,
  minBalance: bigint,
  owner: string,
): Promise<string> {
  const coins = await client.getCoins({ owner, coinType })
  const suitable = coins.data.find((coin) => BigInt(coin.balance) >= minBalance)
  if (!suitable) {
    const total = coins.data.reduce((sum, c) => sum + BigInt(c.balance), 0n)
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      `No ${coinType} coin with balance >= ${minBalance} for ${owner} (total: ${total}, coins: ${coins.data.length})`,
    )
  }
  return suitable.coinObjectId
}

/**
 * Builds an unsigned Sui PTB for a CCIP `ccip_send`, covering both
 * message-only and token-transfer sends.
 *
 * PTB structure:
 * 1. `onramp_state_helper::create_token_transfer_params` (hot potato; empty
 *    receiver for message-only, else the tokenReceiver bytes).
 * 2. Per token: pool `lock_or_burn` (burn_mint / lock_release / managed),
 *    which fills the hot potato.
 * 3. `onramp::ccip_send`, consuming the hot potato and splitting the exact
 *    fee out of the fee coin (`tx.gas` for native SUI, else a whole coin).
 *
 * @param client - Sui RPC client.
 * @param sender - Sender address (used to source fee/token coins).
 * @param router - Onramp package address (e.g. "0xpkg::onramp").
 * @param destChainSelector - Destination chain selector.
 * @param message - CCIP message; `fee` must be populated (see {@link getFee}).
 * @param opts - Optional overrides such as `gasLimit` (tx gas budget).
 * @returns Serialized unsigned transaction ready to sign and submit.
 */
export async function generateUnsignedCcipSend(
  client: SuiJsonRpcClient,
  sender: string,
  router: string,
  destChainSelector: bigint,
  message: AnyMessage & { fee: bigint },
  opts?: { gasLimit?: number | bigint },
): Promise<UnsignedSuiTx> {
  // Resolve latest packages for the move-call targets (old versions are
  // version-gated and revert), but resolve state object refs from the ORIGINAL
  // addresses: the *StatePointer objects are owned by / typed under the
  // original package, so getObjectRef must be called with the original id.
  //
  // Both onramp and CCIP must be the LATEST versions: a PTB has a single
  // linkage table, and the `TokenTransferParams` hot potato returned by
  // `onramp_state_helper::create_token_transfer_params` (CCIP) is consumed by
  // `onramp::ccip_send` (onramp). If the two MoveCalls resolve CCIP to
  // different versions the runtime rejects with `InvalidLinkage`.
  // `onramp::get_ccip_package_id()` returns the compile-time `@ccip` address,
  // which is the ORIGINAL CCIP id — so we must upgrade it ourselves via the
  // CCIPObjectRef's `package_ids` history (`getLatestPackageId`).
  const latestRouter = await getLatestPackageId(router, client)
  const onrampPackage = latestRouter.split('::')[0]!
  const ccip = await getCcipStateAddress(latestRouter, client)
  const latestCcip = await getLatestPackageId(ccip, client)
  const ccipPackage = latestCcip.split('::')[0]!

  const [ccipObjectRef, onrampState] = await Promise.all([
    getObjectRef(ccip, client),
    getObjectRef(router, client), // router carries ::onramp -> OnRampState
  ])

  const tokenAmounts = message.tokenAmounts ?? []
  const extraArgs = message.extraArgs as {
    tokenReceiver?: string
    receiverObjectIds?: string[]
  }

  const tx = new Transaction()

  // 1. Hot potato. For token transfers the receiver must match extraArgs'
  //    tokenReceiver; for message-only it's empty.
  const tokenReceiverBytes =
    tokenAmounts.length && extraArgs.tokenReceiver
      ? getDataBytes(extraArgs.tokenReceiver)
      : new Uint8Array()
  const tokenParams = tx.moveCall({
    package: ccipPackage,
    module: 'onramp_state_helper',
    function: 'create_token_transfer_params',
    arguments: [tx.pure.vector('u8', tokenReceiverBytes)],
  })

  // 2. Pool lock_or_burn per token, filling the hot potato.
  for (const ta of tokenAmounts) {
    const coinType = ta.token
    const coinMetadataId = await resolveCoinMetadataId(client, coinType)
    const pool = await getSourceTokenConfig(client, ccipPackage, ccipObjectRef, coinMetadataId)

    const sourceCoin = await getCoinWithBalance(client, coinType, ta.amount, sender)
    const coin = tx.splitCoins(tx.object(sourceCoin), [tx.pure.u64(ta.amount)])[0]

    const isManaged = pool.tokenPoolModule === 'managed_token_pool'
    tx.moveCall({
      package: pool.tokenPoolPackageId,
      module: pool.tokenPoolModule,
      function: 'lock_or_burn',
      typeArguments: [coinType],
      arguments: [
        tx.object(ccipObjectRef),
        tokenParams,
        coin,
        tx.pure.u64(destChainSelector.toString()),
        tx.object(SUI_CLOCK_OBJECT_ID),
        ...(isManaged
          ? [tx.object(SUI_DENY_LIST_OBJECT_ID), tx.object(pool.tokenStateAddress!)]
          : []),
        tx.object(pool.tokenPoolStateAddress),
      ],
    })
  }

  // 3. Fee coin: native SUI uses tx.gas; other tokens use a whole coin with
  //    sufficient balance (the onramp splits the exact fee, overpayment stays).
  const feeTokenCoinType = message.feeToken || SUI_COIN_TYPE
  const feeCoinMetadataId = await resolveCoinMetadataId(client, feeTokenCoinType)
  const feeTokenArg: TransactionArgument =
    feeTokenCoinType === SUI_COIN_TYPE
      ? tx.gas
      : tx.object(await getCoinWithBalance(client, feeTokenCoinType, message.fee, sender))

  // 4. ccip_send.
  const receiver = encodeAddressToAny(message.receiver)
  const data = getDataBytes(message.data || '0x')
  const encodedExtraArgs = getDataBytes(encodeMoveExtraArgs(message.extraArgs))
  tx.moveCall({
    package: onrampPackage,
    module: 'onramp',
    function: 'ccip_send',
    typeArguments: [feeTokenCoinType],
    arguments: [
      tx.object(ccipObjectRef),
      tx.object(onrampState),
      tx.object(SUI_CLOCK_OBJECT_ID),
      tx.pure.u64(destChainSelector.toString()),
      tx.pure.vector('u8', receiver),
      tx.pure.vector('u8', data),
      tokenParams,
      tx.object(feeCoinMetadataId),
      feeTokenArg,
      tx.pure.vector('u8', encodedExtraArgs),
    ],
  })

  if (opts?.gasLimit) {
    tx.setGasBudget(opts.gasLimit)
  }

  return {
    family: ChainFamily.Sui,
    transactions: [tx.serialize()],
  }
}
