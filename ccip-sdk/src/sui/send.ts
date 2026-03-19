import type { SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { getBytes, hexlify, zeroPadValue } from 'ethers'

import { CCIPError, CCIPErrorCode } from '../errors/index.ts'
import { encodeExtraArgs } from '../extra-args.ts'
import { type AnyMessage, ChainFamily } from '../types.ts'
import { getAddressBytes, getDataBytes } from '../utils.ts'
import { getCcipStateAddress } from './discovery.ts'
import { getObjectRef } from './objects.ts'

const SUI_CLOCK = '0x6'
const SUI_NATIVE_COIN_TYPE = '0x2::sui::SUI'

/**
 * Discovers the onramp package for a given destination chain from the router.
 */
export async function discoverOnRamp(
  client: SuiClient,
  routerPkg: string,
  destChainSelector: bigint,
): Promise<{ onRampPkg: string; routerStateId: string }> {
  const routerAddress = routerPkg.includes('::') ? routerPkg : routerPkg + '::router'
  const routerPkgId = routerAddress.split('::')[0]!

  const ownedObjs = await client.getOwnedObjects({
    owner: routerPkgId,
    filter: { StructType: `${routerPkgId}::router::RouterStatePointer` },
    options: { showContent: true },
  })

  const pointer = ownedObjs.data[0]?.data
  if (!pointer?.content || pointer.content.dataType !== 'moveObject') {
    throw new CCIPError(CCIPErrorCode.UNKNOWN, 'RouterStatePointer not found')
  }

  const parentId = (pointer.content.fields as Record<string, unknown>)['router_object_id'] as string
  if (!parentId) throw new CCIPError(CCIPErrorCode.UNKNOWN, 'router_object_id not found in pointer')

  const { deriveObjectID } = await import('./objects.ts')
  const routerStateId = deriveObjectID(parentId, new TextEncoder().encode('RouterState'))

  const tx = new Transaction()
  tx.moveCall({
    target: `${routerPkgId}::router::get_on_ramp`,
    arguments: [tx.object(routerStateId), tx.pure.u64(destChainSelector)],
  })

  const result = await client.devInspectTransactionBlock({
    sender: normalizeSuiAddress('0x0'),
    transactionBlock: tx,
  })

  if (result.error || !result.results?.[0]?.returnValues?.[0]) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      `Failed to get onramp for dest chain ${destChainSelector}: ${result.error}`,
    )
  }

  const { bcs } = await import('@mysten/sui/bcs')
  const addrBytes = result.results[0].returnValues[0][0]
  const onRampPkg = normalizeSuiAddress(hexlify(bcs.Address.parse(new Uint8Array(addrBytes))))

  return { onRampPkg, routerStateId }
}

/**
 * Resolves all objects needed for a Sui CCIP send transaction.
 */
export async function resolveSendObjects(
  client: SuiClient,
  routerPkg: string,
  destChainSelector: bigint,
) {
  const { onRampPkg } = await discoverOnRamp(client, routerPkg, destChainSelector)
  const onRampAddress = onRampPkg + '::onramp'

  const ccipAddress = await getCcipStateAddress(onRampAddress, client)
  const ccipObjectRef = await getObjectRef(ccipAddress, client)
  const onRampState = await getObjectRef(onRampAddress, client)

  return { onRampPkg, onRampAddress, ccipAddress, ccipObjectRef, onRampState }
}

/**
 * Discovers the CoinMetadata object ID for SUI from the fee quoter's configured fee tokens.
 * We can't use getCoinMetadata() for SUI because it returns a Currency object on newer Sui,
 * not the CoinMetadata object expected by the onramp contract.
 */
