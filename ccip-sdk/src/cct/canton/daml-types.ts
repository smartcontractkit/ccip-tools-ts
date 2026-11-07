/**
 * Hand-maintained TypeScript mirrors of the Daml choice/create argument shapes
 * the CCT Canton ops build. Deliberately minimal: only the shapes actually
 * constructed here, only as precise as the JSON Ledger API encoding requires.
 *
 * Convention (same as the EVM side's hand-maintained ABI arrays in
 * `src/evm/abi/`): no generated bindings are vendored; these types are updated
 * by hand when the Daml changes. Source of truth:
 * `chainlink-canton-fcr/contracts/ccip/registry-pools/` (registry pools +
 * rate limiter) and `contracts/ccip/codec/` (shared codecs).
 *
 * A generated-bindings pipeline (dpm codegen-js on DAR release, CI staleness
 * check, real `@daml/types` value types) replaces this file in the later
 * refactor — tracked as part of the registry-pools release tooling.
 *
 * @packageDocumentation
 */

// ─── Shared primitives ─────────────────────────────────────────────────────

/** Daml variant JSON encoding (`{tag, value}`) as produced/consumed here. */
export type DamlVariant<Tag extends string, Value> = { tag: Tag; value: Value }

/** `Chainlink.InstanceAddress.RawInstanceAddress` — newtype over `instanceId@party`. */
export type RawInstanceAddressArg = {
  unpack: string
}

/** `Splice.Api.Token.HoldingV1.InstrumentId`. */
export type InstrumentIdArg = {
  admin: string
  id: string
}

/** `Splice.Api.Token.MetadataV1.ChoiceContext` (values is a TextMap → JSON object). */
export type ChoiceContextArg = {
  values: Record<string, unknown>
}

/** `Splice.Api.Token.MetadataV1.Metadata` (values is a TextMap Text → JSON object). */
export type MetadataArg = {
  values: Record<string, string>
}

// ─── CCIP.CodecV2 ──────────────────────────────────────────────────────────

/** `CCIP.CodecV2.FinalityConfig.FinalityConfig` — WaitForFinality | WaitForSafe | BlockDepth Int. */
export type FinalityConfigArg =
  | DamlVariant<'WaitForFinality', Record<string, never>>
  | DamlVariant<'WaitForSafe', Record<string, never>>
  | DamlVariant<'BlockDepth', string>

// ─── CCIP.Registry.RateLimiterV2 ───────────────────────────────────────────

// ─── CCIP.Registry.BurnMintTokenPoolV2(Types) ───────────────────────────────
// LockReleaseTokenPool shares the identical field shape.

/** `TransferTimeout` — Indefinite | RelativeHours Int64. */
export type TransferTimeoutArg =
  | DamlVariant<'Indefinite', Record<string, never>>
  | DamlVariant<'RelativeHours', string>

/** `BurnMintTokenPoolDeps` (TAR / RMNRemote / FeeQuoter references). */
export type PoolDepsArg = {
  tokenAdminRegistry: RawInstanceAddressArg
  rmnRemote: RawInstanceAddressArg
  feeQuoter: RawInstanceAddressArg
}

/** `BurnMintTokenPool` / `LockReleaseTokenPool` template create arguments. */
export type BurnMintTokenPoolArg = {
  instanceId: string
  poolOwner: string
  ccipOwner: string
  instrumentId: InstrumentIdArg
  /** Daml `Int64` — the token's decimals ON CANTON (10 for Token Standard). */
  decimals: string
  /** Daml `Optional Party`. */
  rateLimitAdmin: string | null
  observers: string[]
  /** Daml `GenMap` — JSON array of [key, value] pairs. */
  remoteChainConfigs: unknown[]
  /** Daml `GenMap` — JSON array. */
  tokenTransferFeeConfigs: unknown[]
  poolReceiveContext: ChoiceContextArg
  transferTimeout: TransferTimeoutArg
  deps: PoolDepsArg
}

/** `LockReleaseTokenPool` create arguments — the burn-mint fields plus holdings labels. */
export type LockReleaseTokenPoolArg = BurnMintTokenPoolArg & {
  /** Labels on pool-owned holdings (for DA's holdings disclosure API). Mandatory on this template. */
  poolReceiveMetadata: MetadataArg
}

