/**
 * transferOwnership: proposes a new TokenPool owner (Ownable2Step; the new
 * owner must later call acceptOwnership).
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { EVMOperation } from '../../operation.ts'
import { validateAddress } from '../../validate.ts'
import {
  TokenPoolVersion,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../version.ts'

/** Parameters for {@link TransferOwnership}. */
export interface TransferOwnershipParams {
  poolAddress: string
  newOwner: string
  /** Current pool owner; sets `tx.from` for offline / multisig signing. */
  sender?: string
}

/** Encodes `transferOwnership` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: TransferOwnershipParams) => UnsignedEVMTx

const encodeTransferOwnership: Encoder = (iface, { newOwner, poolAddress }) => {
  const data = iface.encodeFunctionData('transferOwnership', [newOwner])
  return { family: ChainFamily.EVM, transactions: [{ to: poolAddress, data }] }
}

/** Proposes a new TokenPool owner via Ownable2Step `transferOwnership`. */
export class TransferOwnership extends EVMOperation<TransferOwnershipParams> {
  readonly name = 'transferOwnership'

  /**
   * Stable across pool versions: one V1_5_0 entry covers all via floor-match.
   * Add another only when a version's encoding diverges.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder>> = {
    [TokenPoolVersion.V1_5_0]: encodeTransferOwnership,
  }

  /** Validates the pool and new-owner addresses before any RPC. */
  protected validate({ poolAddress, newOwner }: TransferOwnershipParams): void {
    validateAddress(this.name, 'poolAddress', poolAddress)
    validateAddress(this.name, 'newOwner', newOwner)
  }

  /** Reads the pool's type-and-version, then floor-matches the encoder and its contract interface. */
  protected async buildUnsigned(
    chain: EVMChain,
    { poolAddress, newOwner }: TransferOwnershipParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    const iface = getTokenPoolInterface(type, version)
    const encode = resolveEncoder(this.encoders, version, this.name)
    return encode(iface, { poolAddress, newOwner })
  }
}
