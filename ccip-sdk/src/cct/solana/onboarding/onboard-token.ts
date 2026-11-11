/**
 * CCIP 2.0 token onboarding on Solana: the ordered chain of CCT operations that takes a mint from
 * no pool to a pool registered with the Router, connected to its remote chains, and on the 2.0 pool
 * interface. Each step is planned from on-chain state, so onboarding resumes where it stopped.
 *
 * @packageDocumentation
 */

import { MULTISIG_SIZE, unpackMint, unpackMultisig } from '@solana/spl-token'
import type { AccountInfo, PublicKey } from '@solana/web3.js'

import type { TokenTransferFeeConfig } from '../../../chain.ts'
import { CCIPError, CCIPWalletInvalidError } from '../../../errors/index.ts'
import type { FinalityAllowed } from '../../../extra-args.ts'
import type { SolanaChain } from '../../../solana/index.ts'
import {
  type TokenAccountResolution,
  TOKEN_ACCOUNT_RESOLUTIONS,
  decodeTokenAdminRegistryConfig,
  getLookupTableTokenPool,
  isLatestTokenAdminRegistryLayout,
} from '../../../solana/token-admin-registry.ts'
import {
  deriveTokenPoolChainConfigOverridePda,
  deriveTokenPoolChainConfigV2Pda,
} from '../../../solana/token-pool.ts'
import { type UnsignedSolanaTx, isWallet } from '../../../solana/types.ts'
import { resolveTokenMint } from '../../../solana/utils.ts'
import { sleep } from '../../../utils.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../errors.ts'
import { Operation } from '../../operation.ts'
import { parseRemoteAddress, parseUniqueRemoteAddresses } from '../../remote-address.ts'
import {
  type SolanaExecuteParams,
  type SolanaGenerateParams,
  refreshAccountState,
} from '../operation.ts'
import { deriveCcipLookupTableAddresses } from '../programs/alt.ts'
import { deriveTokenAdminRegistryPda } from '../programs/router.ts'
import {
  type TokenPoolType,
  decodeTokenPoolGlobalConfig,
  decodeTokenPoolState,
  deriveTokenPoolChainConfigPda,
  deriveTokenPoolConfigPda,
  deriveTokenPoolGlobalConfigPda,
  deriveTokenPoolSignerPda,
  readTokenPoolUpgradeAuthority,
  resolveTokenPoolProgram,
} from '../programs/token-pool.ts'
import { AcceptAdmin } from '../token-admin-registry/operations/accept-admin.ts'
import { AppendToLookupTable } from '../token-admin-registry/operations/append-to-lookup-table.ts'
import { CreateLookupTable } from '../token-admin-registry/operations/create-lookup-table.ts'
import { RegisterAdmin } from '../token-admin-registry/operations/register-admin.ts'
import { SetPoolInterfaceImplementation } from '../token-admin-registry/operations/set-pool-interface-implementation.ts'
import { SetPool } from '../token-admin-registry/operations/set-pool.ts'
import { UpgradeTokenAdminRegistry } from '../token-admin-registry/operations/upgrade-token-admin-registry.ts'
import { ApplyChainUpdates } from '../token-pool/operations/apply-chain-updates.ts'
import {
  type TokenPoolCCVConfig,
  parseChainConfigV2Params,
} from '../token-pool/operations/chain-config-v2.ts'
import {
  CreateTokenMultisig,
  deriveTokenMultisigAddress,
} from '../token-pool/operations/create-token-multisig.ts'
import { DeployTokenPool } from '../token-pool/operations/deploy-token-pool.ts'
import { InitChainConfigV2 } from '../token-pool/operations/init-chain-config-v2.ts'
import { InitFastFinalityRateLimit } from '../token-pool/operations/init-fast-finality-rate-limit.ts'
import {
  type RateLimitConfig,
  parseRateLimitConfig,
} from '../token-pool/operations/set-chain-rate-limit.ts'
import { SetTokenAuthority } from '../token/operations/set-token-authority.ts'
import {
  U64_MAX,
  parseOptionalPublicKey,
  parsePublicKey,
  validateBigInt,
  validateInteger,
  validatePoolProgramAtLeast2,
  validatePoolProgramType,
  validatePoolType,
  validateUniqueChainSelectors,
  validateUniquePublicKeys,
} from '../validate.ts'

const NAME = 'onboardToken'

/** Seed of the burn-mint mint authority multisig, under the onboarding authority. */
const MINT_MULTISIG_SEED = 'ccip-onboarding-mint-authority'

/** How many times `onboardToken` reads the state again when it does not show the last step yet. */
const STATE_READ_ATTEMPTS = 5
/** Delay between those reads, for an RPC node behind the one that confirmed the step. */
const STATE_READ_INTERVAL_MS = 1_000

/** A remote chain to connect the onboarded pool to, on both its 1.6 and 2.0 lane configs. */
export type TokenOnboardingRemoteChain = {
  /** CCIP selector of the remote chain (`u64`). */
  remoteChainSelector: bigint
  /** Remote token address in the remote chain's own format (`0x…` for EVM, base58 for Solana, …). */
  remoteTokenAddress: string
  /** Remote pool addresses in the remote chain's own format; unique. */
  remotePoolAddresses: string[]
  /** Remote token decimals (`u8`). */
  remoteTokenDecimals: number
  /** Rate limit for tokens received from the remote chain. */
  inboundRateLimiterConfig: RateLimitConfig
  /** Rate limit for tokens sent to the remote chain. */
  outboundRateLimiterConfig: RateLimitConfig
  /**
   * Finality that transfers to the remote chain may request below full finality. Defaults to
   * `{ finalityDepth: 0 }`, full finality only.
   */
  allowedFinality?: FinalityAllowed
  /** Fees the pool charges on transfers to the remote chain. Defaults to disabled. */
  tokenTransferFeeConfig?: TokenTransferFeeConfig
  /** CCVs the pool requires on the lane. Defaults to none. */
  ccvConfig?: TokenPoolCCVConfig
  /**
   * Rate limits for faster-than-finality (FTF) transfers on the lane. Omit to create no FTF rate
   * limits; the pool then applies `inboundRateLimiterConfig`/`outboundRateLimiterConfig` to them.
   */
  fastFinalityRateLimits?: { inbound: RateLimitConfig; outbound: RateLimitConfig }
}