/** `RateLimiterDeploySpec` (per-lane rate limiter to deploy via Initialize). */
export type RateLimiterDeploySpecArg = {
  instanceId: string
  isEnabled: boolean
  capacity: string
  rate: string
}

/** `LaneDeploySpec` (per-lane config + rate limiters for Initialize). */
export type LaneDeploySpecArg = {
  remoteChainSelector: string
  remotePools: string[]
  remoteTokenAddress: string
  inboundCCVs: RawInstanceAddressArg[]
  outboundCCVs: RawInstanceAddressArg[]
  finalityConfig: FinalityConfigArg
  inbound: RateLimiterDeploySpecArg
  outbound: RateLimiterDeploySpecArg
  inboundCustomFinality: RateLimiterDeploySpecArg
}

/** `Initialize` choice argument (atomic pool deploy). */
export type InitializeArg = {
  tokenAdminRegistryCid: string
  /** Daml `Optional (ContractId TokenConfig)`. */
  existingTokenConfigCid: string | null
  admin: string
  lanes: LaneDeploySpecArg[]
}

/** `ChainUpdate` (one lane entry within ApplyChainUpdates). */
export type ChainUpdateArg = {
  remoteChainSelector: string
  remotePools: string[]
  remoteTokenAddress: string
  inboundCCVs: RawInstanceAddressArg[]
  outboundCCVs: RawInstanceAddressArg[]
  finalityConfig: FinalityConfigArg
  inboundRateLimiter: RawInstanceAddressArg
  inboundCustomBlockConfirmationsRateLimiter: RawInstanceAddressArg
  outboundRateLimiter: RawInstanceAddressArg
}

/** `ApplyChainUpdates` choice argument. */
export type ApplyChainUpdatesArg = {
  remoteChainSelectorsToRemove: string[]
  chainsToAdd: ChainUpdateArg[]
}

/** `SetRateLimitConfig` choice argument (nonconsuming; `Numeric 0` → JSON string). */
export type SetRateLimitConfigArg = {
  caller: string
  rateLimiterCid: string
  newIsEnabled: boolean
  newCapacity: string
  newRate: string
}

/** `RateLimitConfigArgs` (per-chain limiter swap within SetRateLimiterReferences). */
export type RateLimitConfigArgsArg = {
  remoteChainSelector: string
  inboundRateLimiter: RawInstanceAddressArg
  inboundCustomBlockConfirmationsRateLimiter: RawInstanceAddressArg
  outboundRateLimiter: RawInstanceAddressArg
}

/** `SetRateLimiterReferences` choice argument. */
export type SetRateLimiterReferencesArg = {
  rateLimitConfigArgs: RateLimitConfigArgsArg[]
}

/** `SetTransferTimeout` choice argument. */
export type SetTransferTimeoutArg = {
  newTransferTimeout: TransferTimeoutArg
}

/** `SetObservers` choice argument. */
export type SetObserversArg = {
  observers: string[]
}

/** `SetDynamicConfig` choice argument (`Optional Party` → string | null). */
export type SetDynamicConfigArg = {
  rateLimitAdmin: string | null
}

/** `TokenTransferFeeConfigArgs` (`Numeric 0`/`Int` → JSON string). */
export type TokenTransferFeeConfigArgsArg = {
  destChainSelector: string
  /** The choice rejects `false` — disable via `disableTokenTransferFeeConfigArgs` instead. */
  isEnabled: boolean
  destGasOverhead: string
  destBytesOverhead: string
  feeUSDCents: string
  feeBps: string
}

/** `ApplyTokenTransferFeeConfigUpdates` choice argument. */
export type ApplyTokenTransferFeeConfigUpdatesArg = {
  tokenTransferFeeConfigArgs: TokenTransferFeeConfigArgsArg[]
  disableTokenTransferFeeConfigArgs: string[]
}

/**
 * `Splice.Api.Token.MetadataV1.AnyValue` — scalar subset supported for pool
 * receive-context entries (contract IDs go through the dedicated
 * `AddPoolReceiveContextContractValue` choice instead).
 */
export type AnyValueArg =
  | DamlVariant<'AV_Text', string>
  | DamlVariant<'AV_Int', string>
  | DamlVariant<'AV_Decimal', string>
  | DamlVariant<'AV_Bool', boolean>
  | DamlVariant<'AV_Party', string>
