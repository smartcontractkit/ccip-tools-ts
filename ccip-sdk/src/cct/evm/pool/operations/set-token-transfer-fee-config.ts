/**
 * setTokenTransferFeeConfig — sets per-destination token-transfer fee configs on a
 * token pool. **EVM v2.0+ pools only.**
 *
 * Encodes `applyTokenTransferFeeConfigUpdates(args[], disableSelectors[])` in a single
 * tx: `updates` become the fee-config args, `disable` becomes the list of destination
 * selectors to clear. Version is checked via the pool's `typeAndVersion`; pre-v2.0
 * pools do not expose this function and are rejected before encoding.
 *
 * @packageDocumentation
 */

import type { TokenTransferFeeConfig } from '../../../../chain.ts'
import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCIPVersion } from '../../../../types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'

export type { TokenTransferFeeConfig }

/** Pairs a destination chain selector with its full token-transfer fee config. */
export type TokenTransferFeeConfigUpdate = {
  /** Destination chain selector (uint64). */
  remoteChainSelector: bigint
  /** Full token transfer fee config for this destination. */
  config: TokenTransferFeeConfig
}

/** Parameters for `setTokenTransferFeeConfig`. EVM v2.0+ pools only. */
export type SetTokenTransferFeeConfigParams = {
  /** Local pool address. */
  poolAddress: string
  /** Per-destination fee config updates (may be empty if only disabling). */
  updates: TokenTransferFeeConfigUpdate[]
  /** Destination chain selectors whose fee config should be cleared. */
  disable?: bigint[]
  sender?: string
}

/** uint32 / uint16 upper bounds for fee-config field validation. */
const UINT32_MAX = 4_294_967_295
const UINT16_MAX = 65_535

/** Sets per-destination token-transfer fee configs on a v2.0+ token pool. */
export class SetTokenTransferFeeConfig extends EVMOperation<SetTokenTransferFeeConfigParams> {
  readonly name = 'setTokenTransferFeeConfig'

  /** Validates the pool address and every fee-config field before any RPC. */
  protected validate(p: SetTokenTransferFeeConfigParams): void {
    validateAddress(this.name, 'poolAddress', p.poolAddress)
    const disableCount = p.disable?.length ?? 0
    if (p.updates.length === 0 && disableCount === 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'updates',
        'provide at least one update or one disable selector',
      )
    }
    const checkUint = (value: number, max: number, path: string) => {
      if (!Number.isInteger(value) || value < 0 || value > max) {
        throw new CCTParamsInvalidError(this.name, path, `must be an integer between 0 and ${max}`)
      }
    }
    for (let i = 0; i < p.updates.length; i++) {
      const { remoteChainSelector, config } = p.updates[i]!
      if (remoteChainSelector === 0n) {
        throw new CCTParamsInvalidError(
          this.name,
          `updates[${i}].remoteChainSelector`,
          'must be non-zero',
        )
      }
      checkUint(config.destGasOverhead, UINT32_MAX, `updates[${i}].config.destGasOverhead`)
      checkUint(config.destBytesOverhead, UINT32_MAX, `updates[${i}].config.destBytesOverhead`)
      checkUint(config.finalityFeeUSDCents, UINT32_MAX, `updates[${i}].config.finalityFeeUSDCents`)
      checkUint(
        config.fastFinalityFeeUSDCents,
        UINT32_MAX,
        `updates[${i}].config.fastFinalityFeeUSDCents`,
      )
      checkUint(
        config.finalityTransferFeeBps,
        UINT16_MAX,
        `updates[${i}].config.finalityTransferFeeBps`,
      )
      checkUint(
        config.fastFinalityTransferFeeBps,
        UINT16_MAX,
        `updates[${i}].config.fastFinalityTransferFeeBps`,
      )
    }
  }

  /** Asserts the pool is v2.0+ and encodes `applyTokenTransferFeeConfigUpdates`. */
  protected async buildUnsigned(
    chain: EVMChain,
    p: SetTokenTransferFeeConfigParams,
  ): Promise<UnsignedEVMTx> {
    const [, version] = await chain.typeAndVersion(p.poolAddress)
    if (version < CCIPVersion.V2_0) {
      throw new CCTParamsInvalidError(
        this.name,
        'poolAddress',
        `setTokenTransferFeeConfig is only available on EVM v2.0+ pools (pool version: ${version})`,
      )
    }

    const feeConfigArgs = p.updates.map((u) => ({
      destChainSelector: u.remoteChainSelector,
      tokenTransferFeeConfig: {
        destGasOverhead: u.config.destGasOverhead,
        destBytesOverhead: u.config.destBytesOverhead,
        finalityFeeUSDCents: u.config.finalityFeeUSDCents,
        fastFinalityFeeUSDCents: u.config.fastFinalityFeeUSDCents,
        finalityTransferFeeBps: u.config.finalityTransferFeeBps,
        fastFinalityTransferFeeBps: u.config.fastFinalityTransferFeeBps,
        isEnabled: u.config.isEnabled,
      },
    }))
    const disableSelectors = (p.disable ?? []).map((s) => BigInt(s))

    const data = interfaces.TokenPool_v2_0.encodeFunctionData(
      'applyTokenTransferFeeConfigUpdates',
      [feeConfigArgs, disableSelectors],
    )
    return { family: ChainFamily.EVM, transactions: [{ to: p.poolAddress, data }] }
  }
}
