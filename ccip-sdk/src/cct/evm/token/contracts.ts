/**
 * EVM token contract layer for CCT: cached {@link Interface}s per {@link TokenVersion}
 * ({@link getTokenInterface}) for read/write (e.g. ownership) ops, the deployable
 * `CrossChainToken` (v2.0.0) artifact ({@link getTokenArtifact}), and the narrow reads the
 * role-gated writes are built on ({@link readTokenRole}, {@link readTokenOwner}) plus the
 * owner-only guard over the latter ({@link assertTokenOwner}). `2.0.0` is `CrossChainToken`;
 * `1.5.1` / `1.6.2` are `FactoryBurnMintERC20`. Mirrors `token-pool/contracts.ts`.
 *
 * @packageDocumentation
 */

import { Interface, getAddress, isError } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { EVMChain } from '../../../evm/index.ts'
import { resultToObject } from '../../../evm/types.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTParamsInvalidError,
} from '../../errors.ts'
import FACTORY_BURN_MINT_ERC20_V1_5_1_ABI from '../artifacts/abi/V1_5_1/factory-burn-mint-erc20.ts'
import FACTORY_BURN_MINT_ERC20_V1_6_2_ABI from '../artifacts/abi/V1_6_2/factory-burn-mint-erc20.ts'
import CROSS_CHAIN_TOKEN_V2_0_0_ABI from '../artifacts/abi/V2_0_0/cross-chain-token.ts'
import CROSS_CHAIN_TOKEN_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/cross-chain-token.ts'
import type { DeployArtifact } from '../operation.ts'
import { getTypedContract } from '../query.ts'

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

/**
 * The interface every BurnMintERC677 role/mint write encodes through.
 *
 * Pinned to v1.5.1: the role functions, `mint`, and the role reads are identical at v1.6.2 and
 * on `HyperLiquidCompatibleERC20 1.6.2`, so there is nothing to dispatch on. v2.0.0's
 * `CrossChainToken` is a different contract, ruled out by {@link readTokenRole}.
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
 * True for the two failure shapes a call to a function a contract does not declare produces:
 * `CALL_EXCEPTION` (revert) and `BAD_DATA` (node answers `0x`). Deliberately narrow — a transport
 * error or rate limit must not be read as "this contract lacks the function".
 */
function isMissingFunction(err: unknown): boolean {
  return isError(err, 'CALL_EXCEPTION') || isError(err, 'BAD_DATA')
}

/** The two role predicates, declared identically by every BurnMintERC677 token. */
type TokenRoleReader = Pick<
  TypedContract<typeof FACTORY_BURN_MINT_ERC20_V1_5_1_ABI>,
  'isMinter' | 'isBurner'
>

/**
 * Reads whether `account` holds one of a BurnMintERC677 token's roles, in a single `eth_call`.
 *
 * Doubles as the family check every role/mint write needs: only the BurnMintERC677 family
 * declares these predicates, so a v2.0.0 `CrossChainToken`, a token pool, or an EOA fails here
 * before an op can hand back calldata aimed at code that cannot run it. No `version` parameter —
 * both predicates are identical at v1.5.1 and v1.6.2 (see {@link getErc20Token}).
 * @param chain - Chain to read from.
 * @param tokenAddress - Token contract to read from.
 * @param read - Which role predicate to call.
 * @param account - Address to test.
 * @returns Whether `account` currently holds that role.
 * @throws {@link CCTContractTypeInvalidError} if `tokenAddress` does not declare `read` — it is
 * not a BurnMintERC677 token
 */
export async function readTokenRole(
  chain: EVMChain,
  tokenAddress: string,
  read: 'isMinter' | 'isBurner',
  account: string,
): Promise<boolean> {
  const token: TokenRoleReader = getTypedContract(
    chain,
    tokenAddress,
    FACTORY_BURN_MINT_ERC20_V1_5_1_ABI,
  )
  try {
    return await token[read](account)
  } catch (err) {
    if (!isMissingFunction(err)) throw err
    throw new CCTContractTypeInvalidError(
      tokenAddress,
      'BurnMintERC677 token (FactoryBurnMintERC20 v1.5.1 / v1.6.2)',
      // the type is genuinely unknown: the contract answered nothing
      'unknown',
      `it does not declare ${read}(address) — a v2.0.0 CrossChainToken gates mint/burn through AccessControl instead, and support for it ships separately`,
      { cause: err instanceof Error ? err : undefined },
    )
  }
}

/** `Ownable2Step.owner()`, declared identically by every supported token. */
type TokenOwnerGetter = Pick<TypedContract<typeof FACTORY_BURN_MINT_ERC20_V1_5_1_ABI>, 'owner'>

/**
 * Reads a token's Ownable2Step `owner()` in a single `eth_call`. On the BurnMintERC677 family the
 * owner *is* the mint/burn role admin — `grantMintRole` and its siblings are `onlyOwner`.
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
 * `OnlyOwner` revert after a multisig has already reviewed and signed.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read the owner from.
 * @param tokenAddress - Token being written to.
 * @param sender - The address the tx will be sent from; compared checksummed.
 * @throws {@link CCTParamsInvalidError} if `sender` is not the token owner
 */
export async function assertTokenOwner(
  operation: string,
  chain: EVMChain,
  tokenAddress: string,
  sender: string,
): Promise<void> {
  const owner = await readTokenOwner(chain, tokenAddress)
  if (getAddress(sender) === owner) return
  throw new CCTParamsInvalidError(operation, 'sender', `must be the current token owner (${owner})`)
}
