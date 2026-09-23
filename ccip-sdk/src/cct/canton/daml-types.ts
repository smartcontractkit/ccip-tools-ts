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