/** Parameters shared by token onboarding planning, generation and execution. */
type OnboardTokenParams = {
  /** Token mint to onboard. Its mint authority must be the onboarding `authority`. */
  tokenAddress: string
  /** Canonical token pool program to deploy: `burn-mint` or `lock-release`. */
  poolType: TokenPoolType
  /**
   * Address of the `poolType` program. Defaults to the canonical address for `poolType`; set it
   * where that program is deployed elsewhere. It must be a CCIP 2.0 pool program.
   */
  poolProgramAddress?: string
  /** Remote chains to connect the pool to. Chains the pool already has are left as they are. */
  remoteChains: TokenOnboardingRemoteChain[]
  /** Addresses to seed into the pool allowlist at deployment, which also enables it. */
  allowlist?: string[]
  /**
   * How the Router resolves the pool's accounts on 2.0 lanes. Defaults to `'Standard'`: every
   * lookup table entry, plus the accounts the pool resolves on-chain. Omitted, a registry already
   * on the 2.0 interface keeps its resolution.
   */
  accountResolution?: TokenAccountResolution
  /**
   * Lookup table to set for the pool instead of creating one: the `lookupTableAddress` of an
   * earlier `createLookupTable` or `setPool` step, or a table of your own. It must be empty, which
   * onboarding then fills with the pool's CCIP addresses (signed by `authority`, its authority), or
   * already hold them. Ignored once the registry points at the pool.
   */
  poolLookupTableAddress?: string
}

/** Parameters for token onboarding planning and unsigned generation. */
export type GenerateOnboardTokenParams = OnboardTokenParams & {
  /** Fee payer of every onboarding transaction. */
  payer: string
  /**
   * Mint authority of the token, who becomes the pool owner and token administrator. Defaults to
   * `payer`; pass the vault for a Squads multisig.
   */
  authority?: string
  /**
   * Account that pays for and signs the pool lookup table's creation in a `createLookupTable` step
   * of its own, such as a hot wallet; `authority` stays the table's authority.
   *
   * @remarks A lookup table is created from a recent slot, which Solana accepts for 512 slots
   * (about 3 minutes). Set this when `payer` cannot land a transaction that fast, such as a Squads
   * vault awaiting approvals. Then land the `createLookupTable` transaction right away, and pass
   * its `lookupTableAddress` as `poolLookupTableAddress` from the next call on; the `setPool` step
   * fills the table, with no time limit. Without it, `setPool` creates the table itself.
   */
  lookupTablePayer?: string
}

/** Parameters for executing token onboarding with a wallet that is the token's mint authority. */
export type ExecuteOnboardTokenParams = OnboardTokenParams & {
  /** Signs and pays for every step; must be the token's mint authority. */
  wallet: unknown
  /** Compute unit limit for each transaction; simulated per transaction by default. */
  computeUnits?: number
}

/** Token onboarding operations, in the order onboarding runs them. */
export const TOKEN_ONBOARDING_STEPS = [
  'deployTokenPool',
  'registerAdmin',
  'upgradeTokenAdminRegistry',
  'acceptAdmin',
  'createLookupTable',
  'setPool',
  'applyChainUpdates',
  'initChainConfigV2',
  'initFastFinalityRateLimit',
  'setPoolInterfaceImplementation',
  'createTokenMultisig',
  'setTokenAuthority',
] as const

/** A token onboarding operation. */
export type TokenOnboardingStepName = (typeof TOKEN_ONBOARDING_STEPS)[number]

/**
 * One onboarding step: an SDK operation and, for per-lane steps, the remote chains it configures.
 *
 * @remarks `upgradeTokenAdminRegistry` only runs for a registry an older Router created, which the
 * Router's other registry instructions reject. `createLookupTable` only runs with
 * `lookupTablePayer`, creating an empty pool lookup table. `setPool` creates and fills the table
 * (or fills an empty one given as `poolLookupTableAddress`), then sets it, also replacing a pool
 * the registry already had. For a burn-mint token, `createTokenMultisig` creates a 1-of-2 SPL
 * multisig of the pool signer and the authority, and `setTokenAuthority` makes it the mint
 * authority: the pool mints through it alone, and the authority keeps its own path to mint or move
 * the mint authority. They run last, since the steps before them check the mint authority.
 */
export type TokenOnboardingStep = {
  name: TokenOnboardingStepName
  /** Remote chains of `applyChainUpdates`, `initChainConfigV2` and `initFastFinalityRateLimit`. */
  remoteChainSelectors?: bigint[]
}

/** Onboarding steps still to run, planned from the current on-chain state. */
export type TokenOnboardingPlan = {
  /** Remaining steps in order; empty once the token is onboarded. */
  steps: TokenOnboardingStep[]
  /** Pool state PDA. */
  poolAddress: string
  /** Pool signer PDA, through which the pool mints. */
  poolSignerAddress: string
  /**
   * Burn-mint only: the 1-of-2 multisig of the pool signer and the authority that onboarding makes
   * the mint authority. Its address is fixed by the authority and the mint.
   */
  mintMultisigAddress?: string
}

/**
 * The next onboarding step's unsigned transactions. Its `steps` are the ones after `step`.
 */
export type GenerateOnboardTokenResult = TokenOnboardingPlan & {
  /** The step `transactions` run; `undefined` once the token is onboarded. */
  step?: TokenOnboardingStep
  /** Transactions to land in order, every one confirmed, before generating the next step. */
  transactions: UnsignedSolanaTx[]
  /**
   * Fee payer of `transactions`, to serialize them with: `lookupTablePayer` for
   * `createLookupTable`, which it signs alone, and `payer` otherwise, signing with `authority`.
   */
  payer: string
  /**
   * Lookup table the `createLookupTable` or `setPool` step creates; pass it as
   * `poolLookupTableAddress` from the next call on.
   */
  lookupTableAddress?: string
}

/** A step onboarding executed, with its confirmed transaction signatures. */
export type ExecutedTokenOnboardingStep = TokenOnboardingStep & { hashes: string[] }

/** Result of executing token onboarding. */
export type ExecuteOnboardTokenResult = {
  /** Steps executed by this call, in order; empty if the token was already onboarded. */
  steps: ExecutedTokenOnboardingStep[]
  /** Pool state PDA. */
  poolAddress: string
  /** Pool signer PDA. */
  poolSignerAddress: string
  /** Burn-mint only: the mint authority multisig, see {@link TokenOnboardingPlan}. */
  mintMultisigAddress?: string
}

/** Parsed {@link GenerateOnboardTokenParams}. */
type ParsedOnboardTokenParams = {
  tokenMint: PublicKey
  poolType: TokenPoolType
  poolProgram: PublicKey
  payer: PublicKey
  authority: PublicKey
  /** Validated remote chains, as given. */
  remoteChains: TokenOnboardingRemoteChain[]
  allowlist?: string[]
  accountResolution?: TokenAccountResolution
  poolLookupTable?: PublicKey
  lookupTablePayer?: PublicKey
}

