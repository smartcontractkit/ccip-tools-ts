import { type Addressable, type Log, EventFragment, keccak256 } from 'ethers'

import {
  type CCIPMessage,
  type CCIPRequest,
  defaultAbiCoder,
  parseSourceTokenData,
} from './types.js'
import { networkInfo } from './utils.js'

const USDC_EVENT = EventFragment.from('MessageSent(bytes message)')
const TRANSFER_EVENT = EventFragment.from('Transfer(address from, address to, uint256 value)')
export const LBTC_EVENT = EventFragment.from(
  'DepositToBridge(address fromAddress, bytes32 toAddress, bytes32 payloadHash, bytes payload)',
)

const CIRCLE_API_URL = {
  mainnet: 'https://iris-api.circle.com/v1',
  testnet: 'https://iris-api-sandbox.circle.com/v1',
}
const LOMBARD_API_URL = {
  mainnet: 'https://bridge-manager.lombard.finance',
  testnet: 'https://bridge-manager.staging.lombard.finance',
}

type AttestationResponse =
  | { error: 'string' }
  | { status: 'pending_confirmations' }
  | { status: 'complete'; attestation: string }

type LombardAttestation =
  | { status: 'NOTARIZATION_STATUS_SESSION_APPROVED'; message_hash: string; attestation: string }
  | { status: string; message_hash: string }
type LombardAttestationsResponse = { attestations: Array<LombardAttestation> }

/**
 * Returns the USDC attestation for a given MessageSent Log
 * https://developers.circle.com/stablecoins/reference/getattestation
 *
 * @param message - payload of USDC MessageSent(bytes message) event
 * @param isTestnet - true if this was from a testnet
 * @returns USDC/CCTP attestation bytes
 */
async function getUsdcAttestation(message: string, isTestnet: boolean): Promise<string> {
  const msgHash = keccak256(message)

  const circleApiBaseUrl = isTestnet ? CIRCLE_API_URL.testnet : CIRCLE_API_URL.mainnet
  const res = await fetch(`${circleApiBaseUrl}/attestations/${msgHash}`)
  const json = (await res.json()) as AttestationResponse
  if (!('status' in json) || json.status !== 'complete' || !json.attestation) {
    throw new Error('Could not fetch USDC attestation. Response: ' + JSON.stringify(json, null, 2))
  }
  return json.attestation
}

/**
 * Try to fetch USDC attestations for transfers, return undefined in position if can't
 *
 * @param tokenAmounts - all tokenAmounts to try
 * @param allLogsInRequest - all other logs in same tx as CCIPSendRequested
 * @param isTestnet - use testnet CCTP API endpoint
 * @returns array where each position is either the attestation for that transfer or undefined
 **/
async function getUsdcTokenData(
  tokenAmounts: CCIPMessage['tokenAmounts'],
  allLogsInRequest: Pick<Log, 'topics' | 'address' | 'data'>[],
  isTestnet: boolean,
): Promise<(string | undefined)[]> {
  const attestations: (string | undefined)[] = []

  const messageSentPerToken = allLogsInRequest.reduce((acc, log, i, arr) => {
    // for our MessageSent of interest (USDC-like), the token is the contract
    // which emitted a (burn) Transfer immediately before this event
    const logBefore = arr[i - 1]
    if (
      log.topics[0] !== USDC_EVENT.topicHash ||
      logBefore?.topics?.[0] !== TRANSFER_EVENT.topicHash
    )
      return acc
    const token = logBefore.address
    return acc.set(token, [...(acc.get(token) ?? []), log])
  }, new Map<string | Addressable, (typeof allLogsInRequest)[number][]>())
  for (const [i, { token }] of tokenAmounts.entries()) {
    // what if there are more USDC transfers of this same token after this one?
    const tokenTransfersCountAfter = tokenAmounts.filter(
      ({ token: t }, j) => t === token && j > i,
    ).length
    let messageSentLog: (typeof allLogsInRequest)[number] | undefined
    const messageSents = messageSentPerToken.get(token)
    if (messageSents) {
      // look from the end (near our request), but skip MessageSents for further transfers
      messageSentLog = messageSents[messageSents.length - 1 - tokenTransfersCountAfter]
    }
    let tokenData: string | undefined
    if (messageSentLog) {
      try {
        const message = defaultAbiCoder.decode(USDC_EVENT.inputs, messageSentLog.data)[0] as string
        const attestation = await getUsdcAttestation(message, isTestnet)
        tokenData = defaultAbiCoder.encode(
          ['tuple(bytes message, bytes attestation)'],
          [{ message, attestation }],
        )
      } catch (_) {
        // maybe not a USDC transfer
      }
    }
    attestations.push(tokenData)
  }

  return attestations
}

