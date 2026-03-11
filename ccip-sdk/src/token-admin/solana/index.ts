/**
 * Solana token admin — deploy SPL Token mints and initialize CCIP token pools.
 *
 * @example Using SolanaTokenAdmin with a wallet (signed deploy)
 * ```typescript
 * import { SolanaChain } from '@chainlink/ccip-sdk'
 * import { SolanaTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/solana/index.ts'
 *
 * const chain = await SolanaChain.fromUrl('https://api.devnet.solana.com')
 * const admin = SolanaTokenAdmin.fromChain(chain)
 * const { tokenAddress, txHash } = await admin.deployToken(wallet, {
 *   name: 'My Token', symbol: 'MTK', decimals: 9,
 * })
 * ```
 *
 * @packageDocumentation
 */

import { Program } from '@coral-xyz/anchor'
import {
  AuthorityType,
  MULTISIG_SIZE,
  MintLayout,
  MultisigLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createInitializeMultisigInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from '@solana/spl-token'
import {
  type Connection,
  type Transaction,
  type TransactionInstruction,
  type VersionedTransaction,
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
} from '@solana/web3.js'
import BN from 'bn.js'

import type { ChainContext } from '../../chain.ts'
import {
  CCIPAcceptAdminRoleFailedError,
  CCIPAcceptAdminRoleParamsInvalidError,
  CCIPAcceptOwnershipFailedError,
  CCIPAcceptOwnershipParamsInvalidError,
  CCIPAppendRemotePoolAddressesFailedError,
  CCIPAppendRemotePoolAddressesParamsInvalidError,
  CCIPApplyChainUpdatesFailedError,
  CCIPApplyChainUpdatesParamsInvalidError,
  CCIPCreatePoolMultisigFailedError,
  CCIPCreatePoolMultisigParamsInvalidError,
  CCIPCreatePoolTokenAccountFailedError,
  CCIPCreatePoolTokenAccountParamsInvalidError,
  CCIPCreateTokenAltFailedError,
  CCIPCreateTokenAltParamsInvalidError,
  CCIPDeleteChainConfigFailedError,
  CCIPDeleteChainConfigParamsInvalidError,
  CCIPGrantMintBurnAccessFailedError,
  CCIPGrantMintBurnAccessParamsInvalidError,
  CCIPPoolDeployFailedError,
  CCIPPoolDeployParamsInvalidError,
  CCIPProposeAdminRoleFailedError,
  CCIPProposeAdminRoleParamsInvalidError,
  CCIPRemoveRemotePoolAddressesFailedError,
  CCIPRemoveRemotePoolAddressesParamsInvalidError,
  CCIPRevokeMintBurnAccessParamsInvalidError,
  CCIPSetPoolFailedError,
  CCIPSetPoolParamsInvalidError,
  CCIPSetRateLimitAdminFailedError,
  CCIPSetRateLimitAdminParamsInvalidError,
  CCIPSetRateLimiterConfigFailedError,
  CCIPSetRateLimiterConfigParamsInvalidError,
  CCIPTokenDeployFailedError,
  CCIPTokenDeployParamsInvalidError,
  CCIPTokenPoolInfoNotFoundError,
  CCIPTransferAdminRoleFailedError,
  CCIPTransferAdminRoleParamsInvalidError,
  CCIPTransferMintAuthorityFailedError,
  CCIPTransferMintAuthorityParamsInvalidError,
  CCIPTransferOwnershipFailedError,
  CCIPTransferOwnershipParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import {
  type BaseTokenPool,
  IDL as BASE_TOKEN_POOL_IDL,
} from '../../solana/idl/1.6.0/BASE_TOKEN_POOL.ts'
import {
  type BurnmintTokenPool,
  IDL as BURN_MINT_TOKEN_POOL_IDL,
} from '../../solana/idl/1.6.0/BURN_MINT_TOKEN_POOL.ts'
import { IDL as CCIP_ROUTER_IDL } from '../../solana/idl/1.6.0/CCIP_ROUTER.ts'
import {
  type LockreleaseTokenPool,
  IDL as LOCK_RELEASE_TOKEN_POOL_IDL,
} from '../../solana/idl/1.6.0/LOCK_RELEASE_TOKEN_POOL.ts'
import { SolanaChain } from '../../solana/index.ts'
import { type UnsignedSolanaTx, type Wallet, isWallet } from '../../solana/types.ts'
import { derivePoolSignerPDA, simulateAndSendTxs, simulationProvider } from '../../solana/utils.ts'
import { type NetworkInfo, type WithLogger, ChainFamily } from '../../types.ts'
import {
  encodeRemoteAddress,
  encodeRemoteAddressBytes,
  encodeRemotePoolAddressBytes,
  validateAppendRemotePoolAddressesParams,
  validateApplyChainUpdatesParams,
  validateDeleteChainConfigParams,
  validateRemoveRemotePoolAddressesParams,
} from '../apply-chain-updates-utils.ts'
import { validateSetChainRateLimiterConfigParams } from '../set-rate-limiter-config-utils.ts'
import type {
  AcceptAdminRoleParams,
  AcceptAdminRoleResult,
  AcceptOwnershipParams,
  AppendRemotePoolAddressesParams,
  AppendRemotePoolAddressesResult,
  ApplyChainUpdatesParams,
  ApplyChainUpdatesResult,
  CreatePoolMintAuthorityMultisigParams,
  CreatePoolMintAuthorityMultisigResult,
  CreatePoolTokenAccountParams,
  CreatePoolTokenAccountResult,
  CreateTokenAltParams,
  CreateTokenAltResult,
  DeleteChainConfigParams,
  DeleteChainConfigResult,
  DeployPoolResult,
  DeployTokenResult,
  GrantMintBurnAccessParams,
  GrantMintBurnAccessResult,
  OwnershipResult,
  ProposeAdminRoleResult,
  RemoveRemotePoolAddressesParams,
  RemoveRemotePoolAddressesResult,
  RevokeMintBurnAccessParams,
  SetChainRateLimiterConfigParams,
  SetChainRateLimiterConfigResult,
  SetPoolResult,
  SetRateLimitAdminParams,
  SetRateLimitAdminResult,
  SolanaDeployPoolParams,
  SolanaDeployTokenParams,
  SolanaMintBurnRolesResult,
  SolanaProposeAdminRoleParams,
  SolanaSetPoolParams,
  TransferAdminRoleParams,
  TransferAdminRoleResult,
  TransferMintAuthorityParams,
  TransferMintAuthorityResult,
  TransferOwnershipParams,
} from '../types.ts'

/** Metaplex Token Metadata Program ID. */
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

/** BPF Loader Upgradeable Program ID (for deriving programData accounts). */
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  'BPFLoaderUpgradeab1e11111111111111111111111',
)

// ── PDA Seeds ────────────────────────────────────────────────────────────────

/** Metaplex metadata PDA seed. */
const METADATA_SEED = 'metadata'

/** CCIP token pool config PDA seed. */
const CCIP_TOKENPOOL_CONFIG_SEED = 'ccip_tokenpool_config'

/** Pool program config PDA seed. */
const CONFIG_SEED = 'config'

/** Token admin registry PDA seed (on the Router program). */
const TOKEN_ADMIN_REGISTRY_SEED = 'token_admin_registry'

/** CCIP token pool chain config PDA seed. */
const CCIP_TOKENPOOL_CHAINCONFIG_SEED = 'ccip_tokenpool_chainconfig'

/** Router external token pools signer PDA seed. */
const EXTERNAL_TOKEN_POOLS_SIGNER_SEED = 'external_token_pools_signer'

/** Fee quoter billing token config PDA seed. */
const FEE_BILLING_TOKEN_CONFIG_SEED = 'fee_billing_token_config'

// ── Metaplex Instruction Constants ───────────────────────────────────────────

/** Metaplex Create instruction discriminator (Create V1). */
const METAPLEX_CREATE_DISCRIMINATOR = 42

/** Metaplex token standard value for fungible tokens. */
const METAPLEX_TOKEN_STANDARD_FUNGIBLE = 2

/**
 * Validates deploy parameters for Solana SPL Token.
 * @throws {@link CCIPTokenDeployParamsInvalidError} on invalid params
 */
function validateParams(params: SolanaDeployTokenParams): void {
  if (!params.name || params.name.trim().length === 0) {
    throw new CCIPTokenDeployParamsInvalidError('name', 'must be non-empty')
  }
  if (!params.symbol || params.symbol.trim().length === 0) {
    throw new CCIPTokenDeployParamsInvalidError('symbol', 'must be non-empty')
  }
  if (params.initialSupply !== undefined && params.initialSupply < 0n) {
    throw new CCIPTokenDeployParamsInvalidError('initialSupply', 'must be non-negative')
  }
  if (params.maxSupply !== undefined && params.maxSupply < 0n) {
    throw new CCIPTokenDeployParamsInvalidError('maxSupply', 'must be non-negative')
  }
  if (
    params.maxSupply !== undefined &&
    params.maxSupply > 0n &&
    params.initialSupply !== undefined &&
    params.initialSupply > params.maxSupply
  ) {
    throw new CCIPTokenDeployParamsInvalidError('initialSupply', 'exceeds maxSupply')
  }
}

/**
 * Validates deploy parameters for Solana pool initialization.
 * @throws {@link CCIPPoolDeployParamsInvalidError} on invalid params
 */
function validatePoolParams(params: SolanaDeployPoolParams): void {
  const poolType: string = params.poolType
  if (poolType !== 'burn-mint' && poolType !== 'lock-release') {
    throw new CCIPPoolDeployParamsInvalidError('poolType', "must be 'burn-mint' or 'lock-release'")
  }
  if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
    throw new CCIPPoolDeployParamsInvalidError('tokenAddress', 'must be non-empty')
  }
  if (!params.poolProgramId || params.poolProgramId.trim().length === 0) {
    throw new CCIPPoolDeployParamsInvalidError('poolProgramId', 'must be non-empty')
  }
}

/**
 * Validates proposeAdminRole parameters for Solana.
 * @throws {@link CCIPProposeAdminRoleParamsInvalidError} on invalid params
 */
function validateProposeAdminRoleParams(params: SolanaProposeAdminRoleParams): void {
  if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
    throw new CCIPProposeAdminRoleParamsInvalidError('tokenAddress', 'must be non-empty')
  }
  if (!params.administrator || params.administrator.trim().length === 0) {
    throw new CCIPProposeAdminRoleParamsInvalidError('administrator', 'must be non-empty')
  }
  if (!params.routerAddress || params.routerAddress.trim().length === 0) {
    throw new CCIPProposeAdminRoleParamsInvalidError('routerAddress', 'must be non-empty')
  }
}

/**
 * Validates accept admin role params.
 * @throws {@link CCIPAcceptAdminRoleParamsInvalidError} on invalid params
 */
function validateAcceptAdminRoleParams(params: AcceptAdminRoleParams): void {
  if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
    throw new CCIPAcceptAdminRoleParamsInvalidError('tokenAddress', 'must be non-empty')
  }
  if (!params.routerAddress || params.routerAddress.trim().length === 0) {
    throw new CCIPAcceptAdminRoleParamsInvalidError('routerAddress', 'must be non-empty')
  }
}

function validateTransferAdminRoleParams(params: TransferAdminRoleParams): void {
  if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
    throw new CCIPTransferAdminRoleParamsInvalidError('tokenAddress', 'must be non-empty')
  }
  if (!params.newAdmin || params.newAdmin.trim().length === 0) {
    throw new CCIPTransferAdminRoleParamsInvalidError('newAdmin', 'must be non-empty')
  }
  if (!params.routerAddress || params.routerAddress.trim().length === 0) {
    throw new CCIPTransferAdminRoleParamsInvalidError('routerAddress', 'must be non-empty')
  }
}

function validateSolanaSetPoolParams(params: SolanaSetPoolParams): void {
  if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
    throw new CCIPSetPoolParamsInvalidError('tokenAddress', 'must be non-empty')
  }
  try {
    new PublicKey(params.tokenAddress)
  } catch {
    throw new CCIPSetPoolParamsInvalidError('tokenAddress', 'must be a valid public key')
  }
  if (!params.poolAddress || params.poolAddress.trim().length === 0) {
    throw new CCIPSetPoolParamsInvalidError('poolAddress', 'must be non-empty')
  }
  try {
    new PublicKey(params.poolAddress)
  } catch {
    throw new CCIPSetPoolParamsInvalidError('poolAddress', 'must be a valid public key')
  }
  if (!params.routerAddress || params.routerAddress.trim().length === 0) {
    throw new CCIPSetPoolParamsInvalidError('routerAddress', 'must be non-empty')
  }
  try {
    new PublicKey(params.routerAddress)
  } catch {
    throw new CCIPSetPoolParamsInvalidError('routerAddress', 'must be a valid public key')
  }
  if (!params.poolLookupTable || params.poolLookupTable.trim().length === 0) {
    throw new CCIPSetPoolParamsInvalidError('poolLookupTable', 'must be non-empty')
  }
  try {
    new PublicKey(params.poolLookupTable)
  } catch {
    throw new CCIPSetPoolParamsInvalidError('poolLookupTable', 'must be a valid public key')
  }
}

