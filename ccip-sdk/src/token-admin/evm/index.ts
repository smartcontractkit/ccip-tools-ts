/**
 * EVM token admin — deploy CrossChainToken tokens and CCIP token pools on EVM chains.
 *
 * @example Using EVMTokenAdmin with a wallet (signed deploy)
 * ```typescript
 * import { EVMTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/evm/index.ts'
 *
 * const admin = await EVMTokenAdmin.fromUrl('https://rpc.sepolia.org')
 * const { tokenAddress, txHash } = await admin.deployToken(wallet, {
 *   name: 'My Token', symbol: 'MTK', decimals: 18,
 * })
 * ```
 *
 * @packageDocumentation
 */

import {
  type JsonRpcApiProvider,
  type Signer,
  type TransactionRequest,
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  WebSocketProvider,
  ZeroAddress,
  concat,
  dataLength,
  hexlify,
  id,
  randomBytes,
  toBeHex,
} from 'ethers'

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
  CCIPDeleteChainConfigFailedError,
  CCIPDeleteChainConfigParamsInvalidError,
  CCIPGrantMintBurnAccessFailedError,
  CCIPGrantMintBurnAccessParamsInvalidError,
  CCIPPoolDeployFailedError,
  CCIPPoolDeployParamsInvalidError,
  CCIPProposeAdminRoleFailedError,
  CCIPProposeAdminRoleParamsInvalidError,
  CCIPProvideLiquidityFailedError,
  CCIPProvideLiquidityParamsInvalidError,
  CCIPRemoveRemotePoolAddressesFailedError,
  CCIPRemoveRemotePoolAddressesParamsInvalidError,
  CCIPRevokeMintBurnAccessFailedError,
  CCIPRevokeMintBurnAccessParamsInvalidError,
  CCIPSetAllowedFinalityConfigFailedError,
  CCIPSetAllowedFinalityConfigParamsInvalidError,
  CCIPSetFeeAdminFailedError,
  CCIPSetFeeAdminParamsInvalidError,
  CCIPSetPoolFailedError,
  CCIPSetPoolParamsInvalidError,
  CCIPSetRateLimitAdminFailedError,
  CCIPSetRateLimitAdminParamsInvalidError,
  CCIPSetRateLimiterConfigFailedError,
  CCIPSetRateLimiterConfigParamsInvalidError,
  CCIPSetTokenTransferFeeConfigFailedError,
  CCIPSetTokenTransferFeeConfigParamsInvalidError,
  CCIPTokenDeployFailedError,
  CCIPTokenDeployParamsInvalidError,
  CCIPTransferAdminRoleFailedError,
  CCIPTransferAdminRoleParamsInvalidError,
  CCIPTransferOwnershipFailedError,
  CCIPTransferOwnershipParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import ERC20LockBoxABI from '../../evm/abi/ERC20LockBox.ts'
import TokenPool_1_5_ABI from '../../evm/abi/LockReleaseTokenPool_1_5.ts'
import TokenPool_1_6_ABI from '../../evm/abi/LockReleaseTokenPool_1_6_1.ts'
import RegistryModuleOwnerCustomABI from '../../evm/abi/RegistryModuleOwnerCustom_1_6.ts'
import RouterABI from '../../evm/abi/Router.ts'
import TokenAdminRegistryABI from '../../evm/abi/TokenAdminRegistry_1_5.ts'
import TokenPool_2_0_ABI from '../../evm/abi/TokenPool_2_0.ts'
import { EVMChain, isSigner, submitTransaction } from '../../evm/index.ts'
import { getEvmLogs } from '../../evm/logs.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import { encodeFinality } from '../../extra-args.ts'
import { type NetworkInfo, ChainFamily, networkInfo } from '../../networks.ts'
import { type ChainLog, CCIPVersion } from '../../types.ts'
import {
  encodeRemoteAddress,
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
  DeleteChainConfigParams,
  DeleteChainConfigResult,
  DeployCrossChainPoolTokenResult,
  DeployPoolResult,
  DeployTokenResult,
  DeployVerification,
  DeployVerificationTarget,
  EVMFactoryDeployPoolParams,
  EVMFactoryDeployTokenAndPoolParams,
  FactoryDeployPoolResult,
  FactoryDeployTokenAndPoolResult,
  EVMDeployCrossChainPoolTokenParams,
  EVMDeployPoolParams,
  EVMDeployTokenParams,
  EVMMintBurnRolesResult,
  EVMProposeAdminRoleParams,
  EVMRegistrationMethod,
  GrantMintBurnAccessParams,
  GrantMintBurnAccessResult,
  OwnershipResult,
  ProposeAdminRoleResult,
  ProvideLiquidityParams,
  ProvideLiquidityResult,
  RemoveRemotePoolAddressesParams,
  RemoveRemotePoolAddressesResult,
  RevokeMintBurnAccessParams,
  RevokeMintBurnAccessResult,
  SetAllowedFinalityConfigParams,
  SetAllowedFinalityConfigResult,
  SetChainRateLimiterConfigParams,
  SetChainRateLimiterConfigResult,
  SetFeeAdminParams,
  SetFeeAdminResult,
  SetPoolParams,
  SetPoolResult,
  SetRateLimitAdminParams,
  SetRateLimitAdminResult,
  SetTokenTransferFeeConfigParams,
  SetTokenTransferFeeConfigResult,
  TransferAdminRoleParams,
  TransferAdminRoleResult,
  TransferOwnershipParams,
} from '../types.ts'
import CrossChainTokenABI from './abi/CrossChainToken.ts'

// OZ AccessControl role hashes — keccak256('MINTER_ROLE') / keccak256('BURNER_ROLE')
const MINTER_ROLE = id('MINTER_ROLE')
const BURNER_ROLE = id('BURNER_ROLE')

/** Canonical CCT v2.0 constructor tuple for BaseERC20/CrossChainToken: `ConstructorParams`. */
const CROSS_CHAIN_TOKEN_PARAMS_TUPLE =
  'tuple(string name, string symbol, uint256 maxSupply, uint256 preMint, address preMintRecipient, uint8 decimals, address ccipAdmin)'

/**
 * Minimal human-readable ABI for `TokenPoolFactory 2.0.0` (chainlink-ccip
 * chains/evm/contracts/TokenPoolFactory.sol). `RemoteTokenPoolInfo` is included so the empty
 * remote-pools array type-checks; we only ever pass `[]` for a same-chain deploy.
 */
const TOKEN_POOL_FACTORY_ABI = (() => {
  const remoteTokenPoolInfo =
    'tuple(uint64 remoteChainSelector, bytes remotePoolAddress, bytes remotePoolInitCode, tuple(address remotePoolFactory, address remoteRouter, address remoteRMNProxy, address remoteLockBox, uint8 remoteTokenDecimals) remoteChainConfig, uint8 poolType, bytes remoteTokenAddress, bytes remoteTokenInitCode, tuple(bool isEnabled, uint128 capacity, uint128 rate) rateLimiterConfig)[] remoteTokenPools'
  return [
    'function getStaticConfig() view returns (address rmnProxy, address tokenAdminRegistry, address registryModuleOwnerCustom, address ccipRouter)',
    `function deployTokenAndTokenPool(${remoteTokenPoolInfo}, uint8 localTokenDecimals, uint8 localPoolType, bytes tokenInitCode, bytes tokenPoolInitCode, address lockBox, bytes32 salt, address futureOwner) returns (address token, address pool)`,
    `function deployTokenPoolWithExistingToken(address token, uint8 localTokenDecimals, uint8 localPoolType, ${remoteTokenPoolInfo}, bytes tokenPoolInitCode, address lockBox, bytes32 salt, address futureOwner) returns (address pool)`,
  ]
})()

/** TokenPoolFactory `PoolType` enum: BURN_MINT = 0, LOCK_RELEASE = 1. */
const FACTORY_POOL_TYPE = { 'burn-mint': 0, 'lock-release': 1 } as const

/** Maps registration method to RegistryModuleOwnerCustom function name. */
const REGISTRATION_FUNCTION_NAMES: Record<EVMRegistrationMethod, string> = {
  owner: 'registerAdminViaOwner',
  getCCIPAdmin: 'registerAdminViaGetCCIPAdmin',
  accessControlDefaultAdmin: 'registerAccessControlDefaultAdmin',
}

/**
 * Validates deploy parameters for EVM CrossChainToken.
 * @throws {@link CCIPTokenDeployParamsInvalidError} on invalid params
 */
function validateParams(params: EVMDeployTokenParams): void {
  if (!params.name || params.name.trim().length === 0) {
    throw new CCIPTokenDeployParamsInvalidError('name', 'must be non-empty')
  }
  if (!params.symbol || params.symbol.trim().length === 0) {
    throw new CCIPTokenDeployParamsInvalidError('symbol', 'must be non-empty')
  }
  if (params.maxSupply !== undefined && params.maxSupply < 0n) {
    throw new CCIPTokenDeployParamsInvalidError('maxSupply', 'must be non-negative')
  }
  if (params.initialSupply !== undefined && params.initialSupply < 0n) {
    throw new CCIPTokenDeployParamsInvalidError('initialSupply', 'must be non-negative')
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
 * Validates deploy parameters for EVM token pool.
 * @throws {@link CCIPPoolDeployParamsInvalidError} on invalid params
 */
function validatePoolParams(params: EVMDeployPoolParams): void {
  const poolType: string = params.poolType
  if (poolType !== 'burn-mint' && poolType !== 'lock-release') {
    throw new CCIPPoolDeployParamsInvalidError('poolType', "must be 'burn-mint' or 'lock-release'")
  }
  if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
    throw new CCIPPoolDeployParamsInvalidError('tokenAddress', 'must be non-empty')
  }
  if (!params.routerAddress || params.routerAddress.trim().length === 0) {
    throw new CCIPPoolDeployParamsInvalidError('routerAddress', 'must be non-empty')
  }
}

/**
 * Validates proposeAdminRole parameters for EVM.
 * @throws {@link CCIPProposeAdminRoleParamsInvalidError} on invalid params
 */
function validateProposeAdminRoleParams(params: EVMProposeAdminRoleParams): void {
  if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
    throw new CCIPProposeAdminRoleParamsInvalidError('tokenAddress', 'must be non-empty')
  }
  if (!params.registryModuleAddress || params.registryModuleAddress.trim().length === 0) {
    throw new CCIPProposeAdminRoleParamsInvalidError('registryModuleAddress', 'must be non-empty')
  }
}

/**
 * Validates acceptAdminRole parameters for EVM.
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

/**
 * Validates transferAdminRole parameters.
 * @throws {@link CCIPTransferAdminRoleParamsInvalidError} on invalid params
 */
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

/**
 * Validates setPool parameters for EVM.
 * @throws {@link CCIPSetPoolParamsInvalidError} on invalid params
 */
function validateSetPoolParams(params: SetPoolParams): void {
  if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
    throw new CCIPSetPoolParamsInvalidError('tokenAddress', 'must be non-empty')
  }
  if (!params.poolAddress || params.poolAddress.trim().length === 0) {
    throw new CCIPSetPoolParamsInvalidError('poolAddress', 'must be non-empty')
  }
  if (!params.routerAddress || params.routerAddress.trim().length === 0) {
    throw new CCIPSetPoolParamsInvalidError('routerAddress', 'must be non-empty')
  }
}

/** uint32 / uint16 upper bounds for token-transfer fee config field validation. */
const UINT32_MAX = 4_294_967_295
const UINT16_MAX = 65_535

/**
 * Validates setTokenTransferFeeConfig parameters (EVM v2.0+ token transfer fee config).
 * @throws {@link CCIPSetTokenTransferFeeConfigParamsInvalidError} on invalid params
 */
function validateSetTokenTransferFeeConfigParams(params: SetTokenTransferFeeConfigParams): void {
  if (!params.poolAddress || params.poolAddress.trim().length === 0) {
    throw new CCIPSetTokenTransferFeeConfigParamsInvalidError('poolAddress', 'must be non-empty')
  }
  const disableCount = params.disable?.length ?? 0
  if (params.updates.length === 0 && disableCount === 0) {
    throw new CCIPSetTokenTransferFeeConfigParamsInvalidError(
      'updates',
      'provide at least one update or one disable selector',
    )
  }
  const checkUint = (value: number, max: number, path: string) => {
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new CCIPSetTokenTransferFeeConfigParamsInvalidError(
        path,
        `must be an integer between 0 and ${max}`,
      )
    }
  }
  for (let i = 0; i < params.updates.length; i++) {
    const { remoteChainSelector, config } = params.updates[i]!
    if (remoteChainSelector === 0n) {
      throw new CCIPSetTokenTransferFeeConfigParamsInvalidError(
        `updates[${i}].remoteChainSelector`,
        'must be non-zero',
      )
    }
    checkUint(config.destGasOverhead, UINT32_MAX, `updates[${i}].config.destGasOverhead`)
    checkUint(config.destBytesOverhead, UINT32_MAX, `updates[${i}].config.destBytesOverhead`)
    checkUint(config.finalityFeeUSDCents, UINT32_MAX, `updates[${i}].config.finalityFeeUSDCents`)
    checkUint(
      config.fastFinalityFeeUSDCents,
      UINT32_MAX,
      `updates[${i}].config.fastFinalityFeeUSDCents`,
    )
    checkUint(
      config.finalityTransferFeeBps,
      UINT16_MAX,
      `updates[${i}].config.finalityTransferFeeBps`,
    )
    checkUint(
      config.fastFinalityTransferFeeBps,
      UINT16_MAX,
      `updates[${i}].config.fastFinalityTransferFeeBps`,
    )
  }
}

/**
 * EVM token admin for deploying CCIP-compatible CrossChainToken tokens.
 *
 * Extends {@link EVMChain} — inherits provider, logger, and chain discovery
 * methods like `getTokenAdminRegistryFor`.
 *
 * @example From URL
 * ```typescript
 * const admin = await EVMTokenAdmin.fromUrl('https://rpc.sepolia.org')
 * ```
 *
 * @example Direct construction
 * ```typescript
 * const admin = new EVMTokenAdmin(provider, network, { logger })
 * ```
 */
export class EVMTokenAdmin extends EVMChain {
  /** Creates a new EVMTokenAdmin instance. */
  constructor(provider: JsonRpcApiProvider, network: NetworkInfo, ctx?: ChainContext) {
    super(provider, network, ctx)
  }

  /**
   * Creates an EVMTokenAdmin from a URL.
   *
   * Connects to the RPC endpoint, detects the network, and returns
   * a fully initialized EVMTokenAdmin instance.
   *
   * @param url - RPC endpoint URL (http/https/ws/wss)
   * @param ctx - Optional context with logger and API client configuration
   * @returns A new EVMTokenAdmin instance
   *
   * @example
   * ```typescript
   * const admin = await EVMTokenAdmin.fromUrl('https://rpc.sepolia.org')
   * ```
   */
  static override async fromUrl(url: string, ctx?: ChainContext): Promise<EVMTokenAdmin> {
    let provider: JsonRpcApiProvider
    if (url.startsWith('ws')) {
      const ws = new WebSocketProvider(url)
      await new Promise<void>((resolve, reject) => {
        ws.websocket.onerror = reject
        ws._waitUntilReady()
          .then(() => resolve())
          .catch(reject)
      })
      provider = ws
    } else {
      provider = new JsonRpcProvider(url)
    }

    try {
      const network = networkInfo(Number((await provider.getNetwork()).chainId))
      return new EVMTokenAdmin(provider, network, ctx)
    } catch (err) {
      provider.destroy()
      throw err
    }
  }