/** Which of a remote chain's configs the pool already has. */
export type TokenOnboardingRemoteState = {
  /** The 1.6 `ChainConfig`, with the remote token, pools and rate limits. */
  chainConfig: boolean
  /** The 2.0 `ChainConfigV2`, with allowed finality, fees and CCVs. */
  chainConfigV2: boolean
  /** The FTF `ChainConfigOverride`, with the faster-than-finality rate limits. */
  fastFinalityRateLimit: boolean
}

/** The given `poolLookupTableAddress`, read while `setPool` is still to run. */
export type PoolLookupTableState =
  | { found: false }
  | {
      found: true
      authority?: PublicKey
      /** Whether it is empty, starts with the pool's CCIP addresses, or holds anything else. */
      contents: 'empty' | 'ccip' | 'other'
    }

/** On-chain state that onboarding plans from. */
export type TokenOnboardingState = {
  /** Current mint authority; `null` if revoked. */
  mintAuthority: PublicKey | null
  /** Router the pool is registered with: the pool's, or, before it is deployed, its program's. */
  router: PublicKey
  /** The pool, if deployed. */
  pool?: { owner: PublicKey }
  /**
   * Before the pool is deployed, who may deploy it: a mint authority if the program allows
   * self-served pools, and otherwise only the program's upgrade authority.
   */
  poolDeployment?: { selfServedAllowed: boolean; upgradeAuthority?: PublicKey }
  /** The token's TokenAdminRegistry entry under `router`, if registered. */
  registry?: {
    administrator: PublicKey
    pendingAdministrator?: PublicKey
    lookupTable?: PublicKey
    /** Pool state that the registry's lookup table names, if it has one. */
    tokenPool?: PublicKey
    /** Whether the account has the Router's latest layout, which its other instructions require. */
    latestLayout: boolean
    interfaceVersion: number
    accountResolution: TokenAccountResolution
  }
  /** Each requested remote chain's existing configs, by selector. */
  remotes: Map<bigint, TokenOnboardingRemoteState>
  /** The given `poolLookupTableAddress`, if read. */
  poolLookupTable?: PoolLookupTableState
  /**
   * Burn-mint only: the mint authority multisig onboarding creates, whether it exists as a token
   * account (not just funded), and whether the pool signer can mint through it alone.
   */
  mintMultisig?: { address: PublicKey; exists: boolean; poolSignerCanMint: boolean }
  /** Whether the current mint authority is an SPL multisig the pool signer can mint through alone. */
  poolMintsThroughMintAuthority?: boolean
}

/** Rethrows a remote chain's param error with the param under `remoteChains[i]`. */
function underRemoteChain<T>(index: number, parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    if (!(error instanceof CCTParamsInvalidError)) throw error
    const { param, reason } = error.context as { param: string; reason: string }
    throw new CCTParamsInvalidError(NAME, `remoteChains[${index}].${param}`, reason, {
      cause: error,
    })
  }
}

/** Validates a remote chain's 1.6 and 2.0 lane configs, and returns it as given. */
function parseRemoteChain(
  index: number,
  remote: unknown,
  tokenAddress: string,
  payer: string,
): TokenOnboardingRemoteChain {
  if (typeof remote !== 'object' || remote === null)
    throw new CCTParamsInvalidError(NAME, `remoteChains[${index}]`, 'must be an object')
  const chain = remote as TokenOnboardingRemoteChain
  return underRemoteChain(index, () => {
    const selector = chain.remoteChainSelector
    validateBigInt(NAME, 'remoteChainSelector', selector, 0n, U64_MAX)
    parseRemoteAddress(NAME, 'remoteTokenAddress', chain.remoteTokenAddress, selector)
    if (!Array.isArray(chain.remotePoolAddresses) || !chain.remotePoolAddresses.length)
      throw new CCTParamsInvalidError(NAME, 'remotePoolAddresses', 'must be a non-empty array')
    parseUniqueRemoteAddresses(NAME, 'remotePoolAddresses', chain.remotePoolAddresses, selector)
    validateInteger(NAME, 'remoteTokenDecimals', chain.remoteTokenDecimals, 0, 255)
    parseRateLimitConfig(NAME, 'inboundRateLimiterConfig', chain.inboundRateLimiterConfig)
    parseRateLimitConfig(NAME, 'outboundRateLimiterConfig', chain.outboundRateLimiterConfig)
    parseChainConfigV2Params(NAME, {
      tokenAddress,
      payer,
      remoteChainSelector: selector,
      allowedFinality: chain.allowedFinality,
      tokenTransferFeeConfig: chain.tokenTransferFeeConfig,
      ccvConfig: chain.ccvConfig,
    })
    if (chain.fastFinalityRateLimits !== undefined) {
      const limits = chain.fastFinalityRateLimits as unknown
      if (typeof limits !== 'object' || limits === null)
        throw new CCTParamsInvalidError(NAME, 'fastFinalityRateLimits', 'must be an object')
      parseRateLimitConfig(
        NAME,
        'fastFinalityRateLimits.inbound',
        chain.fastFinalityRateLimits.inbound,
      )
      parseRateLimitConfig(
        NAME,
        'fastFinalityRateLimits.outbound',
        chain.fastFinalityRateLimits.outbound,
      )
    }
    return chain
  })
}

/**
 * Parses and validates onboarding params before any RPC, including every remote chain's lane
 * configs, so a bad lane fails before the first step lands.
 * @throws {@link CCTParamsInvalidError} if a parameter is invalid.
 */
export function parseOnboardTokenParams(
  params: GenerateOnboardTokenParams,
): ParsedOnboardTokenParams {
  validatePoolType(NAME, 'poolType', params.poolType)
  const payer = parsePublicKey(NAME, 'payer', params.payer)
  const tokenMint = parsePublicKey(NAME, 'tokenAddress', params.tokenAddress)

  if (params.allowlist !== undefined) {
    if (!Array.isArray(params.allowlist))
      throw new CCTParamsInvalidError(NAME, 'allowlist', 'must be an array')
    validateUniquePublicKeys(
      NAME,
      'allowlist',
      params.allowlist.map((address, i) => parsePublicKey(NAME, `allowlist[${i}]`, address)),
    )
  }
  const { accountResolution } = params
  if (accountResolution !== undefined && !TOKEN_ACCOUNT_RESOLUTIONS.includes(accountResolution))
    throw new CCTParamsInvalidError(
      NAME,
      'accountResolution',
      `must be one of ${TOKEN_ACCOUNT_RESOLUTIONS.join(', ')}`,
    )

  if (!Array.isArray(params.remoteChains))
    throw new CCTParamsInvalidError(NAME, 'remoteChains', 'must be an array')
  const remoteChains = params.remoteChains.map((remote, i) =>
    parseRemoteChain(i, remote, params.tokenAddress, params.payer),
  )
  validateUniqueChainSelectors(
    NAME,
    'remoteChains',
    remoteChains.map(({ remoteChainSelector }) => remoteChainSelector),
  )

  return {
    tokenMint,
    poolType: params.poolType,
    poolProgram:
      parseOptionalPublicKey(NAME, 'poolProgramAddress', params.poolProgramAddress) ??
      resolveTokenPoolProgram(params.poolType),
    payer,
    authority:
      params.authority === undefined ? payer : parsePublicKey(NAME, 'authority', params.authority),
    remoteChains,
    ...(params.allowlist !== undefined && { allowlist: params.allowlist }),
    ...(accountResolution !== undefined && { accountResolution }),
    poolLookupTable: parseOptionalPublicKey(
      NAME,
      'poolLookupTableAddress',
      params.poolLookupTableAddress,
    ),
    lookupTablePayer: parseOptionalPublicKey(NAME, 'lookupTablePayer', params.lookupTablePayer),
  }
}

