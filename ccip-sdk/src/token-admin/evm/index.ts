/**
 * EVM token admin — deploy BurnMintERC20 tokens and CCIP token pools on EVM chains.
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
  type Log,
  type TransactionRequest,
  AbiCoder,
  Contract,
  Interface,
  JsonRpcProvider,
  WebSocketProvider,
  concat,
  dataLength,
  id,
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
  CCIPRemoveRemotePoolAddressesFailedError,
  CCIPRemoveRemotePoolAddressesParamsInvalidError,
  CCIPRevokeMintBurnAccessFailedError,
  CCIPRevokeMintBurnAccessParamsInvalidError,
  CCIPSetPoolFailedError,
  CCIPSetPoolParamsInvalidError,
  CCIPSetRateLimitAdminFailedError,
  CCIPSetRateLimitAdminParamsInvalidError,
  CCIPSetRateLimiterConfigFailedError,
  CCIPSetRateLimiterConfigParamsInvalidError,
  CCIPTokenDeployFailedError,
  CCIPTokenDeployParamsInvalidError,
  CCIPTransferAdminRoleFailedError,
  CCIPTransferAdminRoleParamsInvalidError,
  CCIPTransferOwnershipFailedError,
  CCIPTransferOwnershipParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import TokenPool_1_5_ABI from '../../evm/abi/LockReleaseTokenPool_1_5.ts'
import TokenPool_1_6_ABI from '../../evm/abi/LockReleaseTokenPool_1_6_1.ts'
import RegistryModuleOwnerCustomABI from '../../evm/abi/RegistryModuleOwnerCustom_1_6.ts'
import RouterABI from '../../evm/abi/Router.ts'
import TokenAdminRegistryABI from '../../evm/abi/TokenAdminRegistry_1_5.ts'
import TokenPool_2_0_ABI from '../../evm/abi/TokenPool_2_0.ts'
import { EVMChain, isSigner, submitTransaction } from '../../evm/index.ts'
import { getEvmLogs } from '../../evm/logs.ts'
import type { UnsignedEVMTx } from '../../evm/types.ts'
import { type NetworkInfo, CCIPVersion, ChainFamily } from '../../types.ts'
import { networkInfo } from '../../utils.ts'
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
  DeployPoolResult,
  DeployTokenResult,
  EVMDeployPoolParams,
  EVMDeployTokenParams,
  EVMMintBurnRolesResult,
  EVMProposeAdminRoleParams,
  EVMRegistrationMethod,
  GrantMintBurnAccessParams,
  GrantMintBurnAccessResult,
  OwnershipResult,
  ProposeAdminRoleResult,
  RemoveRemotePoolAddressesParams,
  RemoveRemotePoolAddressesResult,
  RevokeMintBurnAccessParams,
  RevokeMintBurnAccessResult,
  SetChainRateLimiterConfigParams,
  SetChainRateLimiterConfigResult,
  SetPoolParams,
  SetPoolResult,
  SetRateLimitAdminParams,
  SetRateLimitAdminResult,
  TransferAdminRoleParams,
  TransferAdminRoleResult,
  TransferOwnershipParams,
} from '../types.ts'
import BurnMintERC20ABI from './abi/BurnMintERC20.ts'
import FactoryBurnMintERC20ABI from './abi/FactoryBurnMintERC20.ts'

// OZ AccessControl role hashes — keccak256('MINTER_ROLE') / keccak256('BURNER_ROLE')
const MINTER_ROLE = id('MINTER_ROLE')
const BURNER_ROLE = id('BURNER_ROLE')

/** Maps registration method to RegistryModuleOwnerCustom function name. */
const REGISTRATION_FUNCTION_NAMES: Record<EVMRegistrationMethod, string> = {
  owner: 'registerAdminViaOwner',
  getCCIPAdmin: 'registerAdminViaGetCCIPAdmin',
  accessControlDefaultAdmin: 'registerAccessControlDefaultAdmin',
}