  /**
   * Detects the token pool version and returns the matching ABI.
   *
   * @param poolAddress - Pool contract address
   * @returns Pool version string and the appropriate ABI for that version
   */
  private async getPoolVersionAndABI(poolAddress: string) {
    const [, version] = await this.typeAndVersion(poolAddress)
    if (version <= CCIPVersion.V1_5) {
      return { version, abi: TokenPool_1_5_ABI }
    }
    if (version < CCIPVersion.V2_0) {
      return { version, abi: TokenPool_1_6_ABI }
    }
    return { version, abi: TokenPool_2_0_ABI }
  }

  /**
   * Builds an unsigned deploy transaction for CrossChainToken.
   *
   * The bytecode is lazy-loaded — only fetched when this method is called.
   * This ensures zero cost for consumers who never call deployToken.
   *
   * @param params - Token deployment parameters
   * @returns Unsigned EVM transaction set (single deploy tx with `to: null`)
   * @throws {@link CCIPTokenDeployParamsInvalidError} if params are invalid
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedDeployToken({
   *   name: 'My Token', symbol: 'MTK', decimals: 18,
   * })
   * // unsigned.transactions[0].to === null (contract creation)
   * ```
   */
  async generateUnsignedDeployToken(params: EVMDeployTokenParams): Promise<UnsignedEVMTx> {
    validateParams(params)

    if (!params.ownerAddress || params.ownerAddress.trim().length === 0) {
      throw new CCIPTokenDeployParamsInvalidError(
        'ownerAddress',
        'required (use signed deployToken to auto-fill from the signer)',
      )
    }

    const owner = params.ownerAddress
    const maxSupply = params.maxSupply ?? 0n
    const preMint = params.initialSupply ?? 0n
    const ccipAdmin = params.ccipAdmin ?? owner
    const burnMintRoleAdmin = params.burnMintRoleAdmin ?? owner
    // CrossChainToken reverts unless preMintRecipient is zero exactly when preMint is zero.
    const preMintRecipient = preMint > 0n ? (params.preMintRecipient ?? owner) : ZeroAddress

    // CrossChainToken constructor: (ConstructorParams args, address burnMintRoleAdmin, address owner)
    const { CROSS_CHAIN_TOKEN_BYTECODE } = await import('./bytecodes/CrossChainToken.ts')
    const encodedArgs = AbiCoder.defaultAbiCoder().encode(
      [CROSS_CHAIN_TOKEN_PARAMS_TUPLE, 'address', 'address'],
      [
        {
          name: params.name,
          symbol: params.symbol,
          maxSupply,
          preMint,
          preMintRecipient,
          decimals: params.decimals,
          ccipAdmin,
        },
        burnMintRoleAdmin,
        owner,
      ],
    )
    const deployData = concat([CROSS_CHAIN_TOKEN_BYTECODE, encodedArgs])

    const tx: Pick<TransactionRequest, 'from' | 'to' | 'data' | 'gasLimit'> = {
      to: null, // contract creation
      data: deployData,
    }

    this.logger.debug('generateUnsignedDeployToken: bytecode size =', dataLength(deployData))

    return {
      family: ChainFamily.EVM,
      transactions: [tx],
    }
  }

  /**
   * Deploys a CrossChainToken token, signing and submitting with the provided wallet.
   *
   * @param wallet - Ethers Signer with signing capability
   * @param params - Token deployment parameters
   * @returns Unified deploy result with `tokenAddress` and `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPTokenDeployParamsInvalidError} if params are invalid
   * @throws {@link CCIPTokenDeployFailedError} if the deploy transaction fails
   *
   * @example
   * ```typescript
   * const { tokenAddress, txHash } = await admin.deployToken(wallet, {
   *   name: 'My Token',
   *   symbol: 'MTK',
   *   decimals: 18,
   *   maxSupply: 1_000_000n * 10n ** 18n,
   *   initialSupply: 10_000n * 10n ** 18n,
   * })
   * console.log(`Deployed at ${tokenAddress}, tx: ${txHash}`)
   * ```
   */
  async deployToken(wallet: unknown, params: EVMDeployTokenParams): Promise<DeployTokenResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    // Auto-fill owner/admin addresses from the signer when not provided.
    const effectiveParams = { ...params }
    if (!effectiveParams.ownerAddress) {
      effectiveParams.ownerAddress = await wallet.getAddress()
    }

    const unsigned = await this.generateUnsignedDeployToken(effectiveParams)
    let deployTx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('deployToken: deploying CrossChainToken ...')

    try {
      deployTx = await wallet.populateTransaction(deployTx)
      deployTx.from = undefined // some signers don't like receiving pre-populated `from`
      const response = await submitTransaction(wallet, deployTx, this.provider)

      this.logger.debug('deployToken: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPTokenDeployFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPTokenDeployFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      const tokenAddress = receipt.contractAddress
      if (!tokenAddress) {
        throw new CCIPTokenDeployFailedError('no contract address in receipt', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('deployToken: deployed at', tokenAddress, 'tx =', response.hash)

      const { CROSS_CHAIN_TOKEN_BYTECODE } = await import('./bytecodes/CrossChainToken.ts')
      return {
        tokenAddress,
        txHash: response.hash,
        verification: this.buildDeployVerification(
          'CrossChainToken',
          unsigned.transactions[0]!.data as string,
          CROSS_CHAIN_TOKEN_BYTECODE,
        ),
      }
    } catch (error) {
      if (error instanceof CCIPTokenDeployFailedError) throw error
      throw new CCIPTokenDeployFailedError(error instanceof Error ? error.message : String(error), {
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  // ── Pool Deployment ──────────────────────────────────────────────────────

  /**
   * Builds an unsigned deploy transaction for a CCIP token pool.
   *
   * Both BurnMintTokenPool and LockReleaseTokenPool (v1.6.1) share an
   * identical constructor: `(token, localTokenDecimals, allowlist[], rmnProxy, router)`.
   * `rmnProxy` is derived automatically via `Router.getArmProxy()`.
   *
   * Bytecodes are lazy-loaded based on `poolType`.
   *
   * @param params - Pool deployment parameters
   * @returns Unsigned EVM transaction set (single deploy tx with `to: null`)
   * @throws {@link CCIPPoolDeployParamsInvalidError} if params are invalid
   * @throws {@link CCIPPoolDeployFailedError} if rmnProxy derivation fails
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedDeployPool({
   *   poolType: 'burn-mint',
   *   tokenAddress: '0xa42BA...',
   *   localTokenDecimals: 18,
   *   routerAddress: '0x0BF3...',
   * })
   * ```
   */
  async generateUnsignedDeployPool(params: EVMDeployPoolParams): Promise<UnsignedEVMTx> {
    validatePoolParams(params)

    const rmnProxy = await this.deriveRmnProxy(params.routerAddress)
    this.logger.debug('generateUnsignedDeployPool: rmnProxy =', rmnProxy)

    const advancedPoolHooks = params.advancedPoolHooks ?? ZeroAddress

    // v2.0 pool constructors:
    //   BurnMintTokenPool:    (token, localTokenDecimals, advancedPoolHooks, rmnProxy, router)
    //   LockReleaseTokenPool: (token, localTokenDecimals, advancedPoolHooks, rmnProxy, router, lockBox)
    let deployData: string
    if (params.poolType === 'burn-mint') {
      const { BURN_MINT_TOKEN_POOL_BYTECODE } = await import('./bytecodes/BurnMintTokenPool.ts')
      const encodedArgs = AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint8', 'address', 'address', 'address'],
        [
          params.tokenAddress,
          params.localTokenDecimals,
          advancedPoolHooks,
          rmnProxy,
          params.routerAddress,
        ],
      )
      deployData = concat([BURN_MINT_TOKEN_POOL_BYTECODE, encodedArgs])
    } else {
      // lock-release additionally needs the ERC20LockBox address. The signed `deployPool`
      // auto-deploys one; the unsigned path cannot predict its address, so it must be supplied.
      if (!params.lockBoxAddress || params.lockBoxAddress.trim().length === 0) {
        throw new CCIPPoolDeployParamsInvalidError(
          'lockBoxAddress',
          'required to build an unsigned lock-release pool deploy (use signed deployPool to auto-deploy an ERC20LockBox)',
        )
      }
      const { LOCK_RELEASE_TOKEN_POOL_BYTECODE } =
        await import('./bytecodes/LockReleaseTokenPool.ts')
      const encodedArgs = AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint8', 'address', 'address', 'address', 'address'],
        [
          params.tokenAddress,
          params.localTokenDecimals,
          advancedPoolHooks,
          rmnProxy,
          params.routerAddress,
          params.lockBoxAddress,
        ],
      )
      deployData = concat([LOCK_RELEASE_TOKEN_POOL_BYTECODE, encodedArgs])
    }

    const tx: Pick<TransactionRequest, 'from' | 'to' | 'data' | 'gasLimit'> = {
      to: null,
      data: deployData,
    }

    this.logger.debug(
      'generateUnsignedDeployPool:',
      params.poolType,
      'bytecode size =',
      dataLength(deployData),
    )

    return {
      family: ChainFamily.EVM,
      transactions: [tx],
    }
  }

  /**
   * Deploys a CCIP token pool, signing and submitting with the provided wallet.
   *
   * @param wallet - Ethers Signer with signing capability
   * @param params - Pool deployment parameters
   * @returns Unified deploy result with `poolAddress` and `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPPoolDeployParamsInvalidError} if params are invalid
   * @throws {@link CCIPPoolDeployFailedError} if the deploy transaction fails
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
  async deployPool(wallet: unknown, params: EVMDeployPoolParams): Promise<DeployPoolResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    try {
      // lock-release v2.0 requires an ERC20LockBox bound to the token — auto-deploy one.
      let lockBoxAddress = params.lockBoxAddress
      let autoDeployedLockBox = false
      let lockBoxVerification: DeployVerification | undefined
      if (params.poolType === 'lock-release' && !lockBoxAddress) {
        this.logger.debug('deployPool: deploying ERC20LockBox for', params.tokenAddress, '...')
        const { ERC20_LOCK_BOX_BYTECODE } = await import('./bytecodes/ERC20LockBox.ts')
        // ERC20LockBox constructor: (address token)
        const encodedArgs = AbiCoder.defaultAbiCoder().encode(['address'], [params.tokenAddress])
        const lockBoxData = concat([ERC20_LOCK_BOX_BYTECODE, encodedArgs])
        const lockBox = await this.deployBytecode(wallet, lockBoxData)
        lockBoxAddress = lockBox.address
        autoDeployedLockBox = true
        lockBoxVerification = this.buildDeployVerification(
          'ERC20LockBox',
          lockBoxData,
          ERC20_LOCK_BOX_BYTECODE,
        )
        this.logger.info('deployPool: ERC20LockBox deployed at', lockBoxAddress)
      }

      const unsigned = await this.generateUnsignedDeployPool({ ...params, lockBoxAddress })

      this.logger.debug('deployPool: deploying', params.poolType, 'pool...')
      const { address: poolAddress, txHash } = await this.deployBytecode(
        wallet,
        unsigned.transactions[0]!.data!,
      )
      this.logger.info('deployPool: deployed at', poolAddress, 'tx =', txHash)

      const poolContract =
        params.poolType === 'burn-mint' ? 'BurnMintTokenPool' : 'LockReleaseTokenPool'
      const poolBytecode =
        params.poolType === 'burn-mint'
          ? (await import('./bytecodes/BurnMintTokenPool.ts')).BURN_MINT_TOKEN_POOL_BYTECODE
          : (await import('./bytecodes/LockReleaseTokenPool.ts')).LOCK_RELEASE_TOKEN_POOL_BYTECODE
      const verification = this.buildDeployVerification(
        poolContract,
        unsigned.transactions[0]!.data as string,
        poolBytecode,
      )

      // The lock-release pool must be an authorized caller of its ERC20LockBox to
      // lock (deposit) and release (withdraw). Authorize it on the lockbox we deployed.
      if (autoDeployedLockBox && lockBoxAddress) {
        this.logger.debug('deployPool: authorizing pool on its ERC20LockBox...')
        const authData = new Interface(ERC20LockBoxABI).encodeFunctionData(
          'applyAuthorizedCallerUpdates',
          [{ addedCallers: [poolAddress], removedCallers: [] }],
        )
        const authTx = await wallet.populateTransaction({ to: lockBoxAddress, data: authData })
        authTx.from = undefined
        const authResp = await submitTransaction(wallet, authTx, this.provider)
        const authReceipt = await authResp.wait(1, 60_000)
        if (!authReceipt || authReceipt.status === 0) {
          throw new CCIPPoolDeployFailedError('failed to authorize pool on its ERC20LockBox', {
            context: { txHash: authResp.hash },
          })
        }
        this.logger.info('deployPool: authorized pool on lockbox', lockBoxAddress)
      }

      return {
        poolAddress,
        txHash,
        ...(lockBoxAddress && { lockBoxAddress }),
        verification,
        ...(lockBoxVerification && { lockBoxVerification }),
      }
    } catch (error) {
      if (error instanceof CCIPPoolDeployFailedError) throw error
      throw new CCIPPoolDeployFailedError(error instanceof Error ? error.message : String(error), {
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  /**
   * Builds the `deployTokenAndTokenPool` arguments for a `TokenPoolFactory 2.0.0`, plus the token's
   * ABI-encoded constructor args (returned for verification). The salt defaults to a random 32-byte
   * value when omitted; pass an explicit `salt` for a reproducible address. Pure encoding.
   */
  private async assembleTokenAndPoolFactoryArgs(
    params: EVMFactoryDeployTokenAndPoolParams,
    futureOwner: string,
  ): Promise<{ deployArgs: unknown[]; tokenArgs: string }> {
    const { CROSS_CHAIN_TOKEN_BYTECODE } = await import('./bytecodes/CrossChainToken.ts')
    // ccipAdmin must be the factory so it can set the pool in the TokenAdminRegistry; burn-mint
    // also needs the factory as the burn/mint role admin (it grants the pool then renounces).
    const burnMintRoleAdmin = params.poolType === 'burn-mint' ? params.factoryAddress : futureOwner
    const preMint = params.preMint ?? 0n
    const preMintRecipient = preMint > 0n ? (params.preMintRecipient ?? futureOwner) : ZeroAddress
    const tokenArgs = AbiCoder.defaultAbiCoder().encode(
      [CROSS_CHAIN_TOKEN_PARAMS_TUPLE, 'address', 'address'],
      [
        [
          params.name,
          params.symbol,
          params.maxSupply,
          preMint,
          preMintRecipient,
          params.decimals,
          params.factoryAddress,
        ],
        burnMintRoleAdmin,
        futureOwner,
      ],
    )
    const tokenInitCode = concat([CROSS_CHAIN_TOKEN_BYTECODE, tokenArgs])
    const poolBytecode = await this.loadPoolBytecode(params.poolType)
    const deployArgs = [
      [],
      params.decimals,
      FACTORY_POOL_TYPE[params.poolType],
      tokenInitCode,
      poolBytecode,
      params.lockBoxAddress ?? ZeroAddress,
      params.salt ?? hexlify(randomBytes(32)),
      futureOwner,
    ]
    return { deployArgs, tokenArgs }
  }

  /** Builds the `deployTokenPoolWithExistingToken` arguments for a `TokenPoolFactory 2.0.0`. */
  private async assemblePoolFactoryArgs(
    params: EVMFactoryDeployPoolParams,
    futureOwner: string,
  ): Promise<unknown[]> {
    const poolBytecode = await this.loadPoolBytecode(params.poolType)
    return [
      params.tokenAddress,
      params.decimals,
      FACTORY_POOL_TYPE[params.poolType],
      [],
      poolBytecode,
      params.lockBoxAddress ?? ZeroAddress,
      params.salt ?? hexlify(randomBytes(32)),
      futureOwner,
    ]
  }

  /**
   * Builds the unsigned `TokenPoolFactory` transaction that deploys a new CrossChainToken + pool
   * (the counterpart to the signed {@link deployTokenAndPoolViaFactory}). `futureOwner` is required
   * here (it's baked into the token's constructor); the signed method auto-fills it from the signer.
   * Pass an explicit `salt` for a reproducible CREATE2 address.
   *
   * @throws {@link CCIPPoolDeployParamsInvalidError} if `futureOwner` is missing.
   */
  async generateUnsignedDeployTokenAndPoolViaFactory(
    params: EVMFactoryDeployTokenAndPoolParams,
  ): Promise<UnsignedEVMTx> {
    if (!params.futureOwner || params.futureOwner.trim().length === 0) {
      throw new CCIPPoolDeployParamsInvalidError(
        'futureOwner',
        'required (use signed deployTokenAndPoolViaFactory to auto-fill from the signer)',
      )
    }
    const { deployArgs } = await this.assembleTokenAndPoolFactoryArgs(params, params.futureOwner)
    const data = new Interface(TOKEN_POOL_FACTORY_ABI).encodeFunctionData(
      'deployTokenAndTokenPool',
      deployArgs,
    )
    return { family: ChainFamily.EVM, transactions: [{ to: params.factoryAddress, data }] }
  }

  /**
   * Deploys a new `CrossChainToken` **and** its token pool in a single transaction through a
   * `TokenPoolFactory 2.0.0` (CREATE2). Works for burn-mint and lock-release (the factory
   * auto-deploys an `ERC20LockBox` for lock-release when one isn't supplied). The factory must be
   * the token's `ccipAdmin` (and, for burn-mint, its burn/mint role admin) to wire the registry,
   * so those are set to the factory; final ownership of token + pool goes to `futureOwner`
   * (defaults to the signer).
   *
   * Returns both addresses plus {@link DeployVerificationTarget} handles for every contract the
   * factory created — these carry the exact constructor args (the factory contracts are born in
   * internal CREATE2 calls, so they can't be recovered from a top-level creation tx).
   *
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer.
   */
  async deployTokenAndPoolViaFactory(
    wallet: unknown,
    params: EVMFactoryDeployTokenAndPoolParams,
  ): Promise<FactoryDeployTokenAndPoolResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)
    const factoryAddress = params.factoryAddress
    const futureOwner = params.futureOwner ?? (await wallet.getAddress())
    // Resolve the salt once so the staticCall and the submit deploy to the same address.
    const effectiveParams = {
      ...params,
      salt: params.salt ?? hexlify(randomBytes(32)),
      futureOwner,
    }
    const { deployArgs, tokenArgs } = await this.assembleTokenAndPoolFactoryArgs(
      effectiveParams,
      futureOwner,
    )

    const factory = new Contract(factoryAddress, TOKEN_POOL_FACTORY_ABI, wallet)
    const { rmnProxy, router } = await this.factoryStaticConfig(factory)
    const deployFn = factory.getFunction('deployTokenAndTokenPool')

    this.logger.debug('deployTokenAndPoolViaFactory: simulating to resolve addresses...')
    const [tokenAddress, poolAddress] = (await deployFn.staticCall(...deployArgs)) as [
      string,
      string,
    ]

    this.logger.debug('deployTokenAndPoolViaFactory: deploying via factory', factoryAddress, '...')
    const response = await submitTransaction(
      wallet,
      await deployFn.populateTransaction(...deployArgs),
      this.provider,
    )
    const receipt = await response.wait(1, 60_000)
    if (!receipt || receipt.status === 0) {
      throw new CCIPPoolDeployFailedError('factory deployTokenAndTokenPool reverted', {
        context: { txHash: response.hash },
      })
    }
    this.logger.info(
      'deployTokenAndPoolViaFactory: token',
      tokenAddress,
      'pool',
      poolAddress,
      'tx',
      response.hash,
    )

    const pool = await this.resolveFactoryPoolVerification(
      params.poolType,
      tokenAddress,
      params.decimals,
      rmnProxy,
      router,
      poolAddress,
      params.lockBoxAddress,
    )
    const verifications: DeployVerificationTarget[] = [
      { contract: 'CrossChainToken', address: tokenAddress, encodedConstructorArgs: tokenArgs },
      pool.poolVerification,
      ...(pool.lockBoxVerification ? [pool.lockBoxVerification] : []),
    ]
    return {
      tokenAddress,
      poolAddress,
      txHash: response.hash,
      ...(pool.lockBoxAddress && { lockBoxAddress: pool.lockBoxAddress }),
      verifications,
    }
  }

  /**
   * Builds the unsigned `TokenPoolFactory` transaction that deploys a pool for an existing token
   * (the counterpart to the signed {@link deployPoolViaFactory}). `futureOwner` is required here;
   * the signed method auto-fills it from the signer.
   *
   * @throws {@link CCIPPoolDeployParamsInvalidError} if `futureOwner` is missing.
   */
  async generateUnsignedDeployPoolViaFactory(
    params: EVMFactoryDeployPoolParams,
  ): Promise<UnsignedEVMTx> {
    if (!params.futureOwner || params.futureOwner.trim().length === 0) {
      throw new CCIPPoolDeployParamsInvalidError(
        'futureOwner',
        'required (use signed deployPoolViaFactory to auto-fill from the signer)',
      )
    }
    const deployArgs = await this.assemblePoolFactoryArgs(params, params.futureOwner)
    const data = new Interface(TOKEN_POOL_FACTORY_ABI).encodeFunctionData(
      'deployTokenPoolWithExistingToken',
      deployArgs,
    )
    return { family: ChainFamily.EVM, transactions: [{ to: params.factoryAddress, data }] }
  }

  /**
   * Deploys a token pool for an **existing** token through a `TokenPoolFactory 2.0.0` (CREATE2).
   * Unlike {@link deployTokenAndPoolViaFactory}, the factory is not the token's ccipAdmin here, so
   * the caller must wire the TokenAdminRegistry (propose/accept-admin, set-pool) and, for
   * burn-mint, grant the pool mint/burn roles separately. Returns the pool address plus
   * {@link DeployVerificationTarget} handles (pool, and the auto-deployed lockbox for lock-release).
   *
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer.
   */
  async deployPoolViaFactory(
    wallet: unknown,
    params: EVMFactoryDeployPoolParams,
  ): Promise<FactoryDeployPoolResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)
    const factoryAddress = params.factoryAddress
    const futureOwner = params.futureOwner ?? (await wallet.getAddress())
    const effectiveParams = {
      ...params,
      salt: params.salt ?? hexlify(randomBytes(32)),
      futureOwner,
    }
    const deployArgs = await this.assemblePoolFactoryArgs(effectiveParams, futureOwner)

    const factory = new Contract(factoryAddress, TOKEN_POOL_FACTORY_ABI, wallet)
    const { rmnProxy, router } = await this.factoryStaticConfig(factory)
    const deployFn = factory.getFunction('deployTokenPoolWithExistingToken')

    this.logger.debug('deployPoolViaFactory: simulating to resolve address...')
    const poolAddress = (await deployFn.staticCall(...deployArgs)) as string

    this.logger.debug('deployPoolViaFactory: deploying via factory', factoryAddress, '...')
    const response = await submitTransaction(
      wallet,
      await deployFn.populateTransaction(...deployArgs),
      this.provider,
    )
    const receipt = await response.wait(1, 60_000)
    if (!receipt || receipt.status === 0) {
      throw new CCIPPoolDeployFailedError('factory deployTokenPoolWithExistingToken reverted', {
        context: { txHash: response.hash },
      })
    }
    this.logger.info('deployPoolViaFactory: pool', poolAddress, 'tx', response.hash)

    const pool = await this.resolveFactoryPoolVerification(
      params.poolType,
      params.tokenAddress,
      params.decimals,
      rmnProxy,
      router,
      poolAddress,
      params.lockBoxAddress,
    )
    return {
      poolAddress,
      txHash: response.hash,
      ...(pool.lockBoxAddress && { lockBoxAddress: pool.lockBoxAddress }),
      verifications: [
        pool.poolVerification,
        ...(pool.lockBoxVerification ? [pool.lockBoxVerification] : []),
      ],
    }
  }