/** Checks that `authority` may deploy the pool: as a mint authority, or the upgrade authority. */
function validatePoolDeployment(
  params: ParsedOnboardTokenParams,
  deployment: TokenOnboardingState['poolDeployment'],
) {
  if (!deployment || deployment.selfServedAllowed) return
  if (deployment.upgradeAuthority?.equals(params.authority)) return
  throw new CCTParamsInvalidError(
    NAME,
    'authority',
    `must be the upgrade authority of pool program ${params.poolProgram.toBase58()} (${
      deployment.upgradeAuthority?.toBase58() ?? 'none'
    }) to deploy the pool, since the program does not allow self-served pools`,
  )
}

/** Checks that the given lookup table exists and that `setPool` can fill or use it. */
function validatePoolLookupTable(
  params: ParsedOnboardTokenParams,
  table: PoolLookupTableState | undefined,
) {
  const address = params.poolLookupTable?.toBase58()
  if (!table) return
  if (!table.found)
    throw new CCTParamsInvalidError(
      NAME,
      'poolLookupTableAddress',
      `lookup table ${address} does not exist; land its creation first`,
    )
  if (table.contents === 'other')
    throw new CCTParamsInvalidError(
      NAME,
      'poolLookupTableAddress',
      `lookup table ${address} must be empty or start with the pool's CCIP addresses`,
    )
  if (table.contents === 'empty' && !table.authority?.equals(params.authority))
    throw new CCTParamsInvalidError(
      NAME,
      'poolLookupTableAddress',
      `lookup table ${address} must have the authority ${params.authority.toBase58()} to be filled, not ${table.authority?.toBase58() ?? 'none (frozen)'}`,
    )
}

/** Selectors of the requested remote chains matching `predicate`, in request order. */
function remotesWhere(
  params: ParsedOnboardTokenParams,
  state: TokenOnboardingState,
  predicate: (remote: TokenOnboardingRemoteChain, existing: TokenOnboardingRemoteState) => boolean,
): bigint[] {
  return params.remoteChains
    .filter((remote) => {
      const existing = state.remotes.get(remote.remoteChainSelector) ?? {
        chainConfig: false,
        chainConfigV2: false,
        fastFinalityRateLimit: false,
      }
      return predicate(remote, existing)
    })
    .map(({ remoteChainSelector }) => remoteChainSelector)
}

/**
 * Plans the onboarding steps still to run from on-chain state. Pure: reads nothing.
 *
 * @remarks A step is done once the state it creates exists; existing remote chain configs are not
 * compared with the requested ones. `setPool` is done once the registry's lookup table names this
 * pool; a registry pointing at another pool is set to this one.
 * @throws {@link CCTParamsInvalidError} if a precondition fails: the authority must be the pool
 * owner, the token administrator (or pending one), the program's upgrade authority to deploy a pool
 * of a program without self-served pools, and, while the pool is not deployed and registered or a
 * burn-mint token's mint authority not handed to the pool's multisig, the mint authority.
 */
export function planTokenOnboarding(
  params: ParsedOnboardTokenParams,
  state: TokenOnboardingState,
): TokenOnboardingStep[] {
  const { authority, poolType, poolProgram, tokenMint } = params
  const steps: TokenOnboardingStep[] = []
  const { pool, registry } = state

  if (pool && !pool.owner.equals(authority))
    throw new CCTParamsInvalidError(
      NAME,
      'authority',
      `must be the pool owner, ${pool.owner.toBase58()}`,
    )
  if (
    registry &&
    !registry.administrator.equals(authority) &&
    !registry.pendingAdministrator?.equals(authority)
  )
    throw new CCTParamsInvalidError(
      NAME,
      'authority',
      `must be the token administrator, ${registry.administrator.toBase58()}`,
    )

  if (!pool) {
    validatePoolDeployment(params, state.poolDeployment)
    steps.push({ name: 'deployTokenPool' })
  }
  if (!registry) steps.push({ name: 'registerAdmin' })
  else if (!registry.latestLayout) steps.push({ name: 'upgradeTokenAdminRegistry' })
  if (!registry?.administrator.equals(authority)) steps.push({ name: 'acceptAdmin' })
  if (!registry?.tokenPool?.equals(deriveTokenPoolConfigPda(poolProgram, tokenMint))) {
    if (params.poolLookupTable) validatePoolLookupTable(params, state.poolLookupTable)
    else if (params.lookupTablePayer) steps.push({ name: 'createLookupTable' })
    steps.push({ name: 'setPool' })
  }

  const applyChainUpdates = remotesWhere(params, state, (_, existing) => !existing.chainConfig)
  if (applyChainUpdates.length)
    steps.push({ name: 'applyChainUpdates', remoteChainSelectors: applyChainUpdates })
  const initChainConfigV2 = remotesWhere(params, state, (_, existing) => !existing.chainConfigV2)
  if (initChainConfigV2.length)
    steps.push({ name: 'initChainConfigV2', remoteChainSelectors: initChainConfigV2 })
  const initFastFinality = remotesWhere(
    params,
    state,
    (remote, existing) => !!remote.fastFinalityRateLimits && !existing.fastFinalityRateLimit,
  )
  if (initFastFinality.length)
    steps.push({ name: 'initFastFinalityRateLimit', remoteChainSelectors: initFastFinality })

  if (
    registry?.interfaceVersion !== 2 ||
    (params.accountResolution !== undefined &&
      registry.accountResolution !== params.accountResolution)
  )
    steps.push({ name: 'setPoolInterfaceImplementation' })

  // a burn-mint pool mints through a multisig, or, set up before, as the sole mint authority
  const handsOverMint =
    poolType === 'burn-mint' &&
    !state.mintAuthority?.equals(deriveTokenPoolSignerPda(poolProgram, tokenMint)) &&
    !state.poolMintsThroughMintAuthority
  if (handsOverMint) {
    const multisig = state.mintMultisig
    if (!multisig?.exists) steps.push({ name: 'createTokenMultisig' })
    else if (!multisig.poolSignerCanMint)
      throw new CCTParamsInvalidError(
        NAME,
        'authority',
        `the mint authority multisig ${multisig.address.toBase58()} exists, but the pool signer cannot mint through it alone`,
      )
    steps.push({ name: 'setTokenAuthority' })
  }

  // deploy (self-served) and registration authorize the mint authority, which the handover moves
  const needsMintAuthority = !pool || !registry || handsOverMint
  if (needsMintAuthority && !state.mintAuthority?.equals(authority))
    throw new CCTParamsInvalidError(
      NAME,
      'authority',
      `must be the token's mint authority (${state.mintAuthority?.toBase58() ?? 'revoked'}) to ${
        !pool
          ? 'deploy the pool'
          : !registry
            ? 'register the token'
            : "hand it to the pool's mint multisig"
      }; set the mint authority to ${authority.toBase58()} first`,
    )
  return steps
}

