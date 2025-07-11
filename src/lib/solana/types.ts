export interface CcipCctpMessageSentEvent {
  originalSender: string // PublicKey as string
  remoteChainSelector: bigint
  msgTotalNonce: bigint
  eventAddress: string // PublicKey as string
  sourceDomain: number
  cctpNonce: bigint
  messageSentBytes: Uint8Array
}