  /** Reads `getStaticConfig()` from a TokenPoolFactory to get the local rmnProxy + ccipRouter. */
  private async factoryStaticConfig(
    factory: Contract,
  ): Promise<{ rmnProxy: string; router: string }> {
    const cfg = (await factory.getFunction('getStaticConfig')()) as {
      rmnProxy: string
      ccipRouter: string
    }
    return { rmnProxy: cfg.rmnProxy, router: cfg.ccipRouter }
  }

  /** Lazy-loads the creation bytecode for a pool type. */
  private async loadPoolBytecode(poolType: 'burn-mint' | 'lock-release'): Promise<string> {
    if (poolType === 'burn-mint') {
      return (await import('./bytecodes/BurnMintTokenPool.ts')).BURN_MINT_TOKEN_POOL_BYTECODE
    }
    return (await import('./bytecodes/LockReleaseTokenPool.ts')).LOCK_RELEASE_TOKEN_POOL_BYTECODE
  }

  /**
   * Reconstructs the pool's (and lock-release lockbox's) verification handles for a factory deploy.
   * The factory appends the pool ctor args itself (token, decimals, zero-hooks, rmnProxy, router,
   * and lockBox for lock-release) using its own immutables, so we rebuild them from the static
   * config. For lock-release the lockbox is read from getLockBox() when not explicitly supplied.
   */
  private async resolveFactoryPoolVerification(
    poolType: 'burn-mint' | 'lock-release',
    token: string,
    decimals: number,
    rmnProxy: string,
    router: string,
    poolAddress: string,
    lockBoxAddressParam: string | undefined,
  ): Promise<{
    poolVerification: DeployVerificationTarget
    lockBoxVerification?: DeployVerificationTarget
    lockBoxAddress?: string
  }> {
    const abi = AbiCoder.defaultAbiCoder()
    if (poolType === 'burn-mint') {
      const args = abi.encode(
        ['address', 'uint8', 'address', 'address', 'address'],
        [token, decimals, ZeroAddress, rmnProxy, router],
      )
      return {
        poolVerification: {
          contract: 'BurnMintTokenPool',
          address: poolAddress,
          encodedConstructorArgs: args,
        },
      }
    }
    let lockBox = lockBoxAddressParam
    if (!lockBox) {
      const pool = new Contract(poolAddress, TokenPool_2_0_ABI, this.provider)
      lockBox = (await pool.getFunction('getLockBox')()) as string
    }
    const args = abi.encode(
      ['address', 'uint8', 'address', 'address', 'address', 'address'],
      [token, decimals, ZeroAddress, rmnProxy, router, lockBox],
    )
    return {
      poolVerification: {
        contract: 'LockReleaseTokenPool',
        address: poolAddress,
        encodedConstructorArgs: args,
      },
      lockBoxVerification: {
        contract: 'ERC20LockBox',
        address: lockBox,
        encodedConstructorArgs: abi.encode(['address'], [token]),
      },
      lockBoxAddress: lockBox,
    }
  }

  /**
   * Builds a verification handle for a just-deployed contract. The init code is
   * `bytecode || abiEncodedConstructorArgs`, so the encoded args are exactly the bytes after
   * the (known) creation bytecode — recovered here as the single source of truth.
   */
  private buildDeployVerification(
    contract: string,
    deployData: string,
    bytecode: string,
  ): DeployVerification {
    return { contract, encodedConstructorArgs: `0x${deployData.slice(bytecode.length)}` }
  }

  /**
   * Signs, submits and confirms a contract-creation transaction, returning the
   * deployed address. Shared by pool / lock-box / combined-pool-token deploys.
   * @throws {@link CCIPPoolDeployFailedError} if the deploy fails.
   */
  private async deployBytecode(
    wallet: Signer,
    data: string,
  ): Promise<{ address: string; txHash: string }> {
    let deployTx: TransactionRequest = { to: null, data }
    deployTx = await wallet.populateTransaction(deployTx)
    deployTx.from = undefined // some signers reject a pre-populated `from`
    const response = await submitTransaction(wallet, deployTx, this.provider)
    const receipt = await response.wait(1, 60_000)
    if (!receipt) {
      throw new CCIPPoolDeployFailedError('transaction receipt not received', {
        context: { txHash: response.hash },
      })
    }
    if (receipt.status === 0) {
      throw new CCIPPoolDeployFailedError('transaction reverted', {
        context: { txHash: response.hash },
      })
    }
    if (!receipt.contractAddress) {
      throw new CCIPPoolDeployFailedError('no contract address in receipt', {
        context: { txHash: response.hash },
      })
    }
    return { address: receipt.contractAddress, txHash: response.hash }
  }