/**
 * Reads the on-chain state onboarding plans from: the mint, the pool (or, before it is deployed,
 * its program's global config), the token's registry under the pool's Router and the pool it
 * names, and each requested remote chain's configs.
 * @throws {@link CCTParamsInvalidError} if the pool is not deployed and its program has no global
 * config to deploy it with.
 */
export async function readTokenOnboardingState(
  chain: SolanaChain,
  params: ParsedOnboardTokenParams,
): Promise<TokenOnboardingState> {
  refreshAccountState(chain)
  const { tokenMint, poolProgram, remoteChains } = params
  const mintAccount = await resolveTokenMint(chain.connection, tokenMint)
  const { mintAuthority } = unpackMint(tokenMint, mintAccount, mintAccount.owner)

  const poolState = deriveTokenPoolConfigPda(poolProgram, tokenMint)
  const globalConfig = deriveTokenPoolGlobalConfigPda(poolProgram)
  const selectors = remoteChains.map(({ remoteChainSelector }) => remoteChainSelector)
  const pdas = selectors.flatMap((selector) => [
    deriveTokenPoolChainConfigPda(poolProgram, selector, tokenMint),
    deriveTokenPoolChainConfigV2Pda(poolProgram, selector, tokenMint),
    deriveTokenPoolChainConfigOverridePda(poolProgram, selector, tokenMint),
  ])

  // a burn-mint token's multisig, and the mint authority if it may be another multisig
  const burnMint = params.poolType === 'burn-mint'
  const poolSigner = deriveTokenPoolSignerPda(poolProgram, tokenMint)
  const tokenProgram = mintAccount.owner
  const multisigAddress = burnMint
    ? (
        await deriveTokenMultisigAddress(
          params.authority,
          MINT_MULTISIG_SEED,
          tokenMint,
          tokenProgram,
        )
      ).address
    : undefined
  const otherMintAuthority =
    multisigAddress &&
    mintAuthority &&
    ![params.authority, poolSigner, multisigAddress].some((key) => key.equals(mintAuthority))
      ? mintAuthority
      : undefined

  const [poolAccount, globalConfigAccount, ...accounts] =
    await chain.connection.getMultipleAccountsInfo([
      poolState,
      globalConfig,
      ...pdas,
      ...(multisigAddress ? [multisigAddress] : []),
      ...(otherMintAuthority ? [otherMintAuthority] : []),
    ])
  const remoteAccounts = accounts.slice(0, pdas.length)
  const [multisigAccount, otherMintAuthorityAccount] = accounts.slice(pdas.length)
  const poolMints = (address: PublicKey, account: AccountInfo<Buffer> | null | undefined) =>
    poolSignerCanMintThrough(address, account, tokenProgram, poolSigner)
  const mintMultisig = multisigAddress && {
    address: multisigAddress,
    exists: !!multisigAccount?.owner.equals(tokenProgram),
    poolSignerCanMint: poolMints(multisigAddress, multisigAccount),
  }
  const poolMintsThroughMintAuthority =
    mintMultisig && mintAuthority?.equals(mintMultisig.address)
      ? mintMultisig.poolSignerCanMint
      : otherMintAuthority && poolMints(otherMintAuthority, otherMintAuthorityAccount)
  const remotes = new Map(
    selectors.map((selector, i) => [
      selector,
      {
        chainConfig: !!remoteAccounts[3 * i],
        chainConfigV2: !!remoteAccounts[3 * i + 1],
        fastFinalityRateLimit: !!remoteAccounts[3 * i + 2],
      },
    ]),
  )

  let router: PublicKey
  let pool: TokenOnboardingState['pool']
  let poolDeployment: TokenOnboardingState['poolDeployment']
  if (poolAccount) {
    const { config } = decodeTokenPoolState(poolAccount.data, {
      tokenPool: poolState.toBase58(),
      mint: tokenMint.toBase58(),
      poolProgram: poolProgram.toBase58(),
      accountOwner: poolAccount.owner.toBase58(),
    })
    router = config.router
    pool = { owner: config.owner }
  } else {
    // a new pool takes its program's default Router, so the registry is known before deployment
    if (!globalConfigAccount)
      throw new CCTParamsInvalidError(
        NAME,
        'poolProgramAddress',
        `pool program ${poolProgram.toBase58()} has no global config, so it cannot deploy pools`,
      )
    const { router: defaultRouter, selfServedAllowed } = decodeTokenPoolGlobalConfig(
      globalConfigAccount.data,
      { globalConfig: globalConfig.toBase58(), poolProgram: poolProgram.toBase58() },
    )
    const upgradeAuthority = selfServedAllowed
      ? undefined
      : await readTokenPoolUpgradeAuthority(chain, poolProgram)
    router = defaultRouter
    poolDeployment = { selfServedAllowed, ...(upgradeAuthority && { upgradeAuthority }) }
  }

  const registry = await readRegistry(chain, router, tokenMint)
  const poolLookupTable =
    params.poolLookupTable && !registry?.tokenPool?.equals(poolState)
      ? await readPoolLookupTable(chain, params, params.poolLookupTable, router)
      : undefined
  return {
    mintAuthority,
    router,
    ...(pool && { pool }),
    ...(poolDeployment && { poolDeployment }),
    ...(registry && { registry }),
    remotes,
    ...(poolLookupTable && { poolLookupTable }),
    ...(mintMultisig && { mintMultisig }),
    ...(poolMintsThroughMintAuthority !== undefined && { poolMintsThroughMintAuthority }),
  }
}

