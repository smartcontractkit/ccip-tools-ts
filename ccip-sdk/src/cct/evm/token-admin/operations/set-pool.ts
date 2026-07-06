/**
 * setPool — registers a pool for a token in the TokenAdminRegistry.
 * Version-independent (v1.5–v2.0 share one encoding).
 *
 * @packageDocumentation
 */

import { Interface } from 'ethers'

import TokenAdminRegistryABI from '../../../../evm/abi/TokenAdminRegistry_1_5.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'

/** Parameters for `setPool`. Zero `poolAddress` delists the token. */
export interface SetPoolParams {
  tokenAddress: string
  poolAddress: string
  routerAddress: string
  sender?: string
}

/** Registers a pool for a token in the TokenAdminRegistry discovered from the router. */
export class SetPool extends EVMOperation<SetPoolParams> {
  readonly name = 'setPool'

  /** Validates all addresses before any RPC. */
  protected validate(p: SetPoolParams): void {
    validateAddress(this.name, 'tokenAddress', p.tokenAddress)
    validateAddress(this.name, 'poolAddress', p.poolAddress)
    validateAddress(this.name, 'routerAddress', p.routerAddress)
  }

  /** Encodes `setPool` on the TokenAdminRegistry discovered from the router. */
  protected async encode(chain: EVMChain, p: SetPoolParams): Promise<UnsignedEVMTx> {
    const to = await chain.getTokenAdminRegistryFor(p.routerAddress)
    const data = new Interface(TokenAdminRegistryABI).encodeFunctionData('setPool', [
      p.tokenAddress,
      p.poolAddress,
    ])
    return { family: ChainFamily.EVM, transactions: [{ to, data }] }
  }
}
