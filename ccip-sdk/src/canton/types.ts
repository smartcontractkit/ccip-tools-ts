import type { Provider } from '@canton-network/core-splice-provider'
import type { RpcTypes as DappRpcTypes } from '@canton-network/core-wallet-dapp-rpc-client'

import { CCIPArgumentInvalidError } from '../errors/specialized.ts'
import type { ChainFamily } from '../networks.ts'
import { type PartyId, parsePartyId } from './addressCodec.ts'
import type { JsCommands } from './client/index.ts'

export type CantonRpcProvider = Provider<DappRpcTypes>

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
 * Encoded as `"tokenId@tokenAdmin"` (e.g. `link-token@ccipOwner::1220…`).
 */
export interface CantonInstrumentId {
  id: string
  admin: PartyId
}

/**
 * Input for a single CCV that should verify the outbound send.
 */
export interface CantonCCVSendInput {
  ccvCid: string
  ccvRawAddress: string
  verifierArgs: string
}

/**
 * Token input carrying the Transfer Factory reference and metadata.
 */
export interface CantonTokenInput {
  transferFactory: string
  extraArgs: CantonTokenExtraArgs
  tokenPoolHoldings: string[]
}

/**
 * Extra arguments attached to a Canton token input.
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
 * Parse a Canton instrument string `tokenId@tokenAdmin` into
 * {@link CantonInstrumentId} for ledger Holding filters and CCIP fee/token fields.
 *
 * @example
 * ```ts
 * parseCantonInstrumentId(
 *   'link-token@ccipOwner::1220e382…',
 * )
 * // => { id: 'link-token', admin: 'ccipOwner::1220e382…' }
 * ```
 *
 * @throws {@link CCIPArgumentInvalidError} if the string is not two `@`-separated parts.
 */
export function parseCantonInstrumentId(instrument: string): CantonInstrumentId {
  const parts = instrument.split('@')
  if (parts.length !== 2) {
    throw new CCIPArgumentInvalidError(
      'instrument',
      `invalid Canton instrument ID "${instrument}": expected tokenId@tokenAdmin`,
    )
  }

  return {
    id: parts[0]!,
    admin: parsePartyId(parts[1]!),
  }
}

export type CantonTokenInfo = {
  instrumentId: string
  symbol: string
  decimals: number
}
