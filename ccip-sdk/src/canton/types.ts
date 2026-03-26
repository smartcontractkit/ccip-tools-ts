import type { ChainFamily } from '../types.ts'
import type { JsCommands } from './client/index.ts'

/**
 * A Canton "wallet" identifies the acting party and optionally overrides the
 * bearer token used for Ledger API authentication.
 */
export interface CantonWallet {
  /** Daml party ID used for `actAs` in command submissions. */
  party: string
}

/**
 * Type-guard for {@link CantonWallet}.
 */
export function isCantonWallet(v: unknown): v is CantonWallet {
  return (
    typeof v === 'object' &&
    v !== null &&
    'party' in v &&
    typeof (v as CantonWallet).party === 'string' &&
    (v as CantonWallet).party.length > 0
  )
}

/**
 * An unsigned Canton transaction wraps a `JsCommands` object ready to be
 * submitted to the Canton Ledger API via `submitAndWait` /
 * `submitAndWaitForTransaction`.
 */
export interface UnsignedCantonTx {
  family: typeof ChainFamily.Canton
  /** The Canton command payload ready for submission. */
  commands: JsCommands
}

/**
 * Identifies a token on Canton (maps to `splice_api_token_holding_v1.InstrumentId`).
 *
 * Encoded as `"admin::tokenId"` in the SDK's `message.feeToken` string.
 */
export interface CantonInstrumentId {
  admin: string
  id: string
}

/**
 * Input for a single CCV that should verify the outbound send
 * (maps to Go `ccipsender.CCVSendInput`).
 */
export interface CantonCCVSendInput {
  ccvCid: string
  ccvRawAddress: string
  verifierArgs: string
}

/**
 * Token input carrying the Transfer Factory reference and metadata
 * (maps to Go `interfaces.TokenInput`).
 */
export interface CantonTokenInput {
  transferFactory: string
  extraArgs: CantonTokenExtraArgs
  tokenPoolHoldings: string[]
}

/**
 * Extra arguments attached to a Canton token input
 * (maps to Go `splice_api_token_metadata_v1.ExtraArgs`).
 */
export interface CantonTokenExtraArgs {
  context: { values: Record<string, unknown> }
  meta: { values: Record<string, unknown> }
}

/**
 * Canton-specific send parameters passed via `message.extraArgs` when calling
 * {@link CantonChain.generateUnsignedSendMessage} or {@link CantonChain.sendMessage}.
 *
 * These values cannot be derived automatically and must be supplied by the caller.
 */
export interface CantonExtraArgsV1 {
  /** Contract IDs of pre-funded fee-token holdings owned by the sender party. */
  feeTokenHoldingCids: string[]
  /**
   * CCV raw instance address strings in `"instanceId@party"` format.
   * The corresponding hex InstanceAddresses (keccak256 of each raw address)
   * are derived automatically at runtime and used to query the EDS for disclosures.
   * These are also passed verbatim as `ccvRawAddress.unpack` in the Send choice argument.
   */
  ccvRawAddresses?: string[]
  /** Gas limit for ccipReceive on the destination chain */
  gasLimit?: bigint
}

/**
 * Parse a fee-token string of the form `"admin::tokenId"` into a
 * {@link CantonInstrumentId}.
 *
 * @throws {Error} if the string does not contain the `::` separator.
 */
export function parseInstrumentId(feeToken: string): CantonInstrumentId {
  const sep = feeToken.split('::')
  if (sep.length !== 3) {
    throw new Error(
      `Invalid Canton instrument ID "${feeToken}": expected "ad::min::tokenId" format`,
    )
  }
  const admin = [sep[0], sep[1]].join('::')
  const id = sep[2]!
  return { admin, id }
}
