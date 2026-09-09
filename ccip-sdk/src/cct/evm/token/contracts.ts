/**
 * EVM token contract layer for CCT: cached {@link Interface}s per {@link TokenVersion}
 * ({@link getTokenInterface}) for read/write ops, the deployable `CrossChainToken` (v2.0.0)
 * artifact ({@link getTokenArtifact}), and the narrow owner read every owner-gated token write
 * pre-flights `sender` against ({@link readTokenOwner}) plus the guard built on it
 * ({@link assertTokenOwner}). `2.0.0` is `CrossChainToken`; `1.5.1` / `1.6.2` are
 * `FactoryBurnMintERC20`. Mirrors `token-pool/contracts.ts`.
 *
 * @packageDocumentation
 */

import { Interface, getAddress } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { EVMChain } from '../../../evm/index.ts'
import { resultToObject } from '../../../evm/types.ts'
import { CCTContractVersionUnsupportedError, CCTParamsInvalidError } from '../../errors.ts'
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

/** `Ownable2Step.owner()`, spelled identically by every supported token version. */
type TokenOwnerGetter = Pick<TypedContract<typeof FACTORY_BURN_MINT_ERC20_V1_5_1_ABI>, 'owner'>

/**
 * Reads a token's on-chain `owner()`, checksummed.
 *
 * @remarks One `eth_call` against a single ABI, with no version resolution: `owner()` is declared
 * identically by `FactoryBurnMintERC20` v1.5.1 / v1.6.2 and by v2.0.0's `CrossChainToken`, where
 * it aliases the `DEFAULT_ADMIN_ROLE` holder. Mirrors `readTokenPoolOwner` in
 * `token-pool/contracts.ts`.
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
 * `Only callable by owner` revert after a multisig has already reviewed and signed. The token-side
 * counterpart of `assertPoolOwner`.
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
