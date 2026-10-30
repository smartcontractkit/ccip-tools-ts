import type { Provider } from '@canton-network/core-splice-provider'
import type { RpcTypes as DappRpcTypes } from '@canton-network/core-wallet-dapp-rpc-client'

import { CCIPArgumentInvalidError } from '../errors/specialized.ts'
import type { ChainFamily } from '../networks.ts'
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
  // Contract IDs of holdings to be used as an input to pay for CCIP fees.
  // Holdings are unchecked and passed through as-is.
  // Optional - if not set, will automatically detect holdings
  feeTokenHoldingCids?: string[]
  // Contract IDs of holdings to be used as an input to the CCIP token transfer.
  // Holdings are unchecked and passed through as-is.
  // Optional - if not set, will automatically detect holdings
  tokenTransferHoldingCids?: string[]
  // Contract ID of the PerPartyRouter contract to be used for the send.
  // Optional - if not set, will automatically detect (or deploy) PerPartyRouter.
  perPartyRouterCid?: string
  // Contract ID of the CCIPSender contract to be used for the send.
  // Optional - if not set, will automatically detect (or deploy) CCIPSender.
  ccipSenderCid?: string
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

export type CantonTokenInfo = {
  instrumentId: string
  symbol: string
  decimals: number
}

export class CantonIdentifier {
  packageId: string
  moduleName: string
  entityName: string

  constructor(packageId: string, moduleName: string, entityName: string) {
    this.packageId = packageId
    this.moduleName = moduleName
    this.entityName = entityName
  }

  static fromString(identifier: string): CantonIdentifier {
    const parts = identifier.split(':')
    if (parts.length !== 3) {
      throw new CCIPArgumentInvalidError(
        'identifier',
        `invalid Canton identifier "${identifier}": expected packageId:moduleName:entityName`,
      )
    }
    return new CantonIdentifier(parts[0]!, parts[1]!, parts[2]!)
  }

  toString(): string {
    return `${this.packageId}:${this.moduleName}:${this.entityName}`
  }

  equal(other: CantonIdentifier): boolean {
    return (
      this.packageId === other.packageId &&
      this.moduleName === other.moduleName &&
      this.entityName === other.entityName
    )
  }
}
