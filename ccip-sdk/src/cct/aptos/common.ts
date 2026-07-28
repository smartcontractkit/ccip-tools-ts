/**
 * Shared helpers for Aptos CCT operations: Move compilation (deploy-time),
 * pool-module discovery, initialization guards, pool-type detection, and
 * object-address derivation.
 *
 * These are free functions operating over an {@link AptosChain} facade
 * (`chain.provider` / `chain.logger`) rather than methods on a chain subclass.
 *
 * **Deploy helpers are Node.js/CLI-only** — Move compilation requires the
 * `aptos` CLI plus filesystem and child-process access, so it cannot run in a
 * browser. See the token/pool deploy ops for the backend-relay pattern.
 *
 * @packageDocumentation
 */

/* eslint-disable import-x/no-nodejs-modules -- Node.js-only module: requires CLI compilation */
import { Buffer } from 'buffer'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
/* eslint-enable import-x/no-nodejs-modules */

import { type Aptos, AccountAddress, createObjectAddress } from '@aptos-labs/ts-sdk'

import type { AptosChain } from '../../aptos/index.ts'
import {
  CCIPGrantMintBurnAccessParamsInvalidError,
  CCIPPoolDeployFailedError,
  CCIPPoolDeployParamsInvalidError,
  CCIPPoolNotInitializedError,
  CCIPTokenDeployFailedError,
  CCIPTokenDeployParamsInvalidError,
  CCIPTokenPoolInfoNotFoundError,
} from '../../errors/index.ts'
import type {
  AptosDeployPoolParams,
  AptosDeployTokenParams,
  AptosTokenModule,
} from '../../token-admin/types.ts'
import type { Logger } from '../../types.ts'

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
export async function computeObjectAddress(
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
export function deriveFungibleAssetAddress(objectAddress: string, symbol: string): string {
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
export async function resolveCodeObjectAddress(
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
export function validateParams(params: AptosDeployTokenParams): void {
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
export function ensureAptosCli(): void {
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
 * @param logger - Logger instance
 * @returns metadataBytes and byteCode extracted from the compiled JSON payload
 */
export async function compilePackage(
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
export function validatePoolParams(params: AptosDeployPoolParams): AptosTokenModule {
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
export async function writeCcipDep(tmpDir: string): Promise<void> {
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
export async function writeMcmsDep(tmpDir: string): Promise<void> {
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
export async function writeTokenPoolDep(tmpDir: string): Promise<void> {
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
 * @param tmpDir - Temp directory to write sources into
 * @param tokenModule - Token module variant ('managed' | 'generic' | 'regulated')
 * @param poolType - Pool type ('burn-mint' | 'lock-release')
 * @returns The path to the pool package directory (to pass to `aptos move build-publish-payload`)
 */
export async function writePoolSources(
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
 * Resolves the named addresses for Move compilation.
 *
 * CCIPTokenPool is published to `tokenPoolObjectAddress` (separate object).
 * The pool itself is published to `poolObjectAddress`.
 *
 * For managed/regulated pools, `tokenCodeObjectAddress` is the code object resolved
 * from the FA metadata via on-chain ownership traversal. For generic pools it is unused
 * — `params.tokenAddress` (the FA metadata) is passed directly as the local token address.
 *
 * @param tokenPoolObjectAddress - Object address for the shared CCIPTokenPool package
 * @param poolObjectAddress - Object address for the pool package itself
 * @param tokenModule - Token module variant ('managed' | 'generic' | 'regulated')
 * @param poolType - Pool type ('burn-mint' | 'lock-release')
 * @param params - Pool deploy parameters
 * @param tokenCodeObjectAddress - Code object address for managed/regulated tokens
 * @returns Named-address map for `--named-addresses`
 */
export function resolveNamedAddresses(
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
export function poolLabel(tokenModule: AptosTokenModule, poolType: string): string {
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
export function compileMovePackage(
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
 * @param tokenPoolObjectAddress - Object address for the shared CCIPTokenPool package
 * @param poolObjectAddress - Object address for the pool package itself
 * @param tokenModule - Token module variant ('managed' | 'generic' | 'regulated')
 * @param poolType - Pool type ('burn-mint' | 'lock-release')
 * @param namedAddresses - All named addresses for compilation
 * @param logger - Logger instance
 * @returns Two compiled payloads: tokenPool and pool
 */
export async function compilePoolPackages(
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
 * Auto-discovers the pool module name from a pool address by querying
 * account modules and filtering for `*token_pool`.
 *
 * @param chain - Aptos chain facade
 * @param poolAddress - Pool object address (hex string)
 * @returns The pool module name (e.g., 'managed_token_pool')
 * @throws {@link CCIPTokenPoolInfoNotFoundError} if no pool module found
 */
export async function discoverPoolModule(chain: AptosChain, poolAddress: string): Promise<string> {
  const modulesNames = (await chain._getAccountModulesNames(poolAddress))
    .reverse()
    .filter((name) => name.endsWith('token_pool'))

  if (modulesNames.length === 0) {
    throw new CCIPTokenPoolInfoNotFoundError(poolAddress)
  }

  // Try each module until one responds to get_token view
  for (const name of modulesNames) {
    try {
      await chain.provider.view<[string]>({
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
 * @param chain - Aptos chain facade
 * @param poolAddress - Pool object address (hex string)
 * @param poolModule - Pool module name (from `discoverPoolModule`)
 * @returns `true` if pool state is initialized, `false` otherwise
 */
export async function isPoolInitialized(
  chain: AptosChain,
  poolAddress: string,
  poolModule: string,
): Promise<boolean> {
  try {
    await chain.provider.view<[string]>({
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
 * @param chain - Aptos chain facade
 * @param poolAddress - Pool object address (hex string)
 * @param poolModule - Pool module name
 * @throws {@link CCIPPoolNotInitializedError} if pool is not initialized
 */
export async function ensurePoolInitialized(
  chain: AptosChain,
  poolAddress: string,
  poolModule: string,
): Promise<void> {
  const initialized = await isPoolInitialized(chain, poolAddress, poolModule)
  if (!initialized) {
    throw new CCIPPoolNotInitializedError(poolAddress)
  }
}

/**
 * Detects the pool type from a pool address, using the module name first and
 * falling back to the `type_and_version` view function.
 *
 * @param chain - Aptos chain facade
 * @param poolAddress - Pool object address (hex string)
 * @returns The detected pool `type` and its `module` name
 * @throws {@link CCIPGrantMintBurnAccessParamsInvalidError} if the pool type is unknown
 */
export async function detectPoolType(
  chain: AptosChain,
  poolAddress: string,
): Promise<{
  type: 'managed' | 'burn_mint' | 'regulated' | 'lock_release'
  module: string
}> {
  const poolModule = await discoverPoolModule(chain, poolAddress)

  if (poolModule === 'managed_token_pool') return { type: 'managed', module: poolModule }
  if (poolModule === 'burn_mint_token_pool') return { type: 'burn_mint', module: poolModule }
  if (poolModule === 'regulated_token_pool') return { type: 'regulated', module: poolModule }
  if (poolModule === 'lock_release_token_pool') return { type: 'lock_release', module: poolModule }

  // Fallback: try type_and_version view function
  try {
    const [typeName] = await chain.provider.view<[string]>({
      payload: {
        function: `${poolAddress}::${poolModule}::type_and_version`,
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
 * @param chain - Aptos chain facade
 * @param tokenAddress - FA metadata address (hex string)
 * @returns Code object address
 */
export async function resolveTokenCodeObject(
  chain: AptosChain,
  tokenAddress: string,
): Promise<string> {
  // FA metadata → owned by token state → owned by code object
  // First get the owner of FA metadata (token state object)
  const [tokenStateOwner] = await chain.provider.view<[string]>({
    payload: {
      function: '0x1::object::owner',
      typeArguments: ['0x1::fungible_asset::Metadata'],
      functionArguments: [tokenAddress],
    },
  })

  // Then get the owner of the token state (code object)
  const [codeObject] = await chain.provider.view<[string]>({
    payload: {
      function: '0x1::object::owner',
      typeArguments: ['0x1::object::ObjectCore'],
      functionArguments: [tokenStateOwner],
    },
  })

  return codeObject
}
