/**
 * setPool — registers a pool for a token in the TokenAdminRegistry.
 * Version-independent (v1.5–v2.0 share one encoding).
 *
 * @packageDocumentation
 */

import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'

/** Parameters for `setPool`. Zero `poolAddress` delists the token. */
export type SetPoolParams = {
  tokenAddress: string
  /** The zero address as `poolAddress` delists the token from the registry. */
  poolAddress: string
  /**
   * Contract to resolve the TokenAdminRegistry from. Pass the registry itself for a
   * direct lookup; a Router, OnRamp, OffRamp, or TokenPool also work but add hops and
   * need a configured lane.
   */
  address: string
  sender?: string
}

/** Registers a pool for a token in the TokenAdminRegistry resolved from `address`. */
export class SetPool extends EVMOperation<SetPoolParams> {
  readonly name = 'setPool'

  /** Validates all addresses before any RPC. */
  protected validate(p: SetPoolParams): void {
    validateAddress(this.name, 'tokenAddress', p.tokenAddress)
    validateAddress(this.name, 'poolAddress', p.poolAddress)
    validateAddress(this.name, 'address', p.address)
  }

  /** Builds `setPool` calldata against the TokenAdminRegistry resolved from `address`. */
  protected async buildUnsigned(chain: EVMChain, p: SetPoolParams): Promise<UnsignedEVMTx> {
    const to = await chain.getTokenAdminRegistryFor(p.address)
    // TAR.setPool encoding is version-stable across v1.5–v2.0; no version dispatch needed.
    const data = interfaces.TokenAdminRegistry.encodeFunctionData('setPool', [
      p.tokenAddress,
      p.poolAddress,
    ])
    return { family: ChainFamily.EVM, transactions: [{ to, data }] }
  }
}