  /** Derives the RMN proxy address from a CCIP Router via `Router.getArmProxy()`. */
  private async deriveRmnProxy(routerAddress: string): Promise<string> {
    const router = new Contract(routerAddress, RouterABI, this.provider)
    try {
      return (await router.getFunction('getArmProxy')()) as string
    } catch (error) {
      throw new CCIPPoolDeployFailedError(
        `failed to derive rmnProxy from router ${routerAddress}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── CrossChainPoolToken (combined token + pool) ───────────────────────────

  /**
   * Builds an unsigned deploy transaction for a `CrossChainPoolToken` — the canonical
   * CCT v2.0 contract that is *both* an ERC20 token and its own CCIP token pool.
   *
   * Constructor: `(ConstructorParams tokenParams, address advancedPoolHooks, address rmnProxy, address router)`.
   * `rmnProxy` is derived from the router; `advancedPoolHooks` defaults to the zero address.
   *
   * @param params - Combined token+pool deployment parameters
   * @returns Unsigned EVM transaction set (single deploy tx with `to: null`)
   * @throws {@link CCIPPoolDeployParamsInvalidError} if params are invalid
   */
  async generateUnsignedDeployCrossChainPoolToken(
    params: EVMDeployCrossChainPoolTokenParams,
  ): Promise<UnsignedEVMTx> {
    validateParams(params)
    if (!params.routerAddress || params.routerAddress.trim().length === 0) {
      throw new CCIPPoolDeployParamsInvalidError('routerAddress', 'must be non-empty')
    }
    if (!params.ccipAdmin || params.ccipAdmin.trim().length === 0) {
      throw new CCIPPoolDeployParamsInvalidError(
        'ccipAdmin',
        'required (use signed deployCrossChainPoolToken to auto-fill from the signer)',
      )
    }

    const rmnProxy = await this.deriveRmnProxy(params.routerAddress)
    const advancedPoolHooks = params.advancedPoolHooks ?? ZeroAddress
    const maxSupply = params.maxSupply ?? 0n
    const preMint = params.initialSupply ?? 0n
    const preMintRecipient =
      preMint > 0n ? (params.preMintRecipient ?? params.ccipAdmin) : ZeroAddress

    // CrossChainPoolToken constructor: (ConstructorParams tokenParams, advancedPoolHooks, rmnProxy, router)
    const { CROSS_CHAIN_POOL_TOKEN_BYTECODE } = await import('./bytecodes/CrossChainPoolToken.ts')
    const encodedArgs = AbiCoder.defaultAbiCoder().encode(
      [CROSS_CHAIN_TOKEN_PARAMS_TUPLE, 'address', 'address', 'address'],
      [
        {
          name: params.name,
          symbol: params.symbol,
          maxSupply,
          preMint,
          preMintRecipient,
          decimals: params.decimals,
          ccipAdmin: params.ccipAdmin,
        },
        advancedPoolHooks,
        rmnProxy,
        params.routerAddress,
      ],
    )
    const deployData = concat([CROSS_CHAIN_POOL_TOKEN_BYTECODE, encodedArgs])

    this.logger.debug(
      'generateUnsignedDeployCrossChainPoolToken: bytecode size =',
      dataLength(deployData),
    )
    return { family: ChainFamily.EVM, transactions: [{ to: null, data: deployData }] }
  }

  /**
   * Deploys a `CrossChainPoolToken` (combined token + pool), signing with the wallet.
   * The returned address is simultaneously the token and its pool — pass it to
   * `proposeAdminRole` / `setPool` / `applyChainUpdates` directly.
   *
   * @param wallet - Ethers Signer
   * @param params - Combined token+pool deployment parameters
   * @returns `{ address, tokenAddress, poolAddress, txHash }` (all three addresses are equal)
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPPoolDeployFailedError} if the deploy fails
   */
  async deployCrossChainPoolToken(
    wallet: unknown,
    params: EVMDeployCrossChainPoolTokenParams,
  ): Promise<DeployCrossChainPoolTokenResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const effectiveParams = { ...params }
    if (!effectiveParams.ccipAdmin) effectiveParams.ccipAdmin = await wallet.getAddress()

    try {
      const unsigned = await this.generateUnsignedDeployCrossChainPoolToken(effectiveParams)
      this.logger.debug('deployCrossChainPoolToken: deploying combined token+pool ...')
      const { address, txHash } = await this.deployBytecode(wallet, unsigned.transactions[0]!.data!)
      this.logger.info('deployCrossChainPoolToken: deployed at', address, 'tx =', txHash)
      const { CROSS_CHAIN_POOL_TOKEN_BYTECODE } = await import('./bytecodes/CrossChainPoolToken.ts')
      return {
        address,
        tokenAddress: address,
        poolAddress: address,
        txHash,
        verification: this.buildDeployVerification(
          'CrossChainPoolToken',
          unsigned.transactions[0]!.data as string,
          CROSS_CHAIN_POOL_TOKEN_BYTECODE,
        ),
      }
    } catch (error) {
      if (error instanceof CCIPPoolDeployFailedError) throw error
      throw new CCIPPoolDeployFailedError(error instanceof Error ? error.message : String(error), {
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  // ── Propose Admin Role ────────────────────────────────────────────────────

  /**
   * Builds an unsigned transaction to propose the caller as administrator
   * for a token via the RegistryModuleOwnerCustom contract.
   *
   * The `registrationMethod` determines which function is called:
   * - `'owner'` (default) — `registerAdminViaOwner(token)` — token has `owner()`
   * - `'getCCIPAdmin'` — `registerAdminViaGetCCIPAdmin(token)` — token has `getCCIPAdmin()`
   * - `'accessControlDefaultAdmin'` — `registerAccessControlDefaultAdmin(token)` — OZ AccessControl
   *
   * @param params - Propose admin role parameters
   * @returns Unsigned EVM transaction set (single tx)
   * @throws {@link CCIPProposeAdminRoleParamsInvalidError} if params are invalid
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedProposeAdminRole({
   *   tokenAddress: '0xa42BA...',
   *   registryModuleAddress: '0xa3c7...',
   *   registrationMethod: 'owner', // default
   * })
   * ```
   */
  generateUnsignedProposeAdminRole(params: EVMProposeAdminRoleParams): UnsignedEVMTx {
    validateProposeAdminRoleParams(params)

    const method = params.registrationMethod ?? 'owner'
    const functionName = REGISTRATION_FUNCTION_NAMES[method]

    const iface = new Interface(RegistryModuleOwnerCustomABI)
    const data = iface.encodeFunctionData(functionName, [params.tokenAddress])

    const tx: Pick<TransactionRequest, 'from' | 'to' | 'data' | 'gasLimit'> = {
      to: params.registryModuleAddress,
      data,
    }

    this.logger.debug(
      `generateUnsignedProposeAdminRole: registryModule = ${params.registryModuleAddress}, method = ${method}, token = ${params.tokenAddress}`,
    )

    return {
      family: ChainFamily.EVM,
      transactions: [tx],
    }
  }

  /**
   * Proposes the caller as administrator for a token via the
   * RegistryModuleOwnerCustom contract, signing and submitting with the provided wallet.
   *
   * The wallet must have the appropriate authority over the token, depending
   * on the `registrationMethod` (token owner, CCIP admin, or AccessControl admin).
   *
   * @param wallet - Ethers Signer with signing capability
   * @param params - Propose admin role parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPProposeAdminRoleParamsInvalidError} if params are invalid
   * @throws {@link CCIPProposeAdminRoleFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.proposeAdminRole(wallet, {
   *   tokenAddress: '0xa42BA...',
   *   registryModuleAddress: '0xa3c7...',
   * })
   * console.log(`Proposed admin, tx: ${txHash}`)
   * ```
   */
  async proposeAdminRole(
    wallet: unknown,
    params: EVMProposeAdminRoleParams,
  ): Promise<ProposeAdminRoleResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = this.generateUnsignedProposeAdminRole(params)
    let tx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('proposeAdminRole: proposing administrator...')

    try {
      tx = await wallet.populateTransaction(tx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('proposeAdminRole: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPProposeAdminRoleFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPProposeAdminRoleFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('proposeAdminRole: proposed admin, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPProposeAdminRoleFailedError) throw error
      if (error instanceof CCIPProposeAdminRoleParamsInvalidError) throw error
      throw new CCIPProposeAdminRoleFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Accept Admin Role ────────────────────────────────────────────────────

  /**
   * Builds an unsigned transaction for accepting an administrator role
   * in the TokenAdminRegistry.
   *
   * Calls `acceptAdminRole(localToken)` directly on the TokenAdminRegistry contract.
   * The caller must be the pending administrator for the token.
   *
   * @param params - Accept admin role parameters
   * @returns Unsigned EVM transaction
   * @throws {@link CCIPAcceptAdminRoleParamsInvalidError} if params are invalid
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedAcceptAdminRole({
   *   tokenAddress: '0xa42BA...',
   *   routerAddress: '0x0BF3...',
   * })
   * ```
   */
  async generateUnsignedAcceptAdminRole(params: AcceptAdminRoleParams): Promise<UnsignedEVMTx> {
    validateAcceptAdminRoleParams(params)

    // Discover the TokenAdminRegistry address from the router
    const tarAddress = await this.getTokenAdminRegistryFor(params.routerAddress)

    const iface = new Interface(TokenAdminRegistryABI)
    const data = iface.encodeFunctionData('acceptAdminRole', [params.tokenAddress])
    const tx: TransactionRequest = { to: tarAddress, data }

    this.logger.debug(
      'generateUnsignedAcceptAdminRole: TAR =',
      tarAddress,
      'token =',
      params.tokenAddress,
    )

    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /**
   * Accepts an administrator role for a token in the TokenAdminRegistry,
   * signing and submitting with the provided wallet.
   *
   * @param wallet - EVM signer (must be the pending administrator)
   * @param params - Accept admin role parameters
   * @returns Result with `txHash`
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.acceptAdminRole(wallet, {
   *   tokenAddress: '0xa42BA...',
   *   routerAddress: '0x0BF3...',
   * })
   * console.log(`Accepted admin, tx: ${txHash}`)
   * ```
   */
  async acceptAdminRole(
    wallet: unknown,
    params: AcceptAdminRoleParams,
  ): Promise<AcceptAdminRoleResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedAcceptAdminRole(params)
    let tx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('acceptAdminRole: accepting administrator role...')

    try {
      tx = await wallet.populateTransaction(tx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('acceptAdminRole: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPAcceptAdminRoleFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPAcceptAdminRoleFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('acceptAdminRole: accepted admin, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPAcceptAdminRoleFailedError) throw error
      if (error instanceof CCIPAcceptAdminRoleParamsInvalidError) throw error
      throw new CCIPAcceptAdminRoleFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Transfer Admin Role ─────────────────────────────────────────────────

  /**
   * Builds an unsigned transaction for transferring the administrator role
   * for a token in the TokenAdminRegistry.
   *
   * Encodes `transferAdminRole(address localToken, address newAdmin)` on the TAR.
   *
   * @param params - Transfer admin role parameters
   * @returns Unsigned EVM transaction
   * @throws {@link CCIPTransferAdminRoleParamsInvalidError} if params are invalid
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedTransferAdminRole({
   *   tokenAddress: '0xa42BA...',
   *   newAdmin: '0x1234...',
   *   routerAddress: '0x0BF3...',
   * })
   * ```
   */
  async generateUnsignedTransferAdminRole(params: TransferAdminRoleParams): Promise<UnsignedEVMTx> {
    validateTransferAdminRoleParams(params)

    // Discover the TokenAdminRegistry address from the router
    const tarAddress = await this.getTokenAdminRegistryFor(params.routerAddress)

    const iface = new Interface(TokenAdminRegistryABI)
    const data = iface.encodeFunctionData('transferAdminRole', [
      params.tokenAddress,
      params.newAdmin,
    ])
    const tx: TransactionRequest = { to: tarAddress, data }

    this.logger.debug(
      'generateUnsignedTransferAdminRole: TAR =',
      tarAddress,
      'token =',
      params.tokenAddress,
      'newAdmin =',
      params.newAdmin,
    )

    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /**
   * Transfers the administrator role for a token in the TokenAdminRegistry,
   * signing and submitting with the provided wallet.
   *
   * @param wallet - EVM signer (must be the current administrator)
   * @param params - Transfer admin role parameters
   * @returns Result with `txHash`
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.transferAdminRole(wallet, {
   *   tokenAddress: '0xa42BA...',
   *   newAdmin: '0x1234...',
   *   routerAddress: '0x0BF3...',
   * })
   * console.log(`Transferred admin, tx: ${txHash}`)
   * ```
   */
  async transferAdminRole(
    wallet: unknown,
    params: TransferAdminRoleParams,
  ): Promise<TransferAdminRoleResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedTransferAdminRole(params)
    let tx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('transferAdminRole: transferring administrator role...')

    try {
      tx = await wallet.populateTransaction(tx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('transferAdminRole: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPTransferAdminRoleFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPTransferAdminRoleFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('transferAdminRole: transferred admin, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPTransferAdminRoleFailedError) throw error
      if (error instanceof CCIPTransferAdminRoleParamsInvalidError) throw error
      throw new CCIPTransferAdminRoleFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Set Pool ─────────────────────────────────────────────────────────────

  /**
   * Builds an unsigned transaction for registering a pool in the TokenAdminRegistry.
   *
   * Encodes `setPool(address localToken, address pool)` on the TAR contract.
   *
   * @param params - Set pool parameters
   * @returns Unsigned EVM transaction
   * @throws {@link CCIPSetPoolParamsInvalidError} if params are invalid
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedSetPool({
   *   tokenAddress: '0xa42BA...',
   *   poolAddress: '0xd7BF...',
   *   routerAddress: '0x0BF3...',
   * })
   * ```
   */
  async generateUnsignedSetPool(params: SetPoolParams): Promise<UnsignedEVMTx> {
    validateSetPoolParams(params)

    const tarAddress = await this.getTokenAdminRegistryFor(params.routerAddress)

    const iface = new Interface(TokenAdminRegistryABI)
    const data = iface.encodeFunctionData('setPool', [params.tokenAddress, params.poolAddress])
    const tx: TransactionRequest = { to: tarAddress, data }

    this.logger.debug(
      'generateUnsignedSetPool: TAR =',
      tarAddress,
      'token =',
      params.tokenAddress,
      'pool =',
      params.poolAddress,
    )

    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /**
   * Registers a pool in the TokenAdminRegistry, signing and submitting
   * with the provided wallet.
   *
   * @param wallet - EVM signer (must be the token administrator)
   * @param params - Set pool parameters
   * @returns Result with `txHash`
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.setPool(wallet, {
   *   tokenAddress: '0xa42BA...',
   *   poolAddress: '0xd7BF...',
   *   routerAddress: '0x0BF3...',
   * })
   * console.log(`Pool registered, tx: ${txHash}`)
   * ```
   */
  async setPool(wallet: unknown, params: SetPoolParams): Promise<SetPoolResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedSetPool(params)
    let tx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('setPool: registering pool...')

    try {
      tx = await wallet.populateTransaction(tx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('setPool: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPSetPoolFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPSetPoolFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('setPool: pool registered, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPSetPoolFailedError) throw error
      if (error instanceof CCIPSetPoolParamsInvalidError) throw error
      throw new CCIPSetPoolFailedError(error instanceof Error ? error.message : String(error), {
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  // ── Apply Chain Updates ──────────────────────────────────────────────────

  /**
   * Builds an unsigned transaction for configuring remote chains on a token pool.
   *
   * Encodes `applyChainUpdates(uint64[] removes, ChainUpdate[] adds)` on the
   * TokenPool contract. Remote addresses are encoded to 32-byte left-padded bytes.
   *
   * @param params - Apply chain updates parameters
   * @returns Unsigned EVM transaction
   * @throws {@link CCIPApplyChainUpdatesParamsInvalidError} if params are invalid
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedApplyChainUpdates({
   *   poolAddress: '0x1234...',
   *   remoteChainSelectorsToRemove: [],
   *   chainsToAdd: [{
   *     remoteChainSelector: '16015286601757825753',
   *     remotePoolAddresses: ['0xd7BF...'],
   *     remoteTokenAddress: '0xa42B...',
   *     outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
   *     inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
   *   }],
   * })
   * ```
   */
  async generateUnsignedApplyChainUpdates(params: ApplyChainUpdatesParams): Promise<UnsignedEVMTx> {
    validateApplyChainUpdatesParams(params)

    const { version, abi } = await this.getPoolVersionAndABI(params.poolAddress)
    const iface = new Interface(abi)

    let data: string

    if (version < CCIPVersion.V1_5) {
      // v1.5: applyChainUpdates(ChainUpdate[]) — single pool address, `allowed` field
      const chains = [
        ...params.chainsToAdd.map((chain) => ({
          remoteChainSelector: chain.remoteChainSelector,
          allowed: true,
          remotePoolAddress: encodeRemoteAddress(chain.remotePoolAddresses[0]!),
          remoteTokenAddress: encodeRemoteAddress(chain.remoteTokenAddress),
          outboundRateLimiterConfig: {
            isEnabled: chain.outboundRateLimiterConfig.isEnabled,
            capacity: BigInt(chain.outboundRateLimiterConfig.capacity),
            rate: BigInt(chain.outboundRateLimiterConfig.rate),
          },
          inboundRateLimiterConfig: {
            isEnabled: chain.inboundRateLimiterConfig.isEnabled,
            capacity: BigInt(chain.inboundRateLimiterConfig.capacity),
            rate: BigInt(chain.inboundRateLimiterConfig.rate),
          },
        })),
        ...params.remoteChainSelectorsToRemove.map((s) => ({
          remoteChainSelector: BigInt(s),
          allowed: false,
          remotePoolAddress: '0x',
          remoteTokenAddress: '0x',
          outboundRateLimiterConfig: { isEnabled: false, capacity: 0n, rate: 0n },
          inboundRateLimiterConfig: { isEnabled: false, capacity: 0n, rate: 0n },
        })),
      ]
      data = iface.encodeFunctionData('applyChainUpdates', [chains])
    } else {
      // v1.5.1+ and v2.0: applyChainUpdates(uint64[] removes, ChainUpdate[] adds)
      const chainsToAdd = params.chainsToAdd.map((chain) => ({
        remoteChainSelector: chain.remoteChainSelector,
        remotePoolAddresses: chain.remotePoolAddresses.map((addr) => encodeRemoteAddress(addr)),
        remoteTokenAddress: encodeRemoteAddress(chain.remoteTokenAddress),
        outboundRateLimiterConfig: {
          isEnabled: chain.outboundRateLimiterConfig.isEnabled,
          capacity: BigInt(chain.outboundRateLimiterConfig.capacity),
          rate: BigInt(chain.outboundRateLimiterConfig.rate),
        },
        inboundRateLimiterConfig: {
          isEnabled: chain.inboundRateLimiterConfig.isEnabled,
          capacity: BigInt(chain.inboundRateLimiterConfig.capacity),
          rate: BigInt(chain.inboundRateLimiterConfig.rate),
        },
      }))

      const remoteChainSelectorsToRemove = params.remoteChainSelectorsToRemove.map((s) => BigInt(s))
      data = iface.encodeFunctionData('applyChainUpdates', [
        remoteChainSelectorsToRemove,
        chainsToAdd,
      ])
    }

    const tx: TransactionRequest = { to: params.poolAddress, data }

    this.logger.debug(
      'generateUnsignedApplyChainUpdates: pool =',
      params.poolAddress,
      'version =',
      version,
      'adds =',
      params.chainsToAdd.length,
      'removes =',
      params.remoteChainSelectorsToRemove.length,
    )

    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /**
   * Configures remote chains on a token pool, signing and submitting with the provided wallet.
   *
   * @param wallet - EVM signer (must be the pool owner)
   * @param params - Apply chain updates parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPApplyChainUpdatesParamsInvalidError} if params are invalid
   * @throws {@link CCIPApplyChainUpdatesFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.applyChainUpdates(wallet, {
   *   poolAddress: '0x1234...',
   *   remoteChainSelectorsToRemove: [],
   *   chainsToAdd: [{
   *     remoteChainSelector: '16015286601757825753',
   *     remotePoolAddresses: ['0xd7BF...'],
   *     remoteTokenAddress: '0xa42B...',
   *     outboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
   *     inboundRateLimiterConfig: { isEnabled: false, capacity: '0', rate: '0' },
   *   }],
   * })
   * ```
   */
  async applyChainUpdates(
    wallet: unknown,
    params: ApplyChainUpdatesParams,
  ): Promise<ApplyChainUpdatesResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedApplyChainUpdates(params)
    let tx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('applyChainUpdates: applying chain updates...')

    try {
      tx = await wallet.populateTransaction(tx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('applyChainUpdates: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPApplyChainUpdatesFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPApplyChainUpdatesFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('applyChainUpdates: applied chain updates, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPApplyChainUpdatesFailedError) throw error
      if (error instanceof CCIPApplyChainUpdatesParamsInvalidError) throw error
      throw new CCIPApplyChainUpdatesFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Append Remote Pool Addresses ────────────────────────────────────────

  /**
   * Builds unsigned transactions for appending remote pool addresses to an existing chain config.
   *
   * Encodes `addRemotePool(uint64 remoteChainSelector, bytes remotePoolAddress)` on the
   * TokenPool contract. One transaction per address. Requires v1.5.1+ (not available on v1.5).
   *
   * @param params - Append remote pool addresses parameters
   * @returns Unsigned EVM transactions (one per address)
   * @throws {@link CCIPAppendRemotePoolAddressesParamsInvalidError} if params are invalid
   * @throws {@link CCIPAppendRemotePoolAddressesFailedError} if pool version is v1.5 (no addRemotePool)
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedAppendRemotePoolAddresses({
   *   poolAddress: '0x1234...',
   *   remoteChainSelector: '16015286601757825753',
   *   remotePoolAddresses: ['0xd7BF...', '0xaabb...'],
   * })
   * ```
   */
  async generateUnsignedAppendRemotePoolAddresses(
    params: AppendRemotePoolAddressesParams,
  ): Promise<UnsignedEVMTx> {
    validateAppendRemotePoolAddressesParams(params)

    const { version, abi } = await this.getPoolVersionAndABI(params.poolAddress)

    if (version <= CCIPVersion.V1_5) {
      throw new CCIPAppendRemotePoolAddressesFailedError(
        'addRemotePool is not available on v1.5 pools. Use applyChainUpdates to re-initialize the chain config instead.',
      )
    }

    const iface = new Interface(abi)
    const transactions: TransactionRequest[] = []

    for (const remotePoolAddress of params.remotePoolAddresses) {
      const encodedAddress = encodeRemoteAddress(remotePoolAddress)
      const data = iface.encodeFunctionData('addRemotePool', [
        params.remoteChainSelector,
        encodedAddress,
      ])
      transactions.push({ to: params.poolAddress, data })
    }

    this.logger.debug(
      'generateUnsignedAppendRemotePoolAddresses: pool =',
      params.poolAddress,
      'version =',
      version,
      'addresses =',
      params.remotePoolAddresses.length,
    )

    return { family: ChainFamily.EVM, transactions }
  }

  /**
   * Appends remote pool addresses to an existing chain config, signing and submitting with the provided wallet.
   *
   * @param wallet - EVM signer (must be the pool owner)
   * @param params - Append remote pool addresses parameters
   * @returns Result with `txHash` of the last transaction
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPAppendRemotePoolAddressesParamsInvalidError} if params are invalid
   * @throws {@link CCIPAppendRemotePoolAddressesFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.appendRemotePoolAddresses(wallet, {
   *   poolAddress: '0x1234...',
   *   remoteChainSelector: '16015286601757825753',
   *   remotePoolAddresses: ['0xd7BF...'],
   * })
   * ```
   */
  async appendRemotePoolAddresses(
    wallet: unknown,
    params: AppendRemotePoolAddressesParams,
  ): Promise<AppendRemotePoolAddressesResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedAppendRemotePoolAddresses(params)

    this.logger.debug('appendRemotePoolAddresses: appending remote pool addresses...')

    try {
      let lastTxHash = ''
      for (const unsignedTx of unsigned.transactions) {
        const tx = await wallet.populateTransaction(unsignedTx)
        tx.from = undefined
        const response = await submitTransaction(wallet, tx, this.provider)

        this.logger.debug(
          'appendRemotePoolAddresses: waiting for confirmation, tx =',
          response.hash,
        )
        const receipt = await response.wait(1, 60_000)

        if (!receipt) {
          throw new CCIPAppendRemotePoolAddressesFailedError('transaction receipt not received', {
            context: { txHash: response.hash },
          })
        }

        if (receipt.status === 0) {
          throw new CCIPAppendRemotePoolAddressesFailedError('transaction reverted', {
            context: { txHash: response.hash },
          })
        }

        lastTxHash = response.hash
      }

      this.logger.info(
        'appendRemotePoolAddresses: appended remote pool addresses, tx =',
        lastTxHash,
      )

      return { txHash: lastTxHash }
    } catch (error) {
      if (error instanceof CCIPAppendRemotePoolAddressesFailedError) throw error
      if (error instanceof CCIPAppendRemotePoolAddressesParamsInvalidError) throw error
      throw new CCIPAppendRemotePoolAddressesFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Delete Chain Config ──────────────────────────────────────────────────

  /**
   * Builds an unsigned transaction for removing a remote chain configuration from a token pool.
   *
   * Wraps the existing `applyChainUpdates` ABI call with only the removal selector:
   * - v1.5: `applyChainUpdates([{ remoteChainSelector, allowed: false, ... }])`
   * - v1.5.1+/v2.0: `applyChainUpdates([remoteChainSelector], [])`
   *
   * @param params - Delete chain config parameters
   * @returns Unsigned EVM transaction
   * @throws {@link CCIPDeleteChainConfigParamsInvalidError} if params are invalid
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedDeleteChainConfig({
   *   poolAddress: '0x1234...',
   *   remoteChainSelector: '16015286601757825753',
   * })
   * ```
   */
  async generateUnsignedDeleteChainConfig(params: DeleteChainConfigParams): Promise<UnsignedEVMTx> {
    validateDeleteChainConfigParams(params)

    const { version, abi } = await this.getPoolVersionAndABI(params.poolAddress)
    const iface = new Interface(abi)

    let data: string

    if (version < CCIPVersion.V1_5) {
      // v1.5: applyChainUpdates(ChainUpdate[]) — mark chain as not allowed
      const chains = [
        {
          remoteChainSelector: params.remoteChainSelector,
          allowed: false,
          remotePoolAddress: '0x',
          remoteTokenAddress: '0x',
          outboundRateLimiterConfig: { isEnabled: false, capacity: 0n, rate: 0n },
          inboundRateLimiterConfig: { isEnabled: false, capacity: 0n, rate: 0n },
        },
      ]
      data = iface.encodeFunctionData('applyChainUpdates', [chains])
    } else {
      // v1.5.1+ and v2.0: applyChainUpdates(uint64[] removes, ChainUpdate[] adds)
      data = iface.encodeFunctionData('applyChainUpdates', [[params.remoteChainSelector], []])
    }

    const tx: TransactionRequest = { to: params.poolAddress, data }

    this.logger.debug(
      'generateUnsignedDeleteChainConfig: pool =',
      params.poolAddress,
      'version =',
      version,
      'remoteChainSelector =',
      params.remoteChainSelector,
    )

    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /**
   * Removes a remote chain configuration from a token pool, signing and submitting with the provided wallet.
   *
   * @param wallet - EVM signer (must be the pool owner)
   * @param params - Delete chain config parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPDeleteChainConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPDeleteChainConfigFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.deleteChainConfig(wallet, {
   *   poolAddress: '0x1234...',
   *   remoteChainSelector: '16015286601757825753',
   * })
   * ```
   */
  async deleteChainConfig(
    wallet: unknown,
    params: DeleteChainConfigParams,
  ): Promise<DeleteChainConfigResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedDeleteChainConfig(params)

    this.logger.debug('deleteChainConfig: deleting chain config...')

    try {
      const unsignedTx = unsigned.transactions[0]!
      const tx = await wallet.populateTransaction(unsignedTx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('deleteChainConfig: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPDeleteChainConfigFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPDeleteChainConfigFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('deleteChainConfig: deleted chain config, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPDeleteChainConfigFailedError) throw error
      if (error instanceof CCIPDeleteChainConfigParamsInvalidError) throw error
      throw new CCIPDeleteChainConfigFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Remove Remote Pool Addresses ────────────────────────────────────────

  /**
   * Builds unsigned transactions for removing specific remote pool addresses from an existing chain config.
   *
   * Encodes `removeRemotePool(uint64 remoteChainSelector, bytes remotePoolAddress)` on the
   * TokenPool contract. One transaction per address. Requires v1.5.1+ (not available on v1.5).
   *
   * @param params - Remove remote pool addresses parameters
   * @returns Unsigned EVM transactions (one per address)
   * @throws {@link CCIPRemoveRemotePoolAddressesParamsInvalidError} if params are invalid
   * @throws {@link CCIPRemoveRemotePoolAddressesFailedError} if pool version is v1.5 (no removeRemotePool)
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedRemoveRemotePoolAddresses({
   *   poolAddress: '0x1234...',
   *   remoteChainSelector: '16015286601757825753',
   *   remotePoolAddresses: ['0xd7BF...'],
   * })
   * ```
   */
  async generateUnsignedRemoveRemotePoolAddresses(
    params: RemoveRemotePoolAddressesParams,
  ): Promise<UnsignedEVMTx> {
    validateRemoveRemotePoolAddressesParams(params)

    const { version, abi } = await this.getPoolVersionAndABI(params.poolAddress)

    if (version <= CCIPVersion.V1_5) {
      throw new CCIPRemoveRemotePoolAddressesFailedError(
        'removeRemotePool is not available on v1.5 pools. Use applyChainUpdates to re-initialize the chain config instead.',
      )
    }

    const iface = new Interface(abi)
    const transactions: TransactionRequest[] = []

    for (const remotePoolAddress of params.remotePoolAddresses) {
      const encodedAddress = encodeRemoteAddress(remotePoolAddress)
      const data = iface.encodeFunctionData('removeRemotePool', [
        params.remoteChainSelector,
        encodedAddress,
      ])
      transactions.push({ to: params.poolAddress, data })
    }

    this.logger.debug(
      'generateUnsignedRemoveRemotePoolAddresses: pool =',
      params.poolAddress,
      'version =',
      version,
      'addresses =',
      params.remotePoolAddresses.length,
    )

    return { family: ChainFamily.EVM, transactions }
  }

  /**
   * Removes specific remote pool addresses from an existing chain config, signing and submitting with the provided wallet.
   *
   * @param wallet - EVM signer (must be the pool owner)
   * @param params - Remove remote pool addresses parameters
   * @returns Result with `txHash` of the last transaction
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPRemoveRemotePoolAddressesParamsInvalidError} if params are invalid
   * @throws {@link CCIPRemoveRemotePoolAddressesFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.removeRemotePoolAddresses(wallet, {
   *   poolAddress: '0x1234...',
   *   remoteChainSelector: '16015286601757825753',
   *   remotePoolAddresses: ['0xd7BF...'],
   * })
   * ```
   */
  async removeRemotePoolAddresses(
    wallet: unknown,
    params: RemoveRemotePoolAddressesParams,
  ): Promise<RemoveRemotePoolAddressesResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedRemoveRemotePoolAddresses(params)

    this.logger.debug('removeRemotePoolAddresses: removing remote pool addresses...')

    try {
      let lastTxHash = ''
      for (const unsignedTx of unsigned.transactions) {
        const tx = await wallet.populateTransaction(unsignedTx)
        tx.from = undefined
        const response = await submitTransaction(wallet, tx, this.provider)

        this.logger.debug(
          'removeRemotePoolAddresses: waiting for confirmation, tx =',
          response.hash,
        )
        const receipt = await response.wait(1, 60_000)

        if (!receipt) {
          throw new CCIPRemoveRemotePoolAddressesFailedError('transaction receipt not received', {
            context: { txHash: response.hash },
          })
        }

        if (receipt.status === 0) {
          throw new CCIPRemoveRemotePoolAddressesFailedError('transaction reverted', {
            context: { txHash: response.hash },
          })
        }

        lastTxHash = response.hash
      }

      this.logger.info('removeRemotePoolAddresses: removed remote pool addresses, tx =', lastTxHash)

      return { txHash: lastTxHash }
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
   * Builds an unsigned transaction for updating rate limiter configurations on a token pool.
   *
   * Encodes `setRateLimitConfig(RateLimitConfigArgs[])` on the TokenPool 2.0 contract.
   * Each entry targets a specific remote chain selector with outbound/inbound rate limits.
   *
   * @param params - Set chain rate limiter config parameters
   * @returns Unsigned EVM transaction
   * @throws {@link CCIPSetRateLimiterConfigParamsInvalidError} if params are invalid
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedSetChainRateLimiterConfig({
   *   poolAddress: '0x1234...',
   *   chainConfigs: [{
   *     remoteChainSelector: '16015286601757825753',
   *     outboundRateLimiterConfig: { isEnabled: true, capacity: '100000000000000000000000', rate: '167000000000000000000' },
   *     inboundRateLimiterConfig: { isEnabled: true, capacity: '100000000000000000000000', rate: '167000000000000000000' },
   *   }],
   * })
   * ```
   */
  async generateUnsignedSetChainRateLimiterConfig(
    params: SetChainRateLimiterConfigParams,
  ): Promise<UnsignedEVMTx> {
    validateSetChainRateLimiterConfigParams(params)

    const { version, abi } = await this.getPoolVersionAndABI(params.poolAddress)
    const iface = new Interface(abi)

    const transactions: TransactionRequest[] = []

    if (version >= CCIPVersion.V2_0) {
      // v2.0: setRateLimitConfig(RateLimitConfigArgs[]) — batch with customBlockConfirmations
      const rateLimitConfigArgs = params.chainConfigs.map((config) => ({
        remoteChainSelector: config.remoteChainSelector,
        customBlockConfirmations: config.customBlockConfirmations ?? false,
        outboundRateLimiterConfig: {
          isEnabled: config.outboundRateLimiterConfig.isEnabled,
          capacity: BigInt(config.outboundRateLimiterConfig.capacity),
          rate: BigInt(config.outboundRateLimiterConfig.rate),
        },
        inboundRateLimiterConfig: {
          isEnabled: config.inboundRateLimiterConfig.isEnabled,
          capacity: BigInt(config.inboundRateLimiterConfig.capacity),
          rate: BigInt(config.inboundRateLimiterConfig.rate),
        },
      }))
      const data = iface.encodeFunctionData('setRateLimitConfig', [rateLimitConfigArgs])
      transactions.push({ to: params.poolAddress, data })
    } else {
      // v1.5/v1.6: setChainRateLimiterConfig(selector, outbound, inbound) — one per chain
      for (const config of params.chainConfigs) {
        const data = iface.encodeFunctionData('setChainRateLimiterConfig', [
          config.remoteChainSelector,
          {
            isEnabled: config.outboundRateLimiterConfig.isEnabled,
            capacity: BigInt(config.outboundRateLimiterConfig.capacity),
            rate: BigInt(config.outboundRateLimiterConfig.rate),
          },
          {
            isEnabled: config.inboundRateLimiterConfig.isEnabled,
            capacity: BigInt(config.inboundRateLimiterConfig.capacity),
            rate: BigInt(config.inboundRateLimiterConfig.rate),
          },
        ])
        transactions.push({ to: params.poolAddress, data })
      }
    }

    this.logger.debug(
      'generateUnsignedSetChainRateLimiterConfig: pool =',
      params.poolAddress,
      'version =',
      version,
      'configs =',
      params.chainConfigs.length,
    )

    return { family: ChainFamily.EVM, transactions }
  }

  /**
   * Updates rate limiter configurations on a token pool, signing and submitting with the provided wallet.
   *
   * @param wallet - EVM signer (must be the pool owner or rate limit admin)
   * @param params - Set chain rate limiter config parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPSetRateLimiterConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPSetRateLimiterConfigFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.setChainRateLimiterConfig(wallet, {
   *   poolAddress: '0x1234...',
   *   chainConfigs: [{
   *     remoteChainSelector: '16015286601757825753',
   *     outboundRateLimiterConfig: { isEnabled: true, capacity: '100000000000000000000000', rate: '167000000000000000000' },
   *     inboundRateLimiterConfig: { isEnabled: true, capacity: '100000000000000000000000', rate: '167000000000000000000' },
   *   }],
   * })
   * ```
   */
  async setChainRateLimiterConfig(
    wallet: unknown,
    params: SetChainRateLimiterConfigParams,
  ): Promise<SetChainRateLimiterConfigResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedSetChainRateLimiterConfig(params)

    this.logger.debug('setChainRateLimiterConfig: updating rate limits...')

    try {
      let lastTxHash = ''
      for (const unsignedTx of unsigned.transactions) {
        const tx = await wallet.populateTransaction(unsignedTx)
        tx.from = undefined
        const response = await submitTransaction(wallet, tx, this.provider)

        this.logger.debug(
          'setChainRateLimiterConfig: waiting for confirmation, tx =',
          response.hash,
        )
        const receipt = await response.wait(1, 60_000)

        if (!receipt) {
          throw new CCIPSetRateLimiterConfigFailedError('transaction receipt not received', {
            context: { txHash: response.hash },
          })
        }

        if (receipt.status === 0) {
          throw new CCIPSetRateLimiterConfigFailedError('transaction reverted', {
            context: { txHash: response.hash },
          })
        }

        lastTxHash = response.hash
      }

      this.logger.info('setChainRateLimiterConfig: updated rate limits, tx =', lastTxHash)

      return { txHash: lastTxHash }
    } catch (error) {
      if (error instanceof CCIPSetRateLimiterConfigFailedError) throw error
      if (error instanceof CCIPSetRateLimiterConfigParamsInvalidError) throw error
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
   * Builds an unsigned transaction to set the rate limit admin on a token pool.
   *
   * Automatically detects the pool version:
   * - **v1.5/v1.6**: uses `setRateLimitAdmin(address)`
   * - **v2.0+**: uses `setDynamicConfig(router, rateLimitAdmin, feeAdmin)` — reads current
   *   dynamic config first and preserves `router` and `feeAdmin` values
   *
   * @param params - Set rate limit admin parameters
   * @returns Unsigned EVM transaction set
   * @throws {@link CCIPSetRateLimitAdminParamsInvalidError} if params are invalid
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedSetRateLimitAdmin({
   *   poolAddress: '0x1234...',
   *   rateLimitAdmin: '0xabcd...',
   * })
   * ```
   */
  async generateUnsignedSetRateLimitAdmin(params: SetRateLimitAdminParams): Promise<UnsignedEVMTx> {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCIPSetRateLimitAdminParamsInvalidError('poolAddress', 'must be non-empty')
    }
    if (!params.rateLimitAdmin || params.rateLimitAdmin.trim().length === 0) {
      throw new CCIPSetRateLimitAdminParamsInvalidError('rateLimitAdmin', 'must be non-empty')
    }

    const { version, abi } = await this.getPoolVersionAndABI(params.poolAddress)
    const iface = new Interface(abi)

    let data: string

    if (version >= CCIPVersion.V2_0) {
      // v2.0: read current dynamic config, update only rateLimitAdmin
      const contract = new Contract(params.poolAddress, abi, this.provider)
      const [router, , feeAdmin] = (await contract.getFunction('getDynamicConfig')()) as [
        string,
        unknown,
        string,
      ]
      data = iface.encodeFunctionData('setDynamicConfig', [router, params.rateLimitAdmin, feeAdmin])
    } else {
      // v1.5/v1.6: standalone setRateLimitAdmin(address)
      data = iface.encodeFunctionData('setRateLimitAdmin', [params.rateLimitAdmin])
    }

    const tx: TransactionRequest = { to: params.poolAddress, data }

    this.logger.debug(
      'generateUnsignedSetRateLimitAdmin: pool =',
      params.poolAddress,
      'version =',
      version,
      'admin =',
      params.rateLimitAdmin,
    )

    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /**
   * Sets the rate limit admin on a token pool, signing and submitting with the provided wallet.
   *
   * @param wallet - EVM signer (must be the pool owner)
   * @param params - Set rate limit admin parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPSetRateLimitAdminParamsInvalidError} if params are invalid
   * @throws {@link CCIPSetRateLimitAdminFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.setRateLimitAdmin(wallet, {
   *   poolAddress: '0x1234...',
   *   rateLimitAdmin: '0xabcd...',
   * })
   * ```
   */
  async setRateLimitAdmin(
    wallet: unknown,
    params: SetRateLimitAdminParams,
  ): Promise<SetRateLimitAdminResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedSetRateLimitAdmin(params)
    let tx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('setRateLimitAdmin: updating rate limit admin...')

    try {
      tx = await wallet.populateTransaction(tx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('setRateLimitAdmin: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPSetRateLimitAdminFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPSetRateLimitAdminFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('setRateLimitAdmin: updated rate limit admin, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPSetRateLimitAdminFailedError) throw error
      if (error instanceof CCIPSetRateLimitAdminParamsInvalidError) throw error
      throw new CCIPSetRateLimitAdminFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // provideLiquidity (lock-release pools)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Builds the unsigned transactions to provide liquidity to a lock-release token pool.
   *
   * Lock-release pools must hold (or have access to) token liquidity so they can
   * release tokens for inbound CCIP transfers. Burn-mint pools mint on demand and
   * therefore have no liquidity — this method rejects non-lock-release pools.
   *
   * Returns **two** transactions, `[approveTx, provideTx]`:
   * 1. ERC20 `approve(spender, amount)` on the pool's token.
   * 2. The version-specific provide call:
   *    - **v1.5 / v1.6**: `pool.provideLiquidity(amount)` — liquidity held by the pool,
   *      spender is the pool (caller must be the pool's rebalancer).
   *    - **v2.0**: `lockBox.deposit(token, 0, amount)` on the pool's `ERC20LockBox`
   *      (resolved via `pool.getLockBox()`), spender is the lock box. The
   *      `remoteChainSelector` deposit arg is unused on-chain (passed as `0`).
   *
   * @param params - Provide liquidity parameters
   * @returns Unsigned EVM transaction set with `[approveTx, provideTx]`
   * @throws {@link CCIPProvideLiquidityParamsInvalidError} if params are invalid or the pool is not lock-release
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedProvideLiquidity({
   *   poolAddress: '0x1234...',
   *   amount: 1_000n * 10n ** 18n,
   * })
   * // unsigned.transactions === [approveTx, provideTx]
   * ```
   */
  async generateUnsignedProvideLiquidity(params: ProvideLiquidityParams): Promise<UnsignedEVMTx> {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCIPProvideLiquidityParamsInvalidError('poolAddress', 'must be non-empty')
    }
    if (params.amount <= 0n) {
      throw new CCIPProvideLiquidityParamsInvalidError('amount', 'must be greater than 0')
    }

    // DX guard: provide-liquidity is meaningful only for lock-release pools.
    const [poolType] = await this.typeAndVersion(params.poolAddress)
    if (!poolType.includes('LockRelease')) {
      throw new CCIPProvideLiquidityParamsInvalidError(
        'poolAddress',
        `provide-liquidity is only supported for lock-release pools (got ${poolType})`,
      )
    }

    const { version, abi } = await this.getPoolVersionAndABI(params.poolAddress)
    const poolContract = new Contract(params.poolAddress, abi, this.provider)
    const token = (await poolContract.getFunction('getToken')()) as string

    // Minimal ERC20 approve interface — spender depends on the pool version.
    const erc20Iface = new Interface(['function approve(address spender, uint256 amount)'])

    let spender: string
    let provideTx: TransactionRequest
    if (version >= CCIPVersion.V2_0) {
      // v2.0: liquidity lives in a separate ERC20LockBox; deposit is permissionless.
      const lockBox = (await poolContract.getFunction('getLockBox')()) as string
      spender = lockBox
      const lockBoxIface = new Interface(ERC20LockBoxABI)
      // deposit(address token, uint64 remoteChainSelector, uint256 amount) — selector arg unused.
      provideTx = {
        to: lockBox,
        data: lockBoxIface.encodeFunctionData('deposit', [token, 0n, params.amount]),
      }
    } else {
      // v1.5/v1.6: liquidity held by the pool itself; caller must be the rebalancer.
      spender = params.poolAddress
      const poolIface = new Interface(abi)
      provideTx = {
        to: params.poolAddress,
        data: poolIface.encodeFunctionData('provideLiquidity', [params.amount]),
      }
    }

    const approveTx: TransactionRequest = {
      to: token,
      data: erc20Iface.encodeFunctionData('approve', [spender, params.amount]),
    }

    this.logger.debug(
      'generateUnsignedProvideLiquidity: pool =',
      params.poolAddress,
      'version =',
      version,
      'token =',
      token,
      'spender =',
      spender,
      'amount =',
      params.amount,
    )

    return { family: ChainFamily.EVM, transactions: [approveTx, provideTx] }
  }

  /**
   * Provides liquidity to a lock-release token pool, signing and submitting with the
   * provided wallet. Submits the two transactions sequentially — `approve` first
   * (awaited), then the version-specific provide/deposit — and returns the hash of
   * the provide/deposit transaction.
   *
   * @param wallet - EVM signer (must hold the token; v1.x also requires the rebalancer role)
   * @param params - Provide liquidity parameters
   * @returns Result with `txHash` (the provide/deposit transaction hash)
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPProvideLiquidityParamsInvalidError} if params are invalid
   * @throws {@link CCIPProvideLiquidityFailedError} if either transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.provideLiquidity(wallet, {
   *   poolAddress: '0x1234...',
   *   amount: 1_000n * 10n ** 18n,
   * })
   * ```
   */
  async provideLiquidity(
    wallet: unknown,
    params: ProvideLiquidityParams,
  ): Promise<ProvideLiquidityResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    // v2.0 lock-release: the ERC20LockBox gates deposit() to authorized callers
    // (`AuthorizedCallers`), so the lockbox owner must authorize the depositor first.
    // Do it transparently when the caller isn't already authorized.
    const [poolType, version] = await this.typeAndVersion(params.poolAddress)
    if (version >= CCIPVersion.V2_0 && poolType.includes('LockRelease')) {
      const poolContract = new Contract(params.poolAddress, TokenPool_2_0_ABI, this.provider)
      const lockBox = (await poolContract.getFunction('getLockBox')()) as string
      const lockBoxContract = new Contract(lockBox, ERC20LockBoxABI, this.provider)
      const caller = await wallet.getAddress()
      const authorized = (await lockBoxContract
        .getFunction('getAllAuthorizedCallers')()
        .catch(() => [] as string[])) as string[]
      if (!authorized.some((a) => a.toLowerCase() === caller.toLowerCase())) {
        this.logger.debug('provideLiquidity: authorizing caller on lockbox', lockBox)
        const authData = new Interface(ERC20LockBoxABI).encodeFunctionData(
          'applyAuthorizedCallerUpdates',
          [{ addedCallers: [caller], removedCallers: [] }],
        )
        const authTx = await wallet.populateTransaction({ to: lockBox, data: authData })
        authTx.from = undefined
        const authResp = await submitTransaction(wallet, authTx, this.provider)
        const authReceipt = await authResp.wait(1, 60_000)
        if (!authReceipt || authReceipt.status === 0) {
          throw new CCIPProvideLiquidityFailedError(
            'failed to authorize caller on the ERC20LockBox (caller must be the lockbox owner)',
            { context: { txHash: authResp.hash } },
          )
        }
      }
    }

    const unsigned = await this.generateUnsignedProvideLiquidity(params)
    const [approveTxReq, provideTxReq] = unsigned.transactions as [
      TransactionRequest,
      TransactionRequest,
    ]

    try {
      // 1. approve — must confirm before the provide/deposit can pull the tokens.
      this.logger.debug('provideLiquidity: approving token spend...')
      const approveTx = await wallet.populateTransaction(approveTxReq)
      approveTx.from = undefined
      const approveResp = await submitTransaction(wallet, approveTx, this.provider)
      this.logger.debug('provideLiquidity: waiting for approve, tx =', approveResp.hash)
      const approveReceipt = await approveResp.wait(1, 60_000)
      if (!approveReceipt) {
        throw new CCIPProvideLiquidityFailedError('approve receipt not received', {
          context: { txHash: approveResp.hash },
        })
      }
      if (approveReceipt.status === 0) {
        throw new CCIPProvideLiquidityFailedError('approve transaction reverted', {
          context: { txHash: approveResp.hash },
        })
      }

      // 2. provide/deposit.
      this.logger.debug('provideLiquidity: providing liquidity...')
      const provideTx = await wallet.populateTransaction(provideTxReq)
      provideTx.from = undefined
      const provideResp = await submitTransaction(wallet, provideTx, this.provider)
      this.logger.debug('provideLiquidity: waiting for confirmation, tx =', provideResp.hash)
      const provideReceipt = await provideResp.wait(1, 60_000)
      if (!provideReceipt) {
        throw new CCIPProvideLiquidityFailedError('transaction receipt not received', {
          context: { txHash: provideResp.hash },
        })
      }
      if (provideReceipt.status === 0) {
        throw new CCIPProvideLiquidityFailedError('transaction reverted', {
          context: { txHash: provideResp.hash },
        })
      }

      this.logger.info('provideLiquidity: liquidity provided, tx =', provideResp.hash)
      return { txHash: provideResp.hash }
    } catch (error) {
      if (error instanceof CCIPProvideLiquidityFailedError) throw error
      if (error instanceof CCIPProvideLiquidityParamsInvalidError) throw error
      throw new CCIPProvideLiquidityFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // setTokenTransferFeeConfig (EVM v2.0+ only)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Builds an unsigned transaction to set per-destination token-transfer fee
   * configs on a token pool. **EVM v2.0+ pools only.**
   *
   * Encodes `applyTokenTransferFeeConfigUpdates(args[], disableSelectors[])` in a
   * single transaction: `updates` become the fee-config args, `disable` becomes the
   * list of destination selectors to clear. Access: pool owner or fee admin.
   *
   * @param params - Set token transfer fee config parameters
   * @returns Unsigned EVM transaction set (single tx)
   * @throws {@link CCIPSetTokenTransferFeeConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPSetTokenTransferFeeConfigFailedError} if the pool is not v2.0+
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedSetTokenTransferFeeConfig({
   *   poolAddress: '0x1234...',
   *   updates: [{
   *     remoteChainSelector: 14767482510784806043n,
   *     config: {
   *       destGasOverhead: 90000, destBytesOverhead: 32,
   *       finalityFeeUSDCents: 10, fastFinalityFeeUSDCents: 50,
   *       finalityTransferFeeBps: 5, fastFinalityTransferFeeBps: 25,
   *       isEnabled: true,
   *     },
   *   }],
   *   disable: [],
   * })
   * ```
   */
  async generateUnsignedSetTokenTransferFeeConfig(
    params: SetTokenTransferFeeConfigParams,
  ): Promise<UnsignedEVMTx> {
    validateSetTokenTransferFeeConfigParams(params)

    const { version, abi } = await this.getPoolVersionAndABI(params.poolAddress)
    if (version < CCIPVersion.V2_0) {
      throw new CCIPSetTokenTransferFeeConfigFailedError(
        `setTokenTransferFeeConfig is only available on EVM v2.0+ pools (pool version: ${version})`,
      )
    }

    const iface = new Interface(abi)

    const feeConfigArgs = params.updates.map((u) => ({
      destChainSelector: u.remoteChainSelector,
      tokenTransferFeeConfig: {
        destGasOverhead: u.config.destGasOverhead,
        destBytesOverhead: u.config.destBytesOverhead,
        finalityFeeUSDCents: u.config.finalityFeeUSDCents,
        fastFinalityFeeUSDCents: u.config.fastFinalityFeeUSDCents,
        finalityTransferFeeBps: u.config.finalityTransferFeeBps,
        fastFinalityTransferFeeBps: u.config.fastFinalityTransferFeeBps,
        isEnabled: u.config.isEnabled,
      },
    }))
    const disableSelectors = (params.disable ?? []).map((s) => BigInt(s))

    const data = iface.encodeFunctionData('applyTokenTransferFeeConfigUpdates', [
      feeConfigArgs,
      disableSelectors,
    ])
    const tx: TransactionRequest = { to: params.poolAddress, data }

    this.logger.debug(
      'generateUnsignedSetTokenTransferFeeConfig: pool =',
      params.poolAddress,
      'version =',
      version,
      'updates =',
      feeConfigArgs.length,
      'disable =',
      disableSelectors.length,
    )

    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /**
   * Sets per-destination token-transfer fee configs on a token pool, signing and
   * submitting with the provided wallet. **EVM v2.0+ pools only.**
   *
   * @param wallet - EVM signer (must be the pool owner or fee admin)
   * @param params - Set token transfer fee config parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPSetTokenTransferFeeConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPSetTokenTransferFeeConfigFailedError} if the transaction fails or the pool is not v2.0+
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.setTokenTransferFeeConfig(wallet, {
   *   poolAddress: '0x1234...',
   *   updates: [{ remoteChainSelector: 14767482510784806043n, config: { ... } }],
   * })
   * ```
   */
  async setTokenTransferFeeConfig(
    wallet: unknown,
    params: SetTokenTransferFeeConfigParams,
  ): Promise<SetTokenTransferFeeConfigResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedSetTokenTransferFeeConfig(params)
    let tx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('setTokenTransferFeeConfig: updating token transfer fee config...')

    try {
      tx = await wallet.populateTransaction(tx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('setTokenTransferFeeConfig: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPSetTokenTransferFeeConfigFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPSetTokenTransferFeeConfigFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('setTokenTransferFeeConfig: updated fee config, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPSetTokenTransferFeeConfigFailedError) throw error
      if (error instanceof CCIPSetTokenTransferFeeConfigParamsInvalidError) throw error
      throw new CCIPSetTokenTransferFeeConfigFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // setAllowedFinalityConfig (EVM v2.0+ only)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Builds an unsigned transaction to set the bytes4 allowed-finality config on a
   * token pool. **EVM v2.0+ pools only.**
   *
   * Encodes the desired finality to a uint32 via the SDK finality codec
   * ({@link encodeFinality}) and serializes it as a bytes4 for
   * `setAllowedFinalityConfig(bytes4)`. Access: pool owner.
   *
   * @param params - Set allowed finality config parameters
   * @returns Unsigned EVM transaction set (single tx)
   * @throws {@link CCIPSetAllowedFinalityConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPSetAllowedFinalityConfigFailedError} if the pool is not v2.0+
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedSetAllowedFinalityConfig({
   *   poolAddress: '0x1234...',
   *   finality: 5, // allow FTF down to 5 block confirmations
   * })
   * ```
   */
  async generateUnsignedSetAllowedFinalityConfig(
    params: SetAllowedFinalityConfigParams,
  ): Promise<UnsignedEVMTx> {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCIPSetAllowedFinalityConfigParamsInvalidError('poolAddress', 'must be non-empty')
    }

    const { version, abi } = await this.getPoolVersionAndABI(params.poolAddress)
    if (version < CCIPVersion.V2_0) {
      throw new CCIPSetAllowedFinalityConfigFailedError(
        `setAllowedFinalityConfig is only available on EVM v2.0+ pools (pool version: ${version})`,
      )
    }

    // encodeFinality may throw CCIPExtraArgsParseError on out-of-range block depth.
    let allowedFinality: string
    try {
      allowedFinality = toBeHex(encodeFinality(params.finality), 4)
    } catch (error) {
      throw new CCIPSetAllowedFinalityConfigParamsInvalidError(
        'finality',
        error instanceof Error ? error.message : String(error),
      )
    }

    const iface = new Interface(abi)
    const data = iface.encodeFunctionData('setAllowedFinalityConfig', [allowedFinality])
    const tx: TransactionRequest = { to: params.poolAddress, data }

    this.logger.debug(
      'generateUnsignedSetAllowedFinalityConfig: pool =',
      params.poolAddress,
      'version =',
      version,
      'allowedFinality =',
      allowedFinality,
    )

    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /**
   * Sets the allowed-finality config on a token pool, signing and submitting with
   * the provided wallet. **EVM v2.0+ pools only.**
   *
   * @param wallet - EVM signer (must be the pool owner)
   * @param params - Set allowed finality config parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPSetAllowedFinalityConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPSetAllowedFinalityConfigFailedError} if the transaction fails or the pool is not v2.0+
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.setAllowedFinalityConfig(wallet, {
   *   poolAddress: '0x1234...',
   *   finality: 'finalized',
   * })
   * ```
   */
  async setAllowedFinalityConfig(
    wallet: unknown,
    params: SetAllowedFinalityConfigParams,
  ): Promise<SetAllowedFinalityConfigResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedSetAllowedFinalityConfig(params)
    let tx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('setAllowedFinalityConfig: updating allowed finality config...')

    try {
      tx = await wallet.populateTransaction(tx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('setAllowedFinalityConfig: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPSetAllowedFinalityConfigFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPSetAllowedFinalityConfigFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('setAllowedFinalityConfig: updated allowed finality, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPSetAllowedFinalityConfigFailedError) throw error
      if (error instanceof CCIPSetAllowedFinalityConfigParamsInvalidError) throw error
      throw new CCIPSetAllowedFinalityConfigFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // setFeeAdmin (EVM v2.0+ only)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Builds an unsigned transaction to set the fee admin on a token pool.
   * **EVM v2.0+ pools only.**
   *
   * Reads the current dynamic config `(router, rateLimitAdmin, feeAdmin)` and
   * rewrites only `feeAdmin` via `setDynamicConfig(router, rateLimitAdmin, feeAdmin)`,
   * preserving `router` and `rateLimitAdmin`. Access: pool owner.
   *
   * @param params - Set fee admin parameters
   * @returns Unsigned EVM transaction set (single tx)
   * @throws {@link CCIPSetFeeAdminParamsInvalidError} if params are invalid
   * @throws {@link CCIPSetFeeAdminFailedError} if the pool is not v2.0+
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedSetFeeAdmin({
   *   poolAddress: '0x1234...',
   *   feeAdmin: '0xabcd...',
   * })
   * ```
   */
  async generateUnsignedSetFeeAdmin(params: SetFeeAdminParams): Promise<UnsignedEVMTx> {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCIPSetFeeAdminParamsInvalidError('poolAddress', 'must be non-empty')
    }
    if (!params.feeAdmin || params.feeAdmin.trim().length === 0) {
      throw new CCIPSetFeeAdminParamsInvalidError('feeAdmin', 'must be non-empty')
    }

    const { version, abi } = await this.getPoolVersionAndABI(params.poolAddress)
    if (version < CCIPVersion.V2_0) {
      throw new CCIPSetFeeAdminFailedError(
        `setFeeAdmin is only available on EVM v2.0+ pools (pool version: ${version})`,
      )
    }

    const iface = new Interface(abi)
    // Read current dynamic config, update only feeAdmin.
    const contract = new Contract(params.poolAddress, abi, this.provider)
    const [router, rateLimitAdmin] = (await contract.getFunction('getDynamicConfig')()) as [
      string,
      string,
      unknown,
    ]
    const data = iface.encodeFunctionData('setDynamicConfig', [
      router,
      rateLimitAdmin,
      params.feeAdmin,
    ])
    const tx: TransactionRequest = { to: params.poolAddress, data }

    this.logger.debug(
      'generateUnsignedSetFeeAdmin: pool =',
      params.poolAddress,
      'version =',
      version,
      'feeAdmin =',
      params.feeAdmin,
    )

    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /**
   * Sets the fee admin on a token pool, signing and submitting with the provided
   * wallet. **EVM v2.0+ pools only.**
   *
   * @param wallet - EVM signer (must be the pool owner)
   * @param params - Set fee admin parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPSetFeeAdminParamsInvalidError} if params are invalid
   * @throws {@link CCIPSetFeeAdminFailedError} if the transaction fails or the pool is not v2.0+
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.setFeeAdmin(wallet, {
   *   poolAddress: '0x1234...',
   *   feeAdmin: '0xabcd...',
   * })
   * ```
   */
  async setFeeAdmin(wallet: unknown, params: SetFeeAdminParams): Promise<SetFeeAdminResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedSetFeeAdmin(params)
    let tx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('setFeeAdmin: updating fee admin...')

    try {
      tx = await wallet.populateTransaction(tx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('setFeeAdmin: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPSetFeeAdminFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPSetFeeAdminFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('setFeeAdmin: updated fee admin, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPSetFeeAdminFailedError) throw error
      if (error instanceof CCIPSetFeeAdminParamsInvalidError) throw error
      throw new CCIPSetFeeAdminFailedError(error instanceof Error ? error.message : String(error), {
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  // ── Grant Mint/Burn Access ─────────────────────────────────────────────

  /**
   * Builds an unsigned transaction for granting mint and burn roles on a
   * CrossChainToken token to the specified authority address.
   *
   * Calls `grantMintAndBurnRoles(authority)` on the token contract.
   *
   * @param params - Grant mint/burn access parameters
   * @returns Unsigned EVM transaction set
   * @throws {@link CCIPGrantMintBurnAccessParamsInvalidError} if params are invalid
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedGrantMintBurnAccess({
   *   tokenAddress: '0xa42BA...',
   *   authority: '0x1234...',
   * })
   * ```
   */
  generateUnsignedGrantMintBurnAccess(params: GrantMintBurnAccessParams): UnsignedEVMTx {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCIPGrantMintBurnAccessParamsInvalidError('tokenAddress', 'must be non-empty')
    }
    if (!params.authority || params.authority.trim().length === 0) {
      throw new CCIPGrantMintBurnAccessParamsInvalidError('authority', 'must be non-empty')
    }

    const role = params.role ?? 'mintAndBurn'

    // CrossChainToken: AccessControl roles, plus the `grantMintAndBurnRoles` convenience setter.
    const iface = new Interface(CrossChainTokenABI)
    let data: string
    switch (role) {
      case 'mint':
        data = iface.encodeFunctionData('grantRole', [MINTER_ROLE, params.authority])
        break
      case 'burn':
        data = iface.encodeFunctionData('grantRole', [BURNER_ROLE, params.authority])
        break
      case 'mintAndBurn':
      default:
        data = iface.encodeFunctionData('grantMintAndBurnRoles', [params.authority])
        break
    }

    const tx: TransactionRequest = { to: params.tokenAddress, data }

    this.logger.debug(
      'generateUnsignedGrantMintBurnAccess: token =',
      params.tokenAddress,
      'authority =',
      params.authority,
      'role =',
      role,
    )

    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /**
   * Grants mint and burn roles on a CrossChainToken token, signing and
   * submitting with the provided wallet.
   *
   * @param wallet - EVM signer (must be the token owner)
   * @param params - Grant mint/burn access parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPGrantMintBurnAccessParamsInvalidError} if params are invalid
   * @throws {@link CCIPGrantMintBurnAccessFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.grantMintBurnAccess(wallet, {
   *   tokenAddress: '0xa42BA...',
   *   authority: '0x1234...',
   * })
   * ```
   */
  async grantMintBurnAccess(
    wallet: unknown,
    params: GrantMintBurnAccessParams,
  ): Promise<GrantMintBurnAccessResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = this.generateUnsignedGrantMintBurnAccess(params)
    let tx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('grantMintBurnAccess: granting mint/burn roles...')

    try {
      tx = await wallet.populateTransaction(tx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('grantMintBurnAccess: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPGrantMintBurnAccessFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPGrantMintBurnAccessFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('grantMintBurnAccess: granted mint/burn roles, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPGrantMintBurnAccessFailedError) throw error
      if (error instanceof CCIPGrantMintBurnAccessParamsInvalidError) throw error
      throw new CCIPGrantMintBurnAccessFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Revoke Mint/Burn Access ───────────────────────────────────────────────

  /**
   * Builds an unsigned transaction to revoke mint or burn access from an
   * address on a CrossChainToken token.
   *
   * @param params - Revoke mint/burn access parameters
   * @returns Unsigned EVM transaction
   * @throws {@link CCIPRevokeMintBurnAccessParamsInvalidError} if params are invalid
   */
  generateUnsignedRevokeMintBurnAccess(params: RevokeMintBurnAccessParams): UnsignedEVMTx {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCIPRevokeMintBurnAccessParamsInvalidError('tokenAddress', 'must be non-empty')
    }
    if (!params.authority || params.authority.trim().length === 0) {
      throw new CCIPRevokeMintBurnAccessParamsInvalidError('authority', 'must be non-empty')
    }
    if ((params.role as string) !== 'mint' && (params.role as string) !== 'burn') {
      throw new CCIPRevokeMintBurnAccessParamsInvalidError('role', "must be 'mint' or 'burn'")
    }

    // CrossChainToken: AccessControl `revokeRole(role, account)`.
    const iface = new Interface(CrossChainTokenABI)
    const data =
      params.role === 'mint'
        ? iface.encodeFunctionData('revokeRole', [MINTER_ROLE, params.authority])
        : iface.encodeFunctionData('revokeRole', [BURNER_ROLE, params.authority])

    const tx: TransactionRequest = { to: params.tokenAddress, data }

    this.logger.debug(
      'generateUnsignedRevokeMintBurnAccess: token =',
      params.tokenAddress,
      'authority =',
      params.authority,
      'role =',
      params.role,
    )

    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /**
   * Revokes mint or burn access from an address on a CrossChainToken token,
   * signing and submitting with the provided wallet.
   *
   * @param wallet - EVM signer (must be the token owner)
   * @param params - Revoke mint/burn access parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPRevokeMintBurnAccessParamsInvalidError} if params are invalid
   * @throws {@link CCIPRevokeMintBurnAccessFailedError} if the transaction fails
   */
  async revokeMintBurnAccess(
    wallet: unknown,
    params: RevokeMintBurnAccessParams,
  ): Promise<RevokeMintBurnAccessResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = this.generateUnsignedRevokeMintBurnAccess(params)
    let tx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('revokeMintBurnAccess: revoking', params.role, 'role...')

    try {
      tx = await wallet.populateTransaction(tx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('revokeMintBurnAccess: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPRevokeMintBurnAccessFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPRevokeMintBurnAccessFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('revokeMintBurnAccess: revoked', params.role, 'role, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPRevokeMintBurnAccessFailedError) throw error
      if (error instanceof CCIPRevokeMintBurnAccessParamsInvalidError) throw error
      throw new CCIPRevokeMintBurnAccessFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Get Mint/Burn Roles (read-only) ──────────────────────────────────────

  /**
   * Queries mint and burn role holders on a CrossChainToken token.
   *
   * Tries `AccessControlEnumerable` (`getRoleMemberCount` / `getRoleMember`)
   * first. If the contract only implements `AccessControl` (no enumeration),
   * falls back to scanning `RoleGranted` events and verifying with `hasRole`.
   *
   * @param tokenAddress - ERC20 contract address
   * @returns Lists of minter and burner addresses
   *
   * @example
   * ```typescript
   * const { minters, burners } = await admin.getMintBurnRoles('0xa42BA...')
   * ```
   */
  async getMintBurnRoles(tokenAddress: string): Promise<EVMMintBurnRolesResult> {
    // CrossChainToken uses (non-enumerable) OZ AccessControl, so there is no
    // getMinters()/getBurners() or getRoleMember() enumeration. Scan `RoleGranted`
    // events and verify each candidate still holds the role via `hasRole`.
    // Uses getEvmLogs for consistent pagination + archive-RPC fallback.
    const contract = new Contract(tokenAddress, CrossChainTokenABI, this.provider)
    const minterRole = MINTER_ROLE
    const burnerRole = BURNER_ROLE
    const roleGrantedTopic = Interface.from(CrossChainTokenABI).getEvent('RoleGranted')!.topicHash

    const scanLogs = async (roleTopic: string) => {
      const logs: ChainLog[] = []
      for await (const log of getEvmLogs(
        {
          address: tokenAddress,
          topics: [[roleGrantedTopic], roleTopic],
          startBlock: 1,
        },
        this,
      )) {
        logs.push(log)
      }
      return logs
    }

    const [minterGrantedLogs, burnerGrantedLogs] = await Promise.all([
      scanLogs(minterRole),
      scanLogs(burnerRole),
    ])

    // Collect unique candidate addresses from event topic[2] (indexed `account`)
    const minterCandidates = [
      ...new Set(
        minterGrantedLogs.map(
          (l) => AbiCoder.defaultAbiCoder().decode(['address'], l.topics[2]!)[0] as string,
        ),
      ),
    ]
    const burnerCandidates = [
      ...new Set(
        burnerGrantedLogs.map(
          (l) => AbiCoder.defaultAbiCoder().decode(['address'], l.topics[2]!)[0] as string,
        ),
      ),
    ]

    // Verify each candidate still has the role
    const [minterChecks, burnerChecks] = await Promise.all([
      Promise.all(
        minterCandidates.map((addr) =>
          (contract.getFunction('hasRole')(minterRole, addr) as Promise<boolean>).then((has) =>
            has ? addr : null,
          ),
        ),
      ),
      Promise.all(
        burnerCandidates.map((addr) =>
          (contract.getFunction('hasRole')(burnerRole, addr) as Promise<boolean>).then((has) =>
            has ? addr : null,
          ),
        ),
      ),
    ])

    const minters = minterChecks.filter((a): a is string => a !== null)
    const burners = burnerChecks.filter((a): a is string => a !== null)

    this.logger.debug(
      `getMintBurnRoles: event scan path, token=${tokenAddress}, minters=${minters.length}, burners=${burners.length}`,
    )

    return { minters, burners }
  }

  // ── Transfer Ownership ───────────────────────────────────────────────────

  /**
   * Builds an unsigned transaction for proposing a new pool owner.
   *
   * Encodes `transferOwnership(address to)` on the pool contract.
   *
   * @param params - Transfer ownership parameters
   * @returns Unsigned EVM transaction
   * @throws {@link CCIPTransferOwnershipParamsInvalidError} if params are invalid
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedTransferOwnership({
   *   poolAddress: '0x1234...',
   *   newOwner: '0xabcd...',
   * })
   * ```
   */
  async generateUnsignedTransferOwnership(params: TransferOwnershipParams): Promise<UnsignedEVMTx> {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCIPTransferOwnershipParamsInvalidError('poolAddress', 'must be non-empty')
    }
    if (!params.newOwner || params.newOwner.trim().length === 0) {
      throw new CCIPTransferOwnershipParamsInvalidError('newOwner', 'must be non-empty')
    }

    const { version, abi } = await this.getPoolVersionAndABI(params.poolAddress)
    const iface = new Interface(abi)

    // All versions (v1.5, v1.6, v2.0) use the same transferOwnership(address) signature
    // inherited from OpenZeppelin Ownable2Step. Version-aware branching kept for
    // forward-compatibility — if a future version changes the signature, add a branch here.
    let data: string
    if (version >= CCIPVersion.V2_0) {
      data = iface.encodeFunctionData('transferOwnership', [params.newOwner])
    } else {
      data = iface.encodeFunctionData('transferOwnership', [params.newOwner])
    }

    const tx: TransactionRequest = { to: params.poolAddress, data }

    this.logger.debug(
      'generateUnsignedTransferOwnership: pool =',
      params.poolAddress,
      'newOwner =',
      params.newOwner,
      'version =',
      version,
    )

    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /**
   * Proposes a new pool owner, signing and submitting with the provided wallet.
   *
   * @param wallet - EVM signer (must be the current pool owner)
   * @param params - Transfer ownership parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPTransferOwnershipParamsInvalidError} if params are invalid
   * @throws {@link CCIPTransferOwnershipFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.transferOwnership(wallet, {
   *   poolAddress: '0x1234...',
   *   newOwner: '0xabcd...',
   * })
   * ```
   */
  async transferOwnership(
    wallet: unknown,
    params: TransferOwnershipParams,
  ): Promise<OwnershipResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedTransferOwnership(params)
    let tx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('transferOwnership: proposing new owner...')

    try {
      tx = await wallet.populateTransaction(tx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('transferOwnership: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPTransferOwnershipFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPTransferOwnershipFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('transferOwnership: ownership proposed, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPTransferOwnershipFailedError) throw error
      if (error instanceof CCIPTransferOwnershipParamsInvalidError) throw error
      throw new CCIPTransferOwnershipFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Accept Ownership ─────────────────────────────────────────────────────

  /**
   * Builds an unsigned transaction for accepting pool ownership.
   *
   * Encodes `acceptOwnership()` on the pool contract.
   *
   * @param params - Accept ownership parameters
   * @returns Unsigned EVM transaction
   * @throws {@link CCIPAcceptOwnershipParamsInvalidError} if params are invalid
   *
   * @example
   * ```typescript
   * const unsigned = await admin.generateUnsignedAcceptOwnership({
   *   poolAddress: '0x1234...',
   * })
   * ```
   */
  async generateUnsignedAcceptOwnership(params: AcceptOwnershipParams): Promise<UnsignedEVMTx> {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCIPAcceptOwnershipParamsInvalidError('poolAddress', 'must be non-empty')
    }

    const { version, abi } = await this.getPoolVersionAndABI(params.poolAddress)
    const iface = new Interface(abi)

    // All versions (v1.5, v1.6, v2.0) use the same acceptOwnership() signature
    // inherited from OpenZeppelin Ownable2Step. Version-aware branching kept for
    // forward-compatibility — if a future version changes the signature, add a branch here.
    let data: string
    if (version >= CCIPVersion.V2_0) {
      data = iface.encodeFunctionData('acceptOwnership', [])
    } else {
      data = iface.encodeFunctionData('acceptOwnership', [])
    }

    const tx: TransactionRequest = { to: params.poolAddress, data }

    this.logger.debug(
      'generateUnsignedAcceptOwnership: pool =',
      params.poolAddress,
      'version =',
      version,
    )

    return { family: ChainFamily.EVM, transactions: [tx] }
  }

  /**
   * Accepts pool ownership, signing and submitting with the provided wallet.
   *
   * @param wallet - EVM signer (must be the pending/proposed owner)
   * @param params - Accept ownership parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Signer
   * @throws {@link CCIPAcceptOwnershipParamsInvalidError} if params are invalid
   * @throws {@link CCIPAcceptOwnershipFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.acceptOwnership(wallet, {
   *   poolAddress: '0x1234...',
   * })
   * ```
   */
  async acceptOwnership(wallet: unknown, params: AcceptOwnershipParams): Promise<OwnershipResult> {
    if (!isSigner(wallet)) throw new CCIPWalletInvalidError(wallet)

    const unsigned = await this.generateUnsignedAcceptOwnership(params)
    let tx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('acceptOwnership: accepting ownership...')

    try {
      tx = await wallet.populateTransaction(tx)
      tx.from = undefined
      const response = await submitTransaction(wallet, tx, this.provider)

      this.logger.debug('acceptOwnership: waiting for confirmation, tx =', response.hash)
      const receipt = await response.wait(1, 60_000)

      if (!receipt) {
        throw new CCIPAcceptOwnershipFailedError('transaction receipt not received', {
          context: { txHash: response.hash },
        })
      }

      if (receipt.status === 0) {
        throw new CCIPAcceptOwnershipFailedError('transaction reverted', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('acceptOwnership: ownership accepted, tx =', response.hash)

      return { txHash: response.hash }
    } catch (error) {
      if (error instanceof CCIPAcceptOwnershipFailedError) throw error
      if (error instanceof CCIPAcceptOwnershipParamsInvalidError) throw error
      throw new CCIPAcceptOwnershipFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }
}

export type { EVMRegistrationMethod } from '../types.ts'