/** Reads the token's registry under `router`, with the pool its lookup table names. */
async function readRegistry(
  chain: SolanaChain,
  router: PublicKey,
  tokenMint: PublicKey,
): Promise<TokenOnboardingState['registry']> {
  const account = await chain.connection.getAccountInfo(
    deriveTokenAdminRegistryPda(router, tokenMint),
  )
  if (!account?.data.length) return undefined
  const config = decodeTokenAdminRegistryConfig(account.data)
  const tokenPool =
    config.lookupTable && (await getLookupTableTokenPool(chain.connection, config.lookupTable))
  return {
    ...config,
    latestLayout: isLatestTokenAdminRegistryLayout(account.data),
    ...(tokenPool && { tokenPool }),
  }
}

/** Whether `account` is an SPL multisig whose pool signer slots meet its threshold. */
function poolSignerCanMintThrough(
  address: PublicKey,
  account: AccountInfo<Buffer> | null | undefined,
  tokenProgram: PublicKey,
  poolSigner: PublicKey,
): boolean {
  if (!account?.owner.equals(tokenProgram) || account.data.length !== MULTISIG_SIZE) return false
  const multisig = unpackMultisig(address, account, tokenProgram)
  if (!multisig.isInitialized) return false
  const signers = [
    multisig.signer1,
    multisig.signer2,
    multisig.signer3,
    multisig.signer4,
    multisig.signer5,
    multisig.signer6,
    multisig.signer7,
    multisig.signer8,
    multisig.signer9,
    multisig.signer10,
    multisig.signer11,
  ].slice(0, multisig.n)
  return signers.filter((signer) => signer.equals(poolSigner)).length >= multisig.m
}

/** Reads a lookup table and how its addresses compare with the pool's CCIP addresses. */
async function readPoolLookupTable(
  chain: SolanaChain,
  { tokenMint, poolProgram }: ParsedOnboardTokenParams,
  lookupTableAddress: PublicKey,
  router: PublicKey,
): Promise<PoolLookupTableState> {
  const { value: table } = await chain.connection.getAddressLookupTable(lookupTableAddress)
  if (!table) return { found: false }
  const { addresses, authority } = table.state
  let contents: 'empty' | 'ccip' | 'other' = 'empty'
  if (addresses.length) {
    const ccip = await deriveCcipLookupTableAddresses(chain, {
      lookupTableAddress,
      tokenMint,
      poolProgram,
      router,
    })
    contents = ccip.every((address, i) => addresses[i]?.equals(address)) ? 'ccip' : 'other'
  }
  return { found: true, contents, ...(authority && { authority }) }
}

/** Wraps `error` in a {@link CCIPError} if it is not one, and adds `context` to it. */
function withContext(error: unknown, context: Record<string, unknown>): CCIPError {
  const failure = CCIPError.isCCIPError(error) ? error : CCIPError.from(error)
  Object.assign(failure.context, context)
  return failure
}

/** `onboardToken` creates the lookup table in `setPool`, so it takes no `lookupTablePayer`. */
const lookupTablePayerExecuteError = () =>
  new CCTParamsInvalidError(
    NAME,
    'lookupTablePayer',
    'only applies to generateUnsignedOnboardToken; onboardToken creates the lookup table in setPool',
  )

/** Whether `next` comes after `last` in {@link TOKEN_ONBOARDING_STEPS}, or either is missing. */
function advancesPast(
  next: TokenOnboardingStep | undefined,
  last: TokenOnboardingStep | undefined,
): boolean {
  return (
    !next ||
    !last ||
    TOKEN_ONBOARDING_STEPS.indexOf(next.name) > TOKEN_ONBOARDING_STEPS.indexOf(last.name)
  )
}

/** The wallet that signs and pays for an executed step, and its compute unit limit. */
type StepWallet = { wallet: { publicKey: PublicKey }; computeUnits?: number }

/** A step's operations, bound to their params, for unsigned generation or signed execution. */
type StepRun = {
  /** Builds the step's transactions with `payer` as their fee payer. */
  generate(payer: string): Promise<{
    transactions: UnsignedSolanaTx[]
    payer?: string
    lookupTableAddress?: string
  }>
  execute(wallet: StepWallet): Promise<string[]>
}

/** The generate and execute surface of an SDK operation that lands one transaction. */
type SingleTxOperation<P extends object> = {
  generate(chain: SolanaChain, params: SolanaGenerateParams<P>): Promise<UnsignedSolanaTx>
  execute(chain: SolanaChain, params: SolanaExecuteParams<P>): Promise<{ hash: string }>
}

/**
 * Binds `params` to a single-transaction operation. Params carrying `authority` work for both:
 * signed execution runs with the authority as the wallet.
 */
function bindOperation<P extends object>(
  chain: SolanaChain,
  operation: SingleTxOperation<P>,
  params: P,
): StepRun {
  return {
    generate: async (payer) => ({
      transactions: [await operation.generate(chain, { ...params, payer })],
    }),
    execute: async (wallet) => [(await operation.execute(chain, { ...params, ...wallet })).hash],
  }
}

/**
 * Onboards a token on CCIP 2.0: deploys and registers its pool, connects its remote chains, and
 * sets the 2.0 pool interface. See {@link TOKEN_ONBOARDING_STEPS} for the order.
 *
 * @remarks Each call plans from on-chain state, so an interrupted onboarding resumes where it
 * stopped. Unsigned generation returns one step at a time, since each step's operations validate
 * the state the previous steps leave.
 */
export class OnboardToken extends Operation<
  SolanaChain,
  GenerateOnboardTokenParams,
  GenerateOnboardTokenResult,
  ExecuteOnboardTokenResult,
  ParsedOnboardTokenParams
