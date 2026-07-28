/**
 * setFeeAdmin — delegates token-transfer fee management to a separate admin on a
 * CCIP TokenPool. **EVM v2.0+ pools only.**
 *
 * Reads the current `getDynamicConfig()` and rewrites only `feeAdmin` via
 * `setDynamicConfig(router, rateLimitAdmin, feeAdmin)`, preserving `router`
 * and `rateLimitAdmin`.
 *
 * @packageDocumentation
 */

import { Contract } from 'ethers'

import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCIPVersion } from '../../../../types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'

/** Parameters for `setFeeAdmin`. */
export type SetFeeAdminParams = {
  /** Local TokenPool address (must be a v2.0+ pool). */
  poolAddress: string
  /** New fee admin address. */
  feeAdmin: string
  sender?: string
}

/** Sets the fee admin on a v2.0+ TokenPool, preserving other dynamic-config fields. */
export class SetFeeAdmin extends EVMOperation<SetFeeAdminParams> {
  readonly name = 'setFeeAdmin'

  /** Validates addresses before any RPC. */
  protected validate(p: SetFeeAdminParams): void {
    validateAddress(this.name, 'poolAddress', p.poolAddress)
    validateAddress(this.name, 'feeAdmin', p.feeAdmin)
  }

  /** Gates on v2.0+, reads dynamic config, and rewrites only `feeAdmin`. */
  protected async buildUnsigned(chain: EVMChain, p: SetFeeAdminParams): Promise<UnsignedEVMTx> {
    const [, version] = await chain.typeAndVersion(p.poolAddress)
    if (version < CCIPVersion.V2_0) {
      throw new CCTParamsInvalidError(
        this.name,
        'poolAddress',
        `setFeeAdmin is only available on EVM v2.0+ pools (pool version: ${version})`,
      )
    }

    // Read current dynamic config, update only feeAdmin.
    const contract = new Contract(p.poolAddress, interfaces.TokenPool_v2_0, chain.provider)
    const [router, rateLimitAdmin] = (await contract.getFunction('getDynamicConfig')()) as [
      string,
      string,
      unknown,
    ]
    const data = interfaces.TokenPool_v2_0.encodeFunctionData('setDynamicConfig', [
      router,
      rateLimitAdmin,
      p.feeAdmin,
    ])

    return { family: ChainFamily.EVM, transactions: [{ to: p.poolAddress, data }] }
  }
}
