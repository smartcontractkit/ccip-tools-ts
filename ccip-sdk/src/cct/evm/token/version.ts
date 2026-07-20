/**
 * EVM token version axis for CCT. {@link TokenVersion} + {@link TOKEN_ABIS} cover every
 * known token contract so read/write ops can resolve the right interface;
 * {@link TOKEN_ARTIFACTS} / {@link tokenArtifact} add creation bytecode. `2.0.0` is
 * `CrossChainToken`; `1.5.1` / `1.6.2` are `FactoryBurnMintERC20`. Mirrors
 * `token-pool/version.ts`.
 *
 * @packageDocumentation
 */

import { type InterfaceAbi, Interface } from 'ethers'

import { CCTContractVersionUnsupportedError } from '../../errors.ts'
import FACTORY_BURN_MINT_ERC20_V1_5_1_ABI from '../artifacts/abi/V1_5_1/factory-burn-mint-erc20.ts'
import FACTORY_BURN_MINT_ERC20_V1_6_2_ABI from '../artifacts/abi/V1_6_2/factory-burn-mint-erc20.ts'
import CROSS_CHAIN_TOKEN_V2_0_0_ABI from '../artifacts/abi/V2_0_0/cross-chain-token.ts'
import CROSS_CHAIN_TOKEN_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/cross-chain-token.ts'

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

/** Contract ABI per {@link TokenVersion} — lets read/write ops resolve the right interface. */
export const TOKEN_ABIS: Record<TokenVersion, InterfaceAbi> = {
  [TokenVersion.V1_5_1]: FACTORY_BURN_MINT_ERC20_V1_5_1_ABI,
  [TokenVersion.V1_6_2]: FACTORY_BURN_MINT_ERC20_V1_6_2_ABI,
  [TokenVersion.V2_0_0]: CROSS_CHAIN_TOKEN_V2_0_0_ABI,
}

/**
 * Returns the contract ABI for `version`.
 * @throws {@link CCTContractVersionUnsupportedError} if `version` has no vendored ABI
 */
export function tokenAbi(version: TokenVersion): InterfaceAbi {
  const abi = TOKEN_ABIS[version]
  if (!abi) throw new CCTContractVersionUnsupportedError('token', version)
  return abi
}

/** A token deploy artifact: the cached constructor {@link Interface} and creation bytecode. */
export interface TokenArtifact {
  iface: Interface
  bytecode: `0x${string}`
}

/**
 * Deploy artifacts (ctor {@link Interface} + creation bytecode) keyed by {@link TokenVersion},
 * built once. Only versions with vendored bytecode appear; read via {@link tokenArtifact}.
 */
export const TOKEN_ARTIFACTS: Partial<Record<TokenVersion, TokenArtifact>> = {
  [TokenVersion.V2_0_0]: {
    iface: new Interface(CROSS_CHAIN_TOKEN_V2_0_0_ABI),
    bytecode: CROSS_CHAIN_TOKEN_V2_0_0_BYTECODE,
  },
}

/**
 * Returns the cached deploy artifact for `version`.
 * @throws {@link CCTContractVersionUnsupportedError} if `version` has no vendored deploy bytecode
 */
export function tokenArtifact(version: TokenVersion): TokenArtifact {
  const artifact = TOKEN_ARTIFACTS[version]
  if (!artifact) throw new CCTContractVersionUnsupportedError('token', version)
  return artifact
}
