export type Attestation = {
  attestation: string
  messageHash: string
}

export interface AttestationClient {
  getAttestation(hash: string): Promise<Attestation>
}
