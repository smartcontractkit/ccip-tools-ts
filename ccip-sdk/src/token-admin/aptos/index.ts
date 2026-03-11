/**
 * Aptos token admin — deploy ManagedToken FA modules on Aptos chains.
 *
 * Requires the `aptos` CLI to be installed for Move compilation at deploy time.
 * This is a **Node.js/CLI-only** operation — browser environments are not supported
 * for the publish step (compilation requires filesystem + child_process).
 *
 * ## Why this cannot run in a browser
 *
 * The ManagedToken Move bytecode embeds the **object address** as a named address
 * (`managed_token=<addr>`). This address is derived deterministically from the
 * sender's account address and current sequence number, so it changes for every
 * deploy. The Move source must be recompiled each time using the `aptos` CLI,
 * which requires Node.js (`child_process`, `fs`, `os`, `path`).
 *
 * ## Frontend integration
 *
 * To use this from a frontend (browser/React/Next.js), set up a **backend relay**:
 *
 * 1. Frontend sends `{ sender, params }` to your backend API
 * 2. Backend calls `admin.generateUnsignedDeployToken(sender, params)` (Node.js)
 * 3. Backend returns the serialized unsigned transactions to the frontend
 * 4. Frontend deserializes, signs with the user's wallet (e.g. Petra/Pontem),
 *    and submits each transaction sequentially
 *
 * ```typescript
 * // ── Backend (Node.js / Express / serverless) ──
 * app.post('/api/aptos/deploy-token', async (req, res) => {
 *   const { sender, params } = req.body
 *   const chain = await AptosChain.fromUrl(APTOS_RPC)
 *   const admin = AptosTokenAdmin.fromChain(chain)
 *   const unsignedTxs = await admin.generateUnsignedDeployToken(sender, params)
 *   // Each tx is already BCS-serialized (Uint8Array), encode for transport
 *   const txsHex = unsignedTxs.map(tx => ({
 *     family: tx.family,
 *     transactions: tx.transactions.map(t => Buffer.from(t).toString('hex')),
 *   }))
 *   res.json({ txs: txsHex })
 * })
 *
 * // ── Frontend (browser) ──
 * const { txs } = await fetch('/api/aptos/deploy-token', {
 *   method: 'POST',
 *   body: JSON.stringify({ sender: account.address, params }),
 * }).then(r => r.json())
 *
 * for (const tx of txs) {
 *   const bytes = Uint8Array.from(Buffer.from(tx.transactions[0], 'hex'))
 *   const unsignedTx = SimpleTransaction.deserialize(new Deserializer(bytes))
 *   const signed = await walletAdapter.signTransaction(unsignedTx)
 *   await aptosClient.transaction.submit.simple({
 *     transaction: unsignedTx,
 *     senderAuthenticator: signed,
 *   })
 * }
 * ```
 *
 * @example Using AptosTokenAdmin with a wallet (signed deploy — Node.js only)
 * ```typescript
 * import { AptosChain } from '@chainlink/ccip-sdk'
 * import { AptosTokenAdmin } from '@chainlink/ccip-sdk/src/token-admin/aptos/index.ts'
 *
 * const chain = await AptosChain.fromUrl('https://fullnode.testnet.aptoslabs.com/v1')
 * const admin = AptosTokenAdmin.fromChain(chain)
 * const { tokenAddress, txHash } = await admin.deployToken(wallet, {
 *   name: 'My Token', symbol: 'MTK', decimals: 8,
 * })
 * ```
 *
 * @packageDocumentation
 */

/* eslint-disable import-x/no-nodejs-modules -- Node.js-only module: requires CLI compilation */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
/* eslint-enable import-x/no-nodejs-modules */

import {
  type Aptos,
  AccountAddress,
  Deserializer,
  SimpleTransaction,
  buildTransaction,
  createObjectAddress,
  generateTransactionPayloadWithABI,
  parseTypeTag,
} from '@aptos-labs/ts-sdk'
import { hexlify, zeroPadValue } from 'ethers'

import { AptosChain } from '../../aptos/index.ts'
import { type UnsignedAptosTx, isAptosAccount } from '../../aptos/types.ts'
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
  CCIPExecuteOwnershipTransferFailedError,
  CCIPExecuteOwnershipTransferParamsInvalidError,
  CCIPGrantMintBurnAccessFailedError,
  CCIPGrantMintBurnAccessParamsInvalidError,
  CCIPMethodUnsupportedError,
  CCIPPoolDeployFailedError,
  CCIPPoolDeployParamsInvalidError,
  CCIPPoolNotInitializedError,
  CCIPProposeAdminRoleFailedError,
  CCIPProposeAdminRoleParamsInvalidError,
  CCIPRemoveRemotePoolAddressesFailedError,
  CCIPRemoveRemotePoolAddressesParamsInvalidError,
  CCIPRevokeMintBurnAccessFailedError,
  CCIPRevokeMintBurnAccessParamsInvalidError,
  CCIPSetPoolFailedError,
  CCIPSetPoolParamsInvalidError,
  CCIPSetRateLimiterConfigFailedError,
  CCIPSetRateLimiterConfigParamsInvalidError,
  CCIPTokenDeployFailedError,
  CCIPTokenDeployParamsInvalidError,
  CCIPTokenPoolInfoNotFoundError,
  CCIPTransferAdminRoleFailedError,
  CCIPTransferAdminRoleParamsInvalidError,
  CCIPTransferOwnershipFailedError,
  CCIPTransferOwnershipParamsInvalidError,
  CCIPWalletInvalidError,
} from '../../errors/index.ts'
import { type Logger, type NetworkInfo, ChainFamily } from '../../types.ts'
import { getAddressBytes } from '../../utils.ts'
import {
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
  AptosDeployPoolParams,
  AptosDeployTokenParams,
  AptosMintBurnRolesResult,
  AptosProposeAdminRoleParams,
  AptosTokenModule,
  DeleteChainConfigParams,
  DeleteChainConfigResult,
  DeployPoolResult,
  DeployTokenResult,
  ExecuteOwnershipTransferParams,
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
  TransferAdminRoleParams,
  TransferAdminRoleResult,
  TransferOwnershipParams,
} from '../types.ts'

/** Domain separator used by object_code_deployment::publish to derive object addresses. */
const OBJECT_CODE_DEPLOYMENT_DOMAIN = 'aptos_framework::object_code_deployment'

/** Seed used by init_module to create the token state named object. */
const TOKEN_STATE_SEED = 'managed_token::managed_token::token_state'

/**
 * Computes the deterministic object address that `object_code_deployment::publish`
 * will create for a given sender and their current sequence number.
 *
 * Uses the Aptos SDK's `createObjectAddress` with the same seed derivation as
 * `object_code_deployment::object_seed`: `bcs(domain_separator) || bcs(seq + 1)`.
 */
async function computeObjectAddress(
  provider: Aptos,
  sender: string,
): Promise<{ objectAddress: string; sequenceNumber: bigint }> {
  const { sequence_number } = await provider.getAccountInfo({ accountAddress: sender })
  const sequenceNumber = BigInt(sequence_number)

  const domainBytes = Buffer.from(OBJECT_CODE_DEPLOYMENT_DOMAIN, 'utf8')
  // BCS vector<u8>: ULEB128(length) + bytes
  const uleb = Buffer.from([domainBytes.length])
  // BCS u64: 8 bytes little-endian; object_seed uses sequence_number + 1
  const seqBuf = Buffer.alloc(8)
  seqBuf.writeBigUInt64LE(sequenceNumber + 1n)

  const seed = new Uint8Array(Buffer.concat([uleb, domainBytes, seqBuf]))
  const objectAddress = createObjectAddress(AccountAddress.from(sender), seed).toString()

  return { objectAddress, sequenceNumber }
}

/**
 * Derives the fungible asset metadata address from the code object address and token symbol.
 *
 * Object hierarchy: code object → token state (TOKEN_STATE_SEED) → FA (symbol bytes).
 */
function deriveFungibleAssetAddress(objectAddress: string, symbol: string): string {
  // token state = createObjectAddress(code_object, TOKEN_STATE_SEED)
  const tokenStateAddress = createObjectAddress(
    AccountAddress.from(objectAddress),
    new Uint8Array(Buffer.from(TOKEN_STATE_SEED, 'utf8')),
  )

  // FA metadata = createObjectAddress(token_state, symbol_bytes)
  const faAddress = createObjectAddress(
    tokenStateAddress,
    new Uint8Array(Buffer.from(symbol, 'utf8')),
  )

  return faAddress.toString()
}

/**
 * Resolves the code object address for a managed or regulated token by walking
 * the Aptos object ownership chain: FA metadata → owner (TokenState) → owner (code object).
 *
 * Uses the generic `0x1::object::ObjectCore` resource which stores the `owner` field
 * for every Aptos object — no dependency on specific module view functions.
 *
 * @param provider - Aptos provider instance
 * @param faMetadataAddress - Fungible asset metadata address (the user-facing token address)
 * @returns Code object address (grandparent of the FA metadata)
 * @throws {@link CCIPPoolDeployParamsInvalidError} if ownership chain cannot be resolved
 */
async function resolveCodeObjectAddress(
  provider: Aptos,
  faMetadataAddress: string,
): Promise<string> {
  const resourceType = '0x1::object::ObjectCore'

  // Step 1: FA metadata → owner (TokenState)
  let tokenStateOwner: string
  try {
    const faResource = await provider.getAccountResource<{ owner: string }>({
      accountAddress: faMetadataAddress,
      resourceType,
    })
    tokenStateOwner = faResource.owner
  } catch {
    throw new CCIPPoolDeployParamsInvalidError(
      'tokenAddress',
      `cannot resolve object owner for FA metadata at ${faMetadataAddress} — is this a valid Aptos fungible asset?`,
    )
  }

  // Step 2: TokenState → owner (code object)
  let codeObjectAddress: string
  try {
    const stateResource = await provider.getAccountResource<{ owner: string }>({
      accountAddress: tokenStateOwner,
      resourceType,
    })
    codeObjectAddress = stateResource.owner
  } catch {
    throw new CCIPPoolDeployParamsInvalidError(
      'tokenAddress',
      `cannot resolve code object from token state at ${tokenStateOwner} — unexpected object hierarchy`,
    )
  }

  // Normalize to full 0x-prefixed 64-char hex (API may return short form)
  return AccountAddress.from(codeObjectAddress).toString()
}

/**
 * Validates deploy parameters for Aptos ManagedToken.
 * @throws {@link CCIPTokenDeployParamsInvalidError} on invalid params
 */
