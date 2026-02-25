import { type BytesLike, dataLength, dataSlice, getBytes, toNumber } from 'ethers'
import type { PickDeep } from 'type-fest'

import {
  CCIPLbtcAttestationNotApprovedError,
  CCIPLbtcAttestationNotFoundError,
  CCIPUsdcAttestationError,
} from './errors/index.ts'
import { parseSourceTokenData } from './evm/messages.ts'
import { type CCIPRequest, type OffchainTokenData, type WithLogger, NetworkType } from './types.ts'
import { networkInfo } from './utils.ts'

const CIRCLE_API_URL = {
  mainnet: 'https://iris-api.circle.com',
  testnet: 'https://iris-api-sandbox.circle.com',
}

type CctpAttestationResponse =
  | { error: 'string' }
  | {
      messages: {
        status: 'pending_confirmations' | 'complete'
        eventNonce?: string
        attestation: string
        message: string
      }[]
    }

/**
 * Returns the USDC attestation for a given tokenAmount.extraData and txHash
 * https://developers.circle.com/cctp/quickstarts/transfer-usdc-ethereum-to-arc#3-3-retrieve-attestation
 *
 * @param opts - CCTPv2 options
 * @param networkType - network type (mainnet or testnet)
 * @returns USDC/CCTP attestation and message
 */
export async function getUsdcAttestation(
  opts: {
    /** CCTP sourceDomain */
    sourceDomain: number
    /** CCTP burn eventNonce */
    nonce: number
    /** burn txHash, same as CCIP request */
    txHash: string
  },
  networkType: NetworkType,
): Promise<{ attestation: string; message: string }> {
  const { sourceDomain, nonce, txHash } = opts
  const circleApiBaseUrl =
    networkType === NetworkType.Mainnet ? CIRCLE_API_URL.mainnet : CIRCLE_API_URL.testnet
  const res = await fetch(
    `${circleApiBaseUrl}/v2/messages/${sourceDomain}?transactionHash=${txHash}`,
  )
  const json = (await res.json()) as CctpAttestationResponse
  let att
  if ('messages' in json) {
    att = json.messages.find((m) => m.status === 'complete' && m.eventNonce === nonce.toString())
  }
  if (!att?.message) throw new CCIPUsdcAttestationError(txHash, json, { context: opts })
  return att
}

const LOMBARD_API_URL = {
  mainnet: 'https://mainnet.prod.lombard.finance',
  testnet: 'https://gastald-testnet.prod.lombard.finance',
}

type LombardAttestation =
  | {
      status: 'NOTARIZATION_STATUS_SESSION_APPROVED'
      message_hash: string
      attestation: string
    }
  | { status: string; message_hash: string }
type LombardAttestationsResponse = { attestations: Array<LombardAttestation> }

/**
 * Returns the LBTC attestation for a given payload hash
 *
 * @param payloadHash - hash of the payload of the LBTC transfer
 * @param networkType - network type (mainnet or testnet)
 * @returns LBTC attestation bytes
 */
export async function getLbtcAttestation(
  payloadHash: string,
  networkType: NetworkType,
): Promise<{
  attestation: string
}> {
  const lbtcApiBaseUrl =
    networkType === NetworkType.Mainnet ? LOMBARD_API_URL.mainnet : LOMBARD_API_URL.testnet
  const res = await fetch(`${lbtcApiBaseUrl}/api/bridge/v1/deposits/getByHash`, {
    method: 'POST',
    body: JSON.stringify({ messageHash: [payloadHash] }),
  })
  const response = (await res.json()) as LombardAttestationsResponse | null
  if (response == null || !('attestations' in response)) {
    throw new CCIPLbtcAttestationNotFoundError(payloadHash, response)
  }
  const attestation = response.attestations.find((att) => att.message_hash === payloadHash)
  if (attestation == null) {
    throw new CCIPLbtcAttestationNotFoundError(payloadHash, response)
  }
  if (
    attestation.status !== 'NOTARIZATION_STATUS_SESSION_APPROVED' ||
    !('attestation' in attestation)
  ) {
    throw new CCIPLbtcAttestationNotApprovedError(payloadHash, attestation)
  }
  return attestation
}

/**
 * Fetch CCIPv1 offchain token data for USDC and LBTC tokenAmounts
 * @param request - CCIPRequest containing tx.hash and message
 * @returns Promise resolving to an OffchainTokenData for each tokenAmount
 */
export async function getOffchainTokenData(
  request: PickDeep<CCIPRequest, 'tx.hash' | `message`>,
  { logger = console }: WithLogger = {},
): Promise<OffchainTokenData[]> {
  const { networkType } = networkInfo(request.message.sourceChainSelector)

  function looksUsdcData(extraData: BytesLike) {
    if (dataLength(extraData) !== 64) return
    // USDCTokenPool's extraData is a packed `SourceTokenDataPayloadV1{uint64 nonce, uint32 sourceDomain}`,
    // which we need to query CCTPv2 (by sourceDomain and txHash) and to filter by nonce among messages,
    // if more than one in tx
    let nonce, sourceDomain
    try {
      // those toNumber conversions throw early in case the bytearray don't look like small numbers
      nonce = toNumber(dataSlice(extraData, 0, 32))
      sourceDomain = toNumber(dataSlice(extraData, 32, 32 + 32))
      return { nonce, sourceDomain } // maybe USDC
    } catch {
      // not USDC
    }
  }

  function looksLbtcData(extraData: BytesLike) {
    // LBTC returns `message_hash`/`payloadHash` directly as `bytes32 extraData`
    if (
      dataLength(extraData) === 32 &&
      getBytes(extraData, 'extraData').filter(Boolean).length > 20 // looks like a hash
    )
      return true
  }

  return Promise.all(
    request.message.tokenAmounts.map(async (tokenAmount, i) => {
      let extraData
      if ('extraData' in tokenAmount) {
        extraData = tokenAmount.extraData
      } else if ('sourceTokenData' in request.message) {
        // v1.2..v1.5
        if (dataLength(request.message.sourceTokenData[i]!) === 64) {
          extraData = request.message.sourceTokenData[i]
        } else {
          ;({ extraData } = parseSourceTokenData(request.message.sourceTokenData[i]!))
        }
      }
      if (!extraData) return
      const usdcOpts = looksUsdcData(extraData)
      if (usdcOpts) {
        try {
          const usdcAttestation = await getUsdcAttestation(
            { ...usdcOpts, txHash: request.tx.hash },
            networkType,
          )
          return { _tag: 'usdc', extraData, ...usdcAttestation }
        } catch (err) {
          // maybe not a USDC transfer, or not ready
          logger.warn(`❌ CCTP: Failed to fetch attestation for message:`, request.message, err)
        }
      } else if (looksLbtcData(extraData)) {
        try {
          const lbtcAttestation = await getLbtcAttestation(extraData, networkType)
          return { _tag: 'lbtc', extraData, ...lbtcAttestation }
        } catch (err) {
          logger.warn(`❌ LBTC: Failed to fetch attestation for message:`, extraData, err)
        }
      }
    }),
  )
}
