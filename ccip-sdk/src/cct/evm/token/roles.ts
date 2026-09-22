/** Version-specific CCT mint/burn role reads, enumeration, and authorization. */

import { getAddress, id, isError } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { EVMChain } from '../../../evm/index.ts'
import { CCTContractTypeInvalidError, CCTParamsInvalidError } from '../../errors.ts'
import FACTORY_BURN_MINT_ERC20_V1_5_1_ABI from '../artifacts/abi/V1_5_1/factory-burn-mint-erc20.ts'
import CROSS_CHAIN_TOKEN_V2_0_0_ABI from '../artifacts/abi/V2_0_0/cross-chain-token.ts'
import { getTypedContract } from '../query.ts'
import {
  type TokenVersion as TokenVersionType,
  TokenVersion,
  assertTokenOwner,
  resolveTokenEncoder,
} from './contracts.ts'

/** The two roles whose v1 and v2 authorization schemes are unified by {@link resolveTokenRoleHandler}. */
export type TokenRole = 'mint' | 'burn'

/** CrossChainToken's immutable AccessControl role identifiers. */
export const CrossChainTokenRole = {
  MINTER: id('MINTER_ROLE'),
  BURNER: id('BURNER_ROLE'),
} as const

function isMissingFunction(err: unknown): boolean {
  return isError(err, 'CALL_EXCEPTION') || isError(err, 'BAD_DATA')
}

type V1TokenRoleReader = Pick<
  TypedContract<typeof FACTORY_BURN_MINT_ERC20_V1_5_1_ABI>,
  'isMinter' | 'isBurner'
>
type V1TokenRoleHolderReader = Pick<
  TypedContract<typeof FACTORY_BURN_MINT_ERC20_V1_5_1_ABI>,
  'getMinters' | 'getBurners'
>
type CrossChainTokenRoleReader = Pick<
  TypedContract<typeof CROSS_CHAIN_TOKEN_V2_0_0_ABI>,
  'hasRole' | 'getRoleAdmin'
>

/** Reads a v1 BurnMintERC677 role and doubles as its contract-family check. */
export async function readV1TokenRole(
  chain: EVMChain,
  tokenAddress: string,
  read: 'isMinter' | 'isBurner',
  account: string,
): Promise<boolean> {
  const token: V1TokenRoleReader = getTypedContract(
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
      'unknown',
      `it does not declare ${read}(address)`,
      { cause: err instanceof Error ? err : undefined },
    )
  }
}

/** Lists all v1 BurnMintERC677 role holders. CrossChainToken does not enumerate them. */
export async function readV1TokenRoleHolders(
  chain: EVMChain,
  tokenAddress: string,
  read: 'getMinters' | 'getBurners',
): Promise<string[]> {
  const token: V1TokenRoleHolderReader = getTypedContract(
    chain,
    tokenAddress,
    FACTORY_BURN_MINT_ERC20_V1_5_1_ABI,
  )
  try {
    return (await token[read]()).map((holder) => getAddress(holder as string))
  } catch (err) {
    if (!isMissingFunction(err)) throw err
    throw new CCTContractTypeInvalidError(
      tokenAddress,
      'BurnMintERC677 token (FactoryBurnMintERC20 v1.5.1 / v1.6.2)',
      'unknown',
      `it does not declare ${read}()`,
      { cause: err instanceof Error ? err : undefined },
    )
  }
}

const CROSS_CHAIN_TOKEN_ROLES: Record<TokenRole, string> = {
  mint: CrossChainTokenRole.MINTER,
  burn: CrossChainTokenRole.BURNER,
}
const V1_TOKEN_ROLE_READERS: Record<TokenRole, 'isMinter' | 'isBurner'> = {
  mint: 'isMinter',
  burn: 'isBurner',
}

export type TokenRoleHandler = {
  hasRole(chain: EVMChain, tokenAddress: string, role: TokenRole, account: string): Promise<boolean>
  assertAdmin(
    operation: string,
    chain: EVMChain,
    tokenAddress: string,
    role: TokenRole,
    sender: string,
  ): Promise<void>
}

const V1_TOKEN_ROLE_HANDLER: TokenRoleHandler = {
  hasRole: (chain, tokenAddress, role, account) =>
    readV1TokenRole(chain, tokenAddress, V1_TOKEN_ROLE_READERS[role], account),
  assertAdmin: (operation, chain, tokenAddress, _role, sender) =>
    assertTokenOwner(operation, chain, tokenAddress, sender),
}

const V2_TOKEN_ROLE_HANDLER: TokenRoleHandler = {
  async hasRole(chain, tokenAddress, role, account) {
    const token: CrossChainTokenRoleReader = getTypedContract(
      chain,
      tokenAddress,
      CROSS_CHAIN_TOKEN_V2_0_0_ABI,
    )
    return token.hasRole(CROSS_CHAIN_TOKEN_ROLES[role], account)
  },
  async assertAdmin(operation, chain, tokenAddress, role, sender) {
    const token: CrossChainTokenRoleReader = getTypedContract(
      chain,
      tokenAddress,
      CROSS_CHAIN_TOKEN_V2_0_0_ABI,
    )
    const roleId = CROSS_CHAIN_TOKEN_ROLES[role]
    const adminRole = await token.getRoleAdmin(roleId)
    if (await token.hasRole(adminRole, sender)) return
    throw new CCTParamsInvalidError(
      operation,
      'sender',
      `must hold the admin role for ${roleId} on ${tokenAddress}`,
    )
  },
}

const TOKEN_ROLE_HANDLERS: Partial<Record<TokenVersionType, TokenRoleHandler>> = {
  [TokenVersion.V1_5_1]: V1_TOKEN_ROLE_HANDLER,
  [TokenVersion.V2_0_0]: V2_TOKEN_ROLE_HANDLER,
}

/** Resolves the version-specific implementation for token role reads and authorization. */
export function resolveTokenRoleHandler(
  version: TokenVersionType,
  operation: string,
): TokenRoleHandler {
  return resolveTokenEncoder(TOKEN_ROLE_HANDLERS, version, operation)
}
