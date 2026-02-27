/**
 * A single disclosed contract, ready to be embedded in a Canton command submission
 */
export interface DisclosedContract {
  /** Full Daml template ID string, e.g. `"<pkgId>:CCIP.OffRamp:OffRamp"` */
  templateId: string
  /** Daml contract ID */
  contractId: string
  /** Opaque base64/hex blob obtained from the ACS `createdEvent.createdEventBlob` field */
  createdEventBlob: string
  /** Synchronizer from which the contract was read (required for multi-synchronizer Canton deployments) */
  synchronizerId?: string
}
