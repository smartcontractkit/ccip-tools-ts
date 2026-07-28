/**
 * acceptAdminRole — accepts a pending administrator role for a token in the
 * TokenAdminRegistry. Calls `acceptAdminRole(localToken)` directly on the TAR,
 * resolved from the provided router address.
 *
 * @packageDocumentation
 */

import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'

/** Parameters for `acceptAdminRole`. */
export type AcceptAdminRoleParams = {
  /** Token to accept the administrator role for. */
  tokenAddress: string
  /** Contract to resolve the TokenAdminRegistry from (the TAR, or a Router/pool). */
  address: string
  sender?: string
}

/** Accepts a pending administrator role for a token in the TokenAdminRegistry. */
export class AcceptAdminRole extends EVMOperation<AcceptAdminRoleParams> {
  readonly name = 'acceptAdminRole'

  /** Validates all addresses before any RPC. */
  protected validate(p: AcceptAdminRoleParams): void {
    validateAddress(this.name, 'tokenAddress', p.tokenAddress)
    validateAddress(this.name, 'address', p.address)
  }

  /** Builds `acceptAdminRole` calldata against the TAR resolved from `address`. */
  protected async buildUnsigned(chain: EVMChain, p: AcceptAdminRoleParams): Promise<UnsignedEVMTx> {
    const to = await chain.getTokenAdminRegistryFor(p.address)
    const data = interfaces.TokenAdminRegistry.encodeFunctionData('acceptAdminRole', [
      p.tokenAddress,
    ])
    return { family: ChainFamily.EVM, transactions: [{ to, data }] }
  }
}