/**
 * Returns the LBTC attestation for a given payload hash
 *
 * @param payloadHash - hash of the payload of the LBTC transfer
 * @param isTestnet - true if this was from a testnet
 * @returns LBTC attestation bytes
 */
async function getLbtcAttestation(payloadHash: string, isTestnet: boolean): Promise<string> {
  const lbtcApiBaseUrl = isTestnet ? LOMBARD_API_URL.testnet : LOMBARD_API_URL.mainnet
  const res = await fetch(`${lbtcApiBaseUrl}/bridge/v1/deposits/getByHash`, {
    method: 'POST',
    body: JSON.stringify({ messageHash: [payloadHash] }),
  })
  const response = (await res.json()) as LombardAttestationsResponse
  if (response == null || !('attestations' in response)) {
    throw new Error(
      'Error while fetching LBTC attestation. Response: ' + JSON.stringify(response, null, 2),
    )
  }
  const attestation = response.attestations.find((att) => att.message_hash === payloadHash)
  if (attestation == null) {
    throw new Error(
      'Could not find requested LBTC attestation with hash:' +
        payloadHash +
        ' in response: ' +
        JSON.stringify(response, null, 2),
    )
  }
  if (
    attestation.status === 'NOTARIZATION_STATUS_SESSION_APPROVED' &&
    'attestation' in attestation
  ) {
    return attestation.attestation
  }
  throw new Error(
    'LBTC attestation is not approved or invalid. Response: ' +
      JSON.stringify(attestation, null, 2),
  )
}

/**
 * Try to fetch LBTC attestations for transfers, return undefined in position if can't or not required
 *
 * @param message - CCIPMessage to fetch attestation for every tokenAmounts
 * @param isTestnet - use testnet CCTP API endpoint
 * @returns array where each position is either the attestation for that transfer or undefined
 **/
async function getLbtcTokenData(
  message: Pick<CCIPRequest['message'], 'sourceTokenData' | 'tokenAmounts' | 'sourceChainSelector'>,
  allLogsInRequest: readonly Pick<Log, 'topics' | 'address' | 'data'>[],
  isTestnet: boolean,
): Promise<(string | undefined)[]> {
  const lbtcDepositHashes = allLogsInRequest
    .filter(({ topics }) => topics[0] === LBTC_EVENT.topicHash)
    .map(({ topics }) => topics[3])
  if (lbtcDepositHashes.length === 0) return message.tokenAmounts.map(() => undefined)
  return Promise.all(
    message.tokenAmounts.map(async (_, idx) => {
      const destTokenData = parseSourceTokenData(message.sourceTokenData[idx]).extraData
      // Attestation is required when SourceTokenData.extraData is 32 bytes long ('0x' + 64 hex chars)
      // otherwise attestation is not required
      if (destTokenData.length === 66 && lbtcDepositHashes.includes(destTokenData)) {
        try {
          return await getLbtcAttestation(destTokenData, isTestnet)
        } catch (_) {
          // fallback: undefined
        }
      }
    }),
  )
}

/**
 * Fetch offchain token data for all transfers in request
 *
 * @param request - Request (or subset of) to fetch offchainTokenData for
 * @returns Array of byte arrays, one per transfer in request
 */
export async function fetchOffchainTokenData(
  request: Pick<CCIPRequest, 'tx'> & {
    message: Pick<
      CCIPRequest['message'],
      'sourceTokenData' | 'tokenAmounts' | 'sourceChainSelector'
    >
    log: Pick<CCIPRequest['log'], 'topics' | 'index'>
  },
): Promise<string[]> {
  const { isTestnet } = networkInfo(request.message.sourceChainSelector)
  // there's a chance there are other CCIPSendRequested in same tx,
  // and they may contain USDC transfers as well, so we select
  // any USDC logs after that and before our CCIPSendRequested
  const prevCcipRequestIdx =
    request.tx.logs.find(
      ({ topics, index }) => topics[0] === request.log.topics[0] && index < request.log.index,
    )?.index ?? -1
  const usdcRequestLogs = request.tx.logs.filter(
    ({ index }) => prevCcipRequestIdx < index && index < request.log.index,
  )

  const offchainTokenData: string[] = request.message.tokenAmounts.map(
    () => '0x', // default tokenData
  )
  const usdcTokenData = await getUsdcTokenData(
    request.message.tokenAmounts,
    usdcRequestLogs,
    isTestnet,
  )
  //for lbtc we distinguish logs by hash in event, so we can pass all of them
  const lbtcTokenData = await getLbtcTokenData(request.message, request.tx.logs, isTestnet)

  for (let i = 0; i < offchainTokenData.length; i++) {
    if (usdcTokenData[i]) {
      offchainTokenData[i] = usdcTokenData[i] as string
    } else if (lbtcTokenData[i]) {
      offchainTokenData[i] = lbtcTokenData[i] as string
    }
  }
  return offchainTokenData
}
