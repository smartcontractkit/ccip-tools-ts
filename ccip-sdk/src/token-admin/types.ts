/**
 * Shared types for token-admin entry points.
 *
 * These types define the unified interface for deploying CCIP-compatible tokens
 * across all supported chain families (EVM, Solana, Aptos).
 *
 * @packageDocumentation
 */

/**
 * Base parameters for deploying a new CCIP-compatible token.
 * Extended by chain-specific param types.
 *
 * @example
 * ```typescript
 * const params: DeployTokenParams = {
 *   name: 'My Token',
 *   symbol: 'MTK',
 *   decimals: 18,
 *   maxSupply: 1_000_000n * 10n ** 18n,
 *   initialSupply: 10_000n * 10n ** 18n,
 * }
 * ```
 */
export interface DeployTokenParams {
  /** Token name (e.g., "My Token"). Must be non-empty. */
  name: string
  /** Token symbol (e.g., "MTK"). Must be non-empty. */
  symbol: string
  /** Token decimals (0-18 for EVM, 0-9 for Solana, typically 8 for Aptos). */
  decimals: number
  /** Maximum supply cap. `undefined` or `0n` means unlimited. */
  maxSupply?: bigint
  /** Amount to pre-mint to the deployer or recipient. `undefined` or `0n` means none. */
  initialSupply?: bigint
}

/**
 * Unified result from {@link deployToken} on any chain family.
 *
 * Identical for EVM, Solana, and Aptos — matches the SDK pattern where
 * signed methods return unified types (e.g., `sendMessage() -> CCIPRequest`).
 *
 * Chain-specific details (e.g., Aptos multi-tx hashes, Solana metadata PDA)
 * are only exposed via the unsigned path ({@link generateUnsignedDeployToken}).
 *
 * @example
 * ```typescript
 * const { tokenAddress, txHash } = await admin.deployToken({
 *   name: 'My Token', symbol: 'MTK', decimals: 18,
 * })
 * console.log(`Deployed at ${tokenAddress}, tx: ${txHash}`)
 * ```
 */
export interface DeployTokenResult {
  /**
   * Deployed token address.
   * - EVM: contract address (from `receipt.contractAddress`)
   * - Solana: mint pubkey (base58)
   * - Aptos: fungible asset metadata address (grandchild of the code object)
   */
  tokenAddress: string
  /**
   * Primary deploy transaction hash or signature.
   * - EVM: deploy tx hash
   * - Solana: transaction signature (base58)
   * - Aptos: publish tx hash (first of the sequential txs)
   */
  txHash: string

  // ── Chain-specific optional fields ──────────────────────────────────────────
  // These are populated when relevant for downstream operations (e.g., deployPool).

  /**
   * Aptos code object address (parent of the FA metadata object).
   * Needed as `managed_token` named address when deploying a token pool.
   * Only set on Aptos deploys.
   */
  codeObjectAddress?: string
  /**
   * Solana Metaplex metadata PDA for the mint.
   * Only set on Solana deploys.
   */
  metadataAddress?: string
}

// ─── EVM ──────────────────────────────────────────────────────────────────────

/**
 * EVM token contract type.
 *
 * - `'burnMintERC20'` — OZ AccessControl, owner = `msg.sender` (default)
 * - `'factoryBurnMintERC20'` — Ownable with explicit `newOwner` constructor param,
 *   has `grantMintRole`/`revokeMintRole`/`getMinters()`/`getBurners()`
 */
export type EVMTokenType = 'burnMintERC20' | 'factoryBurnMintERC20'

/**
 * EVM-specific parameters for deploying a CCIP-compatible token.
 *
 * When `tokenType` is `'burnMintERC20'` (default):
 * - Constructor: `(name, symbol, decimals_, maxSupply_, preMint)`
 * - Owner = `msg.sender` (deployer wallet)
 *
 * When `tokenType` is `'factoryBurnMintERC20'`:
 * - Constructor: `(name, symbol, decimals_, maxSupply_, preMint, newOwner)`
 * - `ownerAddress` is required for unsigned path; auto-filled from signer in signed path
 *
 * @example
 * ```typescript
 * // Default: BurnMintERC20
 * const params: EVMDeployTokenParams = {
 *   name: 'My Token',
 *   symbol: 'MTK',
 *   decimals: 18,
 * }
 *
 * // FactoryBurnMintERC20 with explicit owner
 * const factoryParams: EVMDeployTokenParams = {
 *   name: 'My Token',
 *   symbol: 'MTK',
 *   decimals: 18,
 *   tokenType: 'factoryBurnMintERC20',
 *   ownerAddress: '0x1234...',
 * }
 * ```
 */
export interface EVMDeployTokenParams extends DeployTokenParams {
  /** Token contract type. Default: `'burnMintERC20'`. */
  tokenType?: EVMTokenType
  /**
   * Owner address for the deployed token.
   * - `factoryBurnMintERC20`: passed as `newOwner` constructor param.
   *   Required for unsigned path; auto-filled from signer in signed path.
   * - `burnMintERC20`: ignored (owner = msg.sender / deployer).
   */
  ownerAddress?: string
}

// ─── Solana ───────────────────────────────────────────────────────────────────

/**
 * Solana-specific parameters for deploying an SPL Token mint.
 *
 * Supports both SPL Token and Token-2022 programs. Metaplex metadata is
 * **strongly recommended** — without it, wallets and explorers will show
 * "Unknown Token".
 *
 * @example
 * ```typescript
 * const params: SolanaDeployTokenParams = {
 *   name: 'My Token',
 *   symbol: 'MTK',
 *   decimals: 9,
 *   tokenProgram: 'spl-token',
 *   metadataUri: 'https://arweave.net/abc123',
 *   initialSupply: 1_000_000n * 10n ** 9n,
 * }
 * ```
 */
export interface SolanaDeployTokenParams extends DeployTokenParams {
  /** Token program to use. Default: `'spl-token'`. */
  tokenProgram?: 'spl-token' | 'token-2022'
  /**
   * Metaplex metadata JSON URI.
   * **Strongly recommended** — without it, wallets and explorers display "Unknown Token".
   */
  metadataUri?: string
  /** Mint authority pubkey. Default: sender/wallet pubkey. */
  mintAuthority?: string
  /** Freeze authority. `null` disables freeze. Default: sender/wallet pubkey. */
  freezeAuthority?: string | null
  /** Recipient for `initialSupply`. Default: sender/wallet pubkey. */
  recipient?: string
}

