import type { Provider } from '@canton-network/core-splice-provider'
import type { RpcTypes as DappRpcTypes } from '@canton-network/core-wallet-dapp-rpc-client'

import { CCIPArgumentInvalidError } from '../errors/index.ts'
import type { ChainFamily } from '../networks.ts'
import type { JsCommands } from './clients/ledger-api/client.ts'

/**
 * Canton connectivity provider, as defined by the Canton dApp SDK
 * ({@link https://www.npmjs.com/package/@canton-network/dapp-sdk | @canton-network/dapp-sdk}):
 * a `Provider` over the dApp wallet RPC methods
 * (`@canton-network/core-wallet-dapp-rpc-client`).
 *
 * The SDK never dials a Canton Ledger API itself — all Canton connectivity and
 * authentication flows through `provider.request(...)`:
 *
 * - `getActiveNetwork` / `getPrimaryAccount` — network + party detection
 *   (used by {@link CantonChain.fromProvider})
 * - `ledgerApi` / `prepareExecuteAndWait` — Ledger API requests and
 *   interactive submissions (prepare → sign → execute)
 * - `accountsChanged` / `txChanged` events — wallet state changes
 *
 * Construct it with the environment that matches your runtime:
 *
 * - **Browser (dApp SDK)** — connect to the user's Canton wallet and take the
 *   provider from it: `new DappSDK(config)` / `getConnectedProvider()`. This
 *   provider proxies `ledgerApi` requests through the validator wallet.
 * - **Node.js (ccip-cli)** — the CLI ships its own
 *   `ccip-cli/src/providers/canton/provider.ts` `JsonRpcProvider`, which talks
 *   to the Canton JSON Ledger API directly (JWT-authenticated wire-format
 *   pass-through, optional external signer e.g. Ledger). Built from the CLI's
 *   `CantonCliConfig` and handed to {@link CantonChain.fromProvider}.
 * - **Bring your own** — implement the `Provider` interface over
 *   `DappRpcTypes` and pass it to {@link CantonChain.fromProvider}.
 */
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

export interface CantonCreatedContract {
  contractId: string
  updateId: string
}

/**
 * Canton-specific send parameters passed via `message.extraArgs` when calling
 * {@link CantonChain.generateUnsignedSendMessage} or {@link CantonChain.sendMessage}.
 *
 * These values cannot be derived automatically and must be supplied by the caller.
 */
export interface CantonExtraArgsV1 {
  /**
   * Contract IDs of holdings to be used as an input to pay for CCIP fees.
   * Holdings are unchecked and passed through as-is.
   * Optional - if not set, will automatically detect holdings
   * */
  feeTokenHoldingCids?: string[]
  /**
   * Contract IDs of holdings to be used as an input to the CCIP token transfer.
   * Holdings are unchecked and passed through as-is.
   * Optional - if not set, will automatically detect holdings
   */
  tokenTransferHoldingCids?: string[]
  /**
   * Contract ID of the PerPartyRouter contract to be used for the send.
   * Optional - if not set, will automatically detect (or deploy) PerPartyRouter.
   */
  perPartyRouterCid?: string
  /**
   * Contract ID of the CCIPSender contract to be used for the send.
   * Optional - if not set, will automatically detect (or deploy) CCIPSender.
   */
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

/**
 * A Daml template or interface identifier, in its wire format
 * `packageId:moduleName:entityName` — e.g.
 * `b8e4dfb8…984:CCIP.ClientV2:PerPartyRouter`.
 *
 * The first segment is either:
 * - a package **ID** (bare hex hash, no prefix) — the form found in ledger
 *   payloads (`CreatedEvent.templateId`, interface views' `interfaceId`), or
 * - a package **name** (`#`-prefixed) — the form used by the generated
 *   bindings (`PerPartyRouter.templateId`), e.g.
 *   `#ccip-runtime-v2:CCIP.RuntimeV2.PerPartyRouter:PerPartyRouter`.
 *
 * Used to identify templates/interfaces for ACS queries and event filtering.
 * Note {@link CantonIdentifier.equal} compares all three segments exactly — a
 * name-form and a hash-form identifier for the same template are **not** equal.
 */
export class CantonIdentifier {
  packageId: string
  moduleName: string
  entityName: string

  constructor(packageId: string, moduleName: string, entityName: string) {
    this.packageId = packageId
    this.moduleName = moduleName
    this.entityName = entityName
  }

  /**
   * Parse an identifier from its `packageId:moduleName:entityName` wire format.
   *
   * @param identifier - Exactly three colon-separated segments; the segments
   *   themselves must not contain colons.
   * @throws {@link CCIPArgumentInvalidError} if the format doesn't match.
   */
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

  /** Reassemble the identifier into its `packageId:moduleName:entityName` wire format. */
  toString(): string {
    return `${this.packageId}:${this.moduleName}:${this.entityName}`
  }

  /** Exact, segment-wise equality (packageId, moduleName and entityName must all match). */
  equal(other: CantonIdentifier): boolean {
    return (
      this.packageId === other.packageId &&
      this.moduleName === other.moduleName &&
      this.entityName === other.entityName
    )
  }
}
