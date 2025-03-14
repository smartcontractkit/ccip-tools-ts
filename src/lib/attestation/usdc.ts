import { type Attestation, type AttestationClient } from './client'

// Docs: https://developers.circle.com/api-reference/stablecoins/common/get-attestation
const CIRCLE_API_URL = {
  mainnet: 'https://iris-api.circle.com/v1',
  testnet: 'https://iris-api-sandbox.circle.com/v1',
}

type AttestationResponse =
  | { error: 'string' }
  | { status: 'pending_confirmations' }
  | { status: 'complete'; attestation: string }

export class USDCAttestationClient implements AttestationClient {
  private readonly url: string

  constructor(isTestnet: boolean) {
    this.url = isTestnet ? CIRCLE_API_URL.testnet : CIRCLE_API_URL.mainnet
  }

  async getAttestation(hash: string): Promise<Attestation> {
    try {
      const res = await fetch(`${this.url}/attestations/${hash}`)
      const json = (await res.json()) as AttestationResponse
      const attestation = this.validateReponse(json)
      return { attestation, messageHash: hash }
    } catch (e) {
      throw new Error(
        `Error while fetching for USDC attestation with CIRCLE: ${(e as Error)?.message}`,
      )
    }
  }

  private validateReponse(json: AttestationResponse): string {
    // Ideally we do this with zod or similar
    if (!('status' in json) || json.status !== 'complete' || !json.attestation) {
      throw new Error(
        'Could not fetch USDC attestation. Response: ' + JSON.stringify(json, null, 2),
      )
    }
    return json.attestation
  }
}
