/**
 * Explicit Disclosures — shared types
 *
 * Canton requires attaching `createdEventBlob` for every contract referenced by a
 * command submission. The types below model the contracts needed for each CCIP
 * operation (execute vs. send) and the two strategies for obtaining them:
 *
 *   - AcsDisclosureProvider  — queries the Canton Ledger API ACS directly.
 *   - EdsDisclosureProvider  — calls the Explicit Disclosure Service (EDS) REST API.
 */

// ---------------------------------------------------------------------------
// Core contract descriptor
// ---------------------------------------------------------------------------

/**
 * A single disclosed contract, ready to be embedded in a Canton command submission
 * as an element of `JsCommands.disclosedContracts`.
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

// ---------------------------------------------------------------------------
// Grouped disclosure shapes per CCIP operation
// ---------------------------------------------------------------------------

/**
 * All disclosed contracts required to submit a `ccipExecute` command on Canton.
 * Matches the Go `ExecutionDisclosures` struct in `eds.go`.
 */
export interface ExecutionDisclosures {
  offRamp: DisclosedContract
  globalConfig: DisclosedContract
  tokenAdminRegistry: DisclosedContract
  rmnRemote: DisclosedContract
  /** One entry per CommitteeVerifier (CCV) referenced by the execute command */
  verifiers: DisclosedContract[]
}

/**
 * All disclosed contracts required to submit a `ccipSend` command on Canton.
 * Matches the Go `CCIPSendContracts` struct in EDS `types.go`.
 */
export interface SendDisclosures {
  router: DisclosedContract
  onRamp: DisclosedContract
  feeQuoter: DisclosedContract
}

// ---------------------------------------------------------------------------
// Contract instance addresses (needed by the ACS provider)
// ---------------------------------------------------------------------------

/**
 * Hex-encoded keccak256 instance addresses for all CCIP contracts that must be
 * disclosed when executing a CCIP message on Canton.
 *
 * These are **not** Daml contract IDs — they are derived from the contract's
 * `instanceId` field and its signatory party via:
 *   `keccak256(utf8("<instanceId>@<signatoryParty>"))`
 *
 * Required when using `AcsDisclosureProvider`. Not needed for `EdsDisclosureProvider`.
 */
export interface CCIPContractInstanceAddresses {
  offRampAddress: string
  globalConfigAddress: string
  tokenAdminRegistryAddress: string
  rmnRemoteAddress: string
  perPartyRouterFactoryAddress: string
  /** An address for each CommitteeVerifier (CCV) that will be referenced in execution */
  ccvAddresses: string[]
  /** PerPartyRouter instance address (send path) */
  routerAddress?: string
  /** OnRamp instance address (send path) */
  onRampAddress?: string
  /** FeeQuoter instance address (send path) */
  feeQuoterAddress?: string
}

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the ACS-based disclosure provider.
 * Requires direct access to the Canton Ledger API and the full set of contract
 * instance addresses.
 */
export interface AcsDisclosureConfig {
  /** Canton party ID acting on behalf of the user */
  party: string
  /** Hex-encoded instance addresses for all CCIP contracts */
  instanceAddresses: CCIPContractInstanceAddresses
  /** Additional CCV instance addresses to merge in at call time */
  additionalCcvAddresses?: string[]
}

/**
 * Configuration for the EDS-based disclosure provider.
 * Requires only the EDS base URL and environment ID — no direct ledger access needed.
 */
export interface EdsDisclosureConfig {
  /** Base URL of the running EDS instance, e.g. `http://eds-host:8090` */
  edsBaseUrl: string
  /**
   * Environment identifier as configured in the EDS `environments.yaml`,
   * e.g. `"localnet"`, `"testnet"`, `"mainnet"`.
   */
  environmentId: string
  /** Optional request timeout in milliseconds (default: 10_000) */
  timeoutMs?: number
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * Implemented by both `AcsDisclosureProvider` and `EdsDisclosureProvider`.
 * The SDK calls these methods internally before building a Canton command — the
 * user never needs to interact with this interface directly.
 *
 * An optional `additionalDisclosures` callback can be set on the provider to
 * merge extra contracts (e.g. a user-deployed `CCIPReceiver`) into every command.
 */
export interface DisclosureProvider {
  /**
   * Fetch all contracts that must be disclosed for a `ccipExecute` command.
   * @param extraCcvAddresses - Optional extra CCV instance addresses to resolve
   *   on top of those already known to the provider.
   */
  fetchExecutionDisclosures(extraCcvAddresses?: string[]): Promise<ExecutionDisclosures>

  /**
   * Fetch all contracts that must be disclosed for a `ccipSend` command.
   */
  fetchSendDisclosures(): Promise<SendDisclosures>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flatten an `ExecutionDisclosures` object into the flat array expected by
 * `JsCommands.disclosedContracts`.
 */
export function executionDisclosuresToArray(
  disclosures: ExecutionDisclosures,
): DisclosedContract[] {
  return [
    disclosures.offRamp,
    disclosures.globalConfig,
    disclosures.tokenAdminRegistry,
    disclosures.rmnRemote,
    ...disclosures.verifiers,
  ]
}

/**
 * Flatten a `SendDisclosures` object into the flat array expected by
 * `JsCommands.disclosedContracts`.
 */
export function sendDisclosuresToArray(disclosures: SendDisclosures): DisclosedContract[] {
  return [disclosures.router, disclosures.onRamp, disclosures.feeQuoter]
}