> {
  readonly name = NAME

  readonly #acceptAdmin = new AcceptAdmin()
  readonly #appendToLookupTable = new AppendToLookupTable()
  readonly #applyChainUpdates = new ApplyChainUpdates()
  readonly #createLookupTable = new CreateLookupTable()
  readonly #createTokenMultisig = new CreateTokenMultisig()
  readonly #deployTokenPool = new DeployTokenPool()
  readonly #initChainConfigV2 = new InitChainConfigV2()
  readonly #initFastFinalityRateLimit = new InitFastFinalityRateLimit()
  readonly #registerAdmin = new RegisterAdmin()
  readonly #setPool = new SetPool()
  readonly #setPoolInterfaceImplementation = new SetPoolInterfaceImplementation()
  readonly #setTokenAuthority = new SetTokenAuthority()
  readonly #upgradeTokenAdminRegistry = new UpgradeTokenAdminRegistry()

  /** Validates every param, including each remote chain's lane configs, before any RPC. */
  protected override prepare(params: GenerateOnboardTokenParams): ParsedOnboardTokenParams {
    return parseOnboardTokenParams(params)
  }

  /** Parses the params, and checks the pool program is a CCIP 2.0 program of `poolType`. */
  async #prepareOnChain(
    chain: SolanaChain,
    params: GenerateOnboardTokenParams,
  ): Promise<ParsedOnboardTokenParams> {
    const parsed = this.prepare(params)
    await validatePoolProgramType(NAME, chain, parsed.poolProgram, parsed.poolType)
    await validatePoolProgramAtLeast2(NAME, chain, parsed.poolProgram)
    return parsed
  }

  /** Reads the on-chain state and plans the remaining steps from it. */
  async #readPlan(chain: SolanaChain, params: ParsedOnboardTokenParams) {
    const state = await readTokenOnboardingState(chain, params)
    const steps = planTokenOnboarding(params, state)
    chain.logger.debug(
      `${NAME}: token = ${params.tokenMint.toBase58()}, steps = ${steps.map(({ name }) => name).join(', ') || 'none'}`,
    )
    const addresses = {
      poolAddress: deriveTokenPoolConfigPda(params.poolProgram, params.tokenMint).toBase58(),
      poolSignerAddress: deriveTokenPoolSignerPda(params.poolProgram, params.tokenMint).toBase58(),
      ...(state.mintMultisig && { mintMultisigAddress: state.mintMultisig.address.toBase58() }),
    }
    return { state, steps, addresses }
  }

  /** Binds the step's operations to its params, for generation or execution. */
  #run(
    chain: SolanaChain,
    params: ParsedOnboardTokenParams,
    state: TokenOnboardingState,
    step: TokenOnboardingStep,
  ): StepRun {
    const tokenAddress = params.tokenMint.toBase58()
    const poolProgramAddress = params.poolProgram.toBase58()
    const authority = params.authority.toBase58()
    const router = state.router.toBase58()
    const remotes = params.remoteChains.filter(({ remoteChainSelector }) =>
      step.remoteChainSelectors?.includes(remoteChainSelector),
    )
    // operations landing one transaction per remote chain
    const perLane = <P extends object>(
      operation: SingleTxOperation<P>,
      laneParams: P[],
    ): StepRun => {
      const lanes = laneParams.map((lane) => bindOperation(chain, operation, lane))
      return {
        generate: async (payer) => {
          const transactions: UnsignedSolanaTx[] = []
          for (const lane of lanes) transactions.push(...(await lane.generate(payer)).transactions)
          return { transactions }
        },
        execute: async (wallet) => {
          const hashes: string[] = []
          for (const lane of lanes) hashes.push(...(await lane.execute(wallet)))
          return hashes
        },
      }
    }

    switch (step.name) {
      case 'deployTokenPool':
        return bindOperation(chain, this.#deployTokenPool, {
          tokenAddress,
          poolType: params.poolType,
          poolProgramAddress,
          createPoolSignerATA: true,
          ...(params.allowlist && { allowlist: params.allowlist }),
          authority,
        })
      case 'registerAdmin':
        return bindOperation(chain, this.#registerAdmin, {
          tokenAddress,
          address: router,
          administrator: authority,
          authority,
        })
      // permissionless: the payer alone pays for the account's growth
      case 'upgradeTokenAdminRegistry':
        return bindOperation(chain, this.#upgradeTokenAdminRegistry, {
          tokenAddress,
          address: router,
        })
      case 'acceptAdmin':
        return bindOperation(chain, this.#acceptAdmin, { tokenAddress, address: router, authority })
      case 'createLookupTable':
        return {
          // its own payer, so the recent slot it derives the table from is landed in time
          generate: async () => {
            const payer = params.lookupTablePayer!.toBase58()
            const created = await this.#createLookupTable.generate(chain, {
              mode: 'createEmpty',
              authority,
              payer,
            })
            return {
              transactions: [created],
              payer,
              lookupTableAddress: created.lookupTableAddress,
            }
          },
          execute: () => {
            throw lookupTablePayerExecuteError()
          },
        }
      case 'setPool':
        return this.#setPoolRun(chain, params, state, { tokenAddress, poolProgramAddress, router })
      case 'applyChainUpdates': {
        const batch = {
          tokenAddress,
          poolProgramAddress,
          chainsToAdd: remotes.map((remote) => ({
            remoteChainSelector: remote.remoteChainSelector,
            remoteTokenAddress: remote.remoteTokenAddress,
            remotePoolAddresses: remote.remotePoolAddresses,
            remoteTokenDecimals: remote.remoteTokenDecimals,
            inboundRateLimiterConfig: remote.inboundRateLimiterConfig,
            outboundRateLimiterConfig: remote.outboundRateLimiterConfig,
          })),
          remoteChainSelectorsToRemove: [],
          authority,
        }
        return {
          generate: async (payer) => ({
            transactions: await this.#applyChainUpdates.generateBatch(chain, { ...batch, payer }),
          }),
          execute: async (wallet) =>
            (await this.#applyChainUpdates.executeBatch(chain, { ...batch, ...wallet })).hashes,
        }
      }
      case 'initChainConfigV2':
        return perLane(
          this.#initChainConfigV2,
          remotes.map((remote) => ({
            tokenAddress,
            poolProgramAddress,
            remoteChainSelector: remote.remoteChainSelector,
            ...(remote.allowedFinality && { allowedFinality: remote.allowedFinality }),
            ...(remote.tokenTransferFeeConfig && {
              tokenTransferFeeConfig: remote.tokenTransferFeeConfig,
            }),
            ...(remote.ccvConfig && { ccvConfig: remote.ccvConfig }),
            authority,
          })),
        )
      case 'initFastFinalityRateLimit':
        return perLane(
          this.#initFastFinalityRateLimit,
          remotes.map((remote) => ({
            tokenAddress,
            poolProgramAddress,
            remoteChainSelector: remote.remoteChainSelector,
            inbound: remote.fastFinalityRateLimits!.inbound,
            outbound: remote.fastFinalityRateLimits!.outbound,
            authority,
          })),
        )
      case 'setPoolInterfaceImplementation':
        return bindOperation(chain, this.#setPoolInterfaceImplementation, {
          tokenAddress,
          address: router,
          interfaceVersion: 2,
          accountResolution: params.accountResolution ?? 'Standard',
          authority,
        })
      // the pool signer, and the authority as the mint authority, sign it 1-of-2
      case 'createTokenMultisig':
        return bindOperation(chain, this.#createTokenMultisig, {
          tokenAddress,
          poolType: 'burn-mint',
          poolProgramAddress,
          threshold: 1,
          seed: MINT_MULTISIG_SEED,
        })
      case 'setTokenAuthority':
        return bindOperation(chain, this.#setTokenAuthority, {
          tokenAddress,
          // every burn-mint state read derives the multisig, and only burn-mint plans this step
          newAuthority: state.mintMultisig!.address.toBase58(),
          authorityTypes: ['mint'],
          authority,
        })
    }
  }

  /**
   * Binds `setPool`: creates and fills the pool's lookup table, or fills or takes the given one,
   * then sets it as the registry's pool.
   */
  #setPoolRun(
    chain: SolanaChain,
    params: ParsedOnboardTokenParams,
    state: TokenOnboardingState,
    ids: { tokenAddress: string; poolProgramAddress: string; router: string },
  ): StepRun {
    const { tokenAddress, poolProgramAddress, router } = ids
    const authority = params.authority.toBase58()
    const given = params.poolLookupTable?.toBase58()
    const fillsGiven = state.poolLookupTable?.found && state.poolLookupTable.contents === 'empty'
    const createFilled = { tokenAddress, poolProgramAddress, authority }
    const fill = (lookupTableAddress: string) => ({
      lookupTableAddress,
      tokenAddress,
      poolProgramAddress,
      authority,
    })
    const setPool = (poolLookupTableAddress: string) => ({
      tokenAddress,
      address: router,
      poolLookupTableAddress,
      authority,
    })
    // the plan only sets the pool of a registry that names another one, or none
    const replaced = state.registry?.tokenPool
    const warnReplacedPool = () => {
      if (replaced)
        chain.logger.warn(
          `${NAME}: setPool replaces pool ${replaced.toBase58()}, which the token's registry points at`,
        )
    }

    return {
      generate: async (payer) => {
        warnReplacedPool()
        const transactions: UnsignedSolanaTx[] = []
        let lookupTable = given
        let lookupTableAddress: string | undefined
        if (!lookupTable) {
          const created = await this.#createLookupTable.generate(chain, { ...createFilled, payer })
          transactions.push(created)
          lookupTable = lookupTableAddress = created.lookupTableAddress
        } else if (fillsGiven) {
          transactions.push(
            await this.#appendToLookupTable.generate(chain, { ...fill(lookupTable), payer }),
          )
        }
        transactions.push(await this.#setPool.generate(chain, { ...setPool(lookupTable), payer }))
        return { transactions, ...(lookupTableAddress && { lookupTableAddress }) }
      },
      execute: async (wallet) => {
        warnReplacedPool()
        const hashes: string[] = []
        let lookupTable = given
        let created = false
        if (!lookupTable) {
          const table = await this.#createLookupTable.execute(chain, { ...createFilled, ...wallet })
          hashes.push(...table.hashes)
          lookupTable = table.lookupTableAddress
          created = true
        } else if (fillsGiven) {
          const appended = await this.#appendToLookupTable.execute(chain, {
            ...fill(lookupTable),
            ...wallet,
          })
          hashes.push(...appended.hashes)
        }
        try {
          hashes.push(
            (await this.#setPool.execute(chain, { ...setPool(lookupTable), ...wallet })).hash,
          )
        } catch (error) {
          // the created table would be orphaned; resuming with it as poolLookupTableAddress reuses it
          throw created ? withContext(error, { lookupTableAddress: lookupTable }) : error
        }
        return hashes
      },
    }
  }

  /** Plans the remaining onboarding steps without building any transaction. */
  async plan(chain: SolanaChain, params: GenerateOnboardTokenParams): Promise<TokenOnboardingPlan> {
    const { steps, addresses } = await this.#readPlan(
      chain,
      await this.#prepareOnChain(chain, params),
    )
    return { steps, ...addresses }
  }

  /** Builds the next step's unsigned transactions, with `payer` paying and `authority` signing. */
  async generate(
    chain: SolanaChain,
    params: GenerateOnboardTokenParams,
  ): Promise<GenerateOnboardTokenResult> {
    const parsed = await this.#prepareOnChain(chain, params)
    const { state, steps, addresses } = await this.#readPlan(chain, parsed)
    const [step, ...remainingSteps] = steps
    const payer = parsed.payer.toBase58()
    if (!step) return { steps: [], ...addresses, transactions: [], payer }

    const generated = await this.#run(chain, parsed, state, step).generate(payer)
    return { step, payer, steps: remainingSteps, ...addresses, ...generated }
  }

  /**
   * Runs every remaining step with the wallet as payer and authority, replanning from on-chain
   * state after each one.
   * @throws {@link CCTTxFailedError} if a step lands but the state it creates does not appear.
   * Once the steps start, every error is a {@link CCIPError} carrying the steps already executed
   * in `context.executedSteps`, and a failing `setPool` the lookup table it created in
   * `context.lookupTableAddress`.
   */
  async execute(
    chain: SolanaChain,
    params: ExecuteOnboardTokenParams,
  ): Promise<ExecuteOnboardTokenResult> {
    const { wallet, computeUnits, ...rest } = params
    if (!isWallet(wallet)) throw new CCIPWalletInvalidError(wallet)
    if ((rest as { lookupTablePayer?: unknown }).lookupTablePayer !== undefined)
      throw lookupTablePayerExecuteError()
    const stepWallet = { wallet, ...(computeUnits !== undefined && { computeUnits }) }
    const parsed = await this.#prepareOnChain(chain, {
      ...rest,
      payer: wallet.publicKey.toBase58(),
    })

    const executed: ExecutedTokenOnboardingStep[] = []
    try {
      for (;;) {
        const last = executed.at(-1)
        let planned = await this.#readPlan(chain, parsed)
        // an RPC node behind the one that confirmed the last step may not show its state yet
        for (
          let attempt = 1;
          attempt < STATE_READ_ATTEMPTS && !advancesPast(planned.steps[0], last);
          attempt++
        ) {
          await sleep(STATE_READ_INTERVAL_MS)
          planned = await this.#readPlan(chain, parsed)
        }
        const { state, steps, addresses } = planned
        const [step] = steps
        if (!step) return { steps: executed, ...addresses }
        if (!advancesPast(step, last))
          throw new CCTTxFailedError(
            NAME,
            `${last!.name} landed, but the state it creates does not appear on-chain`,
          )

        const hashes = await this.#run(chain, parsed, state, step).execute(stepWallet)
        executed.push({ ...step, hashes })
      }
    } catch (error) {
      throw withContext(error, { executedSteps: executed })
    }
  }
}
