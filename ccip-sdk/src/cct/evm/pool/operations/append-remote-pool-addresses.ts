/**
 * appendRemotePoolAddresses — registers additional remote pool addresses for an
 * already-configured remote chain on a local TokenPool, by encoding
 * `addRemotePool(uint64 remoteChainSelector, bytes remotePoolAddress)` — one
 * transaction per address. Requires a v1.5.1+ pool (v1.5 has no `addRemotePool`;
 * use `applyChainUpdates` to re-initialize the chain config instead).
 *
 * @packageDocumentation
 */

import { hexlify, zeroPadValue } from 'ethers'

import { interfaces } from '../../../../evm/const.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCIPVersion } from '../../../../types.ts'
import { getAddressBytes } from '../../../../utils.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'

/** Parameters for `appendRemotePoolAddresses`. */
export type AppendRemotePoolAddressesParams = {
  /** Local TokenPool address (EVM). */
  poolAddress: string
  /** Remote chain selector; must already be configured via `applyChainUpdates`. */
  remoteChainSelector: bigint
  /** Remote pool addresses in native format (hex/base58/base64). At least one required. */
  remotePoolAddresses: string[]
  sender?: string
}

/**
 * Encodes a remote pool address to raw left-padded 32-byte hex, matching the
 * on-chain `bytes` representation. Handles all chain families via
 * {@link getAddressBytes} (hex/base58/base64).
 */
function encodeRemoteAddress(address: string): string {
  return zeroPadValue(hexlify(getAddressBytes(address)), 32)
}

/** Appends remote pool addresses to an existing chain config on a local TokenPool. */
export class AppendRemotePoolAddresses extends EVMOperation<AppendRemotePoolAddressesParams> {
  readonly name = 'appendRemotePoolAddresses'

  /** Validates the pool address, selector, and address list before any RPC. */
  protected validate(p: AppendRemotePoolAddressesParams): void {
    validateAddress(this.name, 'poolAddress', p.poolAddress)
    if (p.remoteChainSelector == null || p.remoteChainSelector === 0n) {
      throw new CCTParamsInvalidError(this.name, 'remoteChainSelector', 'must be non-zero')
    }
    if (p.remotePoolAddresses.length === 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'remotePoolAddresses',
        'must have at least one address',
      )
    }
    for (let i = 0; i < p.remotePoolAddresses.length; i++) {
      const addr = p.remotePoolAddresses[i]
      if (!addr || addr.trim().length === 0) {
        throw new CCTParamsInvalidError(this.name, `remotePoolAddresses[${i}]`, 'must be non-empty')
      }
    }
  }

  /** Builds one `addRemotePool` tx per address; rejects v1.5 pools. */
  protected async buildUnsigned(
    chain: EVMChain,
    p: AppendRemotePoolAddressesParams,
  ): Promise<UnsignedEVMTx> {
    const [, version] = await chain.typeAndVersion(p.poolAddress)
    if (version <= CCIPVersion.V1_5) {
      throw new CCTParamsInvalidError(
        this.name,
        'poolAddress',
        'addRemotePool is not available on v1.5 pools. Use applyChainUpdates to re-initialize the chain config instead.',
      )
    }
    // addRemotePool(uint64,bytes) encoding is version-stable across v1.5.1–v2.0.
    const iface = version < CCIPVersion.V2_0 ? interfaces.TokenPool_v1_6 : interfaces.TokenPool_v2_0
    const transactions = p.remotePoolAddresses.map((remotePoolAddress) => ({
      to: p.poolAddress,
      data: iface.encodeFunctionData('addRemotePool', [
        p.remoteChainSelector,
        encodeRemoteAddress(remotePoolAddress),
      ]),
    }))
    return { family: ChainFamily.EVM, transactions }
  }
}