/**
 * Validates deploy parameters for EVM BurnMintERC20.
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

/**
 * EVM token admin for deploying CCIP-compatible BurnMintERC20 tokens.
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
   * Builds an unsigned deploy transaction for BurnMintERC20.
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

    const tokenType = params.tokenType ?? 'burnMintERC20'
    const maxSupply = params.maxSupply ?? 0n
    const initialSupply = params.initialSupply ?? 0n

    let deployData: string
    if (tokenType === 'factoryBurnMintERC20') {
      if (!params.ownerAddress || params.ownerAddress.trim().length === 0) {
        throw new CCIPTokenDeployParamsInvalidError(
          'ownerAddress',
          'required for factoryBurnMintERC20 (use signed deployToken to auto-fill from signer)',
        )
      }
      // Lazy-load bytecode — tree-shaking friendly
      const { FACTORY_BURN_MINT_ERC20_BYTECODE } =
        await import('./bytecodes/FactoryBurnMintERC20.ts')
      // Constructor: (name, symbol, decimals_, maxSupply_, preMint, newOwner)
      const encodedArgs = AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'uint8', 'uint256', 'uint256', 'address'],
        [
          params.name,
          params.symbol,
          params.decimals,
          maxSupply,
          initialSupply,
          params.ownerAddress,
        ],
      )
      deployData = concat([FACTORY_BURN_MINT_ERC20_BYTECODE, encodedArgs])
    } else {
      // Lazy-load bytecode — tree-shaking friendly
      const { BURN_MINT_ERC20_BYTECODE } = await import('./bytecodes/BurnMintERC20.ts')
      // Constructor: (name, symbol, decimals_, maxSupply_, preMint)
      const encodedArgs = AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'uint8', 'uint256', 'uint256'],
        [params.name, params.symbol, params.decimals, maxSupply, initialSupply],
      )
      deployData = concat([BURN_MINT_ERC20_BYTECODE, encodedArgs])
    }

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
   * Deploys a BurnMintERC20 token, signing and submitting with the provided wallet.
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

    // Auto-fill ownerAddress from signer for factoryBurnMintERC20
    const effectiveParams = { ...params }
    if (effectiveParams.tokenType === 'factoryBurnMintERC20' && !effectiveParams.ownerAddress) {
      effectiveParams.ownerAddress = await wallet.getAddress()
    }

    const unsigned = await this.generateUnsignedDeployToken(effectiveParams)
    let deployTx: TransactionRequest = unsigned.transactions[0]!

    const tokenType = effectiveParams.tokenType ?? 'burnMintERC20'
    this.logger.debug('deployToken: deploying', tokenType, '...')

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

      return { tokenAddress, txHash: response.hash }
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

    // Derive rmnProxy from Router.getArmProxy()
    const router = new Contract(params.routerAddress, RouterABI, this.provider)
    let rmnProxy: string
    try {
      rmnProxy = (await router.getFunction('getArmProxy')()) as string
    } catch (error) {
      throw new CCIPPoolDeployFailedError(
        `failed to derive rmnProxy from router ${params.routerAddress}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined },
      )
    }

    this.logger.debug('generateUnsignedDeployPool: rmnProxy =', rmnProxy)

    // Lazy-load bytecode based on pool type
    const bytecode =
      params.poolType === 'burn-mint'
        ? (await import('./bytecodes/BurnMintTokenPool.ts')).BURN_MINT_TOKEN_POOL_BYTECODE
        : (await import('./bytecodes/LockReleaseTokenPool.ts')).LOCK_RELEASE_TOKEN_POOL_BYTECODE

    // Both pool constructors: (token, localTokenDecimals, allowlist[], rmnProxy, router)
    const encodedArgs = AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint8', 'address[]', 'address', 'address'],
      [
        params.tokenAddress,
        params.localTokenDecimals,
        params.allowlist ?? [],
        rmnProxy,
        params.routerAddress,
      ],
    )

    const deployData = concat([bytecode, encodedArgs])

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

    const unsigned = await this.generateUnsignedDeployPool(params)
    let deployTx: TransactionRequest = unsigned.transactions[0]!

    this.logger.debug('deployPool: deploying', params.poolType, 'pool...')

    try {
      deployTx = await wallet.populateTransaction(deployTx)
      deployTx.from = undefined
      const response = await submitTransaction(wallet, deployTx, this.provider)

      this.logger.debug('deployPool: waiting for confirmation, tx =', response.hash)
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

      const poolAddress = receipt.contractAddress
      if (!poolAddress) {
        throw new CCIPPoolDeployFailedError('no contract address in receipt', {
          context: { txHash: response.hash },
        })
      }

      this.logger.info('deployPool: deployed at', poolAddress, 'tx =', response.hash)

      return { poolAddress, txHash: response.hash }
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
          remoteChainSelector: BigInt(chain.remoteChainSelector),
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
        remoteChainSelector: BigInt(chain.remoteChainSelector),
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
        BigInt(params.remoteChainSelector),
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
          remoteChainSelector: BigInt(params.remoteChainSelector),
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
      data = iface.encodeFunctionData('applyChainUpdates', [
        [BigInt(params.remoteChainSelector)],
        [],
      ])
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
        BigInt(params.remoteChainSelector),
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
        remoteChainSelector: BigInt(config.remoteChainSelector),
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
          BigInt(config.remoteChainSelector),
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

  // ── Grant Mint/Burn Access ─────────────────────────────────────────────

  /**
   * Builds an unsigned transaction for granting mint and burn roles on a
   * BurnMintERC20 token to the specified authority address.
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
    const tokenType = params.tokenType ?? 'burnMintERC20'

    let data: string
    if (tokenType === 'factoryBurnMintERC20') {
      const iface = new Interface(FactoryBurnMintERC20ABI)
      switch (role) {
        case 'mint':
          data = iface.encodeFunctionData('grantMintRole', [params.authority])
          break
        case 'burn':
          data = iface.encodeFunctionData('grantBurnRole', [params.authority])
          break
        case 'mintAndBurn':
        default:
          data = iface.encodeFunctionData('grantMintAndBurnRoles', [params.authority])
          break
      }
    } else {
      const iface = new Interface(BurnMintERC20ABI)
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
   * Grants mint and burn roles on a BurnMintERC20 token, signing and
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
   * address on a BurnMintERC20 token.
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

    const tokenType = params.tokenType ?? 'burnMintERC20'

    let data: string
    if (tokenType === 'factoryBurnMintERC20') {
      const iface = new Interface(FactoryBurnMintERC20ABI)
      data =
        params.role === 'mint'
          ? iface.encodeFunctionData('revokeMintRole', [params.authority])
          : iface.encodeFunctionData('revokeBurnRole', [params.authority])
    } else {
      const iface = new Interface(BurnMintERC20ABI)
      data =
        params.role === 'mint'
          ? iface.encodeFunctionData('revokeRole', [MINTER_ROLE, params.authority])
          : iface.encodeFunctionData('revokeRole', [BURNER_ROLE, params.authority])
    }

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
   * Revokes mint or burn access from an address on a BurnMintERC20 token,
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
   * Queries mint and burn role holders on a BurnMintERC20 token.
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
    // Try FactoryBurnMintERC20 fast path first — getMinters()/getBurners()
    try {
      const factoryContract = new Contract(tokenAddress, FactoryBurnMintERC20ABI, this.provider)
      const [minters, burners] = await Promise.all([
        factoryContract.getFunction('getMinters')() as Promise<string[]>,
        factoryContract.getFunction('getBurners')() as Promise<string[]>,
      ])

      this.logger.debug(
        `getMintBurnRoles: factory path (getMinters/getBurners), token=${tokenAddress}, minters=${minters.length}, burners=${burners.length}`,
      )

      return { minters: [...minters], burners: [...burners] }
    } catch {
      this.logger.debug(
        'getMintBurnRoles: getMinters/getBurners not available, trying AccessControl',
      )
    }

    const contract = new Contract(tokenAddress, BurnMintERC20ABI, this.provider)

    const [minterRole, burnerRole] = await Promise.all([
      contract.getFunction('MINTER_ROLE')() as Promise<string>,
      contract.getFunction('BURNER_ROLE')() as Promise<string>,
    ])

    // Try AccessControlEnumerable (fast path for BurnMintERC20 with enumeration)
    try {
      const [minterCount, burnerCount] = await Promise.all([
        contract.getFunction('getRoleMemberCount')(minterRole) as Promise<bigint>,
        contract.getFunction('getRoleMemberCount')(burnerRole) as Promise<bigint>,
      ])

      const minterPromises: Promise<string>[] = []
      for (let i = 0n; i < minterCount; i++) {
        minterPromises.push(contract.getFunction('getRoleMember')(minterRole, i) as Promise<string>)
      }
      const burnerPromises: Promise<string>[] = []
      for (let i = 0n; i < burnerCount; i++) {
        burnerPromises.push(contract.getFunction('getRoleMember')(burnerRole, i) as Promise<string>)
      }

      const [minters, burners] = await Promise.all([
        Promise.all(minterPromises),
        Promise.all(burnerPromises),
      ])

      this.logger.debug(
        `getMintBurnRoles: enumerable path, token=${tokenAddress}, minters=${minters.length}, burners=${burners.length}`,
      )

      return { minters, burners }
    } catch {
      // AccessControlEnumerable not available, fall back to event scanning
      this.logger.debug(
        'getMintBurnRoles: getRoleMemberCount not available, scanning RoleGranted events',
      )
    }

    // Fallback: scan RoleGranted events + verify with hasRole
    // Uses getEvmLogs for consistent pagination + archive-RPC fallback
    const roleGrantedTopic = Interface.from(BurnMintERC20ABI).getEvent('RoleGranted')!.topicHash

    const scanLogs = async (roleTopic: string) => {
      const logs: Log[] = []
      for await (const log of getEvmLogs(
        {
          address: tokenAddress,
          topics: [[roleGrantedTopic], roleTopic],
          startBlock: 1,
          onlyFallback: false,
        },
        { provider: this.provider, logger: this.logger },
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
