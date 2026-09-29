/**
 * EVM token contract layer for CCT: cached {@link Interface}s per {@link TokenVersion}
 * ({@link getTokenInterface}) for read/write ops, the deployable `CrossChainToken` (v2.0.0)
 * artifact ({@link getTokenArtifact}), the v1 token role reads ({@link readV1TokenRole}) and
 * role-set enumerations ({@link readV1TokenRoleHolders}), plus the owner read every owner-gated
 * write pre-flights `sender`
 * against ({@link readTokenOwner}) plus the guard built on it ({@link checkTokenOwner}). `2.0.0`
 * is `CrossChainToken`; `1.5.1` / `1.6.2` are `FactoryBurnMintERC20`. Mirrors
 * `token-pool/contracts.ts`.
 *
 * @packageDocumentation
 */

import { Interface, ZeroAddress, getAddress } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { EVMChain } from '../../../evm/index.ts'
import { resultToObject } from '../../../evm/types.ts'
import {
  type PreconditionError,
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTOperationUnsupportedError,
} from '../../errors.ts'
import FACTORY_BURN_MINT_ERC20_V1_5_1_ABI from '../artifacts/abi/V1_5_1/factory-burn-mint-erc20.ts'
import FACTORY_BURN_MINT_ERC20_V1_6_2_ABI from '../artifacts/abi/V1_6_2/factory-burn-mint-erc20.ts'
import CROSS_CHAIN_TOKEN_V2_0_0_ABI from '../artifacts/abi/V2_0_0/cross-chain-token.ts'
import CROSS_CHAIN_TOKEN_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/cross-chain-token.ts'
import type { DeployArtifact } from '../operation.ts'
import { getTypedContract, isMissingFunction } from '../query.ts'

/**
 * Known token versions, low to high. `2.0.0` is `CrossChainToken`; `1.5.1` / `1.6.2`
 * are `FactoryBurnMintERC20`.
 */
export const TokenVersion = {
  V1_5_1: '1.5.1',
  V1_6_2: '1.6.2',
  V2_0_0: '2.0.0',
} as const

/** A known token version. */
export type TokenVersion = (typeof TokenVersion)[keyof typeof TokenVersion]

/** The only supported CrossChainToken contract type and version. */
const CROSS_CHAIN_TOKEN_TYPE = 'CrossChainToken'

function parseCrossChainTokenVersion(address: string, version: string): TokenVersion {
  if (version !== TokenVersion.V2_0_0)
    throw new CCTContractVersionUnsupportedError(CROSS_CHAIN_TOKEN_TYPE, version, {
      context: { address },
    })
  return TokenVersion.V2_0_0
}

/** Narrows an on-chain version string to a version with a vendored token ABI. */
export function isTokenVersion(version: string): version is TokenVersion {
  return Object.values(TokenVersion).some((known) => known === version)
}

/**
 * Cached token {@link Interface}s per {@link TokenVersion}, built once from the vendored ABIs
 * (no per-call `new Interface`) — for read/write (e.g. ownership) ops. Mirrors
 * `TOKEN_POOL_INTERFACES` in `token-pool/contracts.ts`.
 */
export const TOKEN_INTERFACES: Record<TokenVersion, Interface> = {
  [TokenVersion.V1_5_1]: new Interface(FACTORY_BURN_MINT_ERC20_V1_5_1_ABI),
  [TokenVersion.V1_6_2]: new Interface(FACTORY_BURN_MINT_ERC20_V1_6_2_ABI),
  [TokenVersion.V2_0_0]: new Interface(CROSS_CHAIN_TOKEN_V2_0_0_ABI),
}

/** Returns the cached token {@link Interface} for `version`. */
export function getTokenInterface(version: TokenVersion): Interface {
  return TOKEN_INTERFACES[version]
}

/** Resolves a CrossChainToken version for v2-only operations. */
export async function resolveCrossChainToken(
  chain: EVMChain,
  address: string,
): Promise<TokenVersion> {
  const [contractType, version] = await chain.typeAndVersion(address)
  if (contractType !== CROSS_CHAIN_TOKEN_TYPE)
    throw new CCTContractTypeInvalidError(address, CROSS_CHAIN_TOKEN_TYPE, contractType)
  if (!isTokenVersion(version))
    throw new CCTContractVersionUnsupportedError(contractType, version, {
      context: { address },
    })
  return parseCrossChainTokenVersion(address, version)
}

/**
 * Floor-matches an encoder table, with v2.0.0 as the first CrossChainToken version. An absent
 * entry inherits the closest lower encoder; `null` marks a removal ceiling.
 *
 * @throws {@link CCTOperationUnsupportedError} if no encoder exists at or below `version`, or a
 * `null` ceiling is encountered first
 */
