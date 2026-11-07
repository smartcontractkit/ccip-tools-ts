/**
 * Canton CCT constants — template IDs (symbolic package-name form), labels, and
 * context keys. Single home so an upstream package/rename change is one edit.
 *
 * Symbolic (`#<package-name>:…`) form is deliberate: the wallet gateway's ACS
 * proxy accepts only package-name template filters, and the name form matches
 * contracts across all vetted versions of the package.
 *
 * @packageDocumentation
 */

/** Pool flavor — registry-pools family. */
export type PoolType = 'burnMint' | 'lockRelease'

/** CCIPFactory template (shared factory). */
export const FACTORY_TEMPLATE_ID = '#ccip-factory-v2:CCIP.FactoryV2:CCIPFactory'

/** BurnMintTokenPool template — the registry-pools family
 * (`CCIP.Registry.BurnMintTokenPoolV2`, package `ccip-registry-burn-mint-token-pool`).
 * This is the ONLY BurnMintTokenPool family the SDK targets: it adds the
 * mandatory `observers` field (EDS auto-detection) and the atomic
 * `Initialize` choice the production-pools family (`CCIP.BurnMintTokenPoolV2`,
 * pre-registry) lacks. Nothing in this SDK should reference the production
 * package. */
export const BURN_MINT_POOL_TEMPLATE_ID =
  '#ccip-registry-burn-mint-token-pool:CCIP.Registry.BurnMintTokenPoolV2:BurnMintTokenPool'

/** LockReleaseTokenPool template (registry-pools family). */
export const LOCK_RELEASE_POOL_TEMPLATE_ID =
  '#ccip-registry-lock-release-token-pool:CCIP.Registry.LockReleaseTokenPoolV2:LockReleaseTokenPool'

/** Symbolic template ID per {@link PoolType}. */
export const POOL_TEMPLATE_IDS: Readonly<Record<PoolType, string>> = {
  burnMint: BURN_MINT_POOL_TEMPLATE_ID,
  lockRelease: LOCK_RELEASE_POOL_TEMPLATE_ID,
}

/** Registry RateLimiter template. */
export const RATE_LIMITER_TEMPLATE_ID =
  '#ccip-registry-rate-limiter:CCIP.Registry.RateLimiterV2:RateLimiter'

/** TokenAdminRegistry template. */
export const TAR_TEMPLATE_ID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry'

/** TAR TokenConfig template. */
export const TOKEN_CONFIG_TEMPLATE_ID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenConfig'

/** Registry-app `TransferPreapproval` template (symbolic form). */
export const TRANSFER_PREAPPROVAL_TEMPLATE_ID =
  '#utility-registry-app-v0:Utility.Registry.App.V0.Model.TransferPreapproval:TransferPreapproval'

/** Receive-context key the pool merges into transfer extraArgs for direct settlement. */
export const TRANSFER_PREAPPROVAL_CONTEXT_KEY = 'transfer-preapproval'

/** Standard label for CCIP pool holdings — the account DA's bridge API publicly discloses. */
export const CCIP_PUBLIC_LABEL = 'ccip-public'

/** Transfer-meta key the registry reads to select the receiver account (→ holding label). */
export const CIP112_RECEIVER_ID_META_KEY = 'cip-112/receiver.id'
