/**
 * transferAdminRole — transfers the administrator role for a token in the
 * TokenAdminRegistry to a new admin. Encodes
 * `transferAdminRole(localToken, newAdmin)` on the TAR, resolved from the
 * provided router address.
 *
 * @packageDocumentation
 */

import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'

/** Parameters for `transferAdminRole`. */
export type TransferAdminRoleParams = {
  /** Token to transfer the administrator role for. */
  tokenAddress: string
  /** Address of the new administrator. */
  newAdmin: string
  /** Contract to resolve the TokenAdminRegistry from (the TAR, or a Router/pool). */
  address: string
  sender?: string
}

/** Transfers the administrator role for a token in the TokenAdminRegistry. */
export class TransferAdminRole extends EVMOperation<TransferAdminRoleParams> {
  readonly name = 'transferAdminRole'

  /** Validates all addresses before any RPC. */
  protected validate(p: TransferAdminRoleParams): void {
    validateAddress(this.name, 'tokenAddress', p.tokenAddress)
    validateAddress(this.name, 'newAdmin', p.newAdmin)
    validateAddress(this.name, 'address', p.address)
  }

  /** Builds `transferAdminRole` calldata against the TAR resolved from `address`. */
  protected async buildUnsigned(
    chain: EVMChain,
    p: TransferAdminRoleParams,
  ): Promise<UnsignedEVMTx> {
    const to = await chain.getTokenAdminRegistryFor(p.address)
    const data = interfaces.TokenAdminRegistry.encodeFunctionData('transferAdminRole', [
      p.tokenAddress,
      p.newAdmin,
    ])
    return { family: ChainFamily.EVM, transactions: [{ to, data }] }
  }
}
