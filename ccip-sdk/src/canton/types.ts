import type { ChainFamily } from '../networks.ts'
import type { JsCommands, PartySignatures } from './client/index.ts'
import { CCIPArgumentInvalidError } from '../errors/specialized.ts'

/**
 * Signs a prepared Canton transaction hash on behalf of an external party.
 *
 * Implementations receive the raw hash bytes (decoded from the base64
 * `preparedTransactionHash` returned by the Preparing Participant Node) and
 * must return a fully-assembled {@link PartySignatures} structure.
 *
 * @example
 * ```ts
 * const signer: TransactionSigner = {
 *   async sign(hash) {
 *     const sig = ed25519.sign(hash, privateKey)
 *     return {
 *       signatures: [{
 *         party: partyId,
 *         signatures: [{
 *           format: 'CRYPTO_KEY_FORMAT_RAW',
 *           signature: Buffer.from(sig).toString('base64'),
 *           signedBy: keyFingerprint,
 *           signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
 *         }],
 *       }],
 *     }
 *   },
 * }
 * ```
 */
export interface TransactionSigner {
  sign(hash: Uint8Array): Promise<PartySignatures>
}

/**
 * A Canton "wallet" identifies the acting party and optionally carries a
 * {@link TransactionSigner} for external signing.
 *
 * When `signer` is present, {@link CantonChain.sendMessage} and
 * {@link CantonChain.execute} use the external signing flow
 * (prepare → sign → execute) instead of direct submission.
 */
export interface CantonWallet {
  /** Daml party ID used for `actAs` in command submissions. */
  party: string
  /** Optional external signer. When provided, transactions go through the interactive submission API. */
  signer?: TransactionSigner
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
 * Encoded as `"party::fingerprint::tokenId"` (e.g. `ccipOwner::1220…::link-token`).
 * The ledger stores `admin` as `party::fingerprint` and `id` as the token name.
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
  /** Contract IDs of pre-funded token-transfer holdings owned by the sender party. */
  tokenTransferHoldingCids?: string[]
  /**
   * Optional raw (`instanceId@owner`) or hashed InstanceAddress of the source
   * Canton LockReleaseTokenPool. The global TokenAdminRegistry lookup remains
   * authoritative; this value only validates/disambiguates the caller's intent.
   */
  tokenPoolAddress?: string
  /**
   * CCV raw instance address strings in `"instanceId@party"` format.
   * The corresponding hex InstanceAddresses (keccak256 of each raw address)
   * are derived automatically at runtime and used to query the EDS for disclosures.
   * These are also passed verbatim as `ccvRawAddress.unpack` in the Send choice argument.
   */
  ccvRawAddresses?: string[]
  /** Gas limit for ccipReceive on the destination chain (`--gas-limit` / canton-config `defaultSendGasLimit`). */
  gasLimit?: bigint
  /**
   * On-ledger executor mode for Canton → destination sends.
   * - `default`: resolve executor from global EDS.
   * - `none`: `Executor_NoExecutor` — no auto-execute on destination.
   */
  executorMode?: 'default' | 'none'
}

/**
 * Parse a Canton instrument string `party::fingerprint::tokenId` into
 * {@link CantonInstrumentId} for ledger Holding filters and CCIP fee/token fields.
 *
 * @example
 * ```ts
 * parseCantonInstrumentId(
 *   'ccipOwner::1220e382…::link-token',
 * )
 * // => { admin: 'ccipOwner::1220e382…', id: 'link-token' }
 * ```
 *
 * @throws {@link CCIPArgumentInvalidError} if the string is not three `::`-separated parts.
 */
export function parseCantonInstrumentId(instrument: string): CantonInstrumentId {
  const parts = instrument.split('::')
  if (parts.length !== 3) {
    throw new CCIPArgumentInvalidError(
      'instrument',
      `invalid Canton instrument ID "${instrument}": expected party::fingerprint::tokenId`,
    )
  }
  return { admin: [parts[0], parts[1]].join('::'), id: parts[2]! }
}

/**
 * Parse a Canton instrument id string.
 * @deprecated Prefer {@link parseCantonInstrumentId} for new code.
 */
export function parseInstrumentId(feeToken: string): CantonInstrumentId {
  return parseCantonInstrumentId(feeToken)
}
