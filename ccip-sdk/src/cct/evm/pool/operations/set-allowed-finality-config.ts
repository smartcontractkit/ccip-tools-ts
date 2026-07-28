/**
 * setAllowedFinalityConfig — sets the bytes4 allowed-finality config on a CCIP
 * TokenPool. **EVM v2.0+ pools only.**
 *
 * The `finality` value is run through the SDK finality codec
 * ({@link encodeFinality}) and serialized as a bytes4 for
 * `setAllowedFinalityConfig(bytes4)`. Access: pool owner.
 *
 * @packageDocumentation
 */

import { toBeHex } from 'ethers'

import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { type FinalityAllowed, encodeFinality } from '../../../../extra-args.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCIPVersion } from '../../../../types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'

/** Parameters for `setAllowedFinalityConfig`. */
export type SetAllowedFinalityConfigParams = {
  /** Local TokenPool address (must be a v2.0+ pool). */
  poolAddress: string
  /** Allowed finality: `'finalized'`, `'safe'`, a block depth, or a {@link FinalityAllowed}. */
  finality: FinalityAllowed | 'finalized' | 'safe' | number
  sender?: string
}

/** Sets the allowed-finality bytes4 config on a v2.0+ TokenPool. */
export class SetAllowedFinalityConfig extends EVMOperation<SetAllowedFinalityConfigParams> {
  readonly name = 'setAllowedFinalityConfig'

  /** Validates the pool address before any RPC (finality is checked at encode time). */
  protected validate(p: SetAllowedFinalityConfigParams): void {
    validateAddress(this.name, 'poolAddress', p.poolAddress)
  }

  /** Gates on v2.0+, then encodes the bytes4 allowed-finality value. */
  protected async buildUnsigned(
    chain: EVMChain,
    p: SetAllowedFinalityConfigParams,
  ): Promise<UnsignedEVMTx> {
    const [, version] = await chain.typeAndVersion(p.poolAddress)
    if (version < CCIPVersion.V2_0) {
      throw new CCTParamsInvalidError(
        this.name,
        'poolAddress',
        `setAllowedFinalityConfig is only available on EVM v2.0+ pools (pool version: ${version})`,
      )
    }

    // encodeFinality throws on out-of-range block depth; surface as a params error.
    let allowedFinality: string
    try {
      allowedFinality = toBeHex(encodeFinality(p.finality), 4)
    } catch (error) {
      throw new CCTParamsInvalidError(
        this.name,
        'finality',
        error instanceof Error ? error.message : String(error),
      )
    }

    const data = interfaces.TokenPool_v2_0.encodeFunctionData('setAllowedFinalityConfig', [
      allowedFinality,
    ])

    return { family: ChainFamily.EVM, transactions: [{ to: p.poolAddress, data }] }
  }
}