async function discoverSuiFeeTokenMetadata(
  client: SuiClient,
  ccipPkg: string,
  ccipObjectRef: string,
): Promise<{ coinType: string; metadataId: string }> {
  const tx = new Transaction()
  tx.moveCall({
    target: `${ccipPkg}::fee_quoter::get_fee_tokens`,
    arguments: [tx.object(ccipObjectRef)],
  })
  const result = await client.devInspectTransactionBlock({
    sender: normalizeSuiAddress('0x0'),
    transactionBlock: tx,
  })
  if (result.error || !result.results?.[0]?.returnValues?.[0]) {
    throw new CCIPError(CCIPErrorCode.UNKNOWN, 'Failed to get fee tokens from fee quoter')
  }

  const bytes = result.results[0].returnValues[0][0]
  const count = bytes[0]!
  let offset = 1
  for (let i = 0; i < count; i++) {
    const addr = normalizeSuiAddress(
      '0x' + Buffer.from(bytes.slice(offset, offset + 32)).toString('hex'),
    )
    offset += 32

    const obj = await client.getObject({ id: addr, options: { showType: true } })
    const objType = obj.data?.type
    if (objType?.includes('::sui::SUI')) {
      return { coinType: SUI_NATIVE_COIN_TYPE, metadataId: addr }
    }
  }

  throw new CCIPError(CCIPErrorCode.UNKNOWN, 'SUI not found among configured fee tokens')
}

/**
 * Gets the fee for a CCIP send from Sui.
 *
 * get_fee\<T\>(&CCIPObjectRef, &Clock, u64, vector\<u8\>, vector\<u8\>,
 *            vector\<address\>, vector\<u64\>, &CoinMetadata\<T\>, vector\<u8\>) -\> u64
 */
export async function getFee(
  client: SuiClient,
  routerPkg: string,
  destChainSelector: bigint,
  message: AnyMessage,
): Promise<bigint> {
  const { onRampPkg, ccipAddress, ccipObjectRef } = await resolveSendObjects(
    client,
    routerPkg,
    destChainSelector,
  )

  const receiver = Array.from(getBytes(zeroPadValue(getDataBytes(message.receiver), 32)))
  const data = Array.from(getDataBytes(message.data || '0x'))
  const tokenAddresses = (message.tokenAmounts ?? []).map((ta) => ta.token)
  const tokenAmounts = (message.tokenAmounts ?? []).map((ta) => Number(ta.amount))
  const extraArgs = Array.from(getBytes(encodeExtraArgs(message.extraArgs, ChainFamily.Sui)))

  const ccipPkg = ccipAddress.split('::')[0]!
  const feeToken = await discoverSuiFeeTokenMetadata(client, ccipPkg, ccipObjectRef)

  const tx = new Transaction()
  tx.moveCall({
    target: `${onRampPkg}::onramp::get_fee`,
    typeArguments: [feeToken.coinType],
    arguments: [
      tx.object(ccipObjectRef),
      tx.object(SUI_CLOCK),
      tx.pure.u64(destChainSelector),
      tx.pure.vector('u8', receiver),
      tx.pure.vector('u8', data),
      tx.pure.vector('address', tokenAddresses),
      tx.pure.vector('u64', tokenAmounts),
      tx.object(feeToken.metadataId),
      tx.pure.vector('u8', extraArgs),
    ],
  })

  const result = await client.devInspectTransactionBlock({
    sender: normalizeSuiAddress('0x0'),
    transactionBlock: tx,
  })

  if (result.error || !result.results?.[0]?.returnValues?.[0]) {
    throw new CCIPError(
      CCIPErrorCode.UNKNOWN,
      `Failed to get fee: ${result.error || 'no return value'}`,
    )
  }

  const feeBytes = result.results[0].returnValues[0][0]
  const { bcs } = await import('@mysten/sui/bcs')
  return BigInt(bcs.u64().parse(new Uint8Array(feeBytes)))
}

/**
 * Builds a Programmable Transaction Block for ccip_send on Sui.
 *
 * The PTB flow:
 * 1. create_token_transfer_params(token_receiver)
 * 2. For each token: lock_or_burn<T>(...) on the token pool
 * 3. Split fee coin from sender's SUI
 * 4. ccip_send<SUI>(ccipRef, onrampState, clock, destSelector, receiver, data,
 *                    tokenParams, suiMetadata, feeCoin, extraArgs, ctx)
 */