/** Borsh-encode a string: u32 little-endian length prefix + UTF-8 bytes. */
function borshString(s: string): Buffer {
  const bytes = Buffer.from(s)
  const len = Buffer.alloc(4)
  len.writeUInt32LE(bytes.length)
  return Buffer.concat([len, bytes])
}

// ── Pool IDL Merging ──────────────────────────────────────────────────────────

/**
 * Pool-specific IDLs (BURN_MINT_TOKEN_POOL, LOCK_RELEASE_TOKEN_POOL) reference
 * types like `RateLimitConfig`, `RemoteConfig`, `RemoteAddress` via `{ defined: '...' }`
 * but don't include their definitions. Those types live in BASE_TOKEN_POOL.
 *
 * We create merged IDL types that combine pool instructions with base type definitions,
 * so Anchor's `Program` class can serialize the referenced types correctly.
 */
type BurnMintMergedIdl = BurnmintTokenPool & Pick<BaseTokenPool, 'types'>
type LockReleaseMergedIdl = LockreleaseTokenPool & Pick<BaseTokenPool, 'types'>

const BURN_MINT_MERGED_IDL: BurnMintMergedIdl = {
  ...BURN_MINT_TOKEN_POOL_IDL,
  types: [...BASE_TOKEN_POOL_IDL.types],
}

const LOCK_RELEASE_MERGED_IDL: LockReleaseMergedIdl = {
  ...LOCK_RELEASE_TOKEN_POOL_IDL,
  types: [...BASE_TOKEN_POOL_IDL.types],
}

/**
 * Creates an Anchor Program instance for a pool program.
 *
 * Uses the appropriate merged IDL (burn-mint or lock-release) based on the
 * pool program's name. Falls back to burn-mint if the pool type is unknown
 * (both share the same instruction set for the operations we use).
 *
 * @param ctx - Connection and logger for the simulation provider
 * @param poolProgramId - Pool program public key
 * @param poolType - Optional pool type hint ('burn-mint' or 'lock-release')
 * @returns Anchor Program instance
 */
function createPoolProgram(
  ctx: { connection: Connection } & WithLogger,
  poolProgramId: PublicKey,
  poolType?: 'burn-mint' | 'lock-release',
) {
  if (poolType === 'lock-release') {
    return new Program(LOCK_RELEASE_MERGED_IDL, poolProgramId, simulationProvider(ctx))
  }
  return new Program(BURN_MINT_MERGED_IDL, poolProgramId, simulationProvider(ctx))
}

/**
 * Creates an Anchor Program instance for the CCIP Router.
 */
function createRouterProgram(
  ctx: { connection: Connection } & WithLogger,
  routerProgramId: PublicKey,
) {
  return new Program(CCIP_ROUTER_IDL, routerProgramId, simulationProvider(ctx))
}

/**
 * Builds a Metaplex Create (V1) instruction (discriminator 42).
 * Supports both SPL Token and Token-2022 via the splTokenProgram account.
 * Avoids importing metaplex-foundation — the instruction is built manually.
 */
function createMetadataInstruction(
  metadataPDA: PublicKey,
  mint: PublicKey,
  mintAuthority: PublicKey,
  payer: PublicKey,
  updateAuthority: PublicKey,
  name: string,
  symbol: string,
  uri: string,
  decimals: number,
  tokenProgramId: PublicKey,
): TransactionInstruction {
  // Create instruction (discriminator = 42), CreateArgs::V1 variant (0)
  const parts: Buffer[] = [
    Buffer.from([METAPLEX_CREATE_DISCRIMINATOR, 0]),
    // AssetData struct (borsh):
    borshString(name),
    borshString(symbol),
    borshString(uri),
    // sellerFeeBasisPoints (u16) = 0
    Buffer.from([0, 0]),
    // creators (Option<Vec<Creator>>) = None
    Buffer.from([0]),
    // primarySaleHappened (bool) = false
    Buffer.from([0]),
    // isMutable (bool) = true
    Buffer.from([1]),
    // tokenStandard (u8) = Fungible
    Buffer.from([METAPLEX_TOKEN_STANDARD_FUNGIBLE]),
    // collection (Option<Collection>) = None
    Buffer.from([0]),
    // uses (Option<Uses>) = None
    Buffer.from([0]),
    // collectionDetails (Option<CollectionDetails>) = None
    Buffer.from([0]),
    // ruleSet (Option<Pubkey>) = None
    Buffer.from([0]),
    // decimals: Option<u8> = Some(decimals)
    Buffer.from([1, decimals]),
    // printSupply: Option<PrintSupply> = None (fungible)
    Buffer.from([0]),
  ]

  return {
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPDA, isSigner: false, isWritable: true },
      // masterEdition — not needed for fungible, use program ID as placeholder
      { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: true, isWritable: true },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: updateAuthority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat(parts),
  }
}

/**
 * Validates parameters for creating a pool mint authority multisig.
 * @throws {@link CCIPCreatePoolMultisigParamsInvalidError} on invalid params
 */
function validateCreatePoolMultisigParams(params: CreatePoolMintAuthorityMultisigParams): void {
  if (!params.mint || params.mint.trim().length === 0) {
    throw new CCIPCreatePoolMultisigParamsInvalidError('mint', 'must be non-empty')
  }
  if (!params.poolProgramId || params.poolProgramId.trim().length === 0) {
    throw new CCIPCreatePoolMultisigParamsInvalidError('poolProgramId', 'must be non-empty')
  }
  if (!Array.isArray(params.additionalSigners) || params.additionalSigners.length === 0) {
    throw new CCIPCreatePoolMultisigParamsInvalidError(
      'additionalSigners',
      'must have at least one additional signer',
    )
  }
  for (const signer of params.additionalSigners) {
    if (!signer || signer.trim().length === 0) {
      throw new CCIPCreatePoolMultisigParamsInvalidError(
        'additionalSigners',
        'all signers must be non-empty',
      )
    }
  }
  // Total signers = 1 (pool signer PDA) + additionalSigners.length
  // SPL Token multisig supports max 11 signers
  const totalSigners = 1 + params.additionalSigners.length
  if (totalSigners > 11) {
    throw new CCIPCreatePoolMultisigParamsInvalidError(
      'additionalSigners',
      `total signers (${totalSigners}) exceeds SPL Token multisig limit of 11`,
    )
  }
  if (!Number.isInteger(params.threshold) || params.threshold < 1) {
    throw new CCIPCreatePoolMultisigParamsInvalidError('threshold', 'must be a positive integer')
  }
  if (params.threshold > totalSigners) {
    throw new CCIPCreatePoolMultisigParamsInvalidError(
      'threshold',
      `threshold (${params.threshold}) exceeds total signers (${totalSigners})`,
    )
  }
}

/** Validates TransferMintAuthorityParams, throwing on first invalid field. */
function validateTransferMintAuthorityParams(params: TransferMintAuthorityParams): void {
  if (!params.mint || params.mint.trim().length === 0) {
    throw new CCIPTransferMintAuthorityParamsInvalidError('mint', 'must be non-empty')
  }
  try {
    new PublicKey(params.mint)
  } catch {
    throw new CCIPTransferMintAuthorityParamsInvalidError('mint', 'must be a valid public key')
  }
  if (!params.newMintAuthority || params.newMintAuthority.trim().length === 0) {
    throw new CCIPTransferMintAuthorityParamsInvalidError('newMintAuthority', 'must be non-empty')
  }
  try {
    new PublicKey(params.newMintAuthority)
  } catch {
    throw new CCIPTransferMintAuthorityParamsInvalidError(
      'newMintAuthority',
      'must be a valid public key',
    )
  }
}

/** Validates CreateTokenAltParams, throwing on first invalid field. */
function validateCreateTokenAltParams(params: CreateTokenAltParams): void {
  if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
    throw new CCIPCreateTokenAltParamsInvalidError('tokenAddress', 'must be non-empty')
  }
  try {
    new PublicKey(params.tokenAddress)
  } catch {
    throw new CCIPCreateTokenAltParamsInvalidError('tokenAddress', 'must be a valid public key')
  }
  if (!params.poolAddress || params.poolAddress.trim().length === 0) {
    throw new CCIPCreateTokenAltParamsInvalidError('poolAddress', 'must be non-empty')
  }
  try {
    new PublicKey(params.poolAddress)
  } catch {
    throw new CCIPCreateTokenAltParamsInvalidError('poolAddress', 'must be a valid public key')
  }
  if (!params.routerAddress || params.routerAddress.trim().length === 0) {
    throw new CCIPCreateTokenAltParamsInvalidError('routerAddress', 'must be non-empty')
  }
  try {
    new PublicKey(params.routerAddress)
  } catch {
    throw new CCIPCreateTokenAltParamsInvalidError('routerAddress', 'must be a valid public key')
  }
  if (params.authority != null) {
    if (params.authority.trim().length === 0) {
      throw new CCIPCreateTokenAltParamsInvalidError('authority', 'must be non-empty when provided')
    }
    try {
      new PublicKey(params.authority)
    } catch {
      throw new CCIPCreateTokenAltParamsInvalidError('authority', 'must be a valid public key')
    }
  }
  if (params.additionalAddresses != null) {
    // 10 base addresses + additional must not exceed 256
    if (params.additionalAddresses.length > 246) {
      throw new CCIPCreateTokenAltParamsInvalidError(
        'additionalAddresses',
        `too many additional addresses (${params.additionalAddresses.length}), max 246 (256 total - 10 base)`,
      )
    }
    for (const addr of params.additionalAddresses) {
      if (!addr || addr.trim().length === 0) {
        throw new CCIPCreateTokenAltParamsInvalidError(
          'additionalAddresses',
          'all addresses must be non-empty',
        )
      }
      try {
        new PublicKey(addr)
      } catch {
        throw new CCIPCreateTokenAltParamsInvalidError(
          'additionalAddresses',
          `invalid public key: ${addr}`,
        )
      }
    }
  }
}

function validateCreatePoolTokenAccountParams(params: CreatePoolTokenAccountParams): void {
  if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
    throw new CCIPCreatePoolTokenAccountParamsInvalidError('tokenAddress', 'must be non-empty')
  }
  try {
    new PublicKey(params.tokenAddress)
  } catch {
    throw new CCIPCreatePoolTokenAccountParamsInvalidError(
      'tokenAddress',
      'must be a valid public key',
    )
  }
  if (!params.poolAddress || params.poolAddress.trim().length === 0) {
    throw new CCIPCreatePoolTokenAccountParamsInvalidError('poolAddress', 'must be non-empty')
  }
  try {
    new PublicKey(params.poolAddress)
  } catch {
    throw new CCIPCreatePoolTokenAccountParamsInvalidError(
      'poolAddress',
      'must be a valid public key',
    )
  }
}

/**
 * Solana token admin for deploying SPL Token mints with optional Metaplex metadata.
 *
 * Extends {@link SolanaChain} — inherits connection, logger, and chain discovery
 * methods like `getTokenAdminRegistryFor`.
 *
 * @example Direct construction
 * ```typescript
 * const admin = new SolanaTokenAdmin(connection, network, { logger })
 * ```
 */
export class SolanaTokenAdmin extends SolanaChain {
  /** Creates a new SolanaTokenAdmin instance. */
  constructor(connection: Connection, network: NetworkInfo, ctx?: ChainContext) {
    super(connection, network, ctx)
  }

  /**
   * Builds unsigned instructions for deploying an SPL Token mint.
   *
   * The returned instructions include:
   * 1. SystemProgram.createAccount — allocate mint account
   * 2. InitializeMint2 — initialize the mint
   * 3. Create (V1) — Metaplex metadata (supports both SPL Token and Token-2022)
   * 4. CreateAssociatedTokenAccount + MintTo (if initialSupply \> 0)
   *
   * A new mint keypair is generated and returned. The caller must include
   * this keypair as a signer when submitting the transaction.
   *
   * @param sender - Wallet public key (base58) used as payer and default authority
   * @param params - Token deployment parameters
   * @returns Unsigned Solana transaction, mint keypair, and Metaplex metadata PDA
   * @throws {@link CCIPTokenDeployParamsInvalidError} if params are invalid
   *
   * @example
   * ```typescript
   * const { unsigned, mintKeypair } = await admin.generateUnsignedDeployToken(
   *   wallet.publicKey.toBase58(),
   *   { name: 'My Token', symbol: 'MTK', decimals: 9 },
   * )
   * ```
   */
  async generateUnsignedDeployToken(
    sender: string,
    params: SolanaDeployTokenParams,
  ): Promise<{ unsigned: UnsignedSolanaTx; mintKeypair: Keypair; metadataAddress: string }> {
    validateParams(params)

    const payer = new PublicKey(sender)
    const mintKeypair = Keypair.generate()
    const mint = mintKeypair.publicKey

    const tokenProgramId =
      params.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID

    const mintAuthority = params.mintAuthority ? new PublicKey(params.mintAuthority) : payer
    const freezeAuthority =
      params.freezeAuthority === null
        ? null
        : params.freezeAuthority
          ? new PublicKey(params.freezeAuthority)
          : payer

    const instructions: TransactionInstruction[] = []

    // 1. Create mint account
    const mintLen = getMintLen([])
    const lamports = await this.connection.getMinimumBalanceForRentExemption(mintLen)

    instructions.push(
      SystemProgram.createAccount({
        fromPubkey: payer,
        newAccountPubkey: mint,
        space: mintLen,
        lamports,
        programId: tokenProgramId,
      }),
    )

    // 2. Initialize mint
    instructions.push(
      createInitializeMint2Instruction(
        mint,
        params.decimals,
        mintAuthority,
        freezeAuthority,
        tokenProgramId,
      ),
    )

    // 3. Metaplex metadata (always create if name/symbol provided — strongly recommended)
    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from(METADATA_SEED), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      TOKEN_METADATA_PROGRAM_ID,
    )

