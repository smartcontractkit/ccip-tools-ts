import type { Attestation, AttestationClient } from './client.ts'

const LOMBARD_API_URL = {
  mainnet: 'https://mainnet.prod.lombard.finance',
  testnet: 'https://gastald-testnet.prod.lombard.finance',
}

type LombardAttestation =
  | { status: 'NOTARIZATION_STATUS_SESSION_APPROVED'; message_hash: string; attestation: string }
  | { status: string; message_hash: string }
type AttestationsResponse = { attestations: Array<LombardAttestation> }

export class LBTCAttestationClient implements AttestationClient {
  private readonly url: string

  constructor(isTestnet: boolean) {
    this.url = isTestnet ? LOMBARD_API_URL.testnet : LOMBARD_API_URL.mainnet
  }

  async getAttestation(hash: string): Promise<Attestation> {
    try {
      const res = await fetch(`${this.url}/api/bridge/v1/deposits/getByHash`, {
        method: 'POST',
        body: JSON.stringify({ messageHash: [hash] }),
      })
      const json = (await res.json()) as AttestationsResponse

      const attestation = this.validateReponse(json, hash)
      return { attestation, messageHash: hash }
    } catch (e) {
      throw new Error(
        `Error while fetching for USDC attestation with CIRCLE: ${(e as Error)?.message}`,
      )
    }
  }

  private validateReponse(response: AttestationsResponse, hash: string): string {
    // Ideally done with zod
    if (response == null || !('attestations' in response)) {
      throw new Error(
        'Error while fetching LBTC attestation. Response: ' + JSON.stringify(response, null, 2),
      )
    }
    const attestation = response.attestations.find((att) => att.message_hash === hash)
    if (attestation == null) {
      throw new Error(
        'Could not find requested LBTC attestation with hash:' +
          hash +
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
}