export function resolveTokenEncoder<F>(
  encoders: Partial<Record<TokenVersion, F | null>>,
  version: TokenVersion,
  operation: string,
): F {
  const versions = Object.values(TokenVersion)
  for (let i = versions.indexOf(version); i >= 0; i--) {
    const encoder = encoders[versions[i]!]
    if (encoder === null) break
    if (encoder !== undefined) return encoder
  }
  throw new CCTOperationUnsupportedError(operation, version)
}

/**
 * The interface every BurnMintERC677 role, mint and ownership write encodes through.
 *
 * Pinned to v1.5.1: the role functions, `mint`, the role reads and `transferOwnership` /
 * `acceptOwnership` are identical at v1.6.2 and on `HyperLiquidCompatibleERC20 1.6.2`, so there is
 * nothing to dispatch on. v2.0.0's `CrossChainToken` is a different contract, routed away by
 * {@link resolveToken} and ruled out by {@link readV1TokenRole}.
 */
export function getErc20Token(): Interface {
  return TOKEN_INTERFACES[TokenVersion.V1_5_1]
}

/**
 * Deploy artifacts ({@link DeployArtifact}: contract name + ctor {@link Interface} + creation
 * bytecode) keyed by {@link TokenVersion}, built once; read via {@link getTokenArtifact}. Only
 * `2.0.0` (`CrossChainToken`) is deployable.
 */
export const TOKEN_ARTIFACTS: Partial<Record<TokenVersion, DeployArtifact>> = {
  [TokenVersion.V2_0_0]: {
    contract: 'CrossChainToken',
    iface: TOKEN_INTERFACES[TokenVersion.V2_0_0],
    bytecode: CROSS_CHAIN_TOKEN_V2_0_0_BYTECODE,
  },
}

/**
 * Returns the cached deploy artifact for `version`.
 * @throws {@link CCTContractVersionUnsupportedError} if `version` has no vendored deploy bytecode
 */
export function getTokenArtifact(version: TokenVersion): DeployArtifact {
  const artifact = TOKEN_ARTIFACTS[version]
  if (!artifact) throw new CCTContractVersionUnsupportedError('token', version)
  return artifact
}

/**
 * Resolves the encoder version for a token operation. Pre-v2 tokens retain the v1.5.1 encoder:
 * v1.5.1 may not implement `typeAndVersion()`, and the operation's v1 read remains its family
 * check. A reported CrossChainToken must be a supported version.
 */
export async function resolveToken(chain: EVMChain, tokenAddress: string): Promise<TokenVersion> {
  const detected = await chain.typeAndVersion(tokenAddress).catch((error) => {
    if (isMissingFunction(error)) return undefined
    throw error
  })
  if (detected === undefined || detected[0] !== CROSS_CHAIN_TOKEN_TYPE) return TokenVersion.V1_5_1

  return parseCrossChainTokenVersion(tokenAddress, detected[1])
}

/** AccessControlDefaultAdminRules getters declared by CrossChainToken v2.0.0. */
type CrossChainTokenDefaultAdminReader = Pick<
  TypedContract<typeof CROSS_CHAIN_TOKEN_V2_0_0_ABI>,
  'defaultAdmin' | 'pendingDefaultAdmin'
>

/** Reads the current default admin of a CrossChainToken. */
export async function readTokenDefaultAdmin(
  chain: EVMChain,
  tokenAddress: string,
): Promise<string> {
  const token: CrossChainTokenDefaultAdminReader = getTypedContract(
    chain,
    tokenAddress,
    CROSS_CHAIN_TOKEN_V2_0_0_ABI,
  )
  return getAddress(resultToObject(await token.defaultAdmin()))
}

/** Reads a CrossChainToken's pending default admin and its acceptance timestamp. */
export async function readPendingTokenDefaultAdmin(
  chain: EVMChain,
  tokenAddress: string,
): Promise<{ newAdmin: string; schedule: bigint }> {
  const token: CrossChainTokenDefaultAdminReader = getTypedContract(
    chain,
    tokenAddress,
    CROSS_CHAIN_TOKEN_V2_0_0_ABI,
  )
  const [newAdmin, schedule] = await token.pendingDefaultAdmin()
  return { newAdmin: getAddress(newAdmin as string), schedule }
}

/** `CrossChainToken.getCCIPAdmin()`, the single-step CCIP-admin slot, declared identically across versions. */
type CCIPAdminGetter = Pick<TypedContract<typeof CROSS_CHAIN_TOKEN_V2_0_0_ABI>, 'getCCIPAdmin'>

/**
 * Reads a token's on-chain `getCCIPAdmin()`, checksummed.
 *
 * @remarks One `eth_call` against a single ABI, with no version resolution: `getCCIPAdmin()` is
 * declared identically (`() view returns (address)`) by `FactoryBurnMintERC20` v1.5.1 / v1.6.2 and
 * by v2.0.0's `CrossChainToken`, so its selector is stable across every supported version — like
 * {@link readTokenOwner}. Reads through the v2 ABI, which is a superset here.
 * @remarks The CCIP admin is a *single-step* authority: unlike the default admin there is no pending
 * slot, so this current value is the whole story.
 * @param chain - Chain to read from.
 * @param tokenAddress - Token contract to read `getCCIPAdmin()` from.
 * @returns The current CCIP admin, checksummed.
 */