export async function buildCcipSendPTB(
  client: SuiClient,
  sender: string,
  routerPkg: string,
  destChainSelector: bigint,
  message: AnyMessage & { fee: bigint },
): Promise<Transaction> {
  const { onRampPkg, ccipAddress, ccipObjectRef, onRampState } = await resolveSendObjects(
    client,
    routerPkg,
    destChainSelector,
  )

  const receiver = Array.from(getBytes(zeroPadValue(getDataBytes(message.receiver), 32)))
  const data = Array.from(getDataBytes(message.data || '0x'))
  const extraArgs = Array.from(getBytes(encodeExtraArgs(message.extraArgs, ChainFamily.Sui)))

  const ccipPkg = ccipAddress.split('::')[0]!
  const feeToken = await discoverSuiFeeTokenMetadata(client, ccipPkg, ccipObjectRef)

  const tx = new Transaction()

  // Encode tokenReceiver for create_token_transfer_params
  // When transferring tokens, the receiver needs the token; use the message receiver as default
  let tokenReceiverBytes: number[] = []
  if ('tokenReceiver' in message.extraArgs && message.extraArgs.tokenReceiver) {
    tokenReceiverBytes = Array.from(getAddressBytes(message.extraArgs.tokenReceiver))
  } else if (message.tokenAmounts?.length) {
    tokenReceiverBytes = Array.from(getBytes(zeroPadValue(getDataBytes(message.receiver), 32)))
  }

  // Step 1: Create token transfer params
  const tokenParams = tx.moveCall({
    target: `${ccipAddress.split('::')[0]}::onramp_state_helper::create_token_transfer_params`,
    arguments: [tx.pure.vector('u8', tokenReceiverBytes)],
  })

  // Step 2: Process token transfers (lock_or_burn for each token)
  if (message.tokenAmounts?.length) {
    const tokenConfigs = await fetchSendTokenConfigs(
      client,
      ccipAddress,
      ccipObjectRef,
      message.tokenAmounts.map((ta) => ta.token),
    )

    for (let i = 0; i < message.tokenAmounts.length; i++) {
      const ta = message.tokenAmounts[i]!
      const config = tokenConfigs[i]!

      // Get the sender's coins of this type and split the right amount
      const coinType = config.tokenType
      const coins = await client.getCoins({ owner: sender, coinType })
      if (!coins.data.length) {
        throw new CCIPError(
          CCIPErrorCode.INSUFFICIENT_BALANCE,
          `No ${coinType} coins found for sender`,
        )
      }

      let tokenCoin
      if (coins.data.length === 1) {
        const [primary] = tx.splitCoins(tx.object(coins.data[0]!.coinObjectId), [ta.amount])
        tokenCoin = primary!
      } else {
        const primary = tx.object(coins.data[0]!.coinObjectId)
        if (coins.data.length > 1) {
          tx.mergeCoins(
            primary,
            coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
          )
        }
        const [split] = tx.splitCoins(primary, [ta.amount])
        tokenCoin = split!
      }

      // Call lock_or_burn on the token pool
      tx.moveCall({
        target: `${config.tokenPoolPackageId}::${config.tokenPoolModule}::lock_or_burn`,
        typeArguments: [coinType],
        arguments: [
          tx.object(ccipObjectRef),
          tokenParams,
          tokenCoin,
          tx.pure.u64(destChainSelector),
          ...config.lockOrBurnParams.map((p) => tx.object(p)),
        ],
      })
    }
  }

  // Step 3: Split fee coin from sender's SUI gas coin
  const [feeCoin] = tx.splitCoins(tx.gas, [message.fee])

  // Step 4: ccip_send (returns message_id as vector<u8>)
  tx.moveCall({
    target: `${onRampPkg}::onramp::ccip_send`,
    typeArguments: [feeToken.coinType],
    arguments: [
      tx.object(ccipObjectRef),
      tx.object(onRampState),
      tx.object(SUI_CLOCK),
      tx.pure.u64(destChainSelector),
      tx.pure.vector('u8', receiver),
      tx.pure.vector('u8', data),
      tokenParams,
      tx.object(feeToken.metadataId),
      feeCoin,
      tx.pure.vector('u8', extraArgs),
    ],
  })

  // Return the remaining fee coin (Coin<SUI> doesn't have Drop)
  tx.transferObjects([feeCoin], sender)

  return tx
}

