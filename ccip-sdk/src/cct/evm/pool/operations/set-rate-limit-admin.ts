/**
 * setRateLimitAdmin — updates the rate-limit admin on a CCIP TokenPool.
 *
 * Version-dispatched:
 * - **v1.5 / v1.6**: standalone `setRateLimitAdmin(address)`.
 * - **v2.0+**: reads the current `getDynamicConfig()` and rewrites only
 *   `rateLimitAdmin` via `setDynamicConfig(router, rateLimitAdmin, feeAdmin)`,
 *   preserving `router` and `feeAdmin`.
 *
 * @packageDocumentation
 */

import { Contract } from 'ethers'

import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCIPVersion } from '../../../../types.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'

/** Parameters for `setRateLimitAdmin`. */
export type SetRateLimitAdminParams = {
  /** Local TokenPool address. */
  poolAddress: string
  /** New rate-limit admin address. */
  rateLimitAdmin: string
  sender?: string
}

/** Sets the rate-limit admin on a TokenPool, dispatching on the pool version. */
export class SetRateLimitAdmin extends EVMOperation<SetRateLimitAdminParams> {
  readonly name = 'setRateLimitAdmin'

  /** Validates addresses before any RPC. */
  protected validate(p: SetRateLimitAdminParams): void {
    validateAddress(this.name, 'poolAddress', p.poolAddress)
    validateAddress(this.name, 'rateLimitAdmin', p.rateLimitAdmin)
  }

  /** Detects pool version, then encodes the version-appropriate calldata. */
  protected async buildUnsigned(
    chain: EVMChain,
    p: SetRateLimitAdminParams,
  ): Promise<UnsignedEVMTx> {
    const [, version] = await chain.typeAndVersion(p.poolAddress)

    let data: string
    if (version >= CCIPVersion.V2_0) {
      // v2.0: read current dynamic config, update only rateLimitAdmin.
      const contract = new Contract(p.poolAddress, interfaces.TokenPool_v2_0, chain.provider)
      const [router, , feeAdmin] = (await contract.getFunction('getDynamicConfig')()) as [
        string,
        unknown,
        string,
      ]
      data = interfaces.TokenPool_v2_0.encodeFunctionData('setDynamicConfig', [
        router,
        p.rateLimitAdmin,
        feeAdmin,
      ])
    } else {
      // v1.5/v1.6: standalone setRateLimitAdmin(address).
      const iface =
        version <= CCIPVersion.V1_5 ? interfaces.TokenPool_v1_5 : interfaces.TokenPool_v1_6
      data = iface.encodeFunctionData('setRateLimitAdmin', [p.rateLimitAdmin])
    }

    return { family: ChainFamily.EVM, transactions: [{ to: p.poolAddress, data }] }
  }
}