    instructions.push(
      createMetadataInstruction(
        metadataPDA,
        mint,
        mintAuthority,
        payer,
        mintAuthority,
        params.name,
        params.symbol,
        params.metadataUri ?? '',
        params.decimals,
        tokenProgramId,
      ),
    )

    // 4. Mint initial supply if requested
    const initialSupply = params.initialSupply ?? 0n
    if (initialSupply > 0n) {
      const recipient = params.recipient ? new PublicKey(params.recipient) : payer
      const ata = getAssociatedTokenAddressSync(mint, recipient, false, tokenProgramId)

      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          payer,
          ata,
          recipient,
          mint,
          tokenProgramId,
        ),
      )
      instructions.push(
        createMintToInstruction(mint, ata, mintAuthority, initialSupply, [], tokenProgramId),
      )
    }

    this.logger.debug(
      'generateUnsignedDeployToken: mint =',
      mint.toBase58(),
      'instructions =',
      instructions.length,
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions,
        mainIndex: 0,
      },
      mintKeypair,
      metadataAddress: metadataPDA.toBase58(),
    }
  }

  /**
   * Builds an unsigned instruction for initializing a CCIP token pool.
   *
   * The pool program must already be deployed on-chain. This method builds
   * the Anchor `initialize` instruction with the correct PDA derivations:
   * - state PDA: `["ccip_tokenpool_config", mint]` on the pool program
   * - config PDA: `["config"]` on the pool program
   * - programData: `[poolProgramId]` on BPF Loader Upgradeable
   *
   * @param sender - Wallet public key (base58) used as payer/authority
   * @param params - Pool deployment parameters
   * @returns Unsigned Solana transaction and the pool state PDA address
   * @throws {@link CCIPPoolDeployParamsInvalidError} if params are invalid
   */
  async generateUnsignedDeployPool(
    sender: string,
    params: SolanaDeployPoolParams,
  ): Promise<{ unsigned: UnsignedSolanaTx; poolAddress: string }> {
    validatePoolParams(params)

    const authority = new PublicKey(sender)
    const mint = new PublicKey(params.tokenAddress)
    const poolProgramId = new PublicKey(params.poolProgramId)

    // Derive PDAs
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
      poolProgramId,
    )

    const [configPda] = PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], poolProgramId)

    const [programData] = PublicKey.findProgramAddressSync(
      [poolProgramId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    )

    const poolProgram = createPoolProgram(this, poolProgramId, params.poolType)

    const instruction = await poolProgram.methods
      .initialize()
      .accountsStrict({
        state: statePda,
        mint,
        authority,
        systemProgram: SystemProgram.programId,
        program: poolProgramId,
        programData,
        config: configPda,
      })
      .instruction()

    // Auto-detect token program from mint account
    const mintInfo = await this.connection.getAccountInfo(mint)
    if (!mintInfo) {
      throw new CCIPPoolDeployParamsInvalidError('tokenAddress', 'mint account not found on-chain')
    }
    const tokenProgramId = mintInfo.owner

    // Derive Pool Signer PDA and its ATA
    const [poolSignerPda] = derivePoolSignerPDA(mint, poolProgramId)
    const poolTokenAta = getAssociatedTokenAddressSync(
      mint,
      poolSignerPda,
      true, // allowOwnerOffCurve — PDAs are off-curve
      tokenProgramId,
    )

    // Append idempotent ATA creation — safe even if ATA already exists
    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      authority, // payer
      poolTokenAta, // ATA address
      poolSignerPda, // owner (Pool Signer PDA)
      mint, // token mint
      tokenProgramId, // token program
    )

    this.logger.debug(
      'generateUnsignedDeployPool: statePda =',
      statePda.toBase58(),
      'poolProgram =',
      poolProgramId.toBase58(),
      'poolTokenAta =',
      poolTokenAta.toBase58(),
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions: [instruction, createAtaIx],
        mainIndex: 0,
      },
      poolAddress: statePda.toBase58(),
    }
  }

  /**
   * Initializes a CCIP token pool, signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability
   * @param params - Pool deployment parameters
   * @returns Deploy result with `poolAddress` and `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPPoolDeployParamsInvalidError} if params are invalid
   * @throws {@link CCIPPoolDeployFailedError} if the transaction fails
   */
  async deployPool(wallet: unknown, params: SolanaDeployPoolParams): Promise<DeployPoolResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.publicKey.toBase58()
    const { unsigned, poolAddress } = await this.generateUnsignedDeployPool(sender, params)

    this.logger.debug('deployPool: initializing CCIP token pool...')

    try {
      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('deployPool: initialized pool at', poolAddress, 'tx =', signature)

      return { poolAddress, txHash: signature }
    } catch (error) {
      if (error instanceof CCIPPoolDeployFailedError) throw error
      throw new CCIPPoolDeployFailedError(error instanceof Error ? error.message : String(error), {
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  // ── Propose Admin Role ────────────────────────────────────────────────────

  /**
   * Builds an unsigned instruction for proposing an administrator in the
   * TokenAdminRegistry (built into the Router program on Solana).
   *
   * Uses the `owner_propose_administrator` Anchor instruction with 5 accounts:
   * 1. config (read-only) — Router config PDA
   * 2. tokenAdminRegistry (writable) — TAR PDA for the mint
   * 3. mint (read-only) — Token mint
   * 4. authority/sender (writable, signer) — Mint authority
   * 5. systemProgram (read-only)
   *
   * @param sender - Wallet public key (base58) used as authority
   * @param params - Propose admin role parameters
   * @returns Unsigned Solana transaction
   * @throws {@link CCIPProposeAdminRoleParamsInvalidError} if params are invalid
   */
  async generateUnsignedProposeAdminRole(
    sender: string,
    params: SolanaProposeAdminRoleParams,
  ): Promise<{ unsigned: UnsignedSolanaTx }> {
    validateProposeAdminRoleParams(params)

    const authority = new PublicKey(sender)
    const mint = new PublicKey(params.tokenAddress)
    const routerProgramId = new PublicKey(params.routerAddress)
    const administrator = new PublicKey(params.administrator)

    // Derive PDAs on the Router program
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CONFIG_SEED)],
      routerProgramId,
    )

    const [tokenAdminRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(TOKEN_ADMIN_REGISTRY_SEED), mint.toBuffer()],
      routerProgramId,
    )

    const routerProgram = createRouterProgram(this, routerProgramId)

    const instruction = await routerProgram.methods
      .ownerProposeAdministrator(administrator)
      .accountsStrict({
        config: configPda,
        tokenAdminRegistry: tokenAdminRegistryPda,
        mint,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .instruction()

    this.logger.debug(
      'generateUnsignedProposeAdminRole: TAR PDA =',
      tokenAdminRegistryPda.toBase58(),
      'router =',
      routerProgramId.toBase58(),
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions: [instruction],
        mainIndex: 0,
      },
    }
  }

  /**
   * Proposes an administrator for a token in the TokenAdminRegistry,
   * signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability
   * @param params - Propose admin role parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPProposeAdminRoleParamsInvalidError} if params are invalid
   * @throws {@link CCIPProposeAdminRoleFailedError} if the transaction fails
   */
  async proposeAdminRole(
    wallet: unknown,
    params: SolanaProposeAdminRoleParams,
  ): Promise<ProposeAdminRoleResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.publicKey.toBase58()
    const { unsigned } = await this.generateUnsignedProposeAdminRole(sender, params)

    this.logger.debug('proposeAdminRole: proposing administrator...')

    try {
      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('proposeAdminRole: proposed admin, tx =', signature)

      return { txHash: signature }
    } catch (error) {
      if (error instanceof CCIPProposeAdminRoleFailedError) throw error
      throw new CCIPProposeAdminRoleFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Accept Admin Role ─────────────────────────────────────────────────────

  /**
   * Builds an unsigned instruction for accepting an administrator role in the
   * TokenAdminRegistry (built into the Router program on Solana).
   *
   * Uses the `accept_admin_role_token_admin_registry` Anchor instruction with 5 accounts:
   * 1. config (read-only) — Router config PDA
   * 2. tokenAdminRegistry (writable) — TAR PDA for the mint
   * 3. mint (read-only) — Token mint
   * 4. authority/sender (writable, signer) — Pending administrator
   * 5. systemProgram (read-only)
   *
   * @param sender - Wallet public key (base58) of the pending administrator
   * @param params - Accept admin role parameters
   * @returns Unsigned Solana transaction
   * @throws {@link CCIPAcceptAdminRoleParamsInvalidError} if params are invalid
   */
  async generateUnsignedAcceptAdminRole(
    sender: string,
    params: AcceptAdminRoleParams,
  ): Promise<{ unsigned: UnsignedSolanaTx }> {
    validateAcceptAdminRoleParams(params)

    const authority = new PublicKey(sender)
    const mint = new PublicKey(params.tokenAddress)
    const routerProgramId = new PublicKey(params.routerAddress)

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CONFIG_SEED)],
      routerProgramId,
    )

    const [tokenAdminRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(TOKEN_ADMIN_REGISTRY_SEED), mint.toBuffer()],
      routerProgramId,
    )

    const routerProgram = createRouterProgram(this, routerProgramId)

    const instruction = await routerProgram.methods
      .acceptAdminRoleTokenAdminRegistry()
      .accountsStrict({
        config: configPda,
        tokenAdminRegistry: tokenAdminRegistryPda,
        mint,
        authority,
      })
      .instruction()

    this.logger.debug(
      'generateUnsignedAcceptAdminRole: TAR PDA =',
      tokenAdminRegistryPda.toBase58(),
      'router =',
      routerProgramId.toBase58(),
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions: [instruction],
        mainIndex: 0,
      },
    }
  }

  /**
   * Accepts an administrator role for a token in the TokenAdminRegistry,
   * signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability (must be the pending administrator)
   * @param params - Accept admin role parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPAcceptAdminRoleParamsInvalidError} if params are invalid
   * @throws {@link CCIPAcceptAdminRoleFailedError} if the transaction fails
   */
  async acceptAdminRole(
    wallet: unknown,
    params: AcceptAdminRoleParams,
  ): Promise<AcceptAdminRoleResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.publicKey.toBase58()
    const { unsigned } = await this.generateUnsignedAcceptAdminRole(sender, params)

    this.logger.debug('acceptAdminRole: accepting administrator role...')

    try {
      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('acceptAdminRole: accepted admin, tx =', signature)

      return { txHash: signature }
    } catch (error) {
      if (error instanceof CCIPAcceptAdminRoleParamsInvalidError) throw error
      if (error instanceof CCIPAcceptAdminRoleFailedError) throw error
      throw new CCIPAcceptAdminRoleFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Transfer Admin Role ─────────────────────────────────────────────────

  /**
   * Builds an unsigned instruction for transferring the administrator role in the
   * TokenAdminRegistry (built into the Router program on Solana).
   *
   * Uses the `transferAdminRoleTokenAdminRegistry` Anchor instruction with 4 accounts:
   * 1. config (read-only) — Router config PDA
   * 2. tokenAdminRegistry (writable) — TAR PDA for the mint
   * 3. mint (read-only) — Token mint
   * 4. authority/sender (writable, signer) — Current administrator
   *
   * @param sender - Wallet public key (base58) of the current administrator
   * @param params - Transfer admin role parameters
   * @returns Unsigned Solana transaction
   * @throws {@link CCIPTransferAdminRoleParamsInvalidError} if params are invalid
   */
  async generateUnsignedTransferAdminRole(
    sender: string,
    params: TransferAdminRoleParams,
  ): Promise<{ unsigned: UnsignedSolanaTx }> {
    validateTransferAdminRoleParams(params)

    const authority = new PublicKey(sender)
    const mint = new PublicKey(params.tokenAddress)
    const routerProgramId = new PublicKey(params.routerAddress)
    const newAdmin = new PublicKey(params.newAdmin)

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CONFIG_SEED)],
      routerProgramId,
    )

    const [tokenAdminRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(TOKEN_ADMIN_REGISTRY_SEED), mint.toBuffer()],
      routerProgramId,
    )

    const routerProgram = createRouterProgram(this, routerProgramId)

    const instruction = await routerProgram.methods
      .transferAdminRoleTokenAdminRegistry(newAdmin)
      .accountsStrict({
        config: configPda,
        tokenAdminRegistry: tokenAdminRegistryPda,
        mint,
        authority,
      })
      .instruction()

    this.logger.debug(
      'generateUnsignedTransferAdminRole: TAR PDA =',
      tokenAdminRegistryPda.toBase58(),
      'router =',
      routerProgramId.toBase58(),
      'newAdmin =',
      params.newAdmin,
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions: [instruction],
        mainIndex: 0,
      },
    }
  }

  /**
   * Transfers the administrator role for a token in the TokenAdminRegistry,
   * signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability (must be the current administrator)
   * @param params - Transfer admin role parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPTransferAdminRoleParamsInvalidError} if params are invalid
   * @throws {@link CCIPTransferAdminRoleFailedError} if the transaction fails
   */
  async transferAdminRole(
    wallet: unknown,
    params: TransferAdminRoleParams,
  ): Promise<TransferAdminRoleResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.publicKey.toBase58()
    const { unsigned } = await this.generateUnsignedTransferAdminRole(sender, params)

    this.logger.debug('transferAdminRole: transferring administrator role...')

    try {
      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('transferAdminRole: transferred admin, tx =', signature)

      return { txHash: signature }
    } catch (error) {
      if (error instanceof CCIPTransferAdminRoleParamsInvalidError) throw error
      if (error instanceof CCIPTransferAdminRoleFailedError) throw error
      throw new CCIPTransferAdminRoleFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Set Pool ─────────────────────────────────────────────────────────────

  /**
   * Builds unsigned instructions for registering a pool in the TokenAdminRegistry.
   *
   * Uses the `setPool` Anchor instruction with 5 accounts:
   * 1. config (read-only) — Router config PDA
   * 2. tokenAdminRegistry (writable) — TAR PDA for the mint
   * 3. mint (read-only) — Token mint
   * 4. poolLookuptable (read-only) — Address Lookup Table for the pool
   * 5. authority (writable, signer) — Token administrator
   *
   * The `writableIndexes` arg ([3, 4, 7]) is a byte array indicating which ALT
   * entries are writable during pool operations:
   * - Index 3: Pool Config PDA
   * - Index 4: Pool Token Account (ATA)
   * - Index 7: Token Mint
   *
   * @param sender - Wallet public key (base58) of the token administrator
   * @param params - Set pool parameters (includes poolLookupTable)
   * @returns Unsigned Solana transaction
   * @throws {@link CCIPSetPoolParamsInvalidError} if params are invalid
   */
  async generateUnsignedSetPool(
    sender: string,
    params: SolanaSetPoolParams,
  ): Promise<{ unsigned: UnsignedSolanaTx }> {
    validateSolanaSetPoolParams(params)

    const authority = new PublicKey(sender)
    const mint = new PublicKey(params.tokenAddress)
    const routerProgramId = new PublicKey(params.routerAddress)
    const poolLookupTable = new PublicKey(params.poolLookupTable)

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CONFIG_SEED)],
      routerProgramId,
    )

    const [tokenAdminRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(TOKEN_ADMIN_REGISTRY_SEED), mint.toBuffer()],
      routerProgramId,
    )

    const routerProgram = createRouterProgram(this, routerProgramId)

    // writableIndexes [3, 4, 7]: Pool Config PDA, Pool Token ATA, Token Mint
    const instruction = await routerProgram.methods
      .setPool(Buffer.from([3, 4, 7]))
      .accountsStrict({
        config: configPda,
        tokenAdminRegistry: tokenAdminRegistryPda,
        mint,
        poolLookuptable: poolLookupTable,
        authority,
      })
      .instruction()

    this.logger.debug(
      'generateUnsignedSetPool: TAR PDA =',
      tokenAdminRegistryPda.toBase58(),
      'router =',
      routerProgramId.toBase58(),
      'pool ALT =',
      poolLookupTable.toBase58(),
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions: [instruction],
        mainIndex: 0,
      },
    }
  }

  /**
   * Registers a pool in the TokenAdminRegistry, signing and submitting
   * with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability (must be the token administrator)
   * @param params - Set pool parameters (includes poolLookupTable)
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPSetPoolParamsInvalidError} if params are invalid
   * @throws {@link CCIPSetPoolFailedError} if the transaction fails
   */
  async setPool(wallet: unknown, params: SolanaSetPoolParams): Promise<SetPoolResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.publicKey.toBase58()
    const { unsigned } = await this.generateUnsignedSetPool(sender, params)

    this.logger.debug('setPool: registering pool...')

    try {
      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('setPool: pool registered, tx =', signature)

      return { txHash: signature }
    } catch (error) {
      if (error instanceof CCIPSetPoolParamsInvalidError) throw error
      if (error instanceof CCIPSetPoolFailedError) throw error
      throw new CCIPSetPoolFailedError(error instanceof Error ? error.message : String(error), {
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  // ── Apply Chain Updates ──────────────────────────────────────────────────

  /**
   * Auto-discovers the pool program ID and mint from a pool state account.
   *
   * @param poolAddress - Pool state PDA address (base58)
   * @returns Pool program ID and mint public keys
   * @throws {@link CCIPTokenPoolInfoNotFoundError} if pool account not found
   */
  private async discoverPoolInfo(
    poolAddress: string,
  ): Promise<{ poolProgramId: PublicKey; mint: PublicKey }> {
    const poolPubkey = new PublicKey(poolAddress)
    const accountInfo = await this.connection.getAccountInfo(poolPubkey)
    if (!accountInfo) throw new CCIPTokenPoolInfoNotFoundError(poolAddress)

    const poolProgramId = accountInfo.owner

    // Get mint via existing getTokenForTokenPool (which decodes pool state)
    const mintStr = await this.getTokenForTokenPool(poolAddress)
    const mint = new PublicKey(mintStr)

    return { poolProgramId, mint }
  }

  /**
   * Builds unsigned instructions for configuring remote chains on a token pool.
   *
   * Auto-discovers the pool program ID and mint from the pool address.
   * For each chain to add, builds 2 instructions:
   * - `init_chain_remote_config` — creates the chain config PDA
   * - `set_chain_rate_limit` — sets inbound/outbound rate limits
   *
   * For each chain to remove, builds a `delete_chain_config` instruction.
   *
   * @param sender - Wallet public key (base58) used as authority
   * @param params - Apply chain updates parameters
   * @returns Unsigned Solana transaction
   * @throws {@link CCIPApplyChainUpdatesParamsInvalidError} if params are invalid
   * @throws {@link CCIPTokenPoolInfoNotFoundError} if pool account not found
   */
  async generateUnsignedApplyChainUpdates(
    sender: string,
    params: ApplyChainUpdatesParams,
  ): Promise<{ unsigned: UnsignedSolanaTx }> {
    validateApplyChainUpdatesParams(params)

    const authority = new PublicKey(sender)

    // Auto-discover poolProgramId and mint from pool address
    const { poolProgramId, mint } = await this.discoverPoolInfo(params.poolAddress)

    // Derive state PDA
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
      poolProgramId,
    )

    const poolProgram = createPoolProgram(this, poolProgramId)
    const instructions: TransactionInstruction[] = []

    // Build delete instructions for chains to remove
    for (const selectorStr of params.remoteChainSelectorsToRemove) {
      const chainSelectorBuf = Buffer.alloc(8)
      chainSelectorBuf.writeBigUInt64LE(BigInt(selectorStr))

      const [chainConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(CCIP_TOKENPOOL_CHAINCONFIG_SEED), chainSelectorBuf, mint.toBuffer()],
        poolProgramId,
      )

      const deleteIx = await poolProgram.methods
        .deleteChainConfig(new BN(selectorStr), mint)
        .accountsStrict({
          state: statePda,
          chainConfig: chainConfigPda,
          authority,
        })
        .instruction()

      instructions.push(deleteIx)
    }

    // Collect selectors being removed so we know if a chain is being deleted then re-added
    const selectorsBeingRemoved = new Set(
      params.remoteChainSelectorsToRemove.map((s) => s.toString()),
    )

    // Build init + append pool addresses + rate limit instructions for chains to add
    // Solana requires 3 separate instructions per chain:
    //   1. initChainRemoteConfig — with EMPTY pool addresses (creates the chain config PDA)
    //   2. appendRemotePoolAddresses — adds pool addresses to the initialized config
    //   3. setChainRateLimit — configures inbound/outbound rate limiters
    // If the chain config PDA already exists and is NOT being deleted, skip step 1.
    for (const chain of params.chainsToAdd) {
      const chainSelectorBuf = Buffer.alloc(8)
      chainSelectorBuf.writeBigUInt64LE(BigInt(chain.remoteChainSelector))

      const [chainConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(CCIP_TOKENPOOL_CHAINCONFIG_SEED), chainSelectorBuf, mint.toBuffer()],
        poolProgramId,
      )

      // Check if chain config PDA already exists (idempotency)
      // If the chain is being deleted in the same tx, we must re-init it
      const existingConfig = await this.connection.getAccountInfo(chainConfigPda)
      const beingDeleted = selectorsBeingRemoved.has(chain.remoteChainSelector.toString())
      const chainAlreadyInitialized = existingConfig !== null && !beingDeleted

      if (!chainAlreadyInitialized) {
        // === Step 1: init_chain_remote_config (EMPTY pool addresses) ===
        const tokenAddressBytes = encodeRemoteAddressBytes(chain.remoteTokenAddress)

        const initIx = await poolProgram.methods
          .initChainRemoteConfig(new BN(chain.remoteChainSelector), mint, {
            poolAddresses: [],
            tokenAddress: { address: Buffer.from(tokenAddressBytes) },
            decimals: chain.remoteTokenDecimals ?? 0,
          })
          .accountsStrict({
            state: statePda,
            chainConfig: chainConfigPda,
            authority,
            systemProgram: SystemProgram.programId,
          })
          .instruction()

        instructions.push(initIx)

        this.logger.debug(
          'applyChainUpdates: init chain config for selector',
          chain.remoteChainSelector,
        )
      } else {
        this.logger.debug(
          'applyChainUpdates: chain config already exists for selector',
          chain.remoteChainSelector,
          '— skipping init',
        )
      }

      // === Step 2: appendRemotePoolAddresses ===
      if (chain.remotePoolAddresses.length > 0) {
        const addresses = chain.remotePoolAddresses.map((addr) => ({
          address: Buffer.from(encodeRemotePoolAddressBytes(addr)),
        }))

        const appendIx = await poolProgram.methods
          .appendRemotePoolAddresses(new BN(chain.remoteChainSelector), mint, addresses)
          .accountsStrict({
            state: statePda,
            chainConfig: chainConfigPda,
            authority,
            systemProgram: SystemProgram.programId,
          })
          .instruction()

        instructions.push(appendIx)
      }

      // === Step 3: setChainRateLimit ===
      const rateLimitIx = await poolProgram.methods
        .setChainRateLimit(
          new BN(chain.remoteChainSelector),
          mint,
          {
            enabled: chain.inboundRateLimiterConfig.isEnabled,
            capacity: new BN(chain.inboundRateLimiterConfig.capacity),
            rate: new BN(chain.inboundRateLimiterConfig.rate),
          },
          {
            enabled: chain.outboundRateLimiterConfig.isEnabled,
            capacity: new BN(chain.outboundRateLimiterConfig.capacity),
            rate: new BN(chain.outboundRateLimiterConfig.rate),
          },
        )
        .accountsStrict({
          state: statePda,
          chainConfig: chainConfigPda,
          authority,
        })
        .instruction()

      instructions.push(rateLimitIx)
    }

    this.logger.debug(
      'generateUnsignedApplyChainUpdates: pool =',
      params.poolAddress,
      'instructions =',
      instructions.length,
      'poolProgram =',
      poolProgramId.toBase58(),
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions,
        mainIndex: 0,
      },
    }
  }

  /**
   * Configures remote chains on a token pool, signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability (must be pool owner)
   * @param params - Apply chain updates parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPApplyChainUpdatesParamsInvalidError} if params are invalid
   * @throws {@link CCIPApplyChainUpdatesFailedError} if the transaction fails
   */
  async applyChainUpdates(
    wallet: unknown,
    params: ApplyChainUpdatesParams,
  ): Promise<ApplyChainUpdatesResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.publicKey.toBase58()
    const { unsigned } = await this.generateUnsignedApplyChainUpdates(sender, params)

    this.logger.debug('applyChainUpdates: applying chain updates...')

    try {
      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('applyChainUpdates: applied chain updates, tx =', signature)

      return { txHash: signature }
    } catch (error) {
      if (error instanceof CCIPApplyChainUpdatesParamsInvalidError) throw error
      if (error instanceof CCIPApplyChainUpdatesFailedError) throw error
      throw new CCIPApplyChainUpdatesFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Append Remote Pool Addresses ────────────────────────────────────────

  /**
   * Builds unsigned instructions for appending remote pool addresses to an existing chain config.
   *
   * Auto-discovers the pool program ID and mint from the pool address.
   * Builds a single `appendRemotePoolAddresses` instruction with all addresses.
   *
   * @param sender - Wallet public key (base58) used as authority
   * @param params - Append remote pool addresses parameters
   * @returns Unsigned Solana transaction
   * @throws {@link CCIPAppendRemotePoolAddressesParamsInvalidError} if params are invalid
   * @throws {@link CCIPTokenPoolInfoNotFoundError} if pool account not found
   */
  async generateUnsignedAppendRemotePoolAddresses(
    sender: string,
    params: AppendRemotePoolAddressesParams,
  ): Promise<{ unsigned: UnsignedSolanaTx }> {
    validateAppendRemotePoolAddressesParams(params)

    const authority = new PublicKey(sender)
    const { poolProgramId, mint } = await this.discoverPoolInfo(params.poolAddress)

    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
      poolProgramId,
    )

    const chainSelectorBuf = Buffer.alloc(8)
    chainSelectorBuf.writeBigUInt64LE(BigInt(params.remoteChainSelector))

    const [chainConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CCIP_TOKENPOOL_CHAINCONFIG_SEED), chainSelectorBuf, mint.toBuffer()],
      poolProgramId,
    )

    const poolProgram = createPoolProgram(this, poolProgramId)

    const addresses = params.remotePoolAddresses.map((addr) => ({
      address: Buffer.from(encodeRemotePoolAddressBytes(addr)),
    }))

    const appendIx = await poolProgram.methods
      .appendRemotePoolAddresses(new BN(params.remoteChainSelector), mint, addresses)
      .accountsStrict({
        state: statePda,
        chainConfig: chainConfigPda,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .instruction()

    this.logger.debug(
      'generateUnsignedAppendRemotePoolAddresses: pool =',
      params.poolAddress,
      'addresses =',
      params.remotePoolAddresses.length,
      'poolProgram =',
      poolProgramId.toBase58(),
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions: [appendIx],
        mainIndex: 0,
      },
    }
  }

  /**
   * Appends remote pool addresses to an existing chain config, signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability (must be pool owner)
   * @param params - Append remote pool addresses parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPAppendRemotePoolAddressesParamsInvalidError} if params are invalid
   * @throws {@link CCIPAppendRemotePoolAddressesFailedError} if the transaction fails
   */
  async appendRemotePoolAddresses(
    wallet: unknown,
    params: AppendRemotePoolAddressesParams,
  ): Promise<AppendRemotePoolAddressesResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.publicKey.toBase58()
    const { unsigned } = await this.generateUnsignedAppendRemotePoolAddresses(sender, params)

    this.logger.debug('appendRemotePoolAddresses: appending remote pool addresses...')

    try {
      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('appendRemotePoolAddresses: appended remote pool addresses, tx =', signature)

      return { txHash: signature }
    } catch (error) {
      if (error instanceof CCIPAppendRemotePoolAddressesParamsInvalidError) throw error
      if (error instanceof CCIPAppendRemotePoolAddressesFailedError) throw error
      throw new CCIPAppendRemotePoolAddressesFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Delete Chain Config ──────────────────────────────────────────────────

  /**
   * Builds unsigned instructions for removing a remote chain configuration from a token pool.
   *
   * Auto-discovers the pool program ID and mint from the pool address.
   * Calls the `deleteChainConfig` IDL instruction which closes the chain config PDA.
   *
   * @param sender - Wallet public key (base58) used as authority
   * @param params - Delete chain config parameters
   * @returns Unsigned Solana transaction
   * @throws {@link CCIPDeleteChainConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPTokenPoolInfoNotFoundError} if pool account not found
   */
  async generateUnsignedDeleteChainConfig(
    sender: string,
    params: DeleteChainConfigParams,
  ): Promise<{ unsigned: UnsignedSolanaTx }> {
    validateDeleteChainConfigParams(params)

    const authority = new PublicKey(sender)
    const { poolProgramId, mint } = await this.discoverPoolInfo(params.poolAddress)

    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
      poolProgramId,
    )

    const chainSelectorBuf = Buffer.alloc(8)
    chainSelectorBuf.writeBigUInt64LE(BigInt(params.remoteChainSelector))

    const [chainConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CCIP_TOKENPOOL_CHAINCONFIG_SEED), chainSelectorBuf, mint.toBuffer()],
      poolProgramId,
    )

    const poolProgram = createPoolProgram(this, poolProgramId)

    const deleteIx = await poolProgram.methods
      .deleteChainConfig(new BN(params.remoteChainSelector), mint)
      .accountsStrict({
        state: statePda,
        chainConfig: chainConfigPda,
        authority,
      })
      .instruction()

    this.logger.debug(
      'generateUnsignedDeleteChainConfig: pool =',
      params.poolAddress,
      'remoteChainSelector =',
      params.remoteChainSelector,
      'poolProgram =',
      poolProgramId.toBase58(),
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions: [deleteIx],
        mainIndex: 0,
      },
    }
  }

  /**
   * Removes a remote chain configuration from a token pool, signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability (must be pool owner)
   * @param params - Delete chain config parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPDeleteChainConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPDeleteChainConfigFailedError} if the transaction fails
   */
  async deleteChainConfig(
    wallet: unknown,
    params: DeleteChainConfigParams,
  ): Promise<DeleteChainConfigResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.publicKey.toBase58()
    const { unsigned } = await this.generateUnsignedDeleteChainConfig(sender, params)

    this.logger.debug('deleteChainConfig: deleting chain config...')

    try {
      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('deleteChainConfig: deleted chain config, tx =', signature)

      return { txHash: signature }
    } catch (error) {
      if (error instanceof CCIPDeleteChainConfigParamsInvalidError) throw error
      if (error instanceof CCIPDeleteChainConfigFailedError) throw error
      throw new CCIPDeleteChainConfigFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Remove Remote Pool Addresses ────────────────────────────────────────

  /**
   * Removes specific remote pool addresses from an existing chain config.
   *
   * Solana has no on-chain `removeRemotePool` instruction. This method implements a
   * workaround: read current config, delete the chain config, then re-apply with
   * the remaining pools (minus the ones being removed).
   *
   * @param wallet - Solana wallet with signing capability (must be pool owner)
   * @param params - Remove remote pool addresses parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPRemoveRemotePoolAddressesParamsInvalidError} if params are invalid
   * @throws {@link CCIPRemoveRemotePoolAddressesFailedError} if the transaction fails
   */
  async removeRemotePoolAddresses(
    wallet: unknown,
    params: RemoveRemotePoolAddressesParams,
  ): Promise<RemoveRemotePoolAddressesResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)
    validateRemoveRemotePoolAddressesParams(params)

    this.logger.debug('removeRemotePoolAddresses: reading current config...')

    try {
      // Step 1: Read current chain config via SolanaChain
      const solanaChain = new SolanaChain(this.connection, this.network, {
        logger: this.logger,
      })
      const remotes = await solanaChain.getTokenPoolRemotes(
        params.poolAddress,
        BigInt(params.remoteChainSelector),
      )

      // Find the config for this chain selector
      const remoteConfig = Object.values(remotes)[0]
      if (!remoteConfig) {
        throw new CCIPRemoveRemotePoolAddressesFailedError(
          `No chain config found for remote chain selector ${params.remoteChainSelector}`,
        )
      }

      // Step 2: Filter out the addresses to remove
      // Normalize to 32-byte left-padded hex for comparison (on-chain addresses may
      // be returned with padding, e.g., "0x000...6666..." for a 20-byte EVM address)
      const addressesToRemove = new Set(
        params.remotePoolAddresses.map((a) => encodeRemoteAddress(a).toLowerCase()),
      )
      const remainingPools = remoteConfig.remotePools.filter(
        (pool) => !addressesToRemove.has(encodeRemoteAddress(pool).toLowerCase()),
      )

      if (remainingPools.length === remoteConfig.remotePools.length) {
        throw new CCIPRemoveRemotePoolAddressesFailedError(
          'None of the specified pool addresses were found in the current chain config',
        )
      }

      if (remainingPools.length === 0) {
        throw new CCIPRemoveRemotePoolAddressesFailedError(
          'Cannot remove all pool addresses — use deleteChainConfig instead to remove the entire chain config',
        )
      }

      // Step 3: Convert RateLimiterState to RateLimiterConfig
      const toConfig = (state: { tokens: bigint; capacity: bigint; rate: bigint } | null) => {
        if (!state || (state.capacity === 0n && state.rate === 0n)) {
          return { isEnabled: false, capacity: '0', rate: '0' }
        }
        return {
          isEnabled: true,
          capacity: state.capacity.toString(),
          rate: state.rate.toString(),
        }
      }

      // Step 4: Re-apply with delete + re-add (remaining pools only)
      const result = await this.applyChainUpdates(wallet, {
        poolAddress: params.poolAddress,
        remoteChainSelectorsToRemove: [params.remoteChainSelector],
        chainsToAdd: [
          {
            remoteChainSelector: params.remoteChainSelector,
            remotePoolAddresses: remainingPools,
            remoteTokenAddress: remoteConfig.remoteToken,
            outboundRateLimiterConfig: toConfig(remoteConfig.outboundRateLimiterState),
            inboundRateLimiterConfig: toConfig(remoteConfig.inboundRateLimiterState),
          },
        ],
      })

      this.logger.info(
        'removeRemotePoolAddresses: removed remote pool addresses via re-apply, tx =',
        result.txHash,
      )

      return { txHash: result.txHash }
    } catch (error) {
      if (error instanceof CCIPRemoveRemotePoolAddressesFailedError) throw error
      if (error instanceof CCIPRemoveRemotePoolAddressesParamsInvalidError) throw error
      throw new CCIPRemoveRemotePoolAddressesFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Set Chain Rate Limiter Config ────────────────────────────────────────

  /**
   * Builds unsigned instructions for updating rate limiter configurations on a token pool.
   *
   * Auto-discovers the pool program ID and mint from the pool address.
   * For each chain config, builds a `setChainRateLimit` instruction.
   *
   * @param sender - Wallet public key (base58) used as authority
   * @param params - Set chain rate limiter config parameters
   * @returns Unsigned Solana transaction
   * @throws {@link CCIPSetRateLimiterConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPTokenPoolInfoNotFoundError} if pool account not found
   */
  async generateUnsignedSetChainRateLimiterConfig(
    sender: string,
    params: SetChainRateLimiterConfigParams,
  ): Promise<{ unsigned: UnsignedSolanaTx }> {
    validateSetChainRateLimiterConfigParams(params)

    const authority = new PublicKey(sender)

    // Auto-discover poolProgramId and mint from pool address
    const { poolProgramId, mint } = await this.discoverPoolInfo(params.poolAddress)

    // Derive state PDA
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
      poolProgramId,
    )

    const poolProgram = createPoolProgram(this, poolProgramId)
    const instructions: TransactionInstruction[] = []

    for (const config of params.chainConfigs) {
      const chainSelectorBuf = Buffer.alloc(8)
      chainSelectorBuf.writeBigUInt64LE(BigInt(config.remoteChainSelector))

      const [chainConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(CCIP_TOKENPOOL_CHAINCONFIG_SEED), chainSelectorBuf, mint.toBuffer()],
        poolProgramId,
      )

      const rateLimitIx = await poolProgram.methods
        .setChainRateLimit(
          new BN(config.remoteChainSelector),
          mint,
          {
            enabled: config.inboundRateLimiterConfig.isEnabled,
            capacity: new BN(config.inboundRateLimiterConfig.capacity),
            rate: new BN(config.inboundRateLimiterConfig.rate),
          },
          {
            enabled: config.outboundRateLimiterConfig.isEnabled,
            capacity: new BN(config.outboundRateLimiterConfig.capacity),
            rate: new BN(config.outboundRateLimiterConfig.rate),
          },
        )
        .accountsStrict({
          state: statePda,
          chainConfig: chainConfigPda,
          authority,
        })
        .instruction()

      instructions.push(rateLimitIx)
    }

    this.logger.debug(
      'generateUnsignedSetChainRateLimiterConfig: pool =',
      params.poolAddress,
      'instructions =',
      instructions.length,
      'poolProgram =',
      poolProgramId.toBase58(),
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions,
        mainIndex: 0,
      },
    }
  }

  /**
   * Updates rate limiter configurations on a token pool, signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability (must be pool owner or rate limit admin)
   * @param params - Set chain rate limiter config parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPSetRateLimiterConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPSetRateLimiterConfigFailedError} if the transaction fails
   */
  async setChainRateLimiterConfig(
    wallet: unknown,
    params: SetChainRateLimiterConfigParams,
  ): Promise<SetChainRateLimiterConfigResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.publicKey.toBase58()
    const { unsigned } = await this.generateUnsignedSetChainRateLimiterConfig(sender, params)

    this.logger.debug('setChainRateLimiterConfig: updating rate limits...')

    try {
      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('setChainRateLimiterConfig: updated rate limits, tx =', signature)

      return { txHash: signature }
    } catch (error) {
      if (error instanceof CCIPSetRateLimiterConfigParamsInvalidError) throw error
      if (error instanceof CCIPSetRateLimiterConfigFailedError) throw error
      throw new CCIPSetRateLimiterConfigFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // setRateLimitAdmin
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Builds an unsigned transaction to set the rate limit admin on a Solana token pool.
   *
   * Uses the pool's `setRateLimitAdmin(mint, newRateLimitAdmin)` instruction.
   *
   * @param sender - Public key (base58) of the transaction sender (pool owner)
   * @param params - Set rate limit admin parameters
   * @returns Unsigned Solana transaction with pool address
   * @throws {@link CCIPSetRateLimitAdminParamsInvalidError} if params are invalid
   */
  async generateUnsignedSetRateLimitAdmin(
    sender: string,
    params: SetRateLimitAdminParams,
  ): Promise<{ unsigned: UnsignedSolanaTx; poolAddress: string }> {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCIPSetRateLimitAdminParamsInvalidError('poolAddress', 'must be non-empty')
    }
    if (!params.rateLimitAdmin || params.rateLimitAdmin.trim().length === 0) {
      throw new CCIPSetRateLimitAdminParamsInvalidError('rateLimitAdmin', 'must be non-empty')
    }

    const authority = new PublicKey(sender)
    const newRateLimitAdmin = new PublicKey(params.rateLimitAdmin)

    // Auto-discover pool program and mint from the pool state address
    const { poolProgramId, mint } = await this.discoverPoolInfo(params.poolAddress)

    // Derive state PDA
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
      poolProgramId,
    )

    const poolProgram = createPoolProgram(this, poolProgramId)

    const instruction = await poolProgram.methods
      .setRateLimitAdmin(mint, newRateLimitAdmin)
      .accountsStrict({
        state: statePda,
        authority,
      })
      .instruction()

    this.logger.debug(
      'generateUnsignedSetRateLimitAdmin: pool =',
      params.poolAddress,
      'admin =',
      params.rateLimitAdmin,
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions: [instruction],
        mainIndex: 0,
      },
      poolAddress: statePda.toBase58(),
    }
  }

  /**
   * Sets the rate limit admin on a Solana token pool, signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability
   * @param params - Set rate limit admin parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPSetRateLimitAdminParamsInvalidError} if params are invalid
   * @throws {@link CCIPSetRateLimitAdminFailedError} if the transaction fails
   */
  async setRateLimitAdmin(
    wallet: unknown,
    params: SetRateLimitAdminParams,
  ): Promise<SetRateLimitAdminResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    try {
      const { unsigned } = await this.generateUnsignedSetRateLimitAdmin(
        wallet.publicKey.toBase58(),
        params,
      )

      this.logger.debug('setRateLimitAdmin: submitting transaction...')

      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('setRateLimitAdmin: updated rate limit admin, tx =', signature)

      return { txHash: signature }
    } catch (error) {
      if (error instanceof CCIPSetRateLimitAdminParamsInvalidError) throw error
      if (error instanceof CCIPSetRateLimitAdminFailedError) throw error
      throw new CCIPSetRateLimitAdminFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Create Pool Mint Authority Multisig ──────────────────────────────────

  /**
   * Builds unsigned instructions for creating an SPL Token multisig with the
   * Pool Signer PDA as the first signer. **Solana burn-mint pools only.**
   *
   * The instructions include:
   * 1. SystemProgram.createAccount (or createAccountWithSeed if `seed` is provided)
   * 2. InitializeMultisig — sets signers and threshold
   *
   * @param sender - Wallet public key (base58) used as payer
   * @param params - Multisig creation parameters
   * @returns Unsigned Solana transaction, optional multisig keypair (when no seed), and result metadata
   * @throws {@link CCIPCreatePoolMultisigParamsInvalidError} if params are invalid
   */
  async generateUnsignedCreatePoolMintAuthorityMultisig(
    sender: string,
    params: CreatePoolMintAuthorityMultisigParams,
  ): Promise<{
    unsigned: UnsignedSolanaTx
    multisigKeypair?: Keypair
    result: Omit<CreatePoolMintAuthorityMultisigResult, 'txHash'>
  }> {
    validateCreatePoolMultisigParams(params)

    const payer = new PublicKey(sender)
    const mint = new PublicKey(params.mint)
    const poolProgramId = new PublicKey(params.poolProgramId)

    // 1. Derive Pool Signer PDA
    const [poolSignerPda] = derivePoolSignerPDA(mint, poolProgramId)

    // 2. Build full signers list: [poolSignerPda, ...additionalSigners]
    const allSignerPubkeys = [
      poolSignerPda,
      ...params.additionalSigners.map((s) => new PublicKey(s)),
    ]

    // 3. Auto-detect token program from mint account
    const mintInfo = await this.connection.getAccountInfo(mint)
    if (!mintInfo) {
      throw new CCIPCreatePoolMultisigParamsInvalidError('mint', 'mint account not found on-chain')
    }
    const isToken2022 = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    const isTokenProgram = mintInfo.owner.equals(TOKEN_PROGRAM_ID)
    if (!isToken2022 && !isTokenProgram) {
      throw new CCIPCreatePoolMultisigParamsInvalidError(
        'mint',
        `mint owned by ${mintInfo.owner.toBase58()}, expected SPL Token or Token-2022`,
      )
    }
    const tokenProgramId = mintInfo.owner

    // 4. Get rent exemption for multisig account
    const lamports = await this.connection.getMinimumBalanceForRentExemption(MULTISIG_SIZE)

    const instructions: TransactionInstruction[] = []
    let multisigKeypair: Keypair | undefined
    let multisigPubkey: PublicKey

    if (params.seed) {
      // Deterministic: use createAccountWithSeed
      multisigPubkey = await PublicKey.createWithSeed(payer, params.seed, tokenProgramId)
      instructions.push(
        SystemProgram.createAccountWithSeed({
          fromPubkey: payer,
          newAccountPubkey: multisigPubkey,
          basePubkey: payer,
          seed: params.seed,
          lamports,
          space: MULTISIG_SIZE,
          programId: tokenProgramId,
        }),
      )
    } else {
      // Random keypair (standard SPL pattern)
      multisigKeypair = Keypair.generate()
      multisigPubkey = multisigKeypair.publicKey
      instructions.push(
        SystemProgram.createAccount({
          fromPubkey: payer,
          newAccountPubkey: multisigPubkey,
          space: MULTISIG_SIZE,
          lamports,
          programId: tokenProgramId,
        }),
      )
    }

    // 5. Initialize multisig instruction
    instructions.push(
      createInitializeMultisigInstruction(
        multisigPubkey,
        allSignerPubkeys,
        params.threshold,
        tokenProgramId,
      ),
    )

    const allSigners = allSignerPubkeys.map((pk) => pk.toBase58())

    this.logger.debug(
      'generateUnsignedCreatePoolMintAuthorityMultisig: multisig =',
      multisigPubkey.toBase58(),
      'poolSignerPda =',
      poolSignerPda.toBase58(),
      'signers =',
      allSigners.length,
      'threshold =',
      params.threshold,
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions,
        mainIndex: 1,
      },
      multisigKeypair,
      result: {
        multisigAddress: multisigPubkey.toBase58(),
        poolSignerPda: poolSignerPda.toBase58(),
        allSigners,
      },
    }
  }

  /**
   * Creates an SPL Token multisig with the Pool Signer PDA, signing and
   * submitting with the provided wallet. **Solana burn-mint pools only.**
   *
   * @param wallet - Solana wallet with signing capability
   * @param params - Multisig creation parameters
   * @returns Result with `multisigAddress`, `poolSignerPda`, `allSigners`, and `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPCreatePoolMultisigParamsInvalidError} if params are invalid
   * @throws {@link CCIPCreatePoolMultisigFailedError} if the transaction fails
   */
  async createPoolMintAuthorityMultisig(
    wallet: unknown,
    params: CreatePoolMintAuthorityMultisigParams,
  ): Promise<CreatePoolMintAuthorityMultisigResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.publicKey.toBase58()
    const { unsigned, multisigKeypair, result } =
      await this.generateUnsignedCreatePoolMintAuthorityMultisig(sender, params)

    this.logger.debug('createPoolMintAuthorityMultisig: creating multisig...')

    try {
      // If multisigKeypair exists (no seed), wrap wallet to co-sign
      const effectiveWallet: Wallet = multisigKeypair
        ? {
            publicKey: wallet.publicKey,
            async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
              if ('version' in tx) {
                tx.sign([multisigKeypair])
              } else {
                tx.partialSign(multisigKeypair)
              }
              return wallet.signTransaction(tx)
            },
          }
        : wallet

      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        effectiveWallet,
        unsigned,
      )

      this.logger.info(
        'createPoolMintAuthorityMultisig: created multisig at',
        result.multisigAddress,
        'tx =',
        signature,
      )

      return { ...result, txHash: signature }
    } catch (error) {
      if (error instanceof CCIPCreatePoolMultisigFailedError) throw error
      throw new CCIPCreatePoolMultisigFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Transfer Mint Authority ─────────────────────────────────────────────

  /**
   * Builds unsigned instructions for transferring mint authority to a new
   * address (typically a multisig). **Solana only.**
   *
   * @param sender - Wallet public key (base58) — must be the current mint authority
   * @param params - Transfer mint authority parameters
   * @returns Unsigned Solana transaction and empty result placeholder
   * @throws {@link CCIPTransferMintAuthorityParamsInvalidError} if params are invalid
   */
  async generateUnsignedTransferMintAuthority(
    sender: string,
    params: TransferMintAuthorityParams,
  ): Promise<{ unsigned: UnsignedSolanaTx; result: TransferMintAuthorityResult }> {
    validateTransferMintAuthorityParams(params)

    const senderPubkey = new PublicKey(sender)
    const mint = new PublicKey(params.mint)
    const newMintAuthority = new PublicKey(params.newMintAuthority)

    // Auto-detect token program from mint account
    const mintInfo = await this.connection.getAccountInfo(mint)
    if (!mintInfo) {
      throw new CCIPTransferMintAuthorityParamsInvalidError(
        'mint',
        'mint account not found on-chain',
      )
    }
    const isToken2022 = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    const isTokenProgram = mintInfo.owner.equals(TOKEN_PROGRAM_ID)
    if (!isToken2022 && !isTokenProgram) {
      throw new CCIPTransferMintAuthorityParamsInvalidError(
        'mint',
        `mint owned by ${mintInfo.owner.toBase58()}, expected SPL Token or Token-2022`,
      )
    }
    const tokenProgramId = mintInfo.owner

    const instruction = createSetAuthorityInstruction(
      mint,
      senderPubkey,
      AuthorityType.MintTokens,
      newMintAuthority,
      [],
      tokenProgramId,
    )

    this.logger.debug(
      'generateUnsignedTransferMintAuthority: mint =',
      params.mint,
      'newMintAuthority =',
      params.newMintAuthority,
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions: [instruction],
        mainIndex: 0,
      },
      result: { txHash: '' },
    }
  }

  /**
   * Transfers mint authority on an SPL token, signing and submitting with
   * the provided wallet. **Solana only.**
   *
   * @param wallet - Solana wallet with signing capability (must be current mint authority)
   * @param params - Transfer mint authority parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPTransferMintAuthorityParamsInvalidError} if params are invalid
   * @throws {@link CCIPTransferMintAuthorityFailedError} if the transaction fails
   */
  async transferMintAuthority(
    wallet: unknown,
    params: TransferMintAuthorityParams,
  ): Promise<TransferMintAuthorityResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    try {
      const { unsigned } = await this.generateUnsignedTransferMintAuthority(
        wallet.publicKey.toBase58(),
        params,
      )

      this.logger.debug('transferMintAuthority: submitting transaction...')

      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('transferMintAuthority: transferred mint authority, tx =', signature)

      return { txHash: signature }
    } catch (error) {
      if (error instanceof CCIPTransferMintAuthorityFailedError) throw error
      if (error instanceof CCIPTransferMintAuthorityParamsInvalidError) throw error
      throw new CCIPTransferMintAuthorityFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Grant Mint/Burn Access ─────────────────────────────────────────────

  /**
   * Builds an unsigned transaction for granting mint/burn access on a Solana
   * SPL token by transferring the mint authority to the specified address.
   *
   * This wraps {@link generateUnsignedTransferMintAuthority} with the unified
   * `GrantMintBurnAccessParams` interface, mapping `tokenAddress` → `mint`
   * and `authority` → `newMintAuthority`.
   *
   * @param sender - Current mint authority public key (base58)
   * @param params - Grant mint/burn access parameters
   * @returns Unsigned Solana transaction and result
   * @throws {@link CCIPGrantMintBurnAccessParamsInvalidError} if params are invalid
   */
  async generateUnsignedGrantMintBurnAccess(
    sender: string,
    params: GrantMintBurnAccessParams,
  ): Promise<{ unsigned: UnsignedSolanaTx; result: GrantMintBurnAccessResult }> {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCIPGrantMintBurnAccessParamsInvalidError('tokenAddress', 'must be non-empty')
    }
    if (!params.authority || params.authority.trim().length === 0) {
      throw new CCIPGrantMintBurnAccessParamsInvalidError('authority', 'must be non-empty')
    }
    if (params.role === 'burn') {
      throw new CCIPGrantMintBurnAccessParamsInvalidError(
        'role',
        "Solana SPL tokens do not have a separate burn authority — any token holder can burn. Use 'mint' or 'mintAndBurn' instead",
      )
    }

    try {
      const { unsigned, result } = await this.generateUnsignedTransferMintAuthority(sender, {
        mint: params.tokenAddress,
        newMintAuthority: params.authority,
      })
      return { unsigned, result: { txHash: result.txHash } }
    } catch (error) {
      if (error instanceof CCIPTransferMintAuthorityParamsInvalidError) {
        const param = error.context.param === 'mint' ? 'tokenAddress' : 'authority'
        throw new CCIPGrantMintBurnAccessParamsInvalidError(param, String(error.context.reason))
      }
      throw error
    }
  }

  /**
   * Grants mint/burn access on a Solana SPL token by transferring the mint
   * authority, signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability (must be current mint authority)
   * @param params - Grant mint/burn access parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPGrantMintBurnAccessParamsInvalidError} if params are invalid
   * @throws {@link CCIPGrantMintBurnAccessFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.grantMintBurnAccess(wallet, {
   *   tokenAddress: 'J6fECVXwSX5UAeJuC2oCKrsJRjTizWa9uF1FjqzYLa9M',
   *   authority: '2e8X9v1s9nro5ezG3osRm7bpusdYknNrQYzQMxsA4Gwh',
   * })
   * ```
   */
  async grantMintBurnAccess(
    wallet: unknown,
    params: GrantMintBurnAccessParams,
  ): Promise<GrantMintBurnAccessResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    try {
      const { unsigned } = await this.generateUnsignedGrantMintBurnAccess(
        wallet.publicKey.toBase58(),
        params,
      )

      this.logger.debug('grantMintBurnAccess: submitting transaction...')

      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('grantMintBurnAccess: granted mint/burn access, tx =', signature)

      return { txHash: signature }
    } catch (error) {
      if (error instanceof CCIPGrantMintBurnAccessFailedError) throw error
      if (error instanceof CCIPGrantMintBurnAccessParamsInvalidError) throw error
      if (error instanceof CCIPWalletInvalidError) throw error
      throw new CCIPGrantMintBurnAccessFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Revoke Mint/Burn Access ───────────────────────────────────────────────

  /**
   * Not supported on Solana. SPL tokens use a single mint authority model —
   * use {@link transferMintAuthority} to transfer authority instead.
   *
   * @throws {@link CCIPRevokeMintBurnAccessParamsInvalidError} always
   */
  revokeMintBurnAccess(_wallet: unknown, _params: RevokeMintBurnAccessParams): Promise<never> {
    throw new CCIPRevokeMintBurnAccessParamsInvalidError(
      'chain',
      'Solana SPL tokens do not support role-based revoke. Use transferMintAuthority() to transfer mint authority instead',
    )
  }

  /**
   * Deploys an SPL Token mint, signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability
   * @param params - Token deployment parameters
   * @returns Unified deploy result with `tokenAddress` and `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPTokenDeployParamsInvalidError} if params are invalid
   * @throws {@link CCIPTokenDeployFailedError} if the deploy transaction fails
   */
  async deployToken(wallet: unknown, params: SolanaDeployTokenParams): Promise<DeployTokenResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.publicKey.toBase58()
    const { unsigned, mintKeypair } = await this.generateUnsignedDeployToken(sender, params)

    this.logger.debug('deployToken: deploying SPL Token mint...')

    try {
      // Wrap the wallet to also sign with the mint keypair
      const wrappedWallet: Wallet = {
        publicKey: wallet.publicKey,
        async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
          // Sign with mint keypair first — simulateAndSendTxs uses VersionedTransaction
          if ('version' in tx) {
            tx.sign([mintKeypair])
          } else {
            tx.partialSign(mintKeypair)
          }
          // Then sign with the user's wallet
          return wallet.signTransaction(tx)
        },
      }

      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wrappedWallet,
        unsigned,
      )

      const mint = mintKeypair.publicKey
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from(METADATA_SEED), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
        TOKEN_METADATA_PROGRAM_ID,
      )

      this.logger.info(
        'deployToken: deployed at',
        mintKeypair.publicKey.toBase58(),
        'metadata =',
        metadataPDA.toBase58(),
        'tx =',
        signature,
      )

      return {
        tokenAddress: mintKeypair.publicKey.toBase58(),
        txHash: signature,
        metadataAddress: metadataPDA.toBase58(),
      }
    } catch (error) {
      if (error instanceof CCIPTokenDeployFailedError) throw error
      throw new CCIPTokenDeployFailedError(error instanceof Error ? error.message : String(error), {
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  // ── Get Mint/Burn Roles (read-only) ──────────────────────────────────────

  /**
   * Queries the mint authority on an SPL token and, if it is a multisig,
   * returns the threshold and member list.
   *
   * @param params - `tokenAddress` (SPL mint, base58)
   * @returns Mint authority info including multisig details
   *
   * @example
   * ```typescript
   * const roles = await admin.getMintBurnRoles({
   *   tokenAddress: 'J6fECVXwSX5UAeJuC2oCKrsJRjTizWa9uF1FjqzYLa9M',
   * })
   * ```
   */
  async getMintBurnRoles(params: { tokenAddress: string }): Promise<SolanaMintBurnRolesResult> {
    const mintPubkey = new PublicKey(params.tokenAddress)
    const mintAccountInfo = await this.connection.getAccountInfo(mintPubkey)
    if (!mintAccountInfo) {
      throw new CCIPGrantMintBurnAccessParamsInvalidError(
        'tokenAddress',
        'mint account not found on-chain',
      )
    }

    // Parse mint data
    const rawMint = MintLayout.decode(mintAccountInfo.data)
    const mintAuthority =
      rawMint.mintAuthorityOption === 1 ? rawMint.mintAuthority.toBase58() : null

    if (!mintAuthority) {
      return { mintAuthority: null, isMultisig: false }
    }

    // Check if mint authority is a multisig
    const authorityPubkey = new PublicKey(mintAuthority)
    const authorityInfo = await this.connection.getAccountInfo(authorityPubkey)

    const isOwnedByTokenProgram =
      authorityInfo?.owner.equals(TOKEN_PROGRAM_ID) ||
      authorityInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)

    if (!authorityInfo || authorityInfo.data.length !== MULTISIG_SIZE || !isOwnedByTokenProgram) {
      return { mintAuthority, isMultisig: false }
    }

    // Parse multisig account
    const rawMultisig = MultisigLayout.decode(authorityInfo.data)
    if (!rawMultisig.isInitialized) {
      return { mintAuthority, isMultisig: false }
    }

    const signerKeys = [
      'signer1',
      'signer2',
      'signer3',
      'signer4',
      'signer5',
      'signer6',
      'signer7',
      'signer8',
      'signer9',
      'signer10',
      'signer11',
    ] as const

    const members: Array<{ address: string }> = []
    for (let i = 0; i < rawMultisig.n; i++) {
      const signer = rawMultisig[signerKeys[i]!]
      members.push({ address: signer.toBase58() })
    }

    this.logger.debug(
      `getMintBurnRoles: tokenAddress=${params.tokenAddress}, authority=${mintAuthority}, isMultisig=true, threshold=${rawMultisig.m}, members=${members.length}`,
    )

    return {
      mintAuthority,
      isMultisig: true,
      multisigThreshold: rawMultisig.m,
      multisigMembers: members,
    }
  }

  // ── Create Token Address Lookup Table ───────────────────────────────────

  /**
   * Builds unsigned instructions for creating an Address Lookup Table (ALT)
   * populated with the 10 base CCIP addresses for a token's pool. **Solana only.**
   *
   * The ALT is required before calling `setPool` on the router. It contains
   * accounts that the CCIP router references during cross-chain pool operations.
   *
   * **ALT account ordering (10 base addresses):**
   *
   * | Index | Account |
   * |-------|---------|
   * | 0 | ALT self-reference |
   * | 1 | Token Admin Registry PDA (`["token_admin_registry", mint]` on router) |
   * | 2 | Pool Program ID (derived from poolAddress owner) |
   * | 3 | Pool Config PDA (`["ccip_tokenpool_config", mint]` on pool program) — **writable** |
   * | 4 | Pool Token ATA (pool signer's associated token account) — **writable** |
   * | 5 | Pool Signer PDA (`["ccip_tokenpool_signer", mint]` on pool program) |
   * | 6 | Token Program ID (SPL Token or Token-2022, auto-detected) |
   * | 7 | Token Mint — **writable** |
   * | 8 | Fee Token Config PDA (`["fee_billing_token_config", mint]` on feeQuoter) |
   * | 9 | Router Pool Signer PDA (`["external_token_pools_signer", poolProgramId]` on router) |
   *
   * Additional addresses (e.g., SPL Token Multisig for burn-mint with multisig
   * governance) are appended after index 9.
   *
   * @param sender - Wallet public key (base58) — pays for ALT creation
   * @param params - Create token ALT parameters
   * @returns Unsigned Solana transaction and result with lookupTableAddress
   * @throws {@link CCIPCreateTokenAltParamsInvalidError} if params are invalid
   */
  async generateUnsignedCreateTokenAlt(
    sender: string,
    params: CreateTokenAltParams,
  ): Promise<{ unsigned: UnsignedSolanaTx; result: Omit<CreateTokenAltResult, 'txHash'> }> {
    validateCreateTokenAltParams(params)

    const payer = new PublicKey(sender)
    const mint = new PublicKey(params.tokenAddress)
    const routerProgramId = new PublicKey(params.routerAddress)
    const authority = params.authority ? new PublicKey(params.authority) : payer

    // 1. Derive poolProgramId from the pool state PDA's on-chain owner
    const poolStateInfo = await this.connection.getAccountInfo(new PublicKey(params.poolAddress))
    if (!poolStateInfo) {
      throw new CCIPCreateTokenAltParamsInvalidError(
        'poolAddress',
        'pool state account not found on-chain',
      )
    }
    const poolProgramId = poolStateInfo.owner

    // 2. Auto-detect token program from mint account
    const mintInfo = await this.connection.getAccountInfo(mint)
    if (!mintInfo) {
      throw new CCIPCreateTokenAltParamsInvalidError(
        'tokenAddress',
        'mint account not found on-chain',
      )
    }
    const isToken2022 = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    const isTokenProgram = mintInfo.owner.equals(TOKEN_PROGRAM_ID)
    if (!isToken2022 && !isTokenProgram) {
      throw new CCIPCreateTokenAltParamsInvalidError(
        'tokenAddress',
        `mint owned by ${mintInfo.owner.toBase58()}, expected SPL Token or Token-2022`,
      )
    }
    const tokenProgramId = mintInfo.owner

    // 3. Discover feeQuoter from router config
    const routerConfig = await this._getRouterConfig(params.routerAddress)
    const feeQuoterProgramId: PublicKey = routerConfig.feeQuoter

    // 4. Derive all 10 base CCIP addresses

    // [1] Token Admin Registry PDA
    const [tokenAdminRegistryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(TOKEN_ADMIN_REGISTRY_SEED), mint.toBuffer()],
      routerProgramId,
    )

    // [3] Pool Config PDA (writable during pool operations)
    const [poolConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
      poolProgramId,
    )

    // [5] Pool Signer PDA
    const [poolSignerPda] = derivePoolSignerPDA(mint, poolProgramId)

    // [4] Pool Token ATA (writable during pool operations)
    const poolTokenAta = getAssociatedTokenAddressSync(
      mint,
      poolSignerPda,
      true, // allowOwnerOffCurve (PDA)
      tokenProgramId,
    )

    // [8] Fee Token Config PDA
    const [feeTokenConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(FEE_BILLING_TOKEN_CONFIG_SEED), mint.toBuffer()],
      feeQuoterProgramId,
    )

    // [9] Router External Token Pools Signer PDA
    const [routerPoolSignerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(EXTERNAL_TOKEN_POOLS_SIGNER_SEED), poolProgramId.toBuffer()],
      routerProgramId,
    )

    // 5. Create ALT and build extend instructions
    const recentSlot = await this.connection.getSlot()
    const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
      authority,
      payer,
      recentSlot,
    })

    // Fixed ordering per CCIP convention (indexes 0-9)
    const baseAddresses: PublicKey[] = [
      lookupTableAddress, // [0] ALT self-reference
      tokenAdminRegistryPda, // [1] Token Admin Registry PDA
      poolProgramId, // [2] Pool Program ID
      poolConfigPda, // [3] Pool Config PDA (writable)
      poolTokenAta, // [4] Pool Token ATA (writable)
      poolSignerPda, // [5] Pool Signer PDA
      tokenProgramId, // [6] Token Program ID
      mint, // [7] Token Mint (writable)
      feeTokenConfigPda, // [8] Fee Token Config PDA
      routerPoolSignerPda, // [9] Router External Token Pools Signer PDA
    ]

    const additionalPubkeys = (params.additionalAddresses ?? []).map((a) => new PublicKey(a))
    const allAddresses = [...baseAddresses, ...additionalPubkeys]

    // Chunk addresses into extend instructions (max 30 per instruction)
    const extendIxs: TransactionInstruction[] = []
    const CHUNK_SIZE = 30
    for (let i = 0; i < allAddresses.length; i += CHUNK_SIZE) {
      const chunk = allAddresses.slice(i, i + CHUNK_SIZE)
      extendIxs.push(
        AddressLookupTableProgram.extendLookupTable({
          payer,
          authority,
          lookupTable: lookupTableAddress,
          addresses: chunk,
        }),
      )
    }

    const instructions = [createIx, ...extendIxs]

    this.logger.debug(
      'generateUnsignedCreateTokenAlt: ALT =',
      lookupTableAddress.toBase58(),
      'mint =',
      mint.toBase58(),
      'poolProgram =',
      poolProgramId.toBase58(),
      'addresses =',
      allAddresses.length,
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions,
        mainIndex: 0,
      },
      result: {
        lookupTableAddress: lookupTableAddress.toBase58(),
      },
    }
  }

  /**
   * Creates an Address Lookup Table (ALT) for a token's CCIP pool,
   * signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability
   * @param params - Create token ALT parameters
   * @returns Result with `lookupTableAddress` and `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPCreateTokenAltParamsInvalidError} if params are invalid
   * @throws {@link CCIPCreateTokenAltFailedError} if the transaction fails
   */
  async createTokenAlt(
    wallet: unknown,
    params: CreateTokenAltParams,
  ): Promise<CreateTokenAltResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.publicKey.toBase58()
    const { unsigned, result } = await this.generateUnsignedCreateTokenAlt(sender, params)

    this.logger.debug('createTokenAlt: creating address lookup table...')

    try {
      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info(
        'createTokenAlt: created ALT at',
        result.lookupTableAddress,
        'tx =',
        signature,
      )

      return { ...result, txHash: signature }
    } catch (error) {
      if (error instanceof CCIPCreateTokenAltFailedError) throw error
      throw new CCIPCreateTokenAltFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Create Pool Token Account ───────────────────────────────────────────────

  /**
   * Builds an unsigned instruction to create the Pool Signer's Associated Token
   * Account (ATA). This ATA is the token "vault" the pool uses to hold tokens
   * during cross-chain operations and **must** exist before any CCIP transfer.
   *
   * Uses `createAssociatedTokenAccountIdempotentInstruction` so it is safe to
   * call even if the ATA already exists (no-op in that case).
   *
   * This is also automatically appended to {@link generateUnsignedDeployPool},
   * but is exposed separately for existing pools that were deployed before this
   * step was added.
   *
   * @param sender - Wallet public key (base58) — pays rent for the ATA
   * @param params - Token and pool addresses
   * @returns Unsigned Solana transaction and result with pool token account details
   * @throws {@link CCIPCreatePoolTokenAccountParamsInvalidError} if params are invalid
   */
  async generateUnsignedCreatePoolTokenAccount(
    sender: string,
    params: CreatePoolTokenAccountParams,
  ): Promise<{ unsigned: UnsignedSolanaTx; result: Omit<CreatePoolTokenAccountResult, 'txHash'> }> {
    validateCreatePoolTokenAccountParams(params)

    const payer = new PublicKey(sender)
    const mint = new PublicKey(params.tokenAddress)

    // Derive poolProgramId from the pool state PDA's on-chain owner
    const poolStateInfo = await this.connection.getAccountInfo(new PublicKey(params.poolAddress))
    if (!poolStateInfo) {
      throw new CCIPCreatePoolTokenAccountParamsInvalidError(
        'poolAddress',
        'pool state account not found on-chain',
      )
    }
    const poolProgramId = poolStateInfo.owner

    // Auto-detect token program from mint account
    const mintInfo = await this.connection.getAccountInfo(mint)
    if (!mintInfo) {
      throw new CCIPCreatePoolTokenAccountParamsInvalidError(
        'tokenAddress',
        'mint account not found on-chain',
      )
    }
    const isToken2022 = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    const isTokenProgram = mintInfo.owner.equals(TOKEN_PROGRAM_ID)
    if (!isToken2022 && !isTokenProgram) {
      throw new CCIPCreatePoolTokenAccountParamsInvalidError(
        'tokenAddress',
        `mint owned by ${mintInfo.owner.toBase58()}, expected SPL Token or Token-2022`,
      )
    }
    const tokenProgramId = mintInfo.owner

    // Derive Pool Signer PDA and its ATA
    const [poolSignerPda] = derivePoolSignerPDA(mint, poolProgramId)
    const poolTokenAta = getAssociatedTokenAddressSync(
      mint,
      poolSignerPda,
      true, // allowOwnerOffCurve — PDAs are off-curve
      tokenProgramId,
    )

    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      payer, // payer
      poolTokenAta, // ATA address
      poolSignerPda, // owner (Pool Signer PDA)
      mint, // token mint
      tokenProgramId, // token program
    )

    this.logger.debug(
      'generateUnsignedCreatePoolTokenAccount: poolTokenAta =',
      poolTokenAta.toBase58(),
      'poolSignerPda =',
      poolSignerPda.toBase58(),
      'tokenProgram =',
      tokenProgramId.toBase58(),
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions: [createAtaIx],
        mainIndex: 0,
      },
      result: {
        poolTokenAccount: poolTokenAta.toBase58(),
        poolSignerPda: poolSignerPda.toBase58(),
      },
    }
  }

  /**
   * Creates the Pool Signer's Associated Token Account (ATA),
   * signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability
   * @param params - Token and pool addresses
   * @returns Result with `poolTokenAccount`, `poolSignerPda`, and `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPCreatePoolTokenAccountParamsInvalidError} if params are invalid
   * @throws {@link CCIPCreatePoolTokenAccountFailedError} if the transaction fails
   */
  async createPoolTokenAccount(
    wallet: unknown,
    params: CreatePoolTokenAccountParams,
  ): Promise<CreatePoolTokenAccountResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.publicKey.toBase58()
    const { unsigned, result } = await this.generateUnsignedCreatePoolTokenAccount(sender, params)

    this.logger.debug('createPoolTokenAccount: creating pool token ATA...')

    try {
      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info(
        'createPoolTokenAccount: created ATA at',
        result.poolTokenAccount,
        'owner =',
        result.poolSignerPda,
        'tx =',
        signature,
      )

      return { ...result, txHash: signature }
    } catch (error) {
      if (error instanceof CCIPCreatePoolTokenAccountFailedError) throw error
      throw new CCIPCreatePoolTokenAccountFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Transfer Ownership ───────────────────────────────────────────────────

  /**
   * Builds an unsigned instruction for proposing a new pool owner.
   *
   * Uses the pool's `transferOwnership(proposedOwner)` instruction.
   *
   * @param sender - Public key (base58) of the transaction sender (current pool owner)
   * @param params - Transfer ownership parameters
   * @returns Unsigned Solana transaction
   * @throws {@link CCIPTransferOwnershipParamsInvalidError} if params are invalid
   */
  async generateUnsignedTransferOwnership(
    sender: string,
    params: TransferOwnershipParams,
  ): Promise<{ unsigned: UnsignedSolanaTx }> {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCIPTransferOwnershipParamsInvalidError('poolAddress', 'must be non-empty')
    }
    if (!params.newOwner || params.newOwner.trim().length === 0) {
      throw new CCIPTransferOwnershipParamsInvalidError('newOwner', 'must be non-empty')
    }

    let proposedOwner: PublicKey
    try {
      proposedOwner = new PublicKey(params.newOwner)
    } catch {
      throw new CCIPTransferOwnershipParamsInvalidError(
        'newOwner',
        'must be a valid Solana public key',
      )
    }

    const authority = new PublicKey(sender)

    const { poolProgramId, mint } = await this.discoverPoolInfo(params.poolAddress)

    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
      poolProgramId,
    )

    const poolProgram = createPoolProgram(this, poolProgramId)

    const instruction = await poolProgram.methods
      .transferOwnership(proposedOwner)
      .accountsStrict({
        state: statePda,
        mint,
        authority,
      })
      .instruction()

    this.logger.debug(
      'generateUnsignedTransferOwnership: pool =',
      params.poolAddress,
      'newOwner =',
      params.newOwner,
    )

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions: [instruction],
        mainIndex: 0,
      },
    }
  }

  /**
   * Proposes a new pool owner, signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability (must be current pool owner)
   * @param params - Transfer ownership parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPTransferOwnershipParamsInvalidError} if params are invalid
   * @throws {@link CCIPTransferOwnershipFailedError} if the transaction fails
   */
  async transferOwnership(
    wallet: unknown,
    params: TransferOwnershipParams,
  ): Promise<OwnershipResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    try {
      const { unsigned } = await this.generateUnsignedTransferOwnership(
        wallet.publicKey.toBase58(),
        params,
      )

      this.logger.debug('transferOwnership: submitting transaction...')

      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('transferOwnership: ownership proposed, tx =', signature)

      return { txHash: signature }
    } catch (error) {
      if (error instanceof CCIPTransferOwnershipParamsInvalidError) throw error
      if (error instanceof CCIPTransferOwnershipFailedError) throw error
      throw new CCIPTransferOwnershipFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Accept Ownership ─────────────────────────────────────────────────────

  /**
   * Builds an unsigned instruction for accepting pool ownership.
   *
   * Uses the pool's `acceptOwnership()` instruction.
   *
   * @param sender - Public key (base58) of the transaction sender (proposed owner)
   * @param params - Accept ownership parameters
   * @returns Unsigned Solana transaction
   * @throws {@link CCIPAcceptOwnershipParamsInvalidError} if params are invalid
   */
  async generateUnsignedAcceptOwnership(
    sender: string,
    params: AcceptOwnershipParams,
  ): Promise<{ unsigned: UnsignedSolanaTx }> {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCIPAcceptOwnershipParamsInvalidError('poolAddress', 'must be non-empty')
    }

    const authority = new PublicKey(sender)

    const { poolProgramId, mint } = await this.discoverPoolInfo(params.poolAddress)

    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(CCIP_TOKENPOOL_CONFIG_SEED), mint.toBuffer()],
      poolProgramId,
    )

    const poolProgram = createPoolProgram(this, poolProgramId)

    const instruction = await poolProgram.methods
      .acceptOwnership()
      .accountsStrict({
        state: statePda,
        mint,
        authority,
      })
      .instruction()

    this.logger.debug('generateUnsignedAcceptOwnership: pool =', params.poolAddress)

    return {
      unsigned: {
        family: ChainFamily.Solana,
        instructions: [instruction],
        mainIndex: 0,
      },
    }
  }

  /**
   * Accepts pool ownership, signing and submitting with the provided wallet.
   *
   * @param wallet - Solana wallet with signing capability (must be proposed owner)
   * @param params - Accept ownership parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Solana Wallet
   * @throws {@link CCIPAcceptOwnershipParamsInvalidError} if params are invalid
   * @throws {@link CCIPAcceptOwnershipFailedError} if the transaction fails
   */
  async acceptOwnership(wallet: unknown, params: AcceptOwnershipParams): Promise<OwnershipResult> {
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)

    try {
      const { unsigned } = await this.generateUnsignedAcceptOwnership(
        wallet.publicKey.toBase58(),
        params,
      )

      this.logger.debug('acceptOwnership: submitting transaction...')

      const signature = await simulateAndSendTxs(
        { connection: this.connection, logger: this.logger },
        wallet,
        unsigned,
      )

      this.logger.info('acceptOwnership: ownership accepted, tx =', signature)

      return { txHash: signature }
    } catch (error) {
      if (error instanceof CCIPAcceptOwnershipParamsInvalidError) throw error
      if (error instanceof CCIPAcceptOwnershipFailedError) throw error
      throw new CCIPAcceptOwnershipFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }
}

export type { TransferMintAuthorityParams } from '../types.ts'
