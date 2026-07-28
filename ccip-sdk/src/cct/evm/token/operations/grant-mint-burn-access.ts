/**
 * grantMintBurnAccess — grants mint and/or burn roles on a CrossChainToken
 * (BurnMintERC677-style, OpenZeppelin AccessControl) token to an authority.
 *
 * - `role: 'mintAndBurn'` (default) → `grantMintAndBurnRoles(authority)`.
 * - `role: 'mint'` → `grantRole(MINTER_ROLE, authority)`.
 * - `role: 'burn'` → `grantRole(BURNER_ROLE, authority)`.
 *
 * @packageDocumentation
 */

import { id } from 'ethers'

import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'

/** Which role(s) to grant. */
export type GrantMintBurnRole = 'mint' | 'burn' | 'mintAndBurn'

/** OZ AccessControl role hashes — `keccak256('MINTER_ROLE')` / `keccak256('BURNER_ROLE')`. */
const MINTER_ROLE = id('MINTER_ROLE')
const BURNER_ROLE = id('BURNER_ROLE')

const VALID_ROLES: readonly GrantMintBurnRole[] = ['mint', 'burn', 'mintAndBurn']

/** Parameters for `grantMintBurnAccess`. */
export type GrantMintBurnAccessParams = {
  /** CrossChainToken contract address. */
  tokenAddress: string
  /** Address to grant mint/burn access to (pool, multisig, etc.). */
  authority: string
  /** Which role(s) to grant. Defaults to `'mintAndBurn'`. */
  role?: GrantMintBurnRole
  sender?: string
}

/** Grants mint and/or burn roles on a CrossChainToken to an authority. */
export class GrantMintBurnAccess extends EVMOperation<GrantMintBurnAccessParams> {
  readonly name = 'grantMintBurnAccess'

  /** Validates addresses and the requested role before any RPC. */
  protected validate(p: GrantMintBurnAccessParams): void {
    validateAddress(this.name, 'tokenAddress', p.tokenAddress)
    validateAddress(this.name, 'authority', p.authority)
    if (p.role && !VALID_ROLES.includes(p.role)) {
      throw new CCTParamsInvalidError(this.name, 'role', `must be one of ${VALID_ROLES.join(', ')}`)
    }
  }

  /** Encodes the AccessControl grant calldata for the requested role. */
  protected buildUnsigned(_chain: EVMChain, p: GrantMintBurnAccessParams): UnsignedEVMTx {
    const role = p.role ?? 'mintAndBurn'

    let data: string
    switch (role) {
      case 'mint':
        data = interfaces.CrossChainToken.encodeFunctionData('grantRole', [
          MINTER_ROLE,
          p.authority,
        ])
        break
      case 'burn':
        data = interfaces.CrossChainToken.encodeFunctionData('grantRole', [
          BURNER_ROLE,
          p.authority,
        ])
        break
      case 'mintAndBurn':
        data = interfaces.CrossChainToken.encodeFunctionData('grantMintAndBurnRoles', [p.authority])
        break
    }

    return { family: ChainFamily.EVM, transactions: [{ to: p.tokenAddress, data }] }
  }
}
