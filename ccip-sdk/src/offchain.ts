import { type BytesLike, dataLength, dataSlice, hexlify, id, toNumber } from 'ethers'
import type { PickDeep } from 'type-fest'

import {
  CCIPLbtcAttestationNotApprovedError,
  CCIPLbtcAttestationNotFoundError,
  CCIPUsdcAttestationError,
  CCIPUsdcBurnFeesError,
} from './errors/index.ts'
import { parseSourceTokenData } from './evm/messages.ts'
import { fetchWithTimeout } from './fetch.ts'
import { NetworkType, networkInfo } from './networks.ts'
import type { CCIPRequest, OffchainTokenData, WithLogger } from './types.ts'
import { getDataBytes } from './utils.ts'

const CIRCLE_API_URL = {
  mainnet: 'https://iris-api.circle.com',
  testnet: 'https://iris-api-sandbox.circle.com',
}

/** CCTP v2 source-pool data tag. */
export const CCTP_V2_TAG = id('CCTP_V2').substring(0, 10) as '0xb148ea5f'
/** CCTP v2 source-pool data tag of transfers verified by a CCIP v2.0 CCTP verifier. */
export const CCTP_V2_CCV_TAG = id('CCTP_V2_CCV').substring(0, 10) as '0x3047587c'

/**
 * Parse CCTP v2 source-pool data from a token transfer's `extraData`.
 *
 * The payload is either the 4-byte version tag alone, or the 40-byte
 * `[versionTag (4)][sourceDomain (4)][depositHash (32)]` form.
 *
 * @param extraData - The token transfer's `extraData`
 * @returns The tag and, when the payload carries it, the CCTP source domain; otherwise `undefined`
 */
export function parseCctpV2ExtraData(
  extraData: BytesLike,
): { tag: string; sourceDomain?: number } | undefined {
  const bytes = getDataBytes(extraData)
  if (bytes.length !== 4 && bytes.length !== 40) return
  const tag = hexlify(bytes.subarray(0, 4))
  if (tag !== CCTP_V2_TAG && tag !== CCTP_V2_CCV_TAG) return
  return { tag, ...(bytes.length === 40 ? { sourceDomain: toNumber(bytes.subarray(4, 8)) } : {}) }
}

/**
 * A CCIP v2.0 token verifier implementation behind a destination CCV, that accepts `ccvData`
 * composed from a token issuer's offchain attestation.
 */