// ─── Aptos ────────────────────────────────────────────────────────────────────

/**
 * Aptos-specific parameters for deploying a managed_token Move module.
 *
 * Publishes the `managed_token` module bytecode, then calls `initialize()`.
 * If `initialSupply > 0`, also calls `mint()`.
 *
 * @example
 * ```typescript
 * const params: AptosDeployTokenParams = {
 *   name: 'My Token',
 *   symbol: 'MTK',
 *   decimals: 8,
 *   initialSupply: 100_000_000_000n,
 *   icon: 'https://example.com/icon.png',
 * }
 * ```
 */
export interface AptosDeployTokenParams extends DeployTokenParams {
  /** Token icon URI. Passed to `initialize()` as empty string if omitted. */
  icon?: string
  /** Project URL. Passed to `initialize()` as empty string if omitted. */
  project?: string
  /** Recipient for `initialSupply`. Default: sender/deployer address. */
  recipient?: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pool Deployment Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Supported CCIP token pool types.
 *
 * - `'burn-mint'` — Pool burns tokens on source and mints on destination.
 * - `'lock-release'` — Pool locks tokens on source and releases on destination.
 */
export type PoolType = 'burn-mint' | 'lock-release'

/**
 * Base parameters for deploying a CCIP token pool.
 * Extended by chain-specific param types.
 *
 * @example
 * ```typescript
 * const params: DeployPoolParams = {
 *   poolType: 'burn-mint',
 *   tokenAddress: '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
 *   localTokenDecimals: 18,
 * }
 * ```
 */
export interface DeployPoolParams {
  /** Pool type to deploy. */
  poolType: PoolType
  /**
   * Token address the pool manages.
   * - EVM: ERC20 contract address
   * - Solana: SPL mint pubkey (base58)
   * - Aptos: fungible asset metadata address
   */
  tokenAddress: string
  /** Token decimals on this chain (must match the deployed token). */
  localTokenDecimals: number
}

/**
 * Unified result from {@link deployPool} on any chain family.
 *
 * @example
 * ```typescript
 * const { poolAddress, txHash } = await admin.deployPool(wallet, {
 *   poolType: 'burn-mint',
 *   tokenAddress: '0xa42BA...',
 *   localTokenDecimals: 18,
 *   routerAddress: '0x0BF3...',
 * })
 * console.log(`Pool at ${poolAddress}, tx: ${txHash}`)
 * ```
 */
export interface DeployPoolResult {
  /**
   * Deployed pool address.
   * - EVM: contract address
   * - Solana: pool config PDA (base58)
   * - Aptos: pool object address
   */
  poolAddress: string
  /** Primary deploy transaction hash/signature. */
  txHash: string
  /**
   * Whether the pool is fully initialized and ready to use.
   *
   * `false` for Aptos generic pools (`burn_mint_token_pool`, `lock_release_token_pool`)
   * — the token creator module must call `initialize()` with stored capability refs
   * (`BurnRef`/`MintRef`/`TransferRef`) before the pool can be used for CCIP operations.
   *
   * `true` (or `undefined` for backward compatibility) for managed/regulated pools and
   * all EVM/Solana pools, which are fully initialized at deploy time.
   */
  initialized?: boolean
}

// ─── EVM Pool ────────────────────────────────────────────────────────────────

/**
 * EVM-specific parameters for deploying a CCIP token pool.
 *
 * Both BurnMintTokenPool and LockReleaseTokenPool (v1.6.1) share an
 * identical constructor: `(token, localTokenDecimals, allowlist[], rmnProxy, router)`.
 * `rmnProxy` is derived automatically via `Router.getArmProxy()`.
 *
 * @example
 * ```typescript
 * const params: EVMDeployPoolParams = {
 *   poolType: 'burn-mint',
 *   tokenAddress: '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
 *   localTokenDecimals: 18,
 *   routerAddress: '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59',
 * }
 * ```
 */
export interface EVMDeployPoolParams extends DeployPoolParams {
  /** CCIP Router address. Used to derive rmnProxy via `Router.getArmProxy()`. */
  routerAddress: string
  /** Optional allowlist of sender addresses. Default: `[]` (open). */
  allowlist?: string[]
}

// ─── Solana Pool ─────────────────────────────────────────────────────────────

/**
 * Solana-specific parameters for deploying (initializing) a CCIP token pool.
 *
 * Solana pools are pre-deployed programs. Users call `initialize` on an
 * existing program — no binary deployment is needed.
 *
 * @example
 * ```typescript
 * const params: SolanaDeployPoolParams = {
 *   poolType: 'burn-mint',
 *   tokenAddress: 'J6fECVXwSX5UAeJuC2oCKrsJRjTizWa9uF1FjqzYLa9M',
 *   localTokenDecimals: 9,
 *   poolProgramId: '<burnmint_token_pool program ID>',
 * }
 * ```
 */
export interface SolanaDeployPoolParams extends DeployPoolParams {
  /**
   * Program ID of the pre-deployed pool program.
   * - burn-mint: burnmint_token_pool program
   * - lock-release: lockrelease_token_pool program
   */
  poolProgramId: string
}

// ─── Aptos Pool ──────────────────────────────────────────────────────────────

/**
 * Aptos token module variant. Determines which Move pool module is compiled and deployed.
 *
 * Aptos has multiple pool implementations, each designed for a specific token standard.
 * The `poolType` (`'burn-mint'` | `'lock-release'`) specifies the pool **behaviour**,
 * while `tokenModule` specifies the token **standard** the pool targets.
 *
 * | tokenModule   | poolType        | Move module deployed           | Use case |
 * |---------------|-----------------|--------------------------------|----------|
 * | `'managed'`   | `'burn-mint'`   | `managed_token_pool`           | Tokens deployed with SDK's `deployToken()` |
 * | `'generic'`   | `'burn-mint'`   | `burn_mint_token_pool`         | Standard Fungible Asset tokens with BurnRef/MintRef |
 * | `'generic'`   | `'lock-release'`| `lock_release_token_pool`      | Standard FA tokens (custody-based) |
 * | `'regulated'` | `'burn-mint'`   | `regulated_token_pool`         | Tokens with pause/freeze/role-based access |
 *
 * Only `'generic'` supports `poolType: 'lock-release'`. Both `'managed'` and `'regulated'`
 * are inherently burn-mint — they will reject `'lock-release'`.
 *
 * Default: `'managed'`
 */
export type AptosTokenModule = 'managed' | 'generic' | 'regulated'

/**
 * Aptos-specific parameters for deploying a CCIP token pool Move module.
 *
 * Publishes the appropriate pool bytecode — `init_module` runs automatically
 * and creates the pool state, registers callbacks with the CCIP router.
 *
 * The `tokenModule` field (default: `'managed'`) selects which Move pool module
 * to compile. If you deployed your token with `admin.deployToken()`, use the
 * default. See {@link AptosTokenModule} for all options.
 *
 * For managed and regulated tokens, the SDK automatically resolves the code object
 * address from the `tokenAddress` (FA metadata) by querying the on-chain object
 * ownership chain. No separate code object address parameter is needed.
 *
 * @example Deploy pool for a managed token (default — matches `deployToken()` output)
 * ```typescript
 * const params: AptosDeployPoolParams = {
 *   poolType: 'burn-mint',
 *   tokenAddress: '0x89fd6b...',  // FA metadata address from deployToken()
 *   localTokenDecimals: 8,
 *   routerAddress: '0xabc...',
 *   mcmsAddress: '0x123...',
 * }
 * ```
 *
 * @example Deploy pool for a generic Fungible Asset (lock-release)
 * ```typescript
 * const params: AptosDeployPoolParams = {
 *   poolType: 'lock-release',
 *   tokenModule: 'generic',
 *   tokenAddress: '0x89fd6b...',
 *   localTokenDecimals: 8,
 *   routerAddress: '0xabc...',
 *   mcmsAddress: '0x123...',
 * }
 * ```
 *
 * @example Deploy pool for a regulated token
 * ```typescript
 * const params: AptosDeployPoolParams = {
 *   poolType: 'burn-mint',
 *   tokenModule: 'regulated',
 *   tokenAddress: '0x89fd6b...',  // FA metadata address
 *   localTokenDecimals: 8,
 *   routerAddress: '0xabc...',
 *   adminAddress: '0x456...',
 *   mcmsAddress: '0x123...',
 * }
 * ```
 */
export interface AptosDeployPoolParams extends DeployPoolParams {
  /**
   * Aptos token module variant. Determines which Move pool is compiled.
   *
   * - `'managed'` (default) — For tokens deployed with the SDK's `deployToken()`.
   *   Only supports `poolType: 'burn-mint'`.
   * - `'generic'` — For standard Aptos Fungible Asset tokens.
   *   Supports both `'burn-mint'` and `'lock-release'`.
   * - `'regulated'` — For tokens deployed with the `regulated_token` package (pause/freeze/roles).
   *   Only supports `poolType: 'burn-mint'`.
   *
   * Default: `'managed'`
   */
  tokenModule?: AptosTokenModule
  /** CCIP router module address (`ccip` named address). */
  routerAddress: string
  /** Address of the deployed `mcms` package. */
  mcmsAddress: string
  /**
   * Admin address for the regulated token's access control.
   * **Required when `tokenModule` is `'regulated'`.**
   *
   * This is the `admin` named address in the regulated_token Move.toml —
   * typically the account that manages roles (minter, burner, pauser, etc.).
   */
  adminAddress?: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Propose Admin Role Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Base parameters for proposing an administrator in the TokenAdminRegistry.
 * Extended by chain-specific param types.
 *
 * @example
 * ```typescript
 * const params: ProposeAdminRoleParams = {
 *   tokenAddress: '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
 *   administrator: '0x1234567890abcdef1234567890abcdef12345678',
 * }
 * ```
 */
export interface ProposeAdminRoleParams {
  /** Token address to propose an administrator for. */
  tokenAddress: string
  /** Address of the proposed administrator. */
  administrator: string
}

/**
 * Unified result from {@link proposeAdminRole} on any chain family.
 *
 * @example
 * ```typescript
 * const { txHash } = await admin.proposeAdminRole(wallet, params)
 * console.log(`Proposed admin, tx: ${txHash}`)
 * ```
 */
export interface ProposeAdminRoleResult {
  /** Transaction hash/signature of the propose admin role transaction. */
  txHash: string
}

// ─── EVM Propose Admin Role ──────────────────────────────────────────────────

/**
 * Registration method for the RegistryModuleOwnerCustom contract.
 *
 * - `owner` — token implements `owner()` (Ownable pattern, most common)
 * - `getCCIPAdmin` — token implements `getCCIPAdmin()` (dedicated CCIP admin)
 * - `accessControlDefaultAdmin` — token uses OZ AccessControl `DEFAULT_ADMIN_ROLE`
 */
export type EVMRegistrationMethod = 'owner' | 'getCCIPAdmin' | 'accessControlDefaultAdmin'

/**
 * EVM-specific parameters for proposing an administrator.
 *
 * On EVM, registration goes through the RegistryModuleOwnerCustom contract,
 * which verifies the caller's authority over the token and then internally
 * calls `proposeAdministrator(token, caller)` on the TokenAdminRegistry.
 *
 * The `registryModuleAddress` can be found via the CCIP API:
 * `https://docs.chain.link/api/ccip/v1/chains?environment=testnet` → `registryModule`
 *
 * @example
 * ```typescript
 * // Most common: token uses Ownable (owner() method)
 * const params: EVMProposeAdminRoleParams = {
 *   tokenAddress: '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
 *   registryModuleAddress: '0xa3c796d480638d7476792230da1E2ADa86e031b0',
 *   registrationMethod: 'owner',
 * }
 * ```
 */
export interface EVMProposeAdminRoleParams {
  /** Token address to propose admin for. */
  tokenAddress: string
  /** RegistryModuleOwnerCustom contract address. */
  registryModuleAddress: string
  /** Registration method — determines how the contract verifies caller authority. Defaults to `'owner'`. */
  registrationMethod?: EVMRegistrationMethod
}

// ─── Solana Propose Admin Role ───────────────────────────────────────────────

/**
 * Solana-specific parameters for proposing an administrator.
 *
 * On Solana, the TokenAdminRegistry is built into the Router program.
 *
 * @example
 * ```typescript
 * const params: SolanaProposeAdminRoleParams = {
 *   tokenAddress: 'J6fECVXwSX5UAeJuC2oCKrsJRjTizWa9uF1FjqzYLa9M',
 *   administrator: '5YNmS1R9nNSCDzb5a7mMJ1dwK9uHeAAF4CmPEwKgVWr8',
 *   routerAddress: '<router program ID>',
 * }
 * ```
 */
export interface SolanaProposeAdminRoleParams extends ProposeAdminRoleParams {
  /** Router address (bundles the TokenAdminRegistry on Solana). */
  routerAddress: string
}

// ─── Aptos Propose Admin Role ────────────────────────────────────────────────

/**
 * Aptos-specific parameters for proposing an administrator.
 *
 * On Aptos, the TokenAdminRegistry is a module within the CCIP router package
 * (`routerAddress::token_admin_registry`).
 *
 * @example
 * ```typescript
 * const params: AptosProposeAdminRoleParams = {
 *   tokenAddress: '0x89fd6b...',
 *   administrator: '0x1234...',
 *   routerAddress: '0xabc...',
 * }
 * ```
 */
export interface AptosProposeAdminRoleParams extends ProposeAdminRoleParams {
  /** CCIP router module address. */
  routerAddress: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Accept Admin Role Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Base parameters for accepting an administrator role in the TokenAdminRegistry.
 * Extended by chain-specific param types.
 *
 * @example
 * ```typescript
 * const params: AcceptAdminRoleParams = {
 *   tokenAddress: '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
 *   routerAddress: '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59',
 * }
 * ```
 */
export interface AcceptAdminRoleParams {
  /** Token address to accept admin role for. */
  tokenAddress: string
  /** Router address (used to discover the TokenAdminRegistry). */
  routerAddress: string
}

/**
 * Unified result from {@link acceptAdminRole} on any chain family.
 *
 * @example
 * ```typescript
 * const { txHash } = await admin.acceptAdminRole(wallet, params)
 * console.log(`Accepted admin, tx: ${txHash}`)
 * ```
 */
export interface AcceptAdminRoleResult {
  /** Transaction hash/signature of the accept admin role transaction. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Transfer Admin Role Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parameters for transferring a token administrator role.
 *
 * Called by the **current** administrator to hand off the admin role to a new
 * address. The new admin must call {@link acceptAdminRole} to complete the transfer.
 *
 * Consistent across all chain families (EVM, Solana, Aptos).
 *
 * @example
 * ```typescript
 * const params: TransferAdminRoleParams = {
 *   tokenAddress: '0xa42BA...',
 *   newAdmin: '0x1234...',
 *   routerAddress: '0x0BF3...',
 * }
 * ```
 */
export interface TransferAdminRoleParams {
  /** Token address to transfer admin role for. */
  tokenAddress: string
  /** Address of the new administrator. */
  newAdmin: string
  /** Router address (used to discover the TokenAdminRegistry). */
  routerAddress: string
}

/**
 * Unified result from {@link transferAdminRole} on any chain family.
 *
 * @example
 * ```typescript
 * const { txHash } = await admin.transferAdminRole(wallet, params)
 * console.log(`Transferred admin, tx: ${txHash}`)
 * ```
 */
export interface TransferAdminRoleResult {
  /** Transaction hash/signature of the transfer admin role transaction. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Apply Chain Updates Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Rate limiter configuration for a remote chain.
 *
 * Controls the inbound/outbound token flow rate for a specific remote chain.
 * Set `isEnabled: false` with `capacity: '0'` and `rate: '0'` to disable.
 *
 * @example
 * ```typescript
 * // Disabled rate limiter
 * const disabled: RateLimiterConfig = { isEnabled: false, capacity: '0', rate: '0' }
 *
 * // Enabled: 100k tokens capacity, refilling at 167 tokens/sec (~10k/min)
 * const enabled: RateLimiterConfig = { isEnabled: true, capacity: '100000000000000000000000', rate: '167000000000000000000' }
 * ```
 */
export interface RateLimiterConfig {
  /** Whether the rate limiter is enabled. */
  isEnabled: boolean
  /** Maximum token capacity (bigint as string to avoid JS precision loss). */
  capacity: string
  /** Token refill rate per second (bigint as string). */
  rate: string
}

/**
 * Configuration for a single remote chain in a token pool.
 *
 * Defines how a local pool connects to its counterpart on a remote chain:
 * the remote pool address(es), remote token address, and rate limits.
 *
 * Addresses are in their **native format** — hex for EVM/Aptos, base58 for Solana.
 * The SDK handles encoding to 32-byte padded bytes internally.
 *
 * @example
 * ```typescript
 * const remoteChain: RemoteChainConfig = {
 *   remoteChainSelector: 16015286601757825753n,  // Ethereum Sepolia
 *   remotePoolAddresses: ['0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD'],
 *   remoteTokenAddress: '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
 *   outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
 *   inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
 * }
 * ```
 */
export interface RemoteChainConfig {
  /** Remote chain selector. */
  remoteChainSelector: bigint
  /** Remote pool address(es) in native format. At least one required. */
  remotePoolAddresses: string[]
  /** Remote token address in native format. */
  remoteTokenAddress: string
  /** Remote token decimals. Required for Solana pools (used in init_chain_remote_config). Ignored on EVM/Aptos. */
  remoteTokenDecimals?: number
  /** Outbound rate limiter (local → remote). */
  outboundRateLimiterConfig: RateLimiterConfig
  /** Inbound rate limiter (remote → local). */
  inboundRateLimiterConfig: RateLimiterConfig
}

/**
 * Parameters for configuring remote chains on a token pool.
 *
 * Uniform across all chain families — only `poolAddress` is needed.
 * The SDK auto-discovers chain-specific details (program ID, mint, module name)
 * from the pool account on-chain.
 *
 * @example
 * ```typescript
 * const params: ApplyChainUpdatesParams = {
 *   poolAddress: '0x1234...',
 *   remoteChainSelectorsToRemove: [],
 *   chainsToAdd: [{
 *     remoteChainSelector: 16015286601757825753n,
 *     remotePoolAddresses: ['0xd7BF...'],
 *     remoteTokenAddress: '0xa42B...',
 *     outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
 *     inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
 *   }],
 * }
 * ```
 */
export interface ApplyChainUpdatesParams {
  /** Local pool address. */
  poolAddress: string
  /** Remote chain selectors to remove (can be empty). */
  remoteChainSelectorsToRemove: bigint[]
  /** Remote chain configurations to add (can be empty). */
  chainsToAdd: RemoteChainConfig[]
}

/**
 * Unified result from {@link applyChainUpdates} on any chain family.
 *
 * @example
 * ```typescript
 * const { txHash } = await admin.applyChainUpdates(wallet, params)
 * console.log(`Chain updates applied, tx: ${txHash}`)
 * ```
 */
export interface ApplyChainUpdatesResult {
  /** Transaction hash/signature. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Append Remote Pool Addresses Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parameters for appending remote pool addresses to an existing chain config.
 *
 * Unlike {@link ApplyChainUpdatesParams}, this only adds pool addresses to a
 * chain config that was already initialized via `applyChainUpdates`. No rate
 * limiter configuration or chain initialization is performed.
 *
 * @example
 * ```typescript
 * const params: AppendRemotePoolAddressesParams = {
 *   poolAddress: '0x1234...',
 *   remoteChainSelector: 16015286601757825753n,
 *   remotePoolAddresses: ['0xd7BF...', '0xaabb...'],
 * }
 * ```
 */
export interface AppendRemotePoolAddressesParams {
  /** Local pool address. */
  poolAddress: string
  /** Remote chain selector (uint64 as string). Must already be configured via applyChainUpdates. */
  remoteChainSelector: bigint
  /** Remote pool addresses in native format. At least one required. */
  remotePoolAddresses: string[]
}

/**
 * Unified result from {@link appendRemotePoolAddresses} on any chain family.
 *
 * @example
 * ```typescript
 * const { txHash } = await admin.appendRemotePoolAddresses(wallet, params)
 * console.log(`Remote pool addresses appended, tx: ${txHash}`)
 * ```
 */
export interface AppendRemotePoolAddressesResult {
  /** Transaction hash/signature. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Remove Remote Pool Addresses Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parameters for removing specific remote pool addresses from an existing chain config.
 *
 * Unlike {@link DeleteChainConfigParams}, this preserves the chain config and only
 * removes specific pool addresses. The chain config must have been initialized via
 * `applyChainUpdates` and must contain the specified pool addresses.
 *
 * @example
 * ```typescript
 * const params: RemoveRemotePoolAddressesParams = {
 *   poolAddress: '0x1234...',
 *   remoteChainSelector: 16015286601757825753n,
 *   remotePoolAddresses: ['0xd7BF...'],
 * }
 * ```
 */
export interface RemoveRemotePoolAddressesParams {
  /** Local pool address. */
  poolAddress: string
  /** Remote chain selector (uint64 as string). Must already be configured via applyChainUpdates. */
  remoteChainSelector: bigint
  /** Remote pool addresses to remove, in native format. At least one required. */
  remotePoolAddresses: string[]
}

/**
 * Unified result from removeRemotePoolAddresses on any chain family.
 *
 * @example
 * ```typescript
 * const { txHash } = await admin.removeRemotePoolAddresses(wallet, params)
 * console.log(`Remote pool addresses removed, tx: ${txHash}`)
 * ```
 */
export interface RemoveRemotePoolAddressesResult {
  /** Transaction hash/signature. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Delete Chain Config Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parameters for removing an entire remote chain configuration from a token pool.
 *
 * This is a convenience wrapper around applyChainUpdates with only removals.
 * The remote chain config must already exist (created via applyChainUpdates).
 *
 * @example
 * ```typescript
 * const params: DeleteChainConfigParams = {
 *   poolAddress: '0x1234...',
 *   remoteChainSelector: 16015286601757825753n,
 * }
 * ```
 */
export interface DeleteChainConfigParams {
  /** Local pool address. */
  poolAddress: string
  /** Remote chain selector (uint64 as string) to remove. Must be currently configured. */
  remoteChainSelector: bigint
}

/**
 * Unified result from deleteChainConfig on any chain family.
 *
 * @example
 * ```typescript
 * const { txHash } = await admin.deleteChainConfig(wallet, params)
 * console.log(`Chain config deleted, tx: ${txHash}`)
 * ```
 */
export interface DeleteChainConfigResult {
  /** Transaction hash/signature. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Set Chain Rate Limiter Config Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Rate limiter configuration for a specific remote chain.
 *
 * Used by {@link SetChainRateLimiterConfigParams} to update rate limits
 * on an already-configured remote chain. Unlike {@link RemoteChainConfig},
 * this does not include pool/token address fields — only rate limits.
 *
 * @example
 * ```typescript
 * const config: ChainRateLimiterConfig = {
 *   remoteChainSelector: 16015286601757825753n,
 *   outboundRateLimiterConfig: { isEnabled: true, capacity: '100000000000000000000000', rate: '167000000000000000000' },
 *   inboundRateLimiterConfig: { isEnabled: true, capacity: '100000000000000000000000', rate: '167000000000000000000' },
 * }
 * ```
 */
export interface ChainRateLimiterConfig {
  /** Remote chain selector (uint64 as string). */
  remoteChainSelector: bigint
  /** Outbound rate limiter (local → remote). */
  outboundRateLimiterConfig: RateLimiterConfig
  /** Inbound rate limiter (remote → local). */
  inboundRateLimiterConfig: RateLimiterConfig
  /**
   * Whether to set the custom block confirmations (FTF) rate limits.
   *
   * - `false` (default): sets the default rate limits (normal finality transfers)
   * - `true`: sets the FTF (Faster-Than-Finality) rate limits bucket
   *
   * Only applies to EVM v2.0+ pools. Ignored on v1.5/v1.6 pools and non-EVM chains.
   */
  customBlockConfirmations?: boolean
}

/**
 * Parameters for updating rate limiter configurations on a token pool.
 *
 * Updates rate limits for one or more already-configured remote chains.
 * The remote chains must have been previously added via {@link applyChainUpdates}.
 *
 * @example
 * ```typescript
 * const params: SetChainRateLimiterConfigParams = {
 *   poolAddress: '0x1234...',
 *   chainConfigs: [{
 *     remoteChainSelector: 16015286601757825753n,
 *     outboundRateLimiterConfig: { isEnabled: true, capacity: '100000000000000000000000', rate: '167000000000000000000' },
 *     inboundRateLimiterConfig: { isEnabled: true, capacity: '100000000000000000000000', rate: '167000000000000000000' },
 *   }],
 * }
 * ```
 */
export interface SetChainRateLimiterConfigParams {
  /** Local pool address. */
  poolAddress: string
  /** Rate limiter configurations per remote chain. */
  chainConfigs: ChainRateLimiterConfig[]
}

/**
 * Unified result from {@link setChainRateLimiterConfig} on any chain family.
 *
 * @example
 * ```typescript
 * const { txHash } = await admin.setChainRateLimiterConfig(wallet, params)
 * console.log(`Rate limits updated, tx: ${txHash}`)
 * ```
 */
export interface SetChainRateLimiterConfigResult {
  /** Transaction hash/signature. */
  txHash: string
}

// ── Set Rate Limit Admin ──────────────────────────────────────────────────────

/**
 * Parameters for {@link setRateLimitAdmin} — delegates rate-limit management
 * to a separate admin address (EVM and Solana only; not available on Aptos).
 *
 * @example
 * ```typescript
 * const params: SetRateLimitAdminParams = {
 *   poolAddress: '0x1234...',
 *   rateLimitAdmin: '0xabcd...',
 * }
 * ```
 */
export interface SetRateLimitAdminParams {
  /** Local pool address. */
  poolAddress: string
  /** New rate limit admin address. */
  rateLimitAdmin: string
}

/**
 * Unified result from {@link setRateLimitAdmin} on any chain family.
 *
 * @example
 * ```typescript
 * const { txHash } = await admin.setRateLimitAdmin(wallet, params)
 * console.log(`Rate limit admin updated, tx: ${txHash}`)
 * ```
 */
export interface SetRateLimitAdminResult {
  /** Transaction hash/signature. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Create Pool Mint Authority Multisig Types (Solana-only)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parameters for creating an SPL Token multisig with the pool signer PDA
 * as one of the signers. **Solana burn-mint pools only.**
 *
 * The Pool Signer PDA is automatically derived from `mint` and `poolProgramId`
 * and included as the first signer. This allows the pool to autonomously
 * mint/burn tokens for CCIP operations, while additional signers (e.g., a
 * Squads vault) can also mint independently.
 *
 * @example
 * ```typescript
 * const params: CreatePoolMintAuthorityMultisigParams = {
 *   mint: 'J6fECVXwSX5UAeJuC2oCKrsJRjTizWa9uF1FjqzYLa9M',
 *   poolProgramId: '41FGToCmdaWa1dgZLKFAjvmx6e6AjVTX7SVRibvsMGVB',
 *   additionalSigners: ['59eNrRrxrZMdqJxS7J3WGaV4MLLog2er14kePiWVjXtY'],
 *   threshold: 1,
 * }
 * ```
 */
export interface CreatePoolMintAuthorityMultisigParams {
  /** SPL token mint pubkey (base58). */
  mint: string
  /** Pool program ID (burn-mint pool program). */
  poolProgramId: string
  /** Additional signers (e.g., Squads vault). Pool Signer PDA is auto-included as first signer. */
  additionalSigners: string[]
  /** Required number of signers (m-of-n). Must be explicitly set — no default. */
  threshold: number
  /** Optional seed for deterministic address derivation via createAccountWithSeed. If omitted, a random keypair is used (standard SPL pattern). */
  seed?: string
}

/**
 * Result from {@link createPoolMintAuthorityMultisig}.
 *
 * @example
 * ```typescript
 * const { multisigAddress, poolSignerPda, allSigners } =
 *   await admin.createPoolMintAuthorityMultisig(wallet, params)
 * console.log(`Multisig: ${multisigAddress}, Pool Signer PDA: ${poolSignerPda}`)
 * ```
 */
// ═══════════════════════════════════════════════════════════════════════════════
// Transfer Mint Authority Types (Solana-only)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parameters for transferring SPL token mint authority to a new address.
 * **Solana only.**
 *
 * @example
 * ```typescript
 * const params: TransferMintAuthorityParams = {
 *   mint: 'J6fECVXwSX5UAeJuC2oCKrsJRjTizWa9uF1FjqzYLa9M',
 *   newMintAuthority: '2e8X9v1s9nro5ezG3osRm7bpusdYknNrQYzQMxsA4Gwh',
 * }
 * ```
 */
export interface TransferMintAuthorityParams {
  /** SPL token mint pubkey (base58). */
  mint: string
  /** New mint authority address (base58) — typically a multisig. */
  newMintAuthority: string
}

/**
 * Result from {@link transferMintAuthority}.
 *
 * @example
 * ```typescript
 * const { txHash } = await admin.transferMintAuthority(wallet, params)
 * console.log(`Mint authority transferred, tx: ${txHash}`)
 * ```
 */
export interface TransferMintAuthorityResult {
  /** Transaction hash/signature. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Grant Mint/Burn Access Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Which role(s) to grant on a token.
 *
 * - `'mintAndBurn'` — grant both mint and burn (default, backwards compatible)
 * - `'mint'` — grant mint only
 * - `'burn'` — grant burn only
 *
 * **Chain-specific notes:**
 * - **Solana:** Only `'mint'` and `'mintAndBurn'` are valid (SPL tokens have a
 *   single mint authority; burn is implicit for token holders). `'burn'` will
 *   throw an error.
 */
export type MintBurnRole = 'mint' | 'burn' | 'mintAndBurn'

/**
 * Parameters for granting mint and burn permissions on a token.
 *
 * This is a **token** operation — it modifies permissions on the token,
 * not the pool. The `authority` receives permission to mint/burn.
 *
 * | Chain   | `tokenAddress`     | `authority`                      | What happens |
 * |---------|--------------------|----------------------------------|-------------|
 * | EVM     | ERC20 address      | Pool address                     | `grantMintAndBurnRoles(authority)` / `grantMintRole` / `grantBurnRole` |
 * | Solana  | SPL mint (base58)  | New mint authority (multisig/PDA) | `setAuthority(MintTokens)` |
 * | Aptos   | FA metadata addr   | Pool object address              | Auto-detects pool type, grants access |
 *
 * @example
 * ```typescript
 * // Grant both roles (default)
 * const params: GrantMintBurnAccessParams = {
 *   tokenAddress: '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
 *   authority: '0x1234567890abcdef1234567890abcdef12345678',
 * }
 *
 * // Grant mint only
 * const mintOnly: GrantMintBurnAccessParams = {
 *   tokenAddress: '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
 *   authority: '0x1234567890abcdef1234567890abcdef12345678',
 *   role: 'mint',
 * }
 * ```
 */
export interface GrantMintBurnAccessParams {
  /** Token address (EVM contract, Solana mint, Aptos FA metadata). */
  tokenAddress: string
  /** Address to grant mint/burn access to (pool, multisig, etc.). */
  authority: string
  /** Which role(s) to grant. Defaults to `'mintAndBurn'`. */
  role?: MintBurnRole
  /**
   * EVM token type. Controls which ABI is used for the grant call.
   * - `'burnMintERC20'` (default): uses OZ AccessControl `grantRole(bytes32, address)`
   * - `'factoryBurnMintERC20'`: uses Ownable `grantMintRole(address)` / `grantBurnRole(address)`
   * Ignored on Solana/Aptos.
   */
  tokenType?: EVMTokenType
}

/**
 * Unified result from {@link grantMintBurnAccess} on any chain family.
 *
 * @example
 * ```typescript
 * const { txHash } = await admin.grantMintBurnAccess(wallet, params)
 * console.log(`Granted mint/burn access, tx: ${txHash}`)
 * ```
 */
export interface GrantMintBurnAccessResult {
  /** Transaction hash/signature. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Revoke Mint/Burn Access Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parameters for revoking mint or burn permissions on a token.
 *
 * This is a **token** operation — it modifies permissions on the token,
 * not the pool. The `authority` loses the specified role.
 *
 * | Chain   | `role: 'mint'`                        | `role: 'burn'`                        |
 * |---------|---------------------------------------|---------------------------------------|
 * | EVM     | `revokeMintRole(authority)`            | `revokeBurnRole(authority)`            |
 * | Aptos   | Remove from minter allowlist / revoke MINTER_ROLE | Remove from burner allowlist / revoke BURNER_ROLE |
 * | Solana  | Not supported (use `transferMintAuthority`) | Not supported                        |
 *
 * @example
 * ```typescript
 * const params: RevokeMintBurnAccessParams = {
 *   tokenAddress: '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
 *   authority: '0x1234567890abcdef1234567890abcdef12345678',
 *   role: 'mint',
 * }
 * ```
 */
export interface RevokeMintBurnAccessParams {
  /** Token address (EVM contract, Aptos FA metadata). */
  tokenAddress: string
  /** Address to revoke mint/burn access from. */
  authority: string
  /** Which role to revoke — must be specified explicitly. */
  role: 'mint' | 'burn'
  /**
   * EVM token type. Controls which ABI is used for the revoke call.
   * - `'burnMintERC20'` (default): uses OZ AccessControl `revokeRole(bytes32, address)`
   * - `'factoryBurnMintERC20'`: uses Ownable `revokeMintRole(address)` / `revokeBurnRole(address)`
   * Ignored on Solana/Aptos.
   */
  tokenType?: EVMTokenType
}

/**
 * Unified result from {@link revokeMintBurnAccess} on any chain family.
 */
export interface RevokeMintBurnAccessResult {
  /** Transaction hash/signature. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Get Mint/Burn Roles Types (read-only)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * EVM result from querying mint/burn roles on a BurnMintERC20 token.
 *
 * Uses OpenZeppelin AccessControl `getRoleMember` / `getRoleMemberCount`
 * to enumerate all addresses with `MINTER_ROLE` and `BURNER_ROLE`.
 */
export interface EVMMintBurnRolesResult {
  /** Addresses with the MINTER_ROLE. */
  minters: string[]
  /** Addresses with the BURNER_ROLE. */
  burners: string[]
}

/**
 * Solana result from querying mint/burn authority on an SPL token.
 *
 * SPL tokens have a single `mintAuthority`. If the authority is an
 * SPL Token multisig account, the members and threshold are returned.
 */
export interface SolanaMintBurnRolesResult {
  /** Current mint authority (base58), or `null` if disabled. */
  mintAuthority: string | null
  /** Whether the mint authority is an SPL Token multisig. */
  isMultisig: boolean
  /** Multisig threshold (m-of-n). Only set when `isMultisig` is true. */
  multisigThreshold?: number
  /** Multisig members. Only set when `isMultisig` is true. */
  multisigMembers?: Array<{ address: string }>
}

/**
 * Aptos result from querying mint/burn roles on a managed or regulated token.
 *
 * - **managed**: `get_allowed_minters()` / `get_allowed_burners()`
 * - **regulated**: `get_minters()` / `get_burners()` / `get_bridge_minters_or_burners()`
 */
export interface AptosMintBurnRolesResult {
  /** Detected token module type. */
  tokenModule: 'managed' | 'regulated' | 'unknown'
  /** Owner of the code object — can always mint/burn as owner, independent of the allowed lists. */
  owner?: string
  /** Addresses allowed to mint. */
  allowedMinters?: string[]
  /** Addresses allowed to burn. */
  allowedBurners?: string[]
  /** Addresses with BRIDGE_MINTER_OR_BURNER role (regulated only). */
  bridgeMintersOrBurners?: string[]
}

/**
 * Result from {@link createPoolMintAuthorityMultisig} on Solana.
 */
export interface CreatePoolMintAuthorityMultisigResult {
  /** The created SPL Token multisig account address (base58). */
  multisigAddress: string
  /** The auto-derived Pool Signer PDA (base58). */
  poolSignerPda: string
  /** All signers in order: [poolSignerPda, ...additionalSigners]. */
  allSigners: string[]
  /** Transaction hash/signature. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Create Pool Token Account Types (Solana-only)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parameters for creating the Pool Signer's Associated Token Account (ATA).
 *
 * The Pool Token ATA is owned by the Pool Signer PDA and acts as the token
 * "vault" the pool uses to hold/transfer tokens during cross-chain operations.
 * This account **must** exist before any CCIP transfer involving this pool.
 *
 * @example
 * ```typescript
 * const params: CreatePoolTokenAccountParams = {
 *   tokenAddress: '4w7NYkV9pLjPMeCyg8L2TPEQRJh7xpqpKPokQSfjUfLv',
 *   poolAddress: '7SWikMcRz3Ffdkm3fYCqfN7DNqhRa7y3GzcGFnLNqLbz',
 * }
 * ```
 */
export interface CreatePoolTokenAccountParams {
  /** SPL token mint pubkey (base58). */
  tokenAddress: string
  /** Pool state PDA (base58). The SDK derives poolProgramId from its on-chain owner. */
  poolAddress: string
}

/**
 * Result from creating the Pool Token Account.
 *
 * @example
 * ```typescript
 * const { poolTokenAccount, poolSignerPda, txHash } = await admin.createPoolTokenAccount(wallet, params)
 * console.log(`Pool ATA created at ${poolTokenAccount}, tx: ${txHash}`)
 * ```
 */
export interface CreatePoolTokenAccountResult {
  /** Address of the created ATA (base58). */
  poolTokenAccount: string
  /** Pool Signer PDA that owns this ATA (base58). */
  poolSignerPda: string
  /** Transaction signature. Empty string if account already existed. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Create Token Address Lookup Table Types (Solana-only)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parameters for creating an Address Lookup Table (ALT) for a token's CCIP pool.
 *
 * The ALT contains 10 base CCIP addresses auto-derived from the token, pool, and router.
 * These addresses are used by the CCIP router during cross-chain pool operations.
 *
 * @example
 * ```typescript
 * const params: CreateTokenAltParams = {
 *   tokenAddress: 'J6fECVXwSX5UAeJuC2oCKrsJRjTizWa9uF1FjqzYLa9M',
 *   poolAddress: '2pGY9WAjanpR3RnY5hQ1a23uDNomzFCAD5HMBgo8nH6M',
 *   routerAddress: 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C',
 * }
 * ```
 */
export interface CreateTokenAltParams {
  /** SPL token mint pubkey (base58). */
  tokenAddress: string
  /** Pool state PDA (base58). The SDK derives poolProgramId from its on-chain owner. */
  poolAddress: string
  /** CCIP Router program ID (base58). The SDK discovers feeQuoter from its config. */
  routerAddress: string
  /**
   * ALT authority (base58). Defaults to sender (wallet) if omitted.
   * Can differ from the payer — useful for multisig setups where the authority
   * is a Squads vault that can later extend/close the ALT.
   */
  authority?: string
  /**
   * Extra addresses to append after the 10 base CCIP addresses (max 246).
   *
   * When to use:
   * - **Burn-mint with SPL Token Multisig**: pass the multisig address here.
   *   The pool's on-chain mint instruction needs the multisig account in the
   *   transaction to mint through it (appended at index 10).
   * - **Lock-release**: not needed (10 base addresses are sufficient).
   * - **Burn-mint with direct mint authority**: not needed.
   */
  additionalAddresses?: string[]
}

/**
 * Result from creating a token Address Lookup Table.
 *
 * @example
 * ```typescript
 * const { lookupTableAddress, txHash } = await admin.createTokenAlt(wallet, params)
 * console.log(`ALT created at ${lookupTableAddress}, tx: ${txHash}`)
 * ```
 */
export interface CreateTokenAltResult {
  /** Address of the created ALT (base58). */
  lookupTableAddress: string
  /** Transaction signature. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Set Pool Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parameters for setPool — register a pool in the TokenAdminRegistry.
 *
 * Links a token to its pool so the CCIP router can route cross-chain
 * messages through it.
 *
 * @example
 * ```typescript
 * const params: SetPoolParams = {
 *   tokenAddress: '0xa42BA090720aEE0602aD4381FAdcC9380aD3d888',
 *   poolAddress: '0xd7BF0d8E6C242b6Dde4490Ab3aFc8C1e811ec9aD',
 *   routerAddress: '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59',
 * }
 * ```
 */
export interface SetPoolParams {
  /** Token address (EVM hex / Solana base58 / Aptos hex). */
  tokenAddress: string
  /** Pool address to link (EVM: pool contract / Solana: pool state PDA / Aptos: pool resource address). */
  poolAddress: string
  /** Router address (used to discover TokenAdminRegistry on EVM, program ID on Solana/Aptos). */
  routerAddress: string
}

/**
 * Solana-specific setPool params — extends base with ALT requirement.
 *
 * @example
 * ```typescript
 * const params: SolanaSetPoolParams = {
 *   tokenAddress: 'J6fECVXwSX5UAeJuC2oCKrsJRjTizWa9uF1FjqzYLa9M',
 *   poolAddress: '99UxveAueaH64QFiTMKdo9NYD99dMVnMmiqUKv9JQ7xr',
 *   routerAddress: 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C',
 *   poolLookupTable: 'C6jBE3MDmnqTzo5Dc3BopMyP8vc8jsEDwuHi5rwQgLxC',
 * }
 * ```
 */
export interface SolanaSetPoolParams extends SetPoolParams {
  /** Address Lookup Table (base58) created via `createTokenAlt`. Required on Solana. */
  poolLookupTable: string
}

/**
 * Result of setPool operation.
 *
 * @example
 * ```typescript
 * const { txHash } = await admin.setPool(wallet, params)
 * console.log(`Pool registered, tx: ${txHash}`)
 * ```
 */
export interface SetPoolResult {
  /** Transaction hash/signature. */
  txHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// Transfer Ownership Types (2-step pool ownership transfer)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parameters for transferOwnership — propose new pool owner.
 *
 * @example
 * ```typescript
 * const params: TransferOwnershipParams = {
 *   poolAddress: '0x1234...',
 *   newOwner: '0xabcd...',
 * }
 * ```
 */
export interface TransferOwnershipParams {
  /** Pool address (EVM hex / Solana base58 / Aptos hex). */
  poolAddress: string
  /** New owner address to propose. */
  newOwner: string
}

/**
 * Parameters for acceptOwnership — accept proposed pool ownership.
 *
 * @example
 * ```typescript
 * const params: AcceptOwnershipParams = {
 *   poolAddress: '0x1234...',
 * }
 * ```
 */
export interface AcceptOwnershipParams {
  /** Pool address (EVM hex / Solana base58 / Aptos hex). */
  poolAddress: string
}

/**
 * Parameters for executeOwnershipTransfer — Aptos-only 3rd step.
 *
 * Aptos uses a 3-step ownership transfer:
 * 1. `transferOwnership(newOwner)` — current owner proposes
 * 2. `acceptOwnership()` — proposed owner signals acceptance
 * 3. `executeOwnershipTransfer(newOwner)` — current owner finalizes the AptosFramework object transfer
 *
 * @example
 * ```typescript
 * const params: ExecuteOwnershipTransferParams = {
 *   poolAddress: '0x1234...',
 *   newOwner: '0xabcd...',
 * }
 * ```
 */
export interface ExecuteOwnershipTransferParams {
  /** Pool address (Aptos hex). */
  poolAddress: string
  /** New owner address — must match the address that called acceptOwnership. */
  newOwner: string
}

/**
 * Result of transferOwnership, acceptOwnership, or executeOwnershipTransfer.
 *
 * @example
 * ```typescript
 * const { txHash } = await admin.transferOwnership(wallet, params)
 * console.log(`Ownership proposed, tx: ${txHash}`)
 * ```
 */
export interface OwnershipResult {
  /** Transaction hash/signature. */
  txHash: string
}
