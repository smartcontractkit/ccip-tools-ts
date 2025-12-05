import { type Addressable, type Log, EventFragment } from 'ethers'

import { getLbtcAttestation, getUsdcAttestation } from '../offchain.ts'
import type { CCIPMessage, CCIPRequest, OffchainTokenData } from '../types.ts'
import { networkInfo } from '../utils.ts'
import { defaultAbiCoder, interfaces, requestsFragments } from './const.ts'
import { type SourceTokenData, parseSourceTokenData } from './messages.ts'

const BURNED_EVENT_1_5 = interfaces.TokenPool_v1_5.getEvent('Burned')!
const BURNED_EVENT_1_6 = interfaces.TokenPool_v1_6.getEvent('LockedOrBurned')!
const BURNED_EVENT_TOPIC_HASHES = new Set([BURNED_EVENT_1_5.topicHash, BURNED_EVENT_1_6.topicHash])

const USDC_EVENT = EventFragment.from('MessageSent(bytes message)')
const TRANSFER_EVENT = EventFragment.from('Transfer(address from, address to, uint256 value)')

export const LBTC_EVENT = EventFragment.from(
  'DepositToBridge(address fromAddress, bytes32 toAddress, bytes32 payloadHash, bytes payload)',
)
export const LBTC_EVENT_V2 = EventFragment.from(
  'DepositToBridge(address fromAddress, bytes32 toAddress, bytes32 payloadHash)',
)
const LBTC_EVENTS_HASHES = new Set([LBTC_EVENT.topicHash, LBTC_EVENT_V2.topicHash])

/**
 * Fetch offchain token data for all transfers in request
 *
 * @param request - Request (or subset of) to fetch offchainTokenData for
 * @returns Array of byte arrays, one per transfer in request
 */
export async function fetchEVMOffchainTokenData(
  request: Pick<CCIPRequest, 'tx'> & {
    message: CCIPMessage
    log: Pick<CCIPRequest['log'], 'index'>
  },
): Promise<OffchainTokenData[]> {
  const { isTestnet } = networkInfo(request.message.header.sourceChainSelector)
  // there's a chance there are other CCIPSendRequested in same tx,
  // and they may contain USDC transfers as well, so we select
  // any USDC logs after that and before our CCIPSendRequested
  const prevCcipRequestIdx =
    request.tx.logs.find(
      ({ topics, index }) => topics[0] in requestsFragments && index < request.log.index,
    )?.index ?? -1
  const usdcRequestLogs = request.tx.logs.filter(
    ({ index }) => prevCcipRequestIdx < index && index < request.log.index,
  ) as Log[]

  const offchainTokenData: OffchainTokenData[] = request.message.tokenAmounts.map(
    () => undefined, // default tokenData
  )
  const usdcTokenData = await getUsdcTokenData(
    request.message.tokenAmounts,
    usdcRequestLogs,
    isTestnet,
  )
  let lbtcTokenData: OffchainTokenData[] = []
  try {
    let tokenAmounts: readonly SourceTokenData[]
    if ('sourceTokenData' in request.message) {
      tokenAmounts = request.message.sourceTokenData.map(parseSourceTokenData)
    } else {
      tokenAmounts = request.message.tokenAmounts
    }
    //for lbtc we distinguish logs by hash in event, so we can pass all of them
    lbtcTokenData = await getLbtcTokenData(tokenAmounts, request.tx.logs as Log[], isTestnet)
  } catch (_) {
    // pass
  }

  for (let i = 0; i < offchainTokenData.length; i++) {
    if (usdcTokenData[i]) {
      offchainTokenData[i] = usdcTokenData[i]
    } else if (lbtcTokenData[i]) {
      offchainTokenData[i] = lbtcTokenData[i]
    }
  }

  return offchainTokenData
}

/**
 * Encodes offchain token data for EVM execution.
 * @param data - Offchain token data to encode.
 * @returns ABI-encoded data or empty hex string.
 */
