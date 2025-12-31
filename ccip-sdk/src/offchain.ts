import { keccak256 } from 'ethers'

import {
  CCIPLbtcAttestationNotApprovedError,
  CCIPLbtcAttestationNotFoundError,
  CCIPUsdcAttestationError,
} from './errors/index.ts'

const CIRCLE_API_URL = {
  mainnet: 'https://iris-api.circle.com/v1',
  testnet: 'https://iris-api-sandbox.circle.com/v1',
}

type CctpAttestationResponse =
  | { error: 'string' }
  | { status: 'pending_confirmations' }
  | { status: 'complete'; attestation: string }

const LOMBARD_API_URL = {
  mainnet: 'https://mainnet.prod.lombard.finance',
  testnet: 'https://gastald-testnet.prod.lombard.finance',
}

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
export async function getUsdcAttestation(message: string, isTestnet: boolean): Promise<string> {
  const msgHash = keccak256(message)

  const circleApiBaseUrl = isTestnet ? CIRCLE_API_URL.testnet : CIRCLE_API_URL.mainnet
  const res = await fetch(`${circleApiBaseUrl}/attestations/${msgHash}`)
  const json = (await res.json()) as CctpAttestationResponse
  if (!('status' in json) || json.status !== 'complete' || !json.attestation) {
    throw new CCIPUsdcAttestationError(msgHash, json)
  }
  return json.attestation
}

/**
 * Returns the LBTC attestation for a given payload hash
 *
 * @param payloadHash - hash of the payload of the LBTC transfer
 * @param isTestnet - true if this was from a testnet
 * @returns LBTC attestation bytes
 */
export async function getLbtcAttestation(
  payloadHash: string,
  isTestnet: boolean,
): Promise<{
  attestation: string
}> {
  const lbtcApiBaseUrl = isTestnet ? LOMBARD_API_URL.testnet : LOMBARD_API_URL.mainnet
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