export type TokenVerifier = {
  /** Kind of the offchain data it consumes, as {@link OffchainTokenData}'s `_tag`. */
  tag: 'usdc' | 'lbtc'
  /** The address the destination policy requires (a verifier resolver or the verifier itself). */
  ccv: string
  /** The 4-byte tag that routes `ccvData` to this implementation. */
  versionTag: string
  /** Implementation version, e.g. `2.1.0`. */
  version: string
  /** For `usdc`: the CCTP domain this verifier maps the message's source chain to. */
  cctpSourceDomain?: number
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
 * @param opts - CCTP options; select the message by `nonce` (v1.x payloads) or by `messageId`
 *   (v2 payloads, whose CCTP hook data ends with the CCIP message id)
 * @param networkType - network type (mainnet or testnet)
 * @returns USDC/CCTP attestation and message
 * @throws {@link CCIPUsdcAttestationError} if no complete message matches
 */
export async function getUsdcAttestation(
  opts: {
    /** CCTP sourceDomain */
    sourceDomain: number
    /** CCTP burn eventNonce (v1.x source pool payloads) */
    nonce?: number
    /** CCIP message id, matched against the CCTP message's hook data (v2 source pool payloads) */
    messageId?: BytesLike
    /** burn txHash, same as CCIP request */
    txHash: string
  },
  networkType: NetworkType,
): Promise<{ attestation: string; message: string }> {
  const { sourceDomain, nonce, messageId, txHash } = opts
  const circleApiBaseUrl =
    networkType === NetworkType.Mainnet ? CIRCLE_API_URL.mainnet : CIRCLE_API_URL.testnet
  const res = await fetch(
    `${circleApiBaseUrl}/v2/messages/${sourceDomain}?transactionHash=${txHash}`,
  )
  const json = (await res.json()) as CctpAttestationResponse
  const messageIdHex = messageId != null ? hexlify(messageId).slice(2) : undefined
  let att
  if ('messages' in json) {
    att = json.messages.find(
      (m) =>
        m.status === 'complete' &&
        (nonce != null
          ? m.eventNonce === nonce.toString()
          : !!messageIdHex && m.message.toLowerCase().endsWith(messageIdHex)),
    )
  }
  if (!att?.message || !att.attestation)
    throw new CCIPUsdcAttestationError(txHash, json, { context: opts })
  // some providers omit the 0x prefix; downstream code treats these as BytesLike
  const with0x = (hex: string) => (hex.startsWith('0x') ? hex : `0x${hex}`)
  return { attestation: with0x(att.attestation), message: with0x(att.message) }
}

/**
 * CCTP V2 finality tier identifiers returned by Circle's burn-fees API.
 *
 * These are **opaque tier IDs**, not block counts or durations.
 * The CCTP V2 whitepaper (Section 8, Table 2) defines exactly two tiers today;
 * additional tiers may be added in the future (the wide spacing between values
 * is intentional to leave room).
 *
 * @see https://developers.circle.com/cctp/concepts/fees
 * @see CCTP V2 Whitepaper, Section 8 — "Finality Levels"
 */

/** Fast / pre-finality tier: attested seconds after soft confirmation. */
export const CCTP_FINALITY_FAST = 1000

/** Standard / finalized tier: attested after full on-chain finality. */
export const CCTP_FINALITY_STANDARD = 2000

/**
 * Fetches USDC burn fee tiers from Circle's CCTP API.
 *
 * @param sourceDomain - CCTP source domain identifier
 * @param destDomain - CCTP destination domain identifier
 * @param networkType - network type (mainnet or testnet)
 * @returns Array of fee tiers with finality thresholds and BPS fees
 * @throws {@link CCIPUsdcBurnFeesError} if the HTTP request fails or the response is not a valid array of fee tiers
 */
export async function getUsdcBurnFees(
  sourceDomain: number,
  destDomain: number,
  networkType: NetworkType,
): Promise<{ finalityThreshold: number; minimumFee: number }[]> {
  const baseUrl =
    networkType === NetworkType.Mainnet ? CIRCLE_API_URL.mainnet : CIRCLE_API_URL.testnet
  const url = `${baseUrl}/v2/burn/USDC/fees/${sourceDomain}/${destDomain}`
  const res = await fetchWithTimeout(url, 'getUsdcBurnFees')
  if (!res.ok) {
    throw new CCIPUsdcBurnFeesError(sourceDomain, destDomain, res.status)
  }
  const json: unknown = await res.json()
  if (!Array.isArray(json)) {
    throw new CCIPUsdcBurnFeesError(sourceDomain, destDomain, res.status)
  }
  for (const tier of json) {
    const t = tier as Record<string, unknown>
    if (typeof t.finalityThreshold !== 'number' || typeof t.minimumFee !== 'number') {
      throw new CCIPUsdcBurnFeesError(sourceDomain, destDomain, res.status)
    }
  }
  return json as { finalityThreshold: number; minimumFee: number }[]
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
 * Read the verifier version tag a token issuer's attested message binds to a CCIP message.
 *
 * CCIP v2.0 token verifiers send `[versionTag (4)][ccipMessageId (32)]` along with the transfer:
 * as the CCTP message's hook data, or as the Lombard bridge's optional message. The destination
 * verifier rejects a result whose attested tag or message id differs.
 *
 * @param attested - The attested bytes: the CCTP message, or the Lombard payload or attestation
 * @param messageId - The CCIP message id the data is being composed for
 * @returns The 4-byte version tag, or `undefined` when `attested` does not carry `messageId`
 */
export function getAttestedVersionTag(
  attested: BytesLike,
  messageId: BytesLike,
): string | undefined {
  const hex = hexlify(attested)
  const idx = hex.lastIndexOf(hexlify(messageId).slice(2))
  // byte-aligned, and preceded by a 4-byte tag
  if (idx < 10 || idx % 2) return
  return '0x' + hex.slice(idx - 8, idx)
}

/**
 * The Lombard payload hash of a CCIP v2.0 LBTC transfer: the `verifierBlobs` entry the source
 * Lombard verifier returned in `CCIPMessageSent` (v2 Lombard pools don't put it in `extraData`).
 *
 * Blobs line up with the leading `receipts`, one per CCV; only the blob whose receipt `issuer` is
 * one of `ccvs` is taken, so unrelated CCVs' 32-byte blobs are never looked up.
 *
 * @param message - The source message's `receipts` and `verifierBlobs`, when read from source logs
 * @param ccvs - The Lombard CCV addresses, as the destination policy names them
 * @returns The payload hash, or `undefined` when the message doesn't carry it
 */
export function getLbtcPayloadHash(
  message: { receipts?: readonly { issuer: string }[]; verifierBlobs?: readonly BytesLike[] },
  ccvs: readonly string[],
): string | undefined {
  const lombardCCVs = new Set(ccvs.map((ccv) => ccv.toLowerCase()))
  const i = (message.receipts ?? []).findIndex(({ issuer }) =>
    lombardCCVs.has(issuer.toLowerCase()),
  )
  const blob = message.verifierBlobs?.[i]
  if (blob != null && dataLength(blob) === 32) return hexlify(blob)
}

/**
 * Fetch the token issuer's attestation that CCIP v2.0 token verifiers of kind `tag` consume.
 *
 * - `usdc`: Circle's CCTP message whose hook data carries `messageId`, queried by the CCTP source
 *   domain the source-pool data or `cctpSourceDomain` gives;
 * - `lbtc`: Lombard's attestation of `lbtcPayloadHash`; see {@link getLbtcPayloadHash}.
 *
 * @param tag - The verifiers' kind
 * @param opts - The message's id, source chain, token transfer `extraData` and source tx hash
 * @returns The offchain token data, or `undefined` when there is not enough to query the issuer
 * @throws if the issuer's API has no ready attestation
 */
export async function getTokenVerifierData(
  tag: TokenVerifier['tag'],
  opts: WithLogger & {
    messageId: string
    sourceChainSelector: bigint
    extraData: BytesLike
    txHash: string
    lbtcPayloadHash?: string
    cctpSourceDomain?: number
  },
): Promise<NonNullable<OffchainTokenData> | undefined> {
  const { logger = console, messageId, txHash } = opts
  const { networkType } = networkInfo(opts.sourceChainSelector)
  if (tag === 'usdc') {
    const sourceDomain = parseCctpV2ExtraData(opts.extraData)?.sourceDomain ?? opts.cctpSourceDomain
    if (sourceDomain == null) {
      logger.debug('CCTP: no source domain for', messageId)
      return
    }
    return {
      _tag: tag,
      ...(await getUsdcAttestation({ sourceDomain, txHash, messageId }, networkType)),
    }
  }
  const { lbtcPayloadHash } = opts
  if (!lbtcPayloadHash) {
    logger.debug('LBTC: the source verifierBlobs carry no payload hash for', messageId)
    return
  }
  const { attestation } = await getLbtcAttestation(lbtcPayloadHash, networkType)
  return { _tag: tag, extraData: lbtcPayloadHash, attestation }
}

/** Options for {@link getOffchainTokenData}. */
export type GetOffchainTokenDataOpts = WithLogger & {
  /**
   * CCTP source domain, for v2 payloads that carry only the version tag. The 40-byte
   * `[tag][sourceDomain][depositHash]` payload carries it itself.
   */
  usdcSourceDomain?: number
}

/**
 * Fetch offchain token data for USDC (CCTP) and LBTC (Lombard) tokenAmounts.
 *
 * Understands both the v1.x source-pool payloads and the CCTP v2 payloads. A v2 payload that
 * carries only the 4-byte version tag needs `usdcSourceDomain`, since the Circle API is queried by
 * source domain; the 40-byte payload carries it itself.
 *
 * @param request - CCIPRequest containing tx.hash and message
 * @param opts - Logger and optional CCTP source-domain hint for v2 payloads
 * @returns Promise resolving to an OffchainTokenData for each tokenAmount
 */
export async function getOffchainTokenData(
  request: PickDeep<CCIPRequest, 'log.transactionHash' | `message`>,
  { logger = console, usdcSourceDomain }: GetOffchainTokenDataOpts = {},
): Promise<OffchainTokenData[]> {
  const { networkType } = networkInfo(request.message.sourceChainSelector)

  function looksUsdcData(extraData: BytesLike) {
    const cctpV2 = parseCctpV2ExtraData(extraData)
    // v2 payloads select the Circle message by CCIP message id, matched against its hook data
    if (cctpV2) {
      return {
        sourceDomain: cctpV2.sourceDomain ?? usdcSourceDomain,
        messageId: request.message.messageId,
      }
    }
    if (getDataBytes(extraData).length !== 64) return
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
    const bytes = getDataBytes(extraData)
    // looks like a hash
    if (bytes.length === 32 && bytes.filter(Boolean).length > 20) return true
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
        const { sourceDomain } = usdcOpts
        if (sourceDomain == null) {
          logger.debug(
            'CCTP v2 extraData carries no source domain; pass `usdcSourceDomain` to fetch its attestation',
          )
          return
        }
        try {
          const usdcAttestation = await getUsdcAttestation(
            { ...usdcOpts, sourceDomain, txHash: request.log.transactionHash },
            networkType,
          )
          return { _tag: 'usdc', extraData, ...usdcAttestation }
        } catch (err) {
          // maybe not a USDC transfer, or not ready
          logger.warn(`❌ CCTP: Failed to fetch attestation for message:`, request.message, err)
        }
      } else if (looksLbtcData(extraData)) {
        try {
          const lbtcAttestation = await getLbtcAttestation(
            hexlify(getDataBytes(extraData)),
            networkType,
          )
          return { _tag: 'lbtc', extraData, ...lbtcAttestation }
        } catch (err) {
          logger.warn(`❌ LBTC: Failed to fetch attestation for message:`, extraData, err)
        }
      }
    }),
  )
}
