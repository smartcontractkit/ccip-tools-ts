import { type Addressable, type Log, EventFragment, Interface, keccak256 } from 'ethers'

import TokenPoolABI from '../abi/BurnMintTokenPool_1_5_1.js'
import { type AttestationClient, LBTCAttestationClient, USDCAttestationClient } from './attestation'
import {
  getLBTCDepositHashes,
  isBurnedEvent,
  isLBTCEvent,
  isTransferEvent,
  isUSDCEvent,
} from './events/index.js'
import { type ChainEvent } from './events/types.js'

import {
  type CCIPMessage,
  type CCIPRequest,
  type SourceTokenData,
  type TokenAmounts,
  defaultAbiCoder,
  parseSourceTokenData,
} from './types.ts'
import { lazyCached, networkInfo } from './utils.ts'

const TokenPoolInterface = lazyCached(
  `Interface BurnMintTokenPool 1.5.1`,
  () => new Interface(TokenPoolABI),
)
const BURNED_EVENT = TokenPoolInterface.getEvent('Burned')!

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
  mainnet: 'https://mainnet.prod.lombard.finance',
  testnet: 'https://gastald-testnet.prod.lombard.finance',
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

  const messageSentPerTokenAndPool = allLogsInRequest.reduce((acc, log, i, arr) => {
    // for our MessageSent of interest (USDC-like), the token is the contract
    // which emitted a (burn) Transfer immediately before this event, and the pool emitted a Burned
    // event 2 events after
    const transferLog = arr[i - 1]
    const poolLog = arr[i + 2]
    if (
      log.topics[0] !== USDC_EVENT.topicHash ||
      transferLog?.topics?.[0] !== TRANSFER_EVENT.topicHash ||
      poolLog?.topics?.[0] !== BURNED_EVENT.topicHash
    )
      return acc
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
  const res = await fetch(`${lbtcApiBaseUrl}/api/bridge/v1/deposits/getByHash`, {
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
  tokenAmounts: readonly SourceTokenData[],
  allLogsInRequest: readonly Pick<Log, 'topics' | 'address' | 'data'>[],
  isTestnet: boolean,
): Promise<(string | undefined)[]> {
  const lbtcDepositHashes = new Set(
    allLogsInRequest
      .filter(({ topics }) => topics[0] === LBTC_EVENT.topicHash)
      .map(({ topics }) => topics[3]),
  )
  return Promise.all(
    tokenAmounts.map(async ({ extraData }) => {
      // Attestation is required when SourceTokenData.extraData is 32 bytes long ('0x' + 64 hex chars)
      // otherwise attestation is not required
      if (lbtcDepositHashes.has(extraData)) {
        try {
          return await getLbtcAttestation(extraData, isTestnet)
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
  request: Pick<CCIPRequest, 'tx' | 'lane'> & {
    message: CCIPMessage
    log: Pick<CCIPRequest['log'], 'topics' | 'index'>
  },
): Promise<string[]> {
  const { isTestnet } = networkInfo(request.lane.sourceChainSelector)
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
  let lbtcTokenData: (string | undefined)[] = []
  try {
    let tokenAmounts
    if ('sourceTokenData' in request.message) {
      tokenAmounts = request.message.sourceTokenData.map(parseSourceTokenData)
    } else {
      tokenAmounts = request.message.tokenAmounts as readonly SourceTokenData[]
    }
    //for lbtc we distinguish logs by hash in event, so we can pass all of them
    lbtcTokenData = await getLbtcTokenData(tokenAmounts, request.tx.logs, isTestnet)
  } catch (_) {
    // pass
  }

  for (let i = 0; i < offchainTokenData.length; i++) {
    if (usdcTokenData[i]) {
      offchainTokenData[i] = usdcTokenData[i] as string
    } else if (lbtcTokenData[i]) {
      offchainTokenData[i] = lbtcTokenData[i] as string
    }
  }
  return offchainTokenData
}

// ----- Logic Replication using a chain agnostic input -----
export type FetchOffchainTokenDataInput = {
  sourceChainSelector: bigint
  ccipLog: Pick<ChainEvent, 'id' | 'index'>
  txLogs: ChainEvent[]
  tokenAmounts: TokenAmounts
}

export async function fetchOffchainTokenDataV2(
  input: FetchOffchainTokenDataInput,
): Promise<string[]> {
  const { isTestnet } = networkInfo(input.sourceChainSelector)
  const usdcAttClient = new USDCAttestationClient(isTestnet)
  const lbtcAttClient = new LBTCAttestationClient(isTestnet)

  // there's a chance there are other CCIPSendRequested in same tx,
  // and they may contain USDC transfers as well, so we select
  // any possible USDC or LBTC logs after that and before our CCIPSendRequested
  const relevantLogs = filterTxLogs(input.ccipLog, input.txLogs)

  const usdAtts = await getUsdcOffchainData(usdcAttClient, input.tokenAmounts, relevantLogs)
  const lbtcAtts = await getLbtcOffchainData(
    lbtcAttClient,
    input.tokenAmounts as SourceTokenData[],
    relevantLogs,
  )

  const offchainTokenData = input.tokenAmounts.map(() => '0x')
  for (let i = 0; i < offchainTokenData.length; i++) {
    if (usdAtts[i]) {
      offchainTokenData[i] = usdAtts[i] as string
    } else if (lbtcAtts[i]) {
      offchainTokenData[i] = lbtcAtts[i] as string
    }
  }
  return offchainTokenData
}

const filterTxLogs = (
  ccipLog: Pick<ChainEvent, 'id' | 'index'>,
  logs: ChainEvent[],
): ChainEvent[] => {
  const prevCcipRequestIdx =
    logs.find(({ id, index }) => id === ccipLog.id && index < ccipLog.index)?.index ?? -1
  return logs.filter(({ index }) => prevCcipRequestIdx < index && index < ccipLog.index)
}

const getUsdcOffchainData = async (
  attClient: AttestationClient,
  tokenAmounts: TokenAmounts,
  events: ChainEvent[],
): Promise<(string | undefined)[]> => {
  const attestations: (string | undefined)[] = []

  const messageSentPerTokenAndPool = events.reduce((acc, event, i, arr) => {
    // for our MessageSent of interest (USDC-like), the token is the contract
    // which emitted a (burn) Transfer immediately before this event, and the pool emitted a Burned
    // event 2 events after
    const transferEvent = arr[i - 1]
    const poolEvent = arr[i + 2]
    if (!isUSDCEvent(event) || !isTransferEvent(transferEvent) || !isBurnedEvent(poolEvent))
      return acc

    const token = transferEvent.address
    const pool = poolEvent.address
    acc.set(token, [...(acc.get(token) ?? []), event])
    acc.set(pool, [...(acc.get(pool) ?? []), event])

    return acc
  }, new Map<string | Addressable, (typeof events)[number][]>())

  for (const [i, tokenAmount] of tokenAmounts.entries()) {
    const tokenOrPool = 'token' in tokenAmount ? tokenAmount.token : tokenAmount.sourcePoolAddress

    // what if there are more USDC transfers of this same token after this one?
    const tokenTransfersCountAfter = tokenAmounts.filter(
      (ta, j) => ('token' in ta ? ta.token : ta.sourcePoolAddress) === tokenOrPool && j > i,
    ).length

    let messageSentLog: (typeof events)[number] | undefined
    const messageSents = messageSentPerTokenAndPool.get(tokenOrPool)
    if (messageSents) {
      // look from the end (near our request), but skip MessageSents for further transfers
      messageSentLog = messageSents[messageSents.length - 1 - tokenTransfersCountAfter]
    }

    let tokenData: string | undefined
    if (messageSentLog) {
      try {
        // TODO: This probably need to be abstracted per chain
        const message = defaultAbiCoder.decode(USDC_EVENT.inputs, messageSentLog.data)[0] as string
        const { attestation } = await attClient.getAttestation(message)
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

const getLbtcOffchainData = (
  attClient: AttestationClient,
  tokenData: SourceTokenData[],
  events: ChainEvent[],
): Promise<(string | undefined)[]> => {
  const lbtcDepositHashes = new Set(
    events.filter((event) => isLBTCEvent(event)).map(getLBTCDepositHashes),
  )
  return Promise.all(
    tokenData.map(async ({ extraData }) => {
      // Attestation is required when SourceTokenData.extraData is 32 bytes long ('0x' + 64 hex chars)
      // otherwise attestation is not required
      if (lbtcDepositHashes.has(extraData)) {
        try {
          const { attestation } = await attClient.getAttestation(extraData)
          return attestation
        } catch (_) {
          // fallback: undefined
          return undefined
        }
      }
    }),
  )
}
