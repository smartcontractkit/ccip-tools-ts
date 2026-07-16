/**
 * EVM token version axis for CCT deployment: the version selects both the deployed
 * contract and its constructor shape. `2.0.0` (the default) deploys `CrossChainToken`;
 * `1.5.1` and `1.6.2` deploy `FactoryBurnMintERC20`. Mirrors `token-pool/version.ts`.
 *
 * @packageDocumentation
 */

import { Interface } from 'ethers'

import FACTORY_BURN_MINT_ERC20_V1_5_1_ABI from '../artifacts/abi/V1_5_1/factory-burn-mint-erc20.ts'
import FACTORY_BURN_MINT_ERC20_V1_6_2_ABI from '../artifacts/abi/V1_6_2/factory-burn-mint-erc20.ts'
import CROSS_CHAIN_TOKEN_V2_0_0_ABI from '../artifacts/abi/V2_0_0/cross-chain-token.ts'
import FACTORY_BURN_MINT_ERC20_V1_5_1_BYTECODE from '../artifacts/bytecode/V1_5_1/factory-burn-mint-erc20.ts'
import FACTORY_BURN_MINT_ERC20_V1_6_2_BYTECODE from '../artifacts/bytecode/V1_6_2/factory-burn-mint-erc20.ts'
import CROSS_CHAIN_TOKEN_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/cross-chain-token.ts'

/**
 * Deployable token versions, low to high. The version selects the contract deployed and
 * its constructor shape — see {@link TOKEN_CONTRACT}.
 */
export const TokenVersion = {
  V1_5_1: '1.5.1',
  V1_6_2: '1.6.2',
  V2_0_0: '2.0.0',
} as const

/** A known deployable token version. */
export type TokenVersion = (typeof TokenVersion)[keyof typeof TokenVersion]

/** A token deploy artifact: the cached constructor {@link Interface} and creation bytecode. */
export interface TokenArtifact {
  iface: Interface
  bytecode: `0x${string}`
}

/**
 * Cached deploy artifacts per {@link TokenVersion}, built once from the vendored
 * `artifacts/` ABIs + bytecode (no per-call `new Interface`).
 */
export const TOKEN_ARTIFACTS: Record<TokenVersion, TokenArtifact> = {
  [TokenVersion.V1_5_1]: {
    iface: new Interface(FACTORY_BURN_MINT_ERC20_V1_5_1_ABI),
    bytecode: FACTORY_BURN_MINT_ERC20_V1_5_1_BYTECODE,
  },
  [TokenVersion.V1_6_2]: {
    iface: new Interface(FACTORY_BURN_MINT_ERC20_V1_6_2_ABI),
    bytecode: FACTORY_BURN_MINT_ERC20_V1_6_2_BYTECODE,
  },
  [TokenVersion.V2_0_0]: {
    iface: new Interface(CROSS_CHAIN_TOKEN_V2_0_0_ABI),
    bytecode: CROSS_CHAIN_TOKEN_V2_0_0_BYTECODE,
  },
}

/** Returns the cached deploy artifact for a token `version`. */
export function tokenArtifact(version: TokenVersion): TokenArtifact {
  return TOKEN_ARTIFACTS[version]
}