/**
 * Fetches token pool configs needed for lock_or_burn on the send (onramp) side.
 */
async function fetchSendTokenConfigs(
  client: SuiClient,
  ccipAddress: string,
  ccipObjectRef: string,
  tokenAddresses: string[],
) {
  const ccipPkg = ccipAddress.split('::')[0]!
  const configs = []

  for (const tokenAddr of tokenAddresses) {
    // Resolve coin metadata ID from the token address
    let coinMetadataId: string
    if (tokenAddr.includes('::')) {
      const metadata = await client.getCoinMetadata({ coinType: tokenAddr })
      if (!metadata?.id) {
        throw new CCIPError(CCIPErrorCode.UNKNOWN, `CoinMetadata not found for ${tokenAddr}`)
      }
      coinMetadataId = metadata.id
    } else {
      coinMetadataId = tokenAddr
    }

    // Get pool address
    const tx1 = new Transaction()
    tx1.moveCall({
      target: `${ccipPkg}::token_admin_registry::get_pool`,
      arguments: [tx1.object(ccipObjectRef), tx1.pure.address(coinMetadataId)],
    })
    const result1 = await client.devInspectTransactionBlock({
      sender: normalizeSuiAddress('0x0'),
      transactionBlock: tx1,
    })
    if (result1.error || !result1.results?.[0]?.returnValues?.[0]) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, `Failed to get pool for ${tokenAddr}`)
    }
    const poolAddr = normalizeSuiAddress(
      '0x' + Buffer.from(result1.results[0].returnValues[0][0]).toString('hex'),
    )
    if (poolAddr === normalizeSuiAddress('0x0')) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, `No token pool registered for ${tokenAddr}`)
    }

    // Get full token config including lockOrBurnParams
    const tx2 = new Transaction()
    tx2.moveCall({
      target: `${ccipPkg}::token_admin_registry::get_token_config_struct`,
      arguments: [tx2.object(ccipObjectRef), tx2.pure.address(coinMetadataId)],
    })
    const result2 = await client.devInspectTransactionBlock({
      sender: normalizeSuiAddress('0x0'),
      transactionBlock: tx2,
    })
    if (result2.error || !result2.results?.[0]?.returnValues?.[0]) {
      throw new CCIPError(CCIPErrorCode.UNKNOWN, `Failed to get token config for ${tokenAddr}`)
    }

    const configBytes = result2.results[0].returnValues[0][0]
    let offset = 0

    // TokenPoolPackageId (32 bytes)
    const tokenPoolPackageId = normalizeSuiAddress(
      '0x' + Buffer.from(configBytes.slice(offset, offset + 32)).toString('hex'),
    )
    offset += 32

    // TokenPoolModule (String)
    const modLen = configBytes[offset]!
    offset += 1
    const tokenPoolModule = new TextDecoder().decode(
      new Uint8Array(configBytes.slice(offset, offset + modLen)),
    )
    offset += modLen

    // TokenType (ascii::String)
    const typeLen = configBytes[offset]!
    offset += 1
    const tokenType = new TextDecoder().decode(
      new Uint8Array(configBytes.slice(offset, offset + typeLen)),
    )
    offset += typeLen

    // Skip Administrator (32 bytes) + PendingAdministrator (32 bytes)
    offset += 64

    // Skip TokenPoolTypeProof (ascii::String)
    const proofLen = configBytes[offset]!
    offset += 1 + proofLen

    // LockOrBurnParams (vector<address>)
    const lobCount = configBytes[offset]!
    offset += 1
    const lockOrBurnParams: string[] = []
    for (let i = 0; i < lobCount; i++) {
      lockOrBurnParams.push(
        normalizeSuiAddress(
          '0x' + Buffer.from(configBytes.slice(offset, offset + 32)).toString('hex'),
        ),
      )
      offset += 32
    }

    // Prepend 0x to tokenType if needed for full coin type
    const fullTokenType = tokenType.startsWith('0x') ? tokenType : '0x' + tokenType

    configs.push({
      tokenPoolPackageId,
      tokenPoolModule,
      tokenType: fullTokenType,
      lockOrBurnParams,
    })
  }

  return configs
}
