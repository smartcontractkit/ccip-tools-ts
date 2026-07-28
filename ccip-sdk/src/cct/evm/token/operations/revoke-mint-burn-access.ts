/**
 * revokeMintBurnAccess — revokes the mint or burn role from an authority on a
 * CrossChainToken (BurnMintERC677-style, OpenZeppelin AccessControl) token.
 *
 * - `role: 'mint'` → `revokeRole(MINTER_ROLE, authority)`.
 * - `role: 'burn'` → `revokeRole(BURNER_ROLE, authority)`.
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

/** Which role to revoke — must be specified explicitly. */
export type RevokeMintBurnRole = 'mint' | 'burn'

/** OZ AccessControl role hashes — `keccak256('MINTER_ROLE')` / `keccak256('BURNER_ROLE')`. */
const MINTER_ROLE = id('MINTER_ROLE')
const BURNER_ROLE = id('BURNER_ROLE')

/** Parameters for `revokeMintBurnAccess`. */
export type RevokeMintBurnAccessParams = {
  /** CrossChainToken contract address. */
  tokenAddress: string
  /** Address to revoke mint/burn access from. */
  authority: string
  /** Which role to revoke — must be `'mint'` or `'burn'`. */
  role: RevokeMintBurnRole
  sender?: string
}

/** Revokes the mint or burn role from an authority on a CrossChainToken. */
export class RevokeMintBurnAccess extends EVMOperation<RevokeMintBurnAccessParams> {
  readonly name = 'revokeMintBurnAccess'

  /** Validates addresses and the requested role before any RPC. */
  protected validate(p: RevokeMintBurnAccessParams): void {
    validateAddress(this.name, 'tokenAddress', p.tokenAddress)
    validateAddress(this.name, 'authority', p.authority)
    if (p.role !== 'mint' && p.role !== 'burn') {
      throw new CCTParamsInvalidError(this.name, 'role', "must be 'mint' or 'burn'")
    }
  }

  /** Encodes the AccessControl `revokeRole` calldata for the requested role. */
  protected buildUnsigned(_chain: EVMChain, p: RevokeMintBurnAccessParams): UnsignedEVMTx {
    const roleHash = p.role === 'mint' ? MINTER_ROLE : BURNER_ROLE
    const data = interfaces.CrossChainToken.encodeFunctionData('revokeRole', [
      roleHash,
      p.authority,
    ])
    return { family: ChainFamily.EVM, transactions: [{ to: p.tokenAddress, data }] }
  }
}