function validateParams(params: AptosDeployTokenParams): void {
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
 * Checks that the `aptos` CLI is available.
 * @throws {@link CCIPTokenDeployFailedError} if not installed
 */
function ensureAptosCli(): void {
  try {
    execSync('aptos --version', { stdio: 'ignore' })
  } catch {
    throw new CCIPTokenDeployFailedError(
      'aptos CLI is not installed. Install from https://aptos.dev/tools/aptos-cli/',
    )
  }
}

/**
 * Writes Move source files to a temp directory and compiles them
 * with the object address as the named address.
 *
 * @param objectAddress - The deterministic object address where the module will be published
 * @returns metadataBytes and byteCode extracted from the compiled JSON payload
 */
async function compilePackage(
  objectAddress: string,
  logger: Logger,
): Promise<{ metadataBytes: string; byteCode: string[] }> {
  const { MOVE_TOML, ALLOWLIST_MOVE, OWNABLE_MOVE, MANAGED_TOKEN_MOVE } =
    await import('./bytecodes/managed_token.ts')

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-token-'))
  const sourcesDir = path.join(tmpDir, 'sources')
  fs.mkdirSync(sourcesDir, { recursive: true })

  try {
    // Write Move source files
    fs.writeFileSync(path.join(tmpDir, 'Move.toml'), MOVE_TOML)
    fs.writeFileSync(path.join(sourcesDir, 'allowlist.move'), ALLOWLIST_MOVE)
    fs.writeFileSync(path.join(sourcesDir, 'ownable.move'), OWNABLE_MOVE)
    fs.writeFileSync(path.join(sourcesDir, 'managed_token.move'), MANAGED_TOKEN_MOVE)

    const outputFile = path.join(tmpDir, 'compiled.json')

    const cmd = [
      'aptos move build-publish-payload',
      `--json-output-file ${outputFile}`,
      `--package-dir ${tmpDir}`,
      `--named-addresses managed_token=${objectAddress}`,
      '--skip-fetch-latest-git-deps',
      '--assume-yes',
    ].join(' ')

    logger.debug('compilePackage: compiling ManagedToken Move package...')
    execSync(cmd, { stdio: 'pipe' })

    const compiled = JSON.parse(fs.readFileSync(outputFile, 'utf8')) as {
      args: [{ value: string }, { value: string[] }]
    }
    const metadataBytes = compiled.args[0].value
    const byteCode = compiled.args[1].value

    logger.debug('compilePackage: compiled', byteCode.length, 'modules')
    return { metadataBytes, byteCode }
  } finally {
    // Clean up temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

/**
 * Validates deploy parameters for Aptos pool.
 * @throws {@link CCIPPoolDeployParamsInvalidError} on invalid params
 */
function validatePoolParams(params: AptosDeployPoolParams): AptosTokenModule {
  const poolType: string = params.poolType
  if (poolType !== 'burn-mint' && poolType !== 'lock-release') {
    throw new CCIPPoolDeployParamsInvalidError('poolType', "must be 'burn-mint' or 'lock-release'")
  }

  const tokenModule: AptosTokenModule = params.tokenModule ?? 'managed'
  const tokenModuleStr: string = tokenModule
  if (
    tokenModuleStr !== 'managed' &&
    tokenModuleStr !== 'generic' &&
    tokenModuleStr !== 'regulated'
  ) {
    throw new CCIPPoolDeployParamsInvalidError(
      'tokenModule',
      "must be 'managed', 'generic', or 'regulated'",
    )
  }

  // managed and regulated only support burn-mint
  if (tokenModule === 'managed' && poolType !== 'burn-mint') {
    throw new CCIPPoolDeployParamsInvalidError(
      'poolType',
      "managed tokens only support 'burn-mint' pools (managed_token_pool is inherently burn-mint)",
    )
  }
  if (tokenModule === 'regulated' && poolType !== 'burn-mint') {
    throw new CCIPPoolDeployParamsInvalidError(
      'poolType',
      "regulated tokens only support 'burn-mint' pools (regulated_token_pool is inherently burn-mint)",
    )
  }

  if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
    throw new CCIPPoolDeployParamsInvalidError('tokenAddress', 'must be non-empty')
  }
  if (!params.routerAddress || params.routerAddress.trim().length === 0) {
    throw new CCIPPoolDeployParamsInvalidError('routerAddress', 'must be non-empty')
  }
  if (!params.mcmsAddress || params.mcmsAddress.trim().length === 0) {
    throw new CCIPPoolDeployParamsInvalidError('mcmsAddress', 'must be non-empty')
  }

  // regulated requires adminAddress
  if (
    tokenModule === 'regulated' &&
    (!params.adminAddress || params.adminAddress.trim().length === 0)
  ) {
    throw new CCIPPoolDeployParamsInvalidError(
      'adminAddress',
      "must be non-empty when tokenModule is 'regulated'",
    )
  }

  return tokenModule
}

/**
 * Writes the ChainlinkCCIP dependency sources to the given directory.
 * All pool types transitively depend on this package.
 */
async function writeCcipDep(tmpDir: string): Promise<void> {
  const ccip = await import('./bytecodes/ccip.ts')

  const ccipDir = path.join(tmpDir, 'ccip')
  const ccipSrc = path.join(ccipDir, 'sources')
  const ccipUtilSrc = path.join(ccipSrc, 'util')
  fs.mkdirSync(ccipUtilSrc, { recursive: true })

  fs.writeFileSync(path.join(ccipDir, 'Move.toml'), ccip.CCIP_MOVE_TOML)
  fs.writeFileSync(path.join(ccipSrc, 'allowlist.move'), ccip.CCIP_ALLOWLIST_MOVE)
  fs.writeFileSync(path.join(ccipSrc, 'auth.move'), ccip.CCIP_AUTH_MOVE)
  fs.writeFileSync(path.join(ccipSrc, 'client.move'), ccip.CCIP_CLIENT_MOVE)
  fs.writeFileSync(path.join(ccipSrc, 'eth_abi.move'), ccip.CCIP_ETH_ABI_MOVE)
  fs.writeFileSync(path.join(ccipSrc, 'fee_quoter.move'), ccip.CCIP_FEE_QUOTER_MOVE)
  fs.writeFileSync(path.join(ccipSrc, 'merkle_proof.move'), ccip.CCIP_MERKLE_PROOF_MOVE)
  fs.writeFileSync(path.join(ccipSrc, 'nonce_manager.move'), ccip.CCIP_NONCE_MANAGER_MOVE)
  fs.writeFileSync(path.join(ccipSrc, 'ownable.move'), ccip.CCIP_OWNABLE_MOVE)
  fs.writeFileSync(
    path.join(ccipSrc, 'receiver_dispatcher.move'),
    ccip.CCIP_RECEIVER_DISPATCHER_MOVE,
  )
  fs.writeFileSync(path.join(ccipSrc, 'receiver_registry.move'), ccip.CCIP_RECEIVER_REGISTRY_MOVE)
  fs.writeFileSync(path.join(ccipSrc, 'rmn_remote.move'), ccip.CCIP_RMN_REMOTE_MOVE)
  fs.writeFileSync(path.join(ccipSrc, 'state_object.move'), ccip.CCIP_STATE_OBJECT_MOVE)
  fs.writeFileSync(
    path.join(ccipSrc, 'token_admin_dispatcher.move'),
    ccip.CCIP_TOKEN_ADMIN_DISPATCHER_MOVE,
  )
  fs.writeFileSync(
    path.join(ccipSrc, 'token_admin_registry.move'),
    ccip.CCIP_TOKEN_ADMIN_REGISTRY_MOVE,
  )
  fs.writeFileSync(path.join(ccipUtilSrc, 'address.move'), ccip.CCIP_UTIL_ADDRESS_MOVE)
}

/**
 * Writes the ChainlinkManyChainMultisig (MCMS) dependency sources to the given directory.
 * CCIP depends on this package, and all pool types transitively depend on CCIP.
 */
async function writeMcmsDep(tmpDir: string): Promise<void> {
  const mcms = await import('./bytecodes/mcms.ts')

  const mcmsDir = path.join(tmpDir, 'mcms')
  const mcmsSrc = path.join(mcmsDir, 'sources')
  const mcmsUtilsSrc = path.join(mcmsSrc, 'utils')
  fs.mkdirSync(mcmsUtilsSrc, { recursive: true })

  fs.writeFileSync(path.join(mcmsDir, 'Move.toml'), mcms.MCMS_MOVE_TOML)
  fs.writeFileSync(path.join(mcmsSrc, 'mcms.move'), mcms.MCMS_MCMS_MOVE)
  fs.writeFileSync(path.join(mcmsSrc, 'mcms_registry.move'), mcms.MCMS_MCMS_REGISTRY_MOVE)
  fs.writeFileSync(path.join(mcmsSrc, 'mcms_executor.move'), mcms.MCMS_MCMS_EXECUTOR_MOVE)
  fs.writeFileSync(path.join(mcmsSrc, 'mcms_deployer.move'), mcms.MCMS_MCMS_DEPLOYER_MOVE)
  fs.writeFileSync(path.join(mcmsSrc, 'mcms_account.move'), mcms.MCMS_MCMS_ACCOUNT_MOVE)
  fs.writeFileSync(path.join(mcmsUtilsSrc, 'bcs_stream.move'), mcms.MCMS_UTILS_BCS_STREAM_MOVE)
  fs.writeFileSync(path.join(mcmsUtilsSrc, 'params.move'), mcms.MCMS_UTILS_PARAMS_MOVE)
}

/**
 * Writes the token_pool shared dependency to the given directory.
 * All pool types depend on this package.
 */
async function writeTokenPoolDep(tmpDir: string): Promise<void> {
  const {
    TOKEN_POOL_MOVE_TOML,
    TOKEN_POOL_MOVE,
    TOKEN_POOL_OWNABLE_MOVE,
    RATE_LIMITER_MOVE,
    TOKEN_POOL_RATE_LIMITER_MOVE,
  } = await import('./bytecodes/managed_token_pool.ts')

  const tokenPoolDir = path.join(tmpDir, 'token_pool')
  const tokenPoolSourcesDir = path.join(tokenPoolDir, 'sources')
  fs.mkdirSync(tokenPoolSourcesDir, { recursive: true })

  fs.writeFileSync(path.join(tokenPoolDir, 'Move.toml'), TOKEN_POOL_MOVE_TOML)
  fs.writeFileSync(path.join(tokenPoolSourcesDir, 'token_pool.move'), TOKEN_POOL_MOVE)
  fs.writeFileSync(path.join(tokenPoolSourcesDir, 'ownable.move'), TOKEN_POOL_OWNABLE_MOVE)
  fs.writeFileSync(path.join(tokenPoolSourcesDir, 'rate_limiter.move'), RATE_LIMITER_MOVE)
  fs.writeFileSync(
    path.join(tokenPoolSourcesDir, 'token_pool_rate_limiter.move'),
    TOKEN_POOL_RATE_LIMITER_MOVE,
  )
}

/**
 * Writes Move source files for the specified pool type to the temp directory.
 *
 * @returns The path to the pool package directory (to pass to `aptos move build-publish-payload`)
 */
async function writePoolSources(
  tmpDir: string,
  tokenModule: AptosTokenModule,
  poolType: string,
): Promise<string> {
  if (tokenModule === 'managed') {
    const { POOL_MOVE_TOML, MANAGED_TOKEN_POOL_MOVE } =
      await import('./bytecodes/managed_token_pool.ts')
    const { MOVE_TOML, ALLOWLIST_MOVE, OWNABLE_MOVE, MANAGED_TOKEN_MOVE } =
      await import('./bytecodes/managed_token.ts')

    // managed_token_pool package
    const poolDir = path.join(tmpDir, 'managed_token_pool')
    const poolSrc = path.join(poolDir, 'sources')
    fs.mkdirSync(poolSrc, { recursive: true })
    fs.writeFileSync(path.join(poolDir, 'Move.toml'), POOL_MOVE_TOML)
    fs.writeFileSync(path.join(poolSrc, 'managed_token_pool.move'), MANAGED_TOKEN_POOL_MOVE)

    // managed_token dependency
    const mtDir = path.join(tmpDir, 'managed_token')
    const mtSrc = path.join(mtDir, 'sources')
    fs.mkdirSync(mtSrc, { recursive: true })
    fs.writeFileSync(path.join(mtDir, 'Move.toml'), MOVE_TOML)
    fs.writeFileSync(path.join(mtSrc, 'allowlist.move'), ALLOWLIST_MOVE)
    fs.writeFileSync(path.join(mtSrc, 'ownable.move'), OWNABLE_MOVE)
    fs.writeFileSync(path.join(mtSrc, 'managed_token.move'), MANAGED_TOKEN_MOVE)

    return poolDir
  }

  if (tokenModule === 'generic') {
    if (poolType === 'burn-mint') {
      const { BURN_MINT_POOL_MOVE_TOML, BURN_MINT_TOKEN_POOL_MOVE } =
        await import('./bytecodes/burn_mint_token_pool.ts')

      const poolDir = path.join(tmpDir, 'burn_mint_token_pool')
      const poolSrc = path.join(poolDir, 'sources')
      fs.mkdirSync(poolSrc, { recursive: true })
      fs.writeFileSync(path.join(poolDir, 'Move.toml'), BURN_MINT_POOL_MOVE_TOML)
      fs.writeFileSync(path.join(poolSrc, 'burn_mint_token_pool.move'), BURN_MINT_TOKEN_POOL_MOVE)

      return poolDir
    }

    // lock-release
    const { LOCK_RELEASE_POOL_MOVE_TOML, LOCK_RELEASE_TOKEN_POOL_MOVE } =
      await import('./bytecodes/lock_release_token_pool.ts')

    const poolDir = path.join(tmpDir, 'lock_release_token_pool')
    const poolSrc = path.join(poolDir, 'sources')
    fs.mkdirSync(poolSrc, { recursive: true })
    fs.writeFileSync(path.join(poolDir, 'Move.toml'), LOCK_RELEASE_POOL_MOVE_TOML)
    fs.writeFileSync(
      path.join(poolSrc, 'lock_release_token_pool.move'),
      LOCK_RELEASE_TOKEN_POOL_MOVE,
    )

    return poolDir
  }

  // regulated
  const { REGULATED_POOL_MOVE_TOML, REGULATED_TOKEN_POOL_MOVE } =
    await import('./bytecodes/regulated_token_pool.ts')
  const {
    REGULATED_TOKEN_MOVE_TOML,
    REGULATED_TOKEN_MOVE,
    REGULATED_ACCESS_CONTROL_MOVE,
    REGULATED_OWNABLE_MOVE,
  } = await import('./bytecodes/regulated_token_pool.ts')

  // regulated_token_pool package
  const poolDir = path.join(tmpDir, 'regulated_token_pool')
  const poolSrc = path.join(poolDir, 'sources')
  fs.mkdirSync(poolSrc, { recursive: true })
  fs.writeFileSync(path.join(poolDir, 'Move.toml'), REGULATED_POOL_MOVE_TOML)
  fs.writeFileSync(path.join(poolSrc, 'regulated_token_pool.move'), REGULATED_TOKEN_POOL_MOVE)

  // regulated_token dependency
  const rtDir = path.join(tmpDir, 'regulated_token')
  const rtSrc = path.join(rtDir, 'sources')
  fs.mkdirSync(rtSrc, { recursive: true })
  fs.writeFileSync(path.join(rtDir, 'Move.toml'), REGULATED_TOKEN_MOVE_TOML)
  fs.writeFileSync(path.join(rtSrc, 'regulated_token.move'), REGULATED_TOKEN_MOVE)
  fs.writeFileSync(path.join(rtSrc, 'access_control.move'), REGULATED_ACCESS_CONTROL_MOVE)
  fs.writeFileSync(path.join(rtSrc, 'ownable.move'), REGULATED_OWNABLE_MOVE)

  return poolDir
}

/**
 * Resolves the named addresses for Move compilation based on the pool type.
 *
 * For managed/regulated pools, `tokenCodeObjectAddress` is the code object resolved
 * from the FA metadata via on-chain ownership traversal. For generic pools it is unused
 * — `params.tokenAddress` (the FA metadata) is passed directly as the local token address.
 */
/**
 * Resolves the named addresses for Move compilation.
 *
 * CCIPTokenPool is published to `tokenPoolObjectAddress` (separate object).
 * The pool itself is published to `poolObjectAddress`.
 *
 * For managed/regulated pools, `tokenCodeObjectAddress` is the code object resolved
 * from the FA metadata via on-chain ownership traversal. For generic pools it is unused
 * — `params.tokenAddress` (the FA metadata) is passed directly as the local token address.
 */
function resolveNamedAddresses(
  tokenPoolObjectAddress: string,
  poolObjectAddress: string,
  tokenModule: AptosTokenModule,
  poolType: string,
  params: AptosDeployPoolParams,
  tokenCodeObjectAddress?: string,
): Record<string, string> {
  const base: Record<string, string> = {
    ccip: params.routerAddress,
    ccip_token_pool: tokenPoolObjectAddress,
    mcms: params.mcmsAddress,
    // mcms_owner is the account that created the MCMS resource account.
    // Set to 0x0 — only needed at MCMS package init time, not for pool deploys.
    mcms_owner: '0x0',
    // mcms_register_entrypoints is a compile-time feature flag (0x0 = disabled, 0x1 = enabled).
    // When enabled, init_module registers MCMS entrypoints for multisig control.
    // MCMS is internal Chainlink infrastructure — external users always disable it.
    mcms_register_entrypoints: '0x0',
  }

  if (tokenModule === 'managed') {
    return {
      ...base,
      managed_token_pool: poolObjectAddress,
      managed_token: tokenCodeObjectAddress!,
    }
  }

  if (tokenModule === 'generic') {
    if (poolType === 'burn-mint') {
      return {
        ...base,
        burn_mint_token_pool: poolObjectAddress,
        burn_mint_local_token: params.tokenAddress,
      }
    }
    // lock-release
    return {
      ...base,
      lock_release_token_pool: poolObjectAddress,
      lock_release_local_token: params.tokenAddress,
    }
  }

  // regulated
  return {
    ...base,
    regulated_token_pool: poolObjectAddress,
    regulated_token: tokenCodeObjectAddress!,
    admin: params.adminAddress!,
  }
}

/** Human-readable pool type label for log messages. */
function poolLabel(tokenModule: AptosTokenModule, poolType: string): string {
  if (tokenModule === 'managed') return 'ManagedTokenPool'
  if (tokenModule === 'regulated') return 'RegulatedTokenPool'
  return poolType === 'burn-mint' ? 'BurnMintTokenPool' : 'LockReleaseTokenPool'
}

/**
 * Compiles a Move package and returns the metadata + bytecode from the publish payload.
 *
 * Uses `aptos move build-publish-payload` with `--skip-fetch-latest-git-deps`
 * to ensure compiled bytecode matches what's deployed on-chain.
 *
 * @param packageDir - Path to the package to compile
 * @param namedAddresses - All named addresses for compilation
 * @param label - Human-readable label for log messages
 * @param logger - Logger instance
 * @returns metadataBytes and byteCode from the compiled payload
 */
function compileMovePackage(
  packageDir: string,
  namedAddresses: Record<string, string>,
  label: string,
  logger: Logger,
): { metadataBytes: string; byteCode: string[] } {
  const outputFile = path.join(path.dirname(packageDir), `${label}-compiled.json`)

  const namedAddressesStr = Object.entries(namedAddresses)
    .map(([k, v]) => `${k}=${v}`)
    .join(',')

  const cmd = [
    'aptos move build-publish-payload',
    `--json-output-file ${outputFile}`,
    `--package-dir ${packageDir}`,
    `--named-addresses ${namedAddressesStr}`,
    '--skip-fetch-latest-git-deps',
    '--assume-yes',
  ].join(' ')

  logger.debug(`compileMovePackage: compiling ${label}...`)
  logger.debug(`compileMovePackage: cmd = ${cmd}`)
  const result = execSync(cmd, { stdio: 'pipe' })
  const output = result.toString().trim()
  // aptos CLI may exit 0 but return an error in JSON — check for it
  if (output.includes('"Error"')) {
    throw new CCIPPoolDeployFailedError(`Move compilation failed for ${label}:\n${output}`)
  }

  const compiled = JSON.parse(fs.readFileSync(outputFile, 'utf8')) as {
    args: [{ value: string }, { value: string[] }]
  }

  logger.debug(`compileMovePackage: ${label} compiled`, compiled.args[1].value.length, 'modules')
  return { metadataBytes: compiled.args[0].value, byteCode: compiled.args[1].value }
}

/**
 * Writes all shared dependencies and compiles both the CCIPTokenPool package and the
 * pool-specific package. Returns publish payloads for both.
 *
 * Aptos Move `build-publish-payload` only includes modules from the TOP-LEVEL package
 * in the output — local dependency modules are NOT included. Since CCIPTokenPool is a
 * local dependency of every pool type, it must be compiled and published as a SEPARATE
 * object before the pool itself.
 *
 * Deploy flow (2 publish transactions):
 *   1. Publish CCIPTokenPool (4 modules: token_pool, ownable, rate_limiter, token_pool_rate_limiter)
 *   2. Publish the pool (1 module), referencing the CCIPTokenPool object from step 1
 *
 * @returns Two compiled payloads: tokenPool and pool
 */
async function compilePoolPackages(
  tokenPoolObjectAddress: string,
  poolObjectAddress: string,
  tokenModule: AptosTokenModule,
  poolType: string,
  namedAddresses: Record<string, string>,
  logger: Logger,
): Promise<{
  tokenPool: { metadataBytes: string; byteCode: string[] }
  pool: { metadataBytes: string; byteCode: string[] }
}> {
  const label = poolLabel(tokenModule, poolType)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `aptos-pool-${tokenModule}-`))

  try {
    // Write all transitive dependencies as local packages.
    // Order: mcms (leaf) → ccip (depends on mcms) → token_pool (depends on ccip)
    await writeMcmsDep(tmpDir)
    await writeCcipDep(tmpDir)
    await writeTokenPoolDep(tmpDir)

    // Write pool-specific sources and get the pool package directory
    const poolDir = await writePoolSources(tmpDir, tokenModule, poolType)

    // Step 1: Compile CCIPTokenPool (4 modules)
    const tokenPoolDir = path.join(tmpDir, 'token_pool')
    const tokenPool = compileMovePackage(tokenPoolDir, namedAddresses, 'CCIPTokenPool', logger)

    // Step 2: Compile pool package (1 module) — references the already-compiled token_pool
    const pool = compileMovePackage(poolDir, namedAddresses, label, logger)

    return { tokenPool, pool }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

/**
 * Aptos token admin for deploying CCIP-compatible ManagedToken FA modules.
 *
 * Extends {@link AptosChain} — inherits provider, logger, and chain discovery
 * methods like `getTokenAdminRegistryFor`.
 *
 * **Node.js/CLI only** — Move compilation requires the `aptos` CLI and filesystem access.
 *
 * @example Direct construction
 * ```typescript
 * const admin = new AptosTokenAdmin(provider, network, { logger })
 * ```
 */
export class AptosTokenAdmin extends AptosChain {
  /** Creates a new AptosTokenAdmin instance. */
  constructor(provider: Aptos, network: NetworkInfo, ctx?: ChainContext) {
    super(provider, network, ctx)
  }

  /**
   * Builds unsigned transactions for deploying a ManagedToken FA module.
   *
   * **Requires `aptos` CLI** — compiles the Move source with the sender's address.
   *
   * The returned transactions must be signed and submitted **sequentially**:
   * 1. Publish ManagedToken package
   * 2. Initialize token (name, symbol, decimals, etc.)
   * 3. Mint initial supply (only if initialSupply \> 0)
   *
   * @param sender - Deployer's account address (hex string)
   * @param params - Token deployment parameters
   * @returns Unsigned transactions, code object address, and FA token address
   * @throws {@link CCIPTokenDeployParamsInvalidError} if params are invalid
   * @throws {@link CCIPTokenDeployFailedError} if compilation fails
   *
   * @example
   * ```typescript
   * const txs = await admin.generateUnsignedDeployToken(
   *   account.accountAddress.toString(),
   *   { name: 'My Token', symbol: 'MTK', decimals: 8 },
   * )
   * ```
   */
  async generateUnsignedDeployToken(
    sender: string,
    params: AptosDeployTokenParams,
  ): Promise<{ transactions: UnsignedAptosTx[]; codeObjectAddress: string; tokenAddress: string }> {
    validateParams(params)
    ensureAptosCli()

    // Step 1: Compute the deterministic object address from sender + sequence number
    const { objectAddress, sequenceNumber } = await computeObjectAddress(this.provider, sender)
    let nextSeq = sequenceNumber

    this.logger.debug('generateUnsignedDeployToken: object address =', objectAddress)

    // Step 2: Compile Move package with the object address as named address
    const { metadataBytes, byteCode } = await compilePackage(objectAddress, this.logger)

    // Step 3: Build publish transaction via object_code_deployment::publish
    const publishPayload = generateTransactionPayloadWithABI({
      function: '0x1::object_code_deployment::publish' as `${string}::${string}::${string}`,
      functionArguments: [
        Buffer.from(metadataBytes.replace(/^0x/, ''), 'hex'),
        byteCode.map((b) => Buffer.from(b.replace(/^0x/, ''), 'hex')),
      ],
      abi: {
        typeParameters: [],
        parameters: [parseTypeTag('vector<u8>'), parseTypeTag('vector<vector<u8>>')],
      },
    })
    const publishTx = await buildTransaction({
      aptosConfig: this.provider.config,
      sender,
      payload: publishPayload,
      options: { accountSequenceNumber: nextSeq++ },
    })

    const transactions: UnsignedAptosTx[] = [
      { family: ChainFamily.Aptos, transactions: [publishTx.bcsToBytes()] },
    ]

    // Step 4: Build initialize transaction using local ABI (module not yet on-chain)
    // Entry function lives at the object address, not sender
    // initialize(max_supply: Option<u128>, name, symbol, decimals, icon, project)
    // The Aptos SDK auto-converts null → MoveOption(None), bigint → MoveOption(Some(v))
    const maxSupply =
      params.maxSupply !== undefined && params.maxSupply > 0n ? params.maxSupply : null

    const initPayload = generateTransactionPayloadWithABI({
      function: `${objectAddress}::managed_token::initialize` as `${string}::${string}::${string}`,
      functionArguments: [
        maxSupply,
        params.name,
        params.symbol,
        params.decimals,
        params.icon ?? '',
        params.project ?? '',
      ],
      abi: {
        typeParameters: [],
        parameters: [
          parseTypeTag('0x1::option::Option<u128>'),
          parseTypeTag('0x1::string::String'),
          parseTypeTag('0x1::string::String'),
          parseTypeTag('u8'),
          parseTypeTag('0x1::string::String'),
          parseTypeTag('0x1::string::String'),
        ],
      },
    })
    const initTx = await buildTransaction({
      aptosConfig: this.provider.config,
      sender,
      payload: initPayload,
      options: { accountSequenceNumber: nextSeq++ },
    })
    transactions.push({ family: ChainFamily.Aptos, transactions: [initTx.bcsToBytes()] })

    // Step 5: Build mint transaction (if initialSupply > 0)
    const initialSupply = params.initialSupply ?? 0n
    if (initialSupply > 0n) {
      const recipient = params.recipient ?? sender
      const mintPayload = generateTransactionPayloadWithABI({
        function: `${objectAddress}::managed_token::mint` as `${string}::${string}::${string}`,
        functionArguments: [recipient, initialSupply.toString()],
        abi: {
          typeParameters: [],
          parameters: [parseTypeTag('address'), parseTypeTag('u64')],
        },
      })
      const mintTx = await buildTransaction({
        aptosConfig: this.provider.config,
        sender,
        payload: mintPayload,
        options: { accountSequenceNumber: nextSeq },
      })
      transactions.push({ family: ChainFamily.Aptos, transactions: [mintTx.bcsToBytes()] })
    }

    const faAddress = deriveFungibleAssetAddress(objectAddress, params.symbol)

    this.logger.debug(
      'generateUnsignedDeployToken: sender =',
      sender,
      'object =',
      objectAddress,
      'FA =',
      faAddress,
      'transactions =',
      transactions.length,
    )

    return { transactions, codeObjectAddress: objectAddress, tokenAddress: faAddress }
  }

  /**
   * Builds unsigned publish transactions for an Aptos CCIP token pool.
   *
   * **Requires `aptos` CLI** — compiles the Move source at deploy time.
   *
   * Produces **2 sequential transactions**:
   *   1. Publish CCIPTokenPool (4 modules: token_pool, ownable, rate_limiter, token_pool_rate_limiter)
   *   2. Publish the pool (1 module) — `init_module` runs automatically and
   *      registers the pool, creates state, and sets up callbacks
   *
   * CCIPTokenPool must be a separate object because `build-publish-payload` only
   * includes the top-level package's modules — local dependency modules are expected
   * to already exist on-chain at their named address.
   *
   * The `tokenModule` param (default: `'managed'`) selects which pool to deploy:
   * - `'managed'` → `managed_token_pool` (for tokens from `deployToken()`)
   * - `'generic'` → `burn_mint_token_pool` or `lock_release_token_pool`
   * - `'regulated'` → `regulated_token_pool`
   *
   * @param sender - Deployer's account address (hex string)
   * @param params - Pool deployment parameters
   * @returns Unsigned publish transactions and pool object address
   * @throws {@link CCIPPoolDeployParamsInvalidError} if params are invalid
   * @throws {@link CCIPPoolDeployFailedError} if compilation fails
   */
  async generateUnsignedDeployPool(
    sender: string,
    params: AptosDeployPoolParams,
  ): Promise<{ transactions: UnsignedAptosTx[]; poolAddress: string }> {
    const tokenModule = validatePoolParams(params)
    ensureAptosCli()

    // We need 2 sequential object addresses:
    //   seq+1 → CCIPTokenPool object
    //   seq+2 → pool object
    const { sequence_number } = await this.provider.getAccountInfo({
      accountAddress: sender,
    })
    const sequenceNumber = BigInt(sequence_number)

    const domainBytes = Buffer.from(OBJECT_CODE_DEPLOYMENT_DOMAIN, 'utf8')
    const uleb = Buffer.from([domainBytes.length])

    // Object address for CCIPTokenPool (seq + 1)
    const seqBuf1 = Buffer.alloc(8)
    seqBuf1.writeBigUInt64LE(sequenceNumber + 1n)
    const tokenPoolObjectAddress = createObjectAddress(
      AccountAddress.from(sender),
      new Uint8Array(Buffer.concat([uleb, domainBytes, seqBuf1])),
    ).toString()

    // Object address for the pool (seq + 2)
    const seqBuf2 = Buffer.alloc(8)
    seqBuf2.writeBigUInt64LE(sequenceNumber + 2n)
    const poolObjectAddress = createObjectAddress(
      AccountAddress.from(sender),
      new Uint8Array(Buffer.concat([uleb, domainBytes, seqBuf2])),
    ).toString()

    const label = poolLabel(tokenModule, params.poolType)

    this.logger.debug(
      `generateUnsignedDeployPool: ${label} tokenPool =`,
      tokenPoolObjectAddress,
      'pool =',
      poolObjectAddress,
    )

    // For managed/regulated pools, resolve the code object address from the FA metadata
    // by walking the Aptos object ownership chain on-chain.
    // Generic pools use tokenAddress (FA metadata) directly as a named address.
    let tokenCodeObjectAddress: string | undefined
    if (tokenModule === 'managed' || tokenModule === 'regulated') {
      tokenCodeObjectAddress = await resolveCodeObjectAddress(this.provider, params.tokenAddress)
      this.logger.debug(
        `generateUnsignedDeployPool: resolved code object =`,
        tokenCodeObjectAddress,
        'from FA metadata =',
        params.tokenAddress,
      )
    }

    const namedAddresses = resolveNamedAddresses(
      tokenPoolObjectAddress,
      poolObjectAddress,
      tokenModule,
      params.poolType,
      params,
      tokenCodeObjectAddress,
    )

    const { tokenPool, pool } = await compilePoolPackages(
      tokenPoolObjectAddress,
      poolObjectAddress,
      tokenModule,
      params.poolType,
      namedAddresses,
      this.logger,
    )

    // Build 2 publish transactions (sequential: token_pool first, then pool)
    const buildPublishTx = async (
      compiled: { metadataBytes: string; byteCode: string[] },
      seq: bigint,
    ) => {
      const payload = generateTransactionPayloadWithABI({
        function: '0x1::object_code_deployment::publish' as `${string}::${string}::${string}`,
        functionArguments: [
          Buffer.from(compiled.metadataBytes.replace(/^0x/, ''), 'hex'),
          compiled.byteCode.map((b) => Buffer.from(b.replace(/^0x/, ''), 'hex')),
        ],
        abi: {
          typeParameters: [],
          parameters: [parseTypeTag('vector<u8>'), parseTypeTag('vector<vector<u8>>')],
        },
      })
      return buildTransaction({
        aptosConfig: this.provider.config,
        sender,
        payload,
        options: { accountSequenceNumber: seq },
      })
    }

    const tokenPoolTx = await buildPublishTx(tokenPool, sequenceNumber)
    const poolTx = await buildPublishTx(pool, sequenceNumber + 1n)

    this.logger.debug(
      `generateUnsignedDeployPool: ${label} sender =`,
      sender,
      'tokenPool =',
      tokenPoolObjectAddress,
      'pool =',
      poolObjectAddress,
      'transactions = 2',
    )

    return {
      transactions: [
        { family: ChainFamily.Aptos, transactions: [tokenPoolTx.bcsToBytes()] },
        { family: ChainFamily.Aptos, transactions: [poolTx.bcsToBytes()] },
      ],
      poolAddress: poolObjectAddress,
    }
  }

  /**
   * Deploys an Aptos CCIP token pool, signing and submitting with the provided wallet.
   *
   * **Requires `aptos` CLI** — compiles the Move source at deploy time.
   *
   * @param wallet - Aptos account with signing capability
   * @param params - Pool deployment parameters (see {@link AptosDeployPoolParams})
   * @returns Deploy result with `poolAddress` and `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPPoolDeployParamsInvalidError} if params are invalid
   * @throws {@link CCIPPoolDeployFailedError} if the deploy transaction fails
   */
  async deployPool(wallet: unknown, params: AptosDeployPoolParams): Promise<DeployPoolResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs, poolAddress } = await this.generateUnsignedDeployPool(
      sender,
      params,
    )

    const tokenModule = params.tokenModule ?? 'managed'
    const label = poolLabel(tokenModule, params.poolType)
    this.logger.debug(`deployPool: deploying ${label}...`, unsignedTxs.length, 'transactions')

    let lastTxHash = ''

    try {
      for (let i = 0; i < unsignedTxs.length; i++) {
        const unsigned = SimpleTransaction.deserialize(
          new Deserializer(unsignedTxs[i]!.transactions[0]),
        )

        const signed = await wallet.signTransactionWithAuthenticator(unsigned)
        const pendingTxn = await this.provider.transaction.submit.simple({
          transaction: unsigned,
          senderAuthenticator: signed,
        })

        const { hash } = await this.provider.waitForTransaction({
          transactionHash: pendingTxn.hash,
        })

        lastTxHash = hash
        this.logger.debug(`deployPool: tx ${i + 1}/${unsignedTxs.length} confirmed:`, hash)
      }

      const initialized = tokenModule !== 'generic'

      if (!initialized) {
        const poolModule =
          params.poolType === 'burn-mint' ? 'burn_mint_token_pool' : 'lock_release_token_pool'
        this.logger.warn(
          `deployPool: Generic pool deployed but NOT initialized. ` +
            `The token creator module must call ${poolModule}::initialize() ` +
            `with the stored capability refs (BurnRef/MintRef/TransferRef) ` +
            `before the pool can be used for CCIP operations.`,
        )
      }

      this.logger.info('deployPool: pool at', poolAddress, 'tx =', lastTxHash)

      return { poolAddress, txHash: lastTxHash, initialized }
    } catch (error) {
      if (error instanceof CCIPPoolDeployFailedError) throw error
      throw new CCIPPoolDeployFailedError(error instanceof Error ? error.message : String(error), {
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  // ── Token Admin Registry Discovery ─────────────────────────────────────

  // getTokenAdminRegistryFor is inherited from AptosChain.

  // ── Propose Admin Role ────────────────────────────────────────────────────

  /**
   * Builds an unsigned transaction for proposing an administrator in the
   * TokenAdminRegistry on Aptos.
   *
   * On Aptos, the TokenAdminRegistry is a module within the CCIP router package
   * (`routerAddress::token_admin_registry::propose_administrator`).
   *
   * @param sender - Aptos account address (hex string)
   * @param params - Propose admin role parameters
   * @returns Unsigned Aptos transactions (single tx)
   * @throws {@link CCIPProposeAdminRoleParamsInvalidError} if params are invalid
   */
  async generateUnsignedProposeAdminRole(
    sender: string,
    params: AptosProposeAdminRoleParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCIPProposeAdminRoleParamsInvalidError('tokenAddress', 'must be non-empty')
    }
    if (!params.administrator || params.administrator.trim().length === 0) {
      throw new CCIPProposeAdminRoleParamsInvalidError('administrator', 'must be non-empty')
    }
    if (!params.routerAddress || params.routerAddress.trim().length === 0) {
      throw new CCIPProposeAdminRoleParamsInvalidError('routerAddress', 'must be non-empty')
    }

    const payload = generateTransactionPayloadWithABI({
      function:
        `${params.routerAddress}::token_admin_registry::propose_administrator` as `${string}::${string}::${string}`,
      functionArguments: [params.tokenAddress, params.administrator],
      abi: {
        typeParameters: [],
        parameters: [parseTypeTag('address'), parseTypeTag('address')],
      },
    })
    const tx = await buildTransaction({
      aptosConfig: this.provider.config,
      sender,
      payload,
    })

    this.logger.debug(
      'generateUnsignedProposeAdminRole: router =',
      params.routerAddress,
      'token =',
      params.tokenAddress,
    )

    return {
      transactions: [
        {
          family: ChainFamily.Aptos,
          transactions: [tx.bcsToBytes()],
        },
      ],
    }
  }

  /**
   * Proposes an administrator for a token in the TokenAdminRegistry,
   * signing and submitting with the provided wallet.
   *
   * @param wallet - Aptos account with signing capability
   * @param params - Propose admin role parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPProposeAdminRoleParamsInvalidError} if params are invalid
   * @throws {@link CCIPProposeAdminRoleFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.proposeAdminRole(wallet, {
   *   tokenAddress: '0x89fd6b...',
   *   administrator: '0x1234...',
   *   routerAddress: '0xabc...',
   * })
   * console.log(`Proposed admin, tx: ${txHash}`)
   * ```
   */
  async proposeAdminRole(
    wallet: unknown,
    params: AptosProposeAdminRoleParams,
  ): Promise<ProposeAdminRoleResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedProposeAdminRole(
      sender,
      params,
    )

    this.logger.debug('proposeAdminRole: proposing administrator...')

    try {
      const unsigned = SimpleTransaction.deserialize(
        new Deserializer(unsignedTxs[0]!.transactions[0]),
      )

      const signed = await wallet.signTransactionWithAuthenticator(unsigned)
      const pendingTxn = await this.provider.transaction.submit.simple({
        transaction: unsigned,
        senderAuthenticator: signed,
      })

      const { hash } = await this.provider.waitForTransaction({
        transactionHash: pendingTxn.hash,
      })

      this.logger.info('proposeAdminRole: proposed admin, tx =', hash)

      return { txHash: hash }
    } catch (error) {
      if (error instanceof CCIPProposeAdminRoleFailedError) throw error
      if (error instanceof CCIPProposeAdminRoleParamsInvalidError) throw error
      throw new CCIPProposeAdminRoleFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Accept Admin Role ─────────────────────────────────────────────────────

  /**
   * Builds an unsigned transaction for accepting an administrator role in the
   * TokenAdminRegistry on Aptos.
   *
   * @param sender - Aptos account address (hex string) of the pending administrator
   * @param params - Accept admin role parameters
   * @returns Unsigned Aptos transactions (single tx)
   * @throws {@link CCIPAcceptAdminRoleParamsInvalidError} if params are invalid
   */
  async generateUnsignedAcceptAdminRole(
    sender: string,
    params: AcceptAdminRoleParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCIPAcceptAdminRoleParamsInvalidError('tokenAddress', 'must be non-empty')
    }
    if (!params.routerAddress || params.routerAddress.trim().length === 0) {
      throw new CCIPAcceptAdminRoleParamsInvalidError('routerAddress', 'must be non-empty')
    }

    const tx = await this.provider.transaction.build.simple({
      sender: AccountAddress.from(sender),
      data: {
        function:
          `${params.routerAddress}::token_admin_registry::accept_admin_role` as `${string}::${string}::${string}`,
        functionArguments: [params.tokenAddress],
      },
    })

    this.logger.debug(
      'generateUnsignedAcceptAdminRole: router =',
      params.routerAddress,
      'token =',
      params.tokenAddress,
    )

    return {
      transactions: [
        {
          family: ChainFamily.Aptos,
          transactions: [tx.bcsToBytes()],
        },
      ],
    }
  }

  /**
   * Accepts an administrator role for a token in the TokenAdminRegistry,
   * signing and submitting with the provided wallet.
   *
   * @param wallet - Aptos account with signing capability (must be the pending administrator)
   * @param params - Accept admin role parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPAcceptAdminRoleParamsInvalidError} if params are invalid
   * @throws {@link CCIPAcceptAdminRoleFailedError} if the transaction fails
   */
  async acceptAdminRole(
    wallet: unknown,
    params: AcceptAdminRoleParams,
  ): Promise<AcceptAdminRoleResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedAcceptAdminRole(sender, params)

    this.logger.debug('acceptAdminRole: accepting administrator role...')

    try {
      const unsigned = SimpleTransaction.deserialize(
        new Deserializer(unsignedTxs[0]!.transactions[0]),
      )

      const signed = await wallet.signTransactionWithAuthenticator(unsigned)
      const pendingTxn = await this.provider.transaction.submit.simple({
        transaction: unsigned,
        senderAuthenticator: signed,
      })

      const { hash } = await this.provider.waitForTransaction({
        transactionHash: pendingTxn.hash,
      })

      this.logger.info('acceptAdminRole: accepted admin, tx =', hash)

      return { txHash: hash }
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
   * in the TokenAdminRegistry on Aptos.
   *
   * Calls `${routerAddress}::token_admin_registry::transfer_admin_role`.
   * Pass `@0x0` as newAdmin to cancel a pending transfer.
   *
   * @param sender - Aptos account address (hex string) of the current administrator
   * @param params - Transfer admin role parameters
   * @returns Unsigned Aptos transactions (single tx)
   * @throws {@link CCIPTransferAdminRoleParamsInvalidError} if params are invalid
   */
  async generateUnsignedTransferAdminRole(
    sender: string,
    params: TransferAdminRoleParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCIPTransferAdminRoleParamsInvalidError('tokenAddress', 'must be non-empty')
    }
    if (!params.newAdmin || params.newAdmin.trim().length === 0) {
      throw new CCIPTransferAdminRoleParamsInvalidError('newAdmin', 'must be non-empty')
    }
    if (!params.routerAddress || params.routerAddress.trim().length === 0) {
      throw new CCIPTransferAdminRoleParamsInvalidError('routerAddress', 'must be non-empty')
    }

    const payload = generateTransactionPayloadWithABI({
      function:
        `${params.routerAddress}::token_admin_registry::transfer_admin_role` as `${string}::${string}::${string}`,
      functionArguments: [params.tokenAddress, params.newAdmin],
      abi: {
        typeParameters: [],
        parameters: [parseTypeTag('address'), parseTypeTag('address')],
      },
    })
    const tx = await buildTransaction({
      aptosConfig: this.provider.config,
      sender,
      payload,
    })

    this.logger.debug(
      'generateUnsignedTransferAdminRole: router =',
      params.routerAddress,
      'token =',
      params.tokenAddress,
      'newAdmin =',
      params.newAdmin,
    )

    return {
      transactions: [
        {
          family: ChainFamily.Aptos,
          transactions: [tx.bcsToBytes()],
        },
      ],
    }
  }

  /**
   * Transfers the administrator role for a token in the TokenAdminRegistry,
   * signing and submitting with the provided wallet.
   *
   * @param wallet - Aptos account with signing capability (must be the current administrator)
   * @param params - Transfer admin role parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPTransferAdminRoleParamsInvalidError} if params are invalid
   * @throws {@link CCIPTransferAdminRoleFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.transferAdminRole(wallet, {
   *   tokenAddress: '0x89fd6b...',
   *   newAdmin: '0x1234...',
   *   routerAddress: '0xabc...',
   * })
   * console.log(`Transferred admin, tx: ${txHash}`)
   * ```
   */
  async transferAdminRole(
    wallet: unknown,
    params: TransferAdminRoleParams,
  ): Promise<TransferAdminRoleResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedTransferAdminRole(
      sender,
      params,
    )

    this.logger.debug('transferAdminRole: transferring administrator role...')

    try {
      const unsigned = SimpleTransaction.deserialize(
        new Deserializer(unsignedTxs[0]!.transactions[0]),
      )

      const signed = await wallet.signTransactionWithAuthenticator(unsigned)
      const pendingTxn = await this.provider.transaction.submit.simple({
        transaction: unsigned,
        senderAuthenticator: signed,
      })

      const { hash } = await this.provider.waitForTransaction({
        transactionHash: pendingTxn.hash,
      })

      this.logger.info('transferAdminRole: transferred admin, tx =', hash)

      return { txHash: hash }
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
   * Builds an unsigned transaction for registering a pool in the TokenAdminRegistry
   * on Aptos.
   *
   * @param sender - Aptos account address (hex string) of the token administrator
   * @param params - Set pool parameters
   * @returns Unsigned Aptos transactions (single tx)
   * @throws {@link CCIPSetPoolParamsInvalidError} if params are invalid
   */
  async generateUnsignedSetPool(
    sender: string,
    params: SetPoolParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCIPSetPoolParamsInvalidError('tokenAddress', 'must be non-empty')
    }
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCIPSetPoolParamsInvalidError('poolAddress', 'must be non-empty')
    }
    if (!params.routerAddress || params.routerAddress.trim().length === 0) {
      throw new CCIPSetPoolParamsInvalidError('routerAddress', 'must be non-empty')
    }

    const tx = await this.provider.transaction.build.simple({
      sender: AccountAddress.from(sender),
      data: {
        function:
          `${params.routerAddress}::token_admin_registry::set_pool` as `${string}::${string}::${string}`,
        functionArguments: [params.tokenAddress, params.poolAddress],
      },
    })

    this.logger.debug(
      'generateUnsignedSetPool: router =',
      params.routerAddress,
      'token =',
      params.tokenAddress,
      'pool =',
      params.poolAddress,
    )

    return {
      transactions: [
        {
          family: ChainFamily.Aptos,
          transactions: [tx.bcsToBytes()],
        },
      ],
    }
  }

  /**
   * Registers a pool in the TokenAdminRegistry, signing and submitting
   * with the provided wallet.
   *
   * @param wallet - Aptos account with signing capability (must be the token administrator)
   * @param params - Set pool parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPSetPoolParamsInvalidError} if params are invalid
   * @throws {@link CCIPSetPoolFailedError} if the transaction fails
   */
  async setPool(wallet: unknown, params: SetPoolParams): Promise<SetPoolResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedSetPool(sender, params)

    this.logger.debug('setPool: registering pool...')

    try {
      const unsigned = SimpleTransaction.deserialize(
        new Deserializer(unsignedTxs[0]!.transactions[0]),
      )

      const signed = await wallet.signTransactionWithAuthenticator(unsigned)
      const pendingTxn = await this.provider.transaction.submit.simple({
        transaction: unsigned,
        senderAuthenticator: signed,
      })

      const { hash } = await this.provider.waitForTransaction({
        transactionHash: pendingTxn.hash,
      })

      this.logger.info('setPool: pool registered, tx =', hash)

      return { txHash: hash }
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
   * Auto-discovers the pool module name from a pool address by querying
   * account modules and filtering for `*token_pool`.
   *
   * @param poolAddress - Pool object address (hex string)
   * @returns The pool module name (e.g., 'managed_token_pool')
   * @throws {@link CCIPTokenPoolInfoNotFoundError} if no pool module found
   */
  private async discoverPoolModule(poolAddress: string): Promise<string> {
    const modulesNames = (await this._getAccountModulesNames(poolAddress))
      .reverse()
      .filter((name) => name.endsWith('token_pool'))

    if (modulesNames.length === 0) {
      throw new CCIPTokenPoolInfoNotFoundError(poolAddress)
    }

    // Try each module until one responds to get_token view
    for (const name of modulesNames) {
      try {
        await this.provider.view<[string]>({
          payload: {
            function: `${poolAddress}::${name}::get_token`,
          },
        })
        return name
      } catch {
        continue
      }
    }

    // If none respond, use the first one (best effort)
    return modulesNames[0]!
  }

  /**
   * Checks whether an Aptos pool is initialized by attempting to call `get_token`.
   *
   * Generic pools (`burn_mint_token_pool`, `lock_release_token_pool`) have a
   * two-phase lifecycle: `init_module()` creates a `*Deployment` struct, but the
   * pool is not usable until `initialize()` creates the `*State` with ownership
   * and pool functionality. The `get_token` view function only succeeds when
   * the `*State` resource exists.
   *
   * Managed and regulated pools initialize fully in `init_module()`, so this
   * always returns `true` for them.
   *
   * @param poolAddress - Pool object address (hex string)
   * @param poolModule - Pool module name (from `discoverPoolModule`)
   * @returns `true` if pool state is initialized, `false` otherwise
   */
  private async isPoolInitialized(poolAddress: string, poolModule: string): Promise<boolean> {
    try {
      await this.provider.view<[string]>({
        payload: {
          function: `${poolAddress}::${poolModule}::get_token`,
        },
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Guards pool operations by checking initialization status.
   *
   * Throws {@link CCIPPoolNotInitializedError} if the pool is not initialized,
   * providing a clear error message instead of a cryptic `MutBorrowGlobal` failure.
   *
   * @param poolAddress - Pool object address (hex string)
   * @param poolModule - Pool module name
   * @throws {@link CCIPPoolNotInitializedError} if pool is not initialized
   */
  private async ensurePoolInitialized(poolAddress: string, poolModule: string): Promise<void> {
    const initialized = await this.isPoolInitialized(poolAddress, poolModule)
    if (!initialized) {
      throw new CCIPPoolNotInitializedError(poolAddress)
    }
  }

  /**
   * Builds an unsigned transaction for configuring remote chains on a token pool.
   *
   * Auto-discovers the pool module name from the pool address.
   * Calls `apply_chain_updates` on the pool module.
   *
   * Pool addresses are passed as raw bytes (not padded).
   * Token addresses are 32-byte left-padded.
   *
   * @param sender - Aptos account address (hex string) of the pool owner
   * @param params - Apply chain updates parameters
   * @returns Unsigned Aptos transactions
   * @throws {@link CCIPApplyChainUpdatesParamsInvalidError} if params are invalid
   * @throws {@link CCIPTokenPoolInfoNotFoundError} if pool module not found
   * @throws {@link CCIPPoolNotInitializedError} if pool is not initialized (generic pools)
   */
  async generateUnsignedApplyChainUpdates(
    sender: string,
    params: ApplyChainUpdatesParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    validateApplyChainUpdatesParams(params)

    // Auto-discover pool module name
    const poolModule = await this.discoverPoolModule(params.poolAddress)
    await this.ensurePoolInitialized(params.poolAddress, poolModule)

    // Encode arguments
    const remoteChainSelectorsToRemove = params.remoteChainSelectorsToRemove
    const remoteChainSelectorsToAdd = params.chainsToAdd.map((c) => c.remoteChainSelector)

    // Pool addresses: raw bytes (not padded) — matches chainlink-deployments
    // vector<vector<vector<u8>>>: one entry per chain, each has a list of pool address byte arrays
    const remotePoolAddressesToAdd = params.chainsToAdd.map((chain) =>
      chain.remotePoolAddresses.map((addr) => Array.from(getAddressBytes(addr))),
    )

    // Token addresses: 32-byte left-padded — matches chainlink-deployments
    // vector<vector<u8>>: one entry per chain, each is a 32-byte byte array
    const remoteTokenAddressesToAdd = params.chainsToAdd.map((chain) => {
      const bytes = getAddressBytes(chain.remoteTokenAddress)
      const padded = zeroPadValue(hexlify(bytes), 32)
      return Array.from(Buffer.from(padded.slice(2), 'hex'))
    })

    const senderAddr = AccountAddress.from(sender)

    // Fetch current sequence number so multi-tx batches get consecutive nonces
    const { sequence_number } = await this.provider.getAccountInfo({
      accountAddress: senderAddr,
    })
    let nextSeq = BigInt(sequence_number)

    // Transaction 1: apply_chain_updates — adds/removes remote chains
    const applyTx = await this.provider.transaction.build.simple({
      sender: senderAddr,
      data: {
        function:
          `${params.poolAddress}::${poolModule}::apply_chain_updates` as `${string}::${string}::${string}`,
        functionArguments: [
          remoteChainSelectorsToRemove,
          remoteChainSelectorsToAdd,
          remotePoolAddressesToAdd,
          remoteTokenAddressesToAdd,
        ],
      },
      options: { accountSequenceNumber: nextSeq++ },
    })

    const transactions: [Uint8Array, ...Uint8Array[]] = [applyTx.bcsToBytes()]

    // Transaction 2: set_chain_rate_limiter_configs — configures rate limiters
    // Aptos apply_chain_updates does NOT include rate limiter args; they must be set separately.
    // Only build this transaction if there are chains to add (rate limiters apply to added chains).
    if (params.chainsToAdd.length > 0) {
      const rateLimiterTx = await this.provider.transaction.build.simple({
        sender: senderAddr,
        data: {
          function:
            `${params.poolAddress}::${poolModule}::set_chain_rate_limiter_configs` as `${string}::${string}::${string}`,
          functionArguments: [
            remoteChainSelectorsToAdd,
            params.chainsToAdd.map((c) => c.outboundRateLimiterConfig.isEnabled),
            params.chainsToAdd.map((c) => BigInt(c.outboundRateLimiterConfig.capacity)),
            params.chainsToAdd.map((c) => BigInt(c.outboundRateLimiterConfig.rate)),
            params.chainsToAdd.map((c) => c.inboundRateLimiterConfig.isEnabled),
            params.chainsToAdd.map((c) => BigInt(c.inboundRateLimiterConfig.capacity)),
            params.chainsToAdd.map((c) => BigInt(c.inboundRateLimiterConfig.rate)),
          ],
        },
        options: { accountSequenceNumber: nextSeq },
      })

      transactions.push(rateLimiterTx.bcsToBytes())
    }

    this.logger.debug(
      'generateUnsignedApplyChainUpdates: pool =',
      params.poolAddress,
      'module =',
      poolModule,
      'adds =',
      params.chainsToAdd.length,
      'removes =',
      params.remoteChainSelectorsToRemove.length,
      'txs =',
      transactions.length,
    )

    return {
      transactions: [
        {
          family: ChainFamily.Aptos,
          transactions,
        },
      ],
    }
  }

  /**
   * Configures remote chains on a token pool, signing and submitting with the provided wallet.
   *
   * @param wallet - Aptos account with signing capability (must be pool owner)
   * @param params - Apply chain updates parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPApplyChainUpdatesParamsInvalidError} if params are invalid
   * @throws {@link CCIPApplyChainUpdatesFailedError} if the transaction fails
   */
  async applyChainUpdates(
    wallet: unknown,
    params: ApplyChainUpdatesParams,
  ): Promise<ApplyChainUpdatesResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedApplyChainUpdates(
      sender,
      params,
    )

    this.logger.debug('applyChainUpdates: applying chain updates...')

    try {
      // Submit transactions sequentially — tx2 (rate limiters) depends on tx1 (chain config)
      let lastHash = ''
      for (const unsignedTx of unsignedTxs) {
        for (const txBytes of unsignedTx.transactions) {
          const unsigned = SimpleTransaction.deserialize(new Deserializer(txBytes))
          const signed = await wallet.signTransactionWithAuthenticator(unsigned)
          const pendingTxn = await this.provider.transaction.submit.simple({
            transaction: unsigned,
            senderAuthenticator: signed,
          })
          const { hash } = await this.provider.waitForTransaction({
            transactionHash: pendingTxn.hash,
          })
          this.logger.debug('applyChainUpdates: submitted tx =', hash)
          lastHash = hash
        }
      }

      this.logger.info('applyChainUpdates: applied chain updates, tx =', lastHash)

      return { txHash: lastHash }
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
   * Auto-discovers the pool module name from the pool address.
   * Calls `add_remote_pool` on the pool module — one transaction per address.
   *
   * @param sender - Aptos account address (hex string) of the pool owner
   * @param params - Append remote pool addresses parameters
   * @returns Unsigned Aptos transactions (one per address)
   * @throws {@link CCIPAppendRemotePoolAddressesParamsInvalidError} if params are invalid
   * @throws {@link CCIPTokenPoolInfoNotFoundError} if pool module not found
   * @throws {@link CCIPPoolNotInitializedError} if pool is not initialized
   */
  async generateUnsignedAppendRemotePoolAddresses(
    sender: string,
    params: AppendRemotePoolAddressesParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    validateAppendRemotePoolAddressesParams(params)

    const poolModule = await this.discoverPoolModule(params.poolAddress)
    await this.ensurePoolInitialized(params.poolAddress, poolModule)

    const senderAddr = AccountAddress.from(sender)
    const transactions: Uint8Array[] = []

    // Fetch current sequence number so multi-tx batches get consecutive nonces
    const { sequence_number } = await this.provider.getAccountInfo({
      accountAddress: senderAddr,
    })
    let nextSeq = BigInt(sequence_number)

    for (const remotePoolAddress of params.remotePoolAddresses) {
      const encodedAddress = Array.from(getAddressBytes(remotePoolAddress))
      const tx = await this.provider.transaction.build.simple({
        sender: senderAddr,
        data: {
          function:
            `${params.poolAddress}::${poolModule}::add_remote_pool` as `${string}::${string}::${string}`,
          functionArguments: [params.remoteChainSelector, encodedAddress],
        },
        options: { accountSequenceNumber: nextSeq++ },
      })
      transactions.push(tx.bcsToBytes())
    }

    this.logger.debug(
      'generateUnsignedAppendRemotePoolAddresses: pool =',
      params.poolAddress,
      'module =',
      poolModule,
      'addresses =',
      params.remotePoolAddresses.length,
    )

    return {
      transactions: [
        {
          family: ChainFamily.Aptos,
          transactions: transactions as [Uint8Array, ...Uint8Array[]],
        },
      ],
    }
  }

  /**
   * Appends remote pool addresses to an existing chain config, signing and submitting with the provided wallet.
   *
   * @param wallet - Aptos account with signing capability (must be pool owner)
   * @param params - Append remote pool addresses parameters
   * @returns Result with `txHash` of the last transaction
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPAppendRemotePoolAddressesParamsInvalidError} if params are invalid
   * @throws {@link CCIPAppendRemotePoolAddressesFailedError} if the transaction fails
   */
  async appendRemotePoolAddresses(
    wallet: unknown,
    params: AppendRemotePoolAddressesParams,
  ): Promise<AppendRemotePoolAddressesResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedAppendRemotePoolAddresses(
      sender,
      params,
    )

    this.logger.debug('appendRemotePoolAddresses: appending remote pool addresses...')

    try {
      let lastHash = ''
      for (const unsignedTx of unsignedTxs) {
        for (const txBytes of unsignedTx.transactions) {
          const unsigned = SimpleTransaction.deserialize(new Deserializer(txBytes))
          const signed = await wallet.signTransactionWithAuthenticator(unsigned)
          const pendingTxn = await this.provider.transaction.submit.simple({
            transaction: unsigned,
            senderAuthenticator: signed,
          })
          const { hash } = await this.provider.waitForTransaction({
            transactionHash: pendingTxn.hash,
          })
          this.logger.debug('appendRemotePoolAddresses: submitted tx =', hash)
          lastHash = hash
        }
      }

      this.logger.info('appendRemotePoolAddresses: appended remote pool addresses, tx =', lastHash)

      return { txHash: lastHash }
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
   * Calls `apply_chain_updates` on the pool module with only the removal selector
   * and empty add arrays.
   *
   * @param sender - Aptos account address (hex string) of the pool owner
   * @param params - Delete chain config parameters
   * @returns Unsigned Aptos transaction
   * @throws {@link CCIPDeleteChainConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPTokenPoolInfoNotFoundError} if pool module not found
   * @throws {@link CCIPPoolNotInitializedError} if pool is not initialized
   */
  async generateUnsignedDeleteChainConfig(
    sender: string,
    params: DeleteChainConfigParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    validateDeleteChainConfigParams(params)

    const poolModule = await this.discoverPoolModule(params.poolAddress)
    await this.ensurePoolInitialized(params.poolAddress, poolModule)

    const senderAddr = AccountAddress.from(sender)

    const applyTx = await this.provider.transaction.build.simple({
      sender: senderAddr,
      data: {
        function:
          `${params.poolAddress}::${poolModule}::apply_chain_updates` as `${string}::${string}::${string}`,
        functionArguments: [
          [params.remoteChainSelector], // remoteChainSelectorsToRemove
          [], // remoteChainSelectorsToAdd
          [], // remotePoolAddressesToAdd
          [], // remoteTokenAddressesToAdd
        ],
      },
    })

    this.logger.debug(
      'generateUnsignedDeleteChainConfig: pool =',
      params.poolAddress,
      'module =',
      poolModule,
      'remoteChainSelector =',
      params.remoteChainSelector,
    )

    return {
      transactions: [
        {
          family: ChainFamily.Aptos,
          transactions: [applyTx.bcsToBytes()],
        },
      ],
    }
  }

  /**
   * Removes a remote chain configuration from a token pool, signing and submitting with the provided wallet.
   *
   * @param wallet - Aptos account with signing capability (must be pool owner)
   * @param params - Delete chain config parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPDeleteChainConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPDeleteChainConfigFailedError} if the transaction fails
   */
  async deleteChainConfig(
    wallet: unknown,
    params: DeleteChainConfigParams,
  ): Promise<DeleteChainConfigResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedDeleteChainConfig(
      sender,
      params,
    )

    this.logger.debug('deleteChainConfig: deleting chain config...')

    try {
      const unsignedTx = unsignedTxs[0]!
      const txBytes = unsignedTx.transactions[0]
      const unsigned = SimpleTransaction.deserialize(new Deserializer(txBytes))
      const signed = await wallet.signTransactionWithAuthenticator(unsigned)
      const pendingTxn = await this.provider.transaction.submit.simple({
        transaction: unsigned,
        senderAuthenticator: signed,
      })
      const { hash } = await this.provider.waitForTransaction({
        transactionHash: pendingTxn.hash,
      })

      this.logger.info('deleteChainConfig: deleted chain config, tx =', hash)

      return { txHash: hash }
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
   * Calls `remove_remote_pool(signer, u64, vector<u8>)` on the pool module.
   * One transaction per address.
   *
   * @param sender - Aptos account address (hex string) of the pool owner
   * @param params - Remove remote pool addresses parameters
   * @returns Unsigned Aptos transactions (one per address)
   * @throws {@link CCIPRemoveRemotePoolAddressesParamsInvalidError} if params are invalid
   * @throws {@link CCIPTokenPoolInfoNotFoundError} if pool module not found
   * @throws {@link CCIPPoolNotInitializedError} if pool is not initialized
   */
  async generateUnsignedRemoveRemotePoolAddresses(
    sender: string,
    params: RemoveRemotePoolAddressesParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    validateRemoveRemotePoolAddressesParams(params)

    const poolModule = await this.discoverPoolModule(params.poolAddress)
    await this.ensurePoolInitialized(params.poolAddress, poolModule)

    const senderAddr = AccountAddress.from(sender)
    const transactions: Uint8Array[] = []

    // Fetch current sequence number so multi-tx batches get consecutive nonces
    const { sequence_number } = await this.provider.getAccountInfo({
      accountAddress: senderAddr,
    })
    let nextSeq = BigInt(sequence_number)

    for (const remotePoolAddress of params.remotePoolAddresses) {
      const encodedAddress = Array.from(getAddressBytes(remotePoolAddress))
      const tx = await this.provider.transaction.build.simple({
        sender: senderAddr,
        data: {
          function:
            `${params.poolAddress}::${poolModule}::remove_remote_pool` as `${string}::${string}::${string}`,
          functionArguments: [params.remoteChainSelector, encodedAddress],
        },
        options: { accountSequenceNumber: nextSeq++ },
      })
      transactions.push(tx.bcsToBytes())
    }

    this.logger.debug(
      'generateUnsignedRemoveRemotePoolAddresses: pool =',
      params.poolAddress,
      'module =',
      poolModule,
      'addresses =',
      params.remotePoolAddresses.length,
    )

    return {
      transactions: [
        {
          family: ChainFamily.Aptos,
          transactions: transactions as [Uint8Array, ...Uint8Array[]],
        },
      ],
    }
  }

  /**
   * Removes specific remote pool addresses from an existing chain config, signing and submitting with the provided wallet.
   *
   * @param wallet - Aptos account with signing capability (must be pool owner)
   * @param params - Remove remote pool addresses parameters
   * @returns Result with `txHash` of the last transaction
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPRemoveRemotePoolAddressesParamsInvalidError} if params are invalid
   * @throws {@link CCIPRemoveRemotePoolAddressesFailedError} if the transaction fails
   */
  async removeRemotePoolAddresses(
    wallet: unknown,
    params: RemoveRemotePoolAddressesParams,
  ): Promise<RemoveRemotePoolAddressesResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedRemoveRemotePoolAddresses(
      sender,
      params,
    )

    this.logger.debug('removeRemotePoolAddresses: removing remote pool addresses...')

    try {
      let lastHash = ''
      for (const unsignedTx of unsignedTxs) {
        for (const txBytes of unsignedTx.transactions) {
          const unsigned = SimpleTransaction.deserialize(new Deserializer(txBytes))
          const signed = await wallet.signTransactionWithAuthenticator(unsigned)
          const pendingTxn = await this.provider.transaction.submit.simple({
            transaction: unsigned,
            senderAuthenticator: signed,
          })
          const { hash } = await this.provider.waitForTransaction({
            transactionHash: pendingTxn.hash,
          })
          this.logger.debug('removeRemotePoolAddresses: submitted tx =', hash)
          lastHash = hash
        }
      }

      this.logger.info('removeRemotePoolAddresses: removed remote pool addresses, tx =', lastHash)

      return { txHash: lastHash }
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
   * Builds unsigned transactions for updating rate limiter configurations on a token pool.
   *
   * Auto-discovers the pool module name from the pool address.
   * Encodes a single `set_chain_rate_limiter_configs` Move call with all chain configs.
   *
   * @param sender - Aptos account address (hex)
   * @param params - Set chain rate limiter config parameters
   * @returns Unsigned Aptos transactions
   * @throws {@link CCIPSetRateLimiterConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPPoolNotInitializedError} if pool is not initialized (generic pools)
   */
  async generateUnsignedSetChainRateLimiterConfig(
    sender: string,
    params: SetChainRateLimiterConfigParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    validateSetChainRateLimiterConfigParams(params)

    // Auto-discover pool module name
    const poolModule = await this.discoverPoolModule(params.poolAddress)
    await this.ensurePoolInitialized(params.poolAddress, poolModule)

    const senderAddr = AccountAddress.from(sender)

    const rateLimiterTx = await this.provider.transaction.build.simple({
      sender: senderAddr,
      data: {
        function:
          `${params.poolAddress}::${poolModule}::set_chain_rate_limiter_configs` as `${string}::${string}::${string}`,
        functionArguments: [
          params.chainConfigs.map((c) => c.remoteChainSelector),
          params.chainConfigs.map((c) => c.outboundRateLimiterConfig.isEnabled),
          params.chainConfigs.map((c) => BigInt(c.outboundRateLimiterConfig.capacity)),
          params.chainConfigs.map((c) => BigInt(c.outboundRateLimiterConfig.rate)),
          params.chainConfigs.map((c) => c.inboundRateLimiterConfig.isEnabled),
          params.chainConfigs.map((c) => BigInt(c.inboundRateLimiterConfig.capacity)),
          params.chainConfigs.map((c) => BigInt(c.inboundRateLimiterConfig.rate)),
        ],
      },
    })

    this.logger.debug(
      'generateUnsignedSetChainRateLimiterConfig: pool =',
      params.poolAddress,
      'module =',
      poolModule,
      'configs =',
      params.chainConfigs.length,
    )

    return {
      transactions: [
        {
          family: ChainFamily.Aptos,
          transactions: [rateLimiterTx.bcsToBytes()],
        },
      ],
    }
  }

  /**
   * Updates rate limiter configurations on a token pool, signing and submitting with the provided wallet.
   *
   * @param wallet - Aptos account with signing capability (must be pool owner or rate limit admin)
   * @param params - Set chain rate limiter config parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPSetRateLimiterConfigParamsInvalidError} if params are invalid
   * @throws {@link CCIPSetRateLimiterConfigFailedError} if the transaction fails
   */
  async setChainRateLimiterConfig(
    wallet: unknown,
    params: SetChainRateLimiterConfigParams,
  ): Promise<SetChainRateLimiterConfigResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedSetChainRateLimiterConfig(
      sender,
      params,
    )

    this.logger.debug('setChainRateLimiterConfig: updating rate limits...')

    try {
      const unsigned = SimpleTransaction.deserialize(
        new Deserializer(unsignedTxs[0]!.transactions[0]),
      )

      const signed = await wallet.signTransactionWithAuthenticator(unsigned)
      const pendingTxn = await this.provider.transaction.submit.simple({
        transaction: unsigned,
        senderAuthenticator: signed,
      })
      const { hash } = await this.provider.waitForTransaction({
        transactionHash: pendingTxn.hash,
      })

      this.logger.info('setChainRateLimiterConfig: updated rate limits, tx =', hash)

      return { txHash: hash }
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
  // setRateLimitAdmin — NOT SUPPORTED on Aptos
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Not supported on Aptos — rate limiting is managed directly by the pool owner.
   *
   * @throws {@link CCIPMethodUnsupportedError} always
   */
  generateUnsignedSetRateLimitAdmin(
    _sender: string,
    _params: { poolAddress: string; rateLimitAdmin: string },
  ): never {
    throw new CCIPMethodUnsupportedError('AptosTokenAdmin', 'setRateLimitAdmin')
  }

  /**
   * Not supported on Aptos — rate limiting is managed directly by the pool owner.
   *
   * @throws {@link CCIPMethodUnsupportedError} always
   */
  setRateLimitAdmin(
    _wallet: unknown,
    _params: { poolAddress: string; rateLimitAdmin: string },
  ): never {
    throw new CCIPMethodUnsupportedError('AptosTokenAdmin', 'setRateLimitAdmin')
  }

  // ── Grant Mint/Burn Access ─────────────────────────────────────────────

  /**
   * Detects the pool type from a pool address by discovering the pool module
   * name and mapping it to a known type.
   *
   * @param poolAddress - Pool object address (hex string)
   * @returns Pool type and module name
   * @throws {@link CCIPGrantMintBurnAccessParamsInvalidError} if pool type cannot be determined
   */
  private async detectPoolType(poolAddress: string): Promise<{
    type: 'managed' | 'burn_mint' | 'regulated' | 'lock_release'
    module: string
  }> {
    const poolModule = await this.discoverPoolModule(poolAddress)

    if (poolModule === 'managed_token_pool') return { type: 'managed', module: poolModule }
    if (poolModule === 'burn_mint_token_pool') return { type: 'burn_mint', module: poolModule }
    if (poolModule === 'regulated_token_pool') return { type: 'regulated', module: poolModule }
    if (poolModule === 'lock_release_token_pool')
      return { type: 'lock_release', module: poolModule }

    // Fallback: try type_and_version view function
    try {
      const [typeName] = await this.provider.view<[string]>({
        payload: {
          function:
            `${poolAddress}::${poolModule}::type_and_version` as `${string}::${string}::${string}`,
        },
      })
      if (typeName.includes('ManagedTokenPool')) return { type: 'managed', module: poolModule }
      if (typeName.includes('BurnMintTokenPool')) return { type: 'burn_mint', module: poolModule }
      if (typeName.includes('RegulatedTokenPool')) return { type: 'regulated', module: poolModule }
      if (typeName.includes('LockReleaseTokenPool'))
        return { type: 'lock_release', module: poolModule }
    } catch {
      // type_and_version not available, fall through
    }

    throw new CCIPGrantMintBurnAccessParamsInvalidError(
      'authority',
      `unknown pool type at ${poolAddress}: module=${poolModule}`,
    )
  }

  /**
   * Resolves the token code object address from a Fungible Asset metadata address.
   *
   * Object hierarchy: code object → token state → FA metadata.
   * The FA metadata object's owner is the token state object, whose owner is
   * the code object.
   *
   * @param tokenAddress - FA metadata address (hex string)
   * @returns Code object address
   */
  private async resolveTokenCodeObject(tokenAddress: string): Promise<string> {
    // FA metadata → owned by token state → owned by code object
    // First get the owner of FA metadata (token state object)
    const [tokenStateOwner] = await this.provider.view<[string]>({
      payload: {
        function: '0x1::object::owner' as `${string}::${string}::${string}`,
        typeArguments: ['0x1::fungible_asset::Metadata'],
        functionArguments: [tokenAddress],
      },
    })

    // Then get the owner of the token state (code object)
    const [codeObject] = await this.provider.view<[string]>({
      payload: {
        function: '0x1::object::owner' as `${string}::${string}::${string}`,
        typeArguments: ['0x1::object::ObjectCore'],
        functionArguments: [tokenStateOwner],
      },
    })

    return codeObject
  }

  /**
   * Builds unsigned transactions for granting mint/burn access on an Aptos
   * token to the specified pool address.
   *
   * Auto-detects the pool type via the pool's module name:
   * - **ManagedTokenPool**: calls `apply_allowed_minter_updates` + `apply_allowed_burner_updates`
   *   on the managed_token module (2 transactions)
   * - **RegulatedTokenPool**: calls `regulated_token::grant_role` with
   *   `BRIDGE_MINTER_OR_BURNER_ROLE` (1 transaction)
   * - **BurnMintTokenPool**: not supported — requires `initialize()` with Move BurnRef/MintRef
   * - **LockReleaseTokenPool**: not applicable — does not mint/burn
   *
   * @param sender - Token owner address (hex string)
   * @param params - Grant mint/burn access parameters
   * @returns Unsigned Aptos transactions
   * @throws {@link CCIPGrantMintBurnAccessParamsInvalidError} if params are invalid
   * @throws {@link CCIPTokenPoolInfoNotFoundError} if pool module not found
   */
  async generateUnsignedGrantMintBurnAccess(
    sender: string,
    params: GrantMintBurnAccessParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCIPGrantMintBurnAccessParamsInvalidError('tokenAddress', 'must be non-empty')
    }
    if (!params.authority || params.authority.trim().length === 0) {
      throw new CCIPGrantMintBurnAccessParamsInvalidError('authority', 'must be non-empty')
    }

    const poolInfo = await this.detectPoolType(params.authority)

    if (poolInfo.type === 'lock_release') {
      throw new CCIPGrantMintBurnAccessParamsInvalidError(
        'authority',
        'lock-release pools do not mint or burn tokens — no access to grant',
      )
    }

    if (poolInfo.type === 'burn_mint') {
      throw new CCIPGrantMintBurnAccessParamsInvalidError(
        'authority',
        'burn_mint_token_pool requires initialization by the token creator module. ' +
          'The token creator must call burn_mint_token_pool::initialize() with stored BurnRef/MintRef. ' +
          'This cannot be done via SDK because the capability refs are only available to the token creator.',
      )
    }

    await this.ensurePoolInitialized(params.authority, poolInfo.module)

    // Get pool resource signer address (the address that calls mint/burn)
    const [poolResourceSigner] = await this.provider.view<[string]>({
      payload: {
        function:
          `${params.authority}::${poolInfo.module}::get_store_address` as `${string}::${string}::${string}`,
      },
    })

    // Resolve token code object from FA metadata
    const tokenCodeObject = await this.resolveTokenCodeObject(params.tokenAddress)

    const txs: UnsignedAptosTx[] = []

    // Fetch current sequence number so multi-tx batches get consecutive nonces
    const { sequence_number } = await this.provider.getAccountInfo({
      accountAddress: AccountAddress.from(sender),
    })
    let nextSeq = BigInt(sequence_number)

    const role = params.role ?? 'mintAndBurn'

    if (poolInfo.type === 'managed') {
      // managed_token: add pool resource signer to allowed minters and/or burners
      if (role === 'mint' || role === 'mintAndBurn') {
        const tx = await this.provider.transaction.build.simple({
          sender: AccountAddress.from(sender),
          data: {
            function:
              `${tokenCodeObject}::managed_token::apply_allowed_minter_updates` as `${string}::${string}::${string}`,
            functionArguments: [[], [poolResourceSigner]],
          },
          options: { accountSequenceNumber: nextSeq++ },
        })
        txs.push({ family: ChainFamily.Aptos, transactions: [tx.bcsToBytes()] })
      }
      if (role === 'burn' || role === 'mintAndBurn') {
        const tx = await this.provider.transaction.build.simple({
          sender: AccountAddress.from(sender),
          data: {
            function:
              `${tokenCodeObject}::managed_token::apply_allowed_burner_updates` as `${string}::${string}::${string}`,
            functionArguments: [[], [poolResourceSigner]],
          },
          options: { accountSequenceNumber: nextSeq },
        })
        txs.push({ family: ChainFamily.Aptos, transactions: [tx.bcsToBytes()] })
      }
    } else {
      // regulated_token: MINTER_ROLE=4, BURNER_ROLE=5, BRIDGE_MINTER_OR_BURNER_ROLE=6
      const roleNumber = role === 'mint' ? 4 : role === 'burn' ? 5 : 6
      const tx = await this.provider.transaction.build.simple({
        sender: AccountAddress.from(sender),
        data: {
          function:
            `${tokenCodeObject}::regulated_token::grant_role` as `${string}::${string}::${string}`,
          functionArguments: [roleNumber, poolResourceSigner],
        },
      })
      txs.push({ family: ChainFamily.Aptos, transactions: [tx.bcsToBytes()] })
    }

    this.logger.debug(
      'generateUnsignedGrantMintBurnAccess: pool type =',
      poolInfo.type,
      'poolResourceSigner =',
      poolResourceSigner,
      'txs =',
      txs.length,
    )

    return { transactions: txs }
  }

  /**
   * Grants mint/burn access on an Aptos token, signing and submitting with
   * the provided wallet.
   *
   * @param wallet - Aptos account with signing capability (must be the token owner)
   * @param params - Grant mint/burn access parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPGrantMintBurnAccessParamsInvalidError} if params are invalid
   * @throws {@link CCIPGrantMintBurnAccessFailedError} if the transaction fails
   *
   * @example
   * ```typescript
   * const { txHash } = await admin.grantMintBurnAccess(wallet, {
   *   tokenAddress: '0x89fd6b...',
   *   authority: '0x1234...',
   * })
   * ```
   */
  async grantMintBurnAccess(
    wallet: unknown,
    params: GrantMintBurnAccessParams,
  ): Promise<GrantMintBurnAccessResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedGrantMintBurnAccess(
      sender,
      params,
    )

    this.logger.debug('grantMintBurnAccess: granting mint/burn access...')

    try {
      let lastHash = ''
      for (const unsignedTx of unsignedTxs) {
        const unsigned = SimpleTransaction.deserialize(new Deserializer(unsignedTx.transactions[0]))
        const signed = await wallet.signTransactionWithAuthenticator(unsigned)
        const pendingTxn = await this.provider.transaction.submit.simple({
          transaction: unsigned,
          senderAuthenticator: signed,
        })
        const { hash } = await this.provider.waitForTransaction({
          transactionHash: pendingTxn.hash,
        })
        lastHash = hash
      }

      this.logger.info('grantMintBurnAccess: granted mint/burn access, tx =', lastHash)

      return { txHash: lastHash }
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
   * Builds unsigned transaction(s) to revoke mint or burn access from an
   * address on an Aptos token.
   *
   * - **Managed token:** calls `apply_allowed_minter_updates([authority], [])` or
   *   `apply_allowed_burner_updates([authority], [])`.
   * - **Regulated token:** calls `revoke_role(MINTER_ROLE=4, authority)` or
   *   `revoke_role(BURNER_ROLE=5, authority)`.
   *
   * @param sender - Sender account address
   * @param params - Revoke mint/burn access parameters
   * @returns Unsigned Aptos transaction(s)
   * @throws {@link CCIPRevokeMintBurnAccessParamsInvalidError} if params are invalid
   */
  async generateUnsignedRevokeMintBurnAccess(
    sender: string,
    params: RevokeMintBurnAccessParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    if (!params.tokenAddress || params.tokenAddress.trim().length === 0) {
      throw new CCIPRevokeMintBurnAccessParamsInvalidError('tokenAddress', 'must be non-empty')
    }
    if (!params.authority || params.authority.trim().length === 0) {
      throw new CCIPRevokeMintBurnAccessParamsInvalidError('authority', 'must be non-empty')
    }
    if ((params.role as string) !== 'mint' && (params.role as string) !== 'burn') {
      throw new CCIPRevokeMintBurnAccessParamsInvalidError('role', "must be 'mint' or 'burn'")
    }

    const poolInfo = await this.detectPoolType(params.authority)

    if (poolInfo.type === 'lock_release') {
      throw new CCIPRevokeMintBurnAccessParamsInvalidError(
        'authority',
        'lock-release pools do not mint or burn tokens — no access to revoke',
      )
    }

    if (poolInfo.type === 'burn_mint') {
      throw new CCIPRevokeMintBurnAccessParamsInvalidError(
        'authority',
        'burn_mint_token_pool requires initialization by the token creator module. Revoke is not supported via SDK.',
      )
    }

    await this.ensurePoolInitialized(params.authority, poolInfo.module)

    const [poolResourceSigner] = await this.provider.view<[string]>({
      payload: {
        function:
          `${params.authority}::${poolInfo.module}::get_store_address` as `${string}::${string}::${string}`,
      },
    })

    const tokenCodeObject = await this.resolveTokenCodeObject(params.tokenAddress)

    const txs: UnsignedAptosTx[] = []

    if (poolInfo.type === 'managed') {
      // managed_token: remove pool resource signer from minters or burners
      const fnName =
        params.role === 'mint' ? 'apply_allowed_minter_updates' : 'apply_allowed_burner_updates'
      const tx = await this.provider.transaction.build.simple({
        sender: AccountAddress.from(sender),
        data: {
          function:
            `${tokenCodeObject}::managed_token::${fnName}` as `${string}::${string}::${string}`,
          functionArguments: [[poolResourceSigner], []], // remove=[signer], add=[]
        },
      })
      txs.push({ family: ChainFamily.Aptos, transactions: [tx.bcsToBytes()] })
    } else {
      // regulated_token: MINTER_ROLE=4, BURNER_ROLE=5
      const roleNumber = params.role === 'mint' ? 4 : 5
      const tx = await this.provider.transaction.build.simple({
        sender: AccountAddress.from(sender),
        data: {
          function:
            `${tokenCodeObject}::regulated_token::revoke_role` as `${string}::${string}::${string}`,
          functionArguments: [roleNumber, poolResourceSigner],
        },
      })
      txs.push({ family: ChainFamily.Aptos, transactions: [tx.bcsToBytes()] })
    }

    this.logger.debug(
      'generateUnsignedRevokeMintBurnAccess: pool type =',
      poolInfo.type,
      'role =',
      params.role,
      'poolResourceSigner =',
      poolResourceSigner,
    )

    return { transactions: txs }
  }

  /**
   * Revokes mint or burn access from an address on an Aptos token,
   * signing and submitting with the provided wallet.
   *
   * @param wallet - Aptos account with signing capability
   * @param params - Revoke mint/burn access parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPRevokeMintBurnAccessParamsInvalidError} if params are invalid
   * @throws {@link CCIPRevokeMintBurnAccessFailedError} if the transaction fails
   */
  async revokeMintBurnAccess(
    wallet: unknown,
    params: RevokeMintBurnAccessParams,
  ): Promise<RevokeMintBurnAccessResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedRevokeMintBurnAccess(
      sender,
      params,
    )

    this.logger.debug('revokeMintBurnAccess: revoking', params.role, 'access...')

    try {
      let lastHash = ''
      for (const unsignedTx of unsignedTxs) {
        const unsigned = SimpleTransaction.deserialize(new Deserializer(unsignedTx.transactions[0]))
        const signed = await wallet.signTransactionWithAuthenticator(unsigned)
        const pendingTxn = await this.provider.transaction.submit.simple({
          transaction: unsigned,
          senderAuthenticator: signed,
        })
        const { hash } = await this.provider.waitForTransaction({
          transactionHash: pendingTxn.hash,
        })
        lastHash = hash
      }

      this.logger.info('revokeMintBurnAccess: revoked', params.role, 'access, tx =', lastHash)

      return { txHash: lastHash }
    } catch (error) {
      if (error instanceof CCIPRevokeMintBurnAccessFailedError) throw error
      if (error instanceof CCIPRevokeMintBurnAccessParamsInvalidError) throw error
      throw new CCIPRevokeMintBurnAccessFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  /**
   * Deploys a ManagedToken FA module, signing and submitting with the provided wallet.
   *
   * **Requires `aptos` CLI** — compiles the Move source at deploy time.
   *
   * @param wallet - Aptos account with signing capability
   * @param params - Token deployment parameters
   * @returns Unified deploy result with `tokenAddress` and `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPTokenDeployParamsInvalidError} if params are invalid
   * @throws {@link CCIPTokenDeployFailedError} if the deploy transaction fails
   *
   * @example
   * ```typescript
   * const { tokenAddress, txHash } = await admin.deployToken(wallet, {
   *   name: 'My Token',
   *   symbol: 'MTK',
   *   decimals: 8,
   *   initialSupply: 1_000_000_000n,
   * })
   * console.log(\`Deployed at \${tokenAddress}, tx: \${txHash}\`)
   * ```
   */
  async deployToken(wallet: unknown, params: AptosDeployTokenParams): Promise<DeployTokenResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()

    const {
      transactions: unsignedTxs,
      codeObjectAddress,
      tokenAddress: faAddress,
    } = await this.generateUnsignedDeployToken(sender, params)

    this.logger.debug('deployToken: deploying ManagedToken...', unsignedTxs.length, 'transactions')

    let firstTxHash = ''

    try {
      for (let i = 0; i < unsignedTxs.length; i++) {
        const unsigned = SimpleTransaction.deserialize(
          new Deserializer(unsignedTxs[i]!.transactions[0]),
        )

        const signed = await wallet.signTransactionWithAuthenticator(unsigned)
        const pendingTxn = await this.provider.transaction.submit.simple({
          transaction: unsigned,
          senderAuthenticator: signed,
        })

        const { hash } = await this.provider.waitForTransaction({
          transactionHash: pendingTxn.hash,
        })

        if (i === 0) firstTxHash = hash
        this.logger.debug('deployToken: tx', i, 'confirmed:', hash)
      }

      this.logger.info(
        'deployToken: FA at',
        faAddress,
        'code object at',
        codeObjectAddress,
        'tx =',
        firstTxHash,
      )

      return { tokenAddress: faAddress, txHash: firstTxHash, codeObjectAddress }
    } catch (error) {
      if (error instanceof CCIPTokenDeployFailedError) throw error
      throw new CCIPTokenDeployFailedError(error instanceof Error ? error.message : String(error), {
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  // ── Get Mint/Burn Roles (read-only) ──────────────────────────────────────

  /**
   * Queries mint and burn roles on an Aptos managed or regulated token.
   *
   * - **managed**: calls `get_allowed_minters()` and `get_allowed_burners()`
   * - **regulated**: calls `get_minters()`, `get_burners()`,
   *   and `get_bridge_minters_or_burners()`
   *
   * Resolves the code object address from the FA metadata automatically.
   *
   * @param tokenAddress - Fungible asset metadata address (hex string)
   * @returns Role info including detected token module type
   *
   * @example
   * ```typescript
   * const roles = await admin.getMintBurnRoles('0x89fd6b...')
   * ```
   */
  async getMintBurnRoles(tokenAddress: string): Promise<AptosMintBurnRolesResult> {
    const codeObject = await this.resolveTokenCodeObject(tokenAddress)

    // Resolve the owner of the code object (wallet that deployed the token)
    let owner: string | undefined
    try {
      const [codeObjectOwner] = await this.provider.view<[string]>({
        payload: {
          function: '0x1::object::owner' as `${string}::${string}::${string}`,
          typeArguments: ['0x1::object::ObjectCore'],
          functionArguments: [codeObject],
        },
      })
      owner = codeObjectOwner
    } catch {
      this.logger.debug('getMintBurnRoles: failed to resolve code object owner')
    }

    // Try managed_token first
    try {
      const [minters] = await this.provider.view<[string[]]>({
        payload: {
          function:
            `${codeObject}::managed_token::get_allowed_minters` as `${string}::${string}::${string}`,
        },
      })
      const [burners] = await this.provider.view<[string[]]>({
        payload: {
          function:
            `${codeObject}::managed_token::get_allowed_burners` as `${string}::${string}::${string}`,
        },
      })

      this.logger.debug(
        `getMintBurnRoles: managed token, minters=${minters.length}, burners=${burners.length}`,
      )

      return {
        tokenModule: 'managed',
        owner,
        allowedMinters: minters,
        allowedBurners: burners,
      }
    } catch {
      // Not a managed token, try regulated
    }

    // Try regulated_token
    try {
      const [minters] = await this.provider.view<[string[]]>({
        payload: {
          function:
            `${codeObject}::regulated_token::get_minters` as `${string}::${string}::${string}`,
        },
      })
      const [burners] = await this.provider.view<[string[]]>({
        payload: {
          function:
            `${codeObject}::regulated_token::get_burners` as `${string}::${string}::${string}`,
        },
      })
      const [bridgeMintersOrBurners] = await this.provider.view<[string[]]>({
        payload: {
          function:
            `${codeObject}::regulated_token::get_bridge_minters_or_burners` as `${string}::${string}::${string}`,
        },
      })

      this.logger.debug(
        `getMintBurnRoles: regulated token, minters=${minters.length}, burners=${burners.length}, bridge=${bridgeMintersOrBurners.length}`,
      )

      return {
        tokenModule: 'regulated',
        owner,
        allowedMinters: minters,
        allowedBurners: burners,
        bridgeMintersOrBurners,
      }
    } catch {
      // Not a regulated token either
    }

    this.logger.debug('getMintBurnRoles: unknown token module type')

    return { tokenModule: 'unknown', owner }
  }

  // ── Transfer Ownership ───────────────────────────────────────────────────

  /**
   * Builds an unsigned transaction for proposing a new pool owner.
   *
   * Uses `poolAddress::moduleName::transfer_ownership(caller, to)`.
   *
   * @param sender - Sender address (hex)
   * @param params - Transfer ownership parameters
   * @returns Unsigned Aptos transaction
   * @throws {@link CCIPTransferOwnershipParamsInvalidError} if params are invalid
   */
  async generateUnsignedTransferOwnership(
    sender: string,
    params: TransferOwnershipParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCIPTransferOwnershipParamsInvalidError('poolAddress', 'must be non-empty')
    }
    if (!params.newOwner || params.newOwner.trim().length === 0) {
      throw new CCIPTransferOwnershipParamsInvalidError('newOwner', 'must be non-empty')
    }

    const moduleName = await this.discoverPoolModule(params.poolAddress)
    await this.ensurePoolInitialized(params.poolAddress, moduleName)

    const tx = await this.provider.transaction.build.simple({
      sender: AccountAddress.from(sender),
      data: {
        function:
          `${params.poolAddress}::${moduleName}::transfer_ownership` as `${string}::${string}::${string}`,
        functionArguments: [params.newOwner],
      },
    })

    this.logger.debug(
      'generateUnsignedTransferOwnership: pool =',
      params.poolAddress,
      'module =',
      moduleName,
      'newOwner =',
      params.newOwner,
    )

    return {
      transactions: [
        {
          family: ChainFamily.Aptos,
          transactions: [tx.bcsToBytes()],
        },
      ],
    }
  }

  /**
   * Proposes a new pool owner, signing and submitting with the provided wallet.
   *
   * @param wallet - Aptos account with signing capability (must be current pool owner)
   * @param params - Transfer ownership parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPTransferOwnershipParamsInvalidError} if params are invalid
   * @throws {@link CCIPTransferOwnershipFailedError} if the transaction fails
   */
  async transferOwnership(
    wallet: unknown,
    params: TransferOwnershipParams,
  ): Promise<OwnershipResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedTransferOwnership(
      sender,
      params,
    )

    this.logger.debug('transferOwnership: proposing new owner...')

    try {
      const unsigned = SimpleTransaction.deserialize(
        new Deserializer(unsignedTxs[0]!.transactions[0]),
      )

      const signed = await wallet.signTransactionWithAuthenticator(unsigned)
      const pendingTxn = await this.provider.transaction.submit.simple({
        transaction: unsigned,
        senderAuthenticator: signed,
      })

      const { hash } = await this.provider.waitForTransaction({
        transactionHash: pendingTxn.hash,
      })

      this.logger.info('transferOwnership: ownership proposed, tx =', hash)

      return { txHash: hash }
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
   * Uses `poolAddress::moduleName::accept_ownership(caller)`.
   *
   * @param sender - Sender address (hex)
   * @param params - Accept ownership parameters
   * @returns Unsigned Aptos transaction
   * @throws {@link CCIPAcceptOwnershipParamsInvalidError} if params are invalid
   */
  async generateUnsignedAcceptOwnership(
    sender: string,
    params: AcceptOwnershipParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCIPAcceptOwnershipParamsInvalidError('poolAddress', 'must be non-empty')
    }

    const moduleName = await this.discoverPoolModule(params.poolAddress)
    await this.ensurePoolInitialized(params.poolAddress, moduleName)

    const tx = await this.provider.transaction.build.simple({
      sender: AccountAddress.from(sender),
      data: {
        function:
          `${params.poolAddress}::${moduleName}::accept_ownership` as `${string}::${string}::${string}`,
        functionArguments: [],
      },
    })

    this.logger.debug(
      'generateUnsignedAcceptOwnership: pool =',
      params.poolAddress,
      'module =',
      moduleName,
    )

    return {
      transactions: [
        {
          family: ChainFamily.Aptos,
          transactions: [tx.bcsToBytes()],
        },
      ],
    }
  }

  /**
   * Accepts pool ownership, signing and submitting with the provided wallet.
   *
   * @param wallet - Aptos account with signing capability (must be proposed owner)
   * @param params - Accept ownership parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPAcceptOwnershipParamsInvalidError} if params are invalid
   * @throws {@link CCIPAcceptOwnershipFailedError} if the transaction fails
   */
  async acceptOwnership(wallet: unknown, params: AcceptOwnershipParams): Promise<OwnershipResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedAcceptOwnership(sender, params)

    this.logger.debug('acceptOwnership: accepting ownership...')

    try {
      const unsigned = SimpleTransaction.deserialize(
        new Deserializer(unsignedTxs[0]!.transactions[0]),
      )

      const signed = await wallet.signTransactionWithAuthenticator(unsigned)
      const pendingTxn = await this.provider.transaction.submit.simple({
        transaction: unsigned,
        senderAuthenticator: signed,
      })

      const { hash } = await this.provider.waitForTransaction({
        transactionHash: pendingTxn.hash,
      })

      this.logger.info('acceptOwnership: ownership accepted, tx =', hash)

      return { txHash: hash }
    } catch (error) {
      if (error instanceof CCIPAcceptOwnershipFailedError) throw error
      if (error instanceof CCIPAcceptOwnershipParamsInvalidError) throw error
      throw new CCIPAcceptOwnershipFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }

  // ── Execute Ownership Transfer (Aptos 3rd step) ─────────────────────────

  /**
   * Builds an unsigned transaction for executing (finalizing) pool ownership transfer.
   *
   * Aptos uses a 3-step ownership transfer:
   * 1. `transfer_ownership(to)` — current owner proposes
   * 2. `accept_ownership()` — proposed owner signals acceptance
   * 3. `execute_ownership_transfer(to)` — **current owner** finalizes the AptosFramework object transfer
   *
   * Uses `poolAddress::moduleName::execute_ownership_transfer(caller, to)`.
   *
   * @param sender - Sender address (hex) — must be the **current** pool owner
   * @param params - Execute ownership transfer parameters
   * @returns Unsigned Aptos transaction
   * @throws {@link CCIPExecuteOwnershipTransferParamsInvalidError} if params are invalid
   */
  async generateUnsignedExecuteOwnershipTransfer(
    sender: string,
    params: ExecuteOwnershipTransferParams,
  ): Promise<{ transactions: UnsignedAptosTx[] }> {
    if (!params.poolAddress || params.poolAddress.trim().length === 0) {
      throw new CCIPExecuteOwnershipTransferParamsInvalidError('poolAddress', 'must be non-empty')
    }
    if (!params.newOwner || params.newOwner.trim().length === 0) {
      throw new CCIPExecuteOwnershipTransferParamsInvalidError('newOwner', 'must be non-empty')
    }

    const moduleName = await this.discoverPoolModule(params.poolAddress)
    await this.ensurePoolInitialized(params.poolAddress, moduleName)

    const tx = await this.provider.transaction.build.simple({
      sender: AccountAddress.from(sender),
      data: {
        function:
          `${params.poolAddress}::${moduleName}::execute_ownership_transfer` as `${string}::${string}::${string}`,
        functionArguments: [params.newOwner],
      },
    })

    this.logger.debug(
      'generateUnsignedExecuteOwnershipTransfer: pool =',
      params.poolAddress,
      'module =',
      moduleName,
      'newOwner =',
      params.newOwner,
    )

    return {
      transactions: [
        {
          family: ChainFamily.Aptos,
          transactions: [tx.bcsToBytes()],
        },
      ],
    }
  }

  /**
   * Executes (finalizes) pool ownership transfer, signing and submitting with the provided wallet.
   *
   * This is the Aptos-only 3rd step: the **current owner** calls this after the proposed
   * owner has called `acceptOwnership`. It performs the AptosFramework `object::transfer`.
   *
   * @param wallet - Aptos account with signing capability (must be **current** pool owner)
   * @param params - Execute ownership transfer parameters
   * @returns Result with `txHash`
   * @throws {@link CCIPWalletInvalidError} if wallet is not a valid Aptos account
   * @throws {@link CCIPExecuteOwnershipTransferParamsInvalidError} if params are invalid
   * @throws {@link CCIPExecuteOwnershipTransferFailedError} if the transaction fails
   */
  async executeOwnershipTransfer(
    wallet: unknown,
    params: ExecuteOwnershipTransferParams,
  ): Promise<OwnershipResult> {
    if (!isAptosAccount(wallet)) throw new CCIPWalletInvalidError(wallet)

    const sender = wallet.accountAddress.toString()
    const { transactions: unsignedTxs } = await this.generateUnsignedExecuteOwnershipTransfer(
      sender,
      params,
    )

    this.logger.debug('executeOwnershipTransfer: finalizing ownership transfer...')

    try {
      const unsigned = SimpleTransaction.deserialize(
        new Deserializer(unsignedTxs[0]!.transactions[0]),
      )

      const signed = await wallet.signTransactionWithAuthenticator(unsigned)
      const pendingTxn = await this.provider.transaction.submit.simple({
        transaction: unsigned,
        senderAuthenticator: signed,
      })

      const { hash } = await this.provider.waitForTransaction({
        transactionHash: pendingTxn.hash,
      })

      this.logger.info('executeOwnershipTransfer: ownership transfer executed, tx =', hash)

      return { txHash: hash }
    } catch (error) {
      if (error instanceof CCIPExecuteOwnershipTransferFailedError) throw error
      if (error instanceof CCIPExecuteOwnershipTransferParamsInvalidError) throw error
      throw new CCIPExecuteOwnershipTransferFailedError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      )
    }
  }
}