export async function readCCIPAdmin(chain: EVMChain, tokenAddress: string): Promise<string> {
  const token: CCIPAdminGetter = getTypedContract(chain, tokenAddress, CROSS_CHAIN_TOKEN_V2_0_0_ABI)
  return getAddress(resultToObject(await token.getCCIPAdmin()))
}

/**
 * Confirms a CrossChainToken has a default admin and, when supplied, checks `sender` against it.
 * @returns The unmet requirement, or `undefined` if `sender` already holds the role. The two are
 * exclusive — with no admin there is nothing to compare `sender` to.
 */
export async function checkTokenDefaultAdmin(
  chain: EVMChain,
  tokenAddress: string,
  sender?: string,
): Promise<PreconditionError | undefined> {
  const admin = await readTokenDefaultAdmin(chain, tokenAddress)
  if (admin === ZeroAddress)
    return { param: 'tokenAddress', reason: 'has no current default admin' }
  if (sender === undefined || getAddress(sender) === admin) return undefined
  return { param: 'sender', reason: `must be the current default admin (${admin})` }
}

/** `Ownable2Step.owner()`, declared identically by every supported token version. */
type TokenOwnerGetter = Pick<TypedContract<typeof FACTORY_BURN_MINT_ERC20_V1_5_1_ABI>, 'owner'>

/**
 * Reads a token's on-chain `owner()`, checksummed.
 *
 * @remarks One `eth_call` against a single ABI, with no version resolution: `owner()` is declared
 * identically by `FactoryBurnMintERC20` v1.5.1 / v1.6.2 and by v2.0.0's `CrossChainToken`, where
 * it aliases the `DEFAULT_ADMIN_ROLE` holder. Mirrors `readTokenPoolOwner` in
 * `token-pool/contracts.ts`.
 * @remarks On the BurnMintERC677 family the owner *is* the mint/burn role admin — `grantMintRole`
 * and its siblings are `onlyOwner`.
 * @remarks Unlike {@link readV1TokenRole}, this is *not* also a family check: every one of those
 * contracts answers `owner()`, so it narrows nothing about the token's type.
 * @param chain - Chain to read from.
 * @param tokenAddress - Token contract to read `owner()` from.
 * @returns The current owner, checksummed.
 */
export async function readTokenOwner(chain: EVMChain, tokenAddress: string): Promise<string> {
  const token: TokenOwnerGetter = getTypedContract(
    chain,
    tokenAddress,
    FACTORY_BURN_MINT_ERC20_V1_5_1_ABI,
  )
  return getAddress(resultToObject(await token.owner()))
}

/**
 * Pre-flights `sender` against the token's on-chain `owner()` for an owner-gated write, so an
 * unauthorized caller fails as a {@link CCTParamsInvalidError} here instead of as an opaque
 * `OnlyCallableByOwner` revert after a multisig has already reviewed and signed. The token-side
 * counterpart of {@link checkPoolOwner}.
 * @param chain - Chain to read the owner from.
 * @param tokenAddress - Token being written to.
 * @param sender - The address the tx will be sent from; compared checksummed.
 * @returns The unmet requirement, or `undefined` if `sender` already owns the token.
 */
export async function checkTokenOwner(
  chain: EVMChain,
  tokenAddress: string,
  sender: string,
): Promise<PreconditionError | undefined> {
  const owner = await readTokenOwner(chain, tokenAddress)
  if (getAddress(sender) === owner) return undefined
  return { param: 'sender', reason: `must be the current token owner (${owner})` }
}

/**
 * The token-side `checkPoolOwnershipTransfer`: bounds a v1 two-step transfer against the token's
 * `owner()` in one `eth_call`.
 * @param chain - Chain to read the owner from.
 * @param tokenAddress - Token being written to.
 * @param newOwner - The address being proposed as the next owner.
 * @param sender - The address the tx will be sent from, when known.
 * @param newOwnerParam - Param name `newOwner` is reported under, e.g. `newAdmin` for
 * `beginDefaultAdminTransfer`.
 * @returns Every unmet requirement; both can fail at once.
 */
export async function checkTokenOwnershipTransfer(
  chain: EVMChain,
  tokenAddress: string,
  newOwner: string,
  sender?: string,
  newOwnerParam = 'newOwner',
): Promise<PreconditionError[]> {
  const owner = await readTokenOwner(chain, tokenAddress)
  const unmet: PreconditionError[] = []
  if (sender !== undefined && getAddress(sender) !== owner)
    unmet.push({ param: 'sender', reason: `must be the current token owner (${owner})` })
  if (getAddress(newOwner) === owner)
    unmet.push({
      param: newOwnerParam,
      reason: `must differ from the current token owner (${owner}) — the token would revert CannotTransferToSelf`,
    })
  return unmet
}