export function encodeEVMOffchainTokenData(data: OffchainTokenData): string {
  if (data?._tag === 'usdc') {
    return defaultAbiCoder.encode(['tuple(bytes message, bytes attestation)'], [data])
  } else if (data?._tag === 'lbtc') {
    return data.attestation as string
  }
  return '0x'
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
): Promise<OffchainTokenData[]> {
  const attestations: OffchainTokenData[] = []

  const messageSentPerTokenAndPool = allLogsInRequest.reduce((acc, log, i, arr) => {
    // for our MessageSent of interest (USDC-like), the token is the contract
    // which emitted a (burn) Transfer immediately before this event, and the pool emitted a Burned
    // event 2 events after
    const transferLog = arr[i - 1]
    const poolLog = arr[i + 2]
    if (
      log.topics[0] !== USDC_EVENT.topicHash ||
      transferLog?.topics?.[0] !== TRANSFER_EVENT.topicHash ||
      !BURNED_EVENT_TOPIC_HASHES.has(poolLog?.topics?.[0])
    ) {
      return acc
    }
    const token = transferLog.address
    const pool = poolLog.address
    acc.set(token, [...(acc.get(token) ?? []), log])
    acc.set(pool, [...(acc.get(pool) ?? []), log])
    return acc
  }, new Map<string | Addressable, (typeof allLogsInRequest)[number][]>())

  for (const [i, tokenAmount] of tokenAmounts.entries()) {
    const tokenOrPool = 'token' in tokenAmount ? tokenAmount.token : tokenAmount.sourcePoolAddress

    // what if there are more USDC transfers of this same token after this one?
    const tokenTransfersCountAfter = tokenAmounts.filter(
      (ta, j) => ('token' in ta ? ta.token : ta.sourcePoolAddress) === tokenOrPool && j > i,
    ).length

    let messageSentLog: (typeof allLogsInRequest)[number] | undefined
    const messageSents = messageSentPerTokenAndPool.get(tokenOrPool)
    if (messageSents) {
      // look from the end (near our request), but skip MessageSents for further transfers
      messageSentLog = messageSents[messageSents.length - 1 - tokenTransfersCountAfter]
    }

    let tokenData: OffchainTokenData
    if (messageSentLog) {
      let message
      try {
        message = defaultAbiCoder.decode(USDC_EVENT.inputs, messageSentLog.data)[0] as string
        const attestation = await getUsdcAttestation(message, isTestnet)
        tokenData = {
          _tag: 'usdc',
          message,
          attestation,
        }
        // encoding of OffchainTokenData to be done as part of Chain.executeReceipt
      } catch (err) {
        // maybe not a USDC transfer, or not ready
        console.warn(`❌ EVM CCTP: Failed to fetch attestation for message:`, message, err)
      }
    }
    attestations.push(tokenData)
  }

  return attestations
}

/**
 * Try to fetch LBTC attestations for transfers, return undefined in position if can't or not required
 **/
async function getLbtcTokenData(
  tokenAmounts: readonly SourceTokenData[],
  allLogsInRequest: readonly Pick<Log, 'topics' | 'address' | 'data'>[],
  isTestnet: boolean,
): Promise<OffchainTokenData[]> {
  const lbtcDepositHashes = new Set(
    allLogsInRequest
      .filter(({ topics }) => LBTC_EVENTS_HASHES.has(topics[0]))
      .map(({ topics }) => topics[3]),
  )
  return Promise.all(
    tokenAmounts.map(async ({ extraData }) => {
      // Attestation is required when SourceTokenData.extraData is 32 bytes long ('0x' + 64 hex chars)
      // otherwise attestation is not required
      if (lbtcDepositHashes.has(extraData)) {
        try {
          return { _tag: 'lbtc', extraData, ...(await getLbtcAttestation(extraData, isTestnet)) }
        } catch (err) {
          console.warn(`❌ EVM LBTC: Failed to fetch attestation for message:`, extraData, err)
        }
      }
    }),
  )
}
