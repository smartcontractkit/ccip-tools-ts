/**
 * setRemotePool: replaces the remote pool address a v1.5.0 pool accepts on one lane.
 *
 * @remarks **v1.5.0 only.** A 1.5.0 pool holds exactly one remote pool per lane and this call
 * overwrites it wholesale; v1.5.1 replaced it with the additive `addRemotePool` /
 * `removeRemotePool` pair (a lane may hold several remote pools there), and no version from
 * v1.5.1 up declares `setRemotePool` at all. Emulating it on a newer pool is deliberately not
 * attempted — "replace" over a set of unknown size is not a single transaction — so this op
 * reports itself unsupported there instead of guessing.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import {
  TokenPoolVersion,
  assertPoolOwner,
  getTokenPoolInterface,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'
import {
  type ParsedRemotePoolParams,
  type RemotePoolParams,
  parseRemotePoolParams,
} from '../remote-pool.ts'

/**
 * Parameters for {@link SetRemotePool} — see {@link RemotePoolParams}; `remotePoolAddress` is the
 * remote chain's pool address as hex bytes, which becomes the lane's *only* remote pool.
 */
export type SetRemotePoolParams = RemotePoolParams

/** {@link SetRemotePoolParams} as {@link SetRemotePool.parse} leaves it. */
type ParsedSetRemotePoolParams = ParsedRemotePoolParams

/** Encodes `setRemotePool` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: ParsedSetRemotePoolParams) => UnsignedEVMTx

const encodeSetRemotePool: Encoder = (
  iface,
  { poolAddress, remoteChainSelector, remotePoolAddress },
) =>
  callTx(
    poolAddress,
    iface.encodeFunctionData('setRemotePool', [remoteChainSelector, remotePoolAddress]),
  )

/** Replaces a v1.5.0 pool's remote pool for one lane via `setRemotePool`. */
export class SetRemotePool extends EVMOperation<SetRemotePoolParams, ParsedSetRemotePoolParams> {
  readonly name = 'setRemotePool'

  /**
   * v1.5.0 only. The explicit `null` at v1.5.1 is load-bearing: it is the removal ceiling
   * {@link resolveEncoder} stops its floor-match walk at, so v1.5.1/v1.6.1/v2.0.0 report the op
   * as unsupported. Without it they would inherit the v1.5.0 encoder and emit calldata for a
   * function selector those pools do not implement.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_5_0]: encodeSetRemotePool,
    [TokenPoolVersion.V1_5_1]: null,
  }

  /**
   * Validates the pool address, lane selector and remote pool bytes before any RPC, keeping the
   * parsed `remotePoolAddress` so {@link buildUnsigned} encodes it without re-parsing.
   */
  protected override parse(params: SetRemotePoolParams): ParsedSetRemotePoolParams {
    return parseRemotePoolParams(this.name, params)
  }

  /**
   * Resolves the pool's version (rejecting anything past v1.5.0), confirms `sender` owns the
   * pool, then encodes the call. No membership precondition: this call replaces whatever the lane
   * held, so there is nothing to check it against.
   * @throws {@link CCTOperationUnsupportedError} if the pool is v1.5.1 or newer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the pool owner
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: ParsedSetRemotePoolParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    // resolved before any further RPC, so an unsupported version fails on one call
    const encode = resolveEncoder(this.encoders, version, this.name)
    // owner-gated on-chain; surface it as a param error here instead of an on-chain revert
    if (params.sender !== undefined)
      await assertPoolOwner(this.name, chain, params.poolAddress, params.sender)
    return encode(getTokenPoolInterface(type, version), params)
  }

  /**
   * Signs and submits as the pool owner, defaulting `sender` to the signing wallet — the only
   * address that can satisfy {@link buildUnsigned}'s owner check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address, or
   * if any other param is invalid (see {@link buildUnsigned})
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<SetRemotePoolParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
