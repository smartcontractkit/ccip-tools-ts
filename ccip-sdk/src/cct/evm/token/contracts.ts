/**
 * EVM token contract layer for CCT: cached {@link Interface}s per {@link TokenVersion}
 * ({@link getTokenInterface}) for read/write (e.g. ownership) ops, and the deployable
 * `CrossChainToken` (v2.0.0) artifact ({@link getTokenArtifact}). `2.0.0` is `CrossChainToken`;
 * `1.5.1` / `1.6.2` are `FactoryBurnMintERC20`. Mirrors `token-pool/contracts.ts`.
 *
 * @packageDocumentation
 */

import { Interface } from 'ethers'

import { CCTContractVersionUnsupportedError } from '../../errors.ts'
import FACTORY_BURN_MINT_ERC20_V1_5_1_ABI from '../artifacts/abi/V1_5_1/factory-burn-mint-erc20.ts'
import FACTORY_BURN_MINT_ERC20_V1_6_2_ABI from '../artifacts/abi/V1_6_2/factory-burn-mint-erc20.ts'
import CROSS_CHAIN_TOKEN_V2_0_0_ABI from '../artifacts/abi/V2_0_0/cross-chain-token.ts'
import CROSS_CHAIN_TOKEN_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/cross-chain-token.ts'
import type { DeployArtifact } from '../operation.ts'

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
