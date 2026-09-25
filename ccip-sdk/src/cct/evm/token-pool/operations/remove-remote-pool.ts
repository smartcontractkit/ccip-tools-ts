/**
 * removeRemotePool: de-authorizes one remote pool address on a lane (v1.5.1+).
 *
 * @remarks **v1.5.1 and newer**, the versions where a lane holds a *set* of remote pools. The
 * counterpart to {@link AddRemotePool}, and the last step of a remote-side pool upgrade: add the
 * new pool, drain the old, then remove it. v1.5.0 has no removal primitive — its single remote
 * pool can only be overwritten via {@link SetRemotePool} — so this op reports itself unsupported
 * there rather than emulating a removal.
 *
 * @packageDocumentation
 */

import type { Interface } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
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
  isRegisteredRemotePool,
  parseRemotePoolParams,
  readRegisteredRemotePools,
} from '../remote-pool.ts'

/**
 * Parameters for {@link RemoveRemotePool} — see {@link RemotePoolParams}; `remotePoolAddress` is
 * the remote chain's pool address as hex bytes, removed from the lane's existing set.
 */
export type RemoveRemotePoolParams = RemotePoolParams

/** {@link RemoveRemotePoolParams} as {@link RemoveRemotePool.parse} leaves it. */
type ParsedRemoveRemotePoolParams = ParsedRemotePoolParams

/** Encodes `removeRemotePool` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: ParsedRemoveRemotePoolParams) => UnsignedEVMTx

const encodeRemoveRemotePool: Encoder = (
  iface,
  { poolAddress, remoteChainSelector, remotePoolAddress },
) =>
  callTx(
    poolAddress,
    iface.encodeFunctionData('removeRemotePool', [remoteChainSelector, remotePoolAddress]),
  )

/** De-authorizes a remote pool on one lane of a v1.5.1+ pool via `removeRemotePool`. */
export class RemoveRemotePool extends EVMOperation<
  RemoveRemotePoolParams,
  ParsedRemoveRemotePoolParams
> {
  readonly name = 'removeRemotePool'

  /**
   * v1.5.1 and up, where the function was introduced and has not changed since — one entry
   * covers v1.6.1 and v2.0.0 by {@link resolveEncoder}'s floor-match. No `null` ceiling is
   * needed at the bottom: v1.5.0 matches nothing at or below itself and is reported unsupported
   * for free.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_5_1]: encodeRemoveRemotePool,
  }

  /**
   * Validates the pool address, lane selector and remote pool bytes before any RPC, keeping the
   * parsed `remotePoolAddress` so {@link buildUnsigned} checks and encodes it without re-parsing.
   */
  protected override parse(params: RemoveRemotePoolParams): ParsedRemoveRemotePoolParams {
    return parseRemotePoolParams(this.name, params)
  }

  /**
   * Resolves the pool's version (rejecting v1.5.0), confirms `sender` owns the pool, then requires
   * the address to actually be registered on this lane: the lane's remote pools are read scoped to
   * this one selector, and removing an address that is not among them would revert on-chain
   * (`InvalidRemotePoolForChain`). An unconfigured lane reads as having none — see
   * {@link readRegisteredRemotePools} — and is rejected the same way.
   * @throws {@link CCTOperationUnsupportedError} if the pool is v1.5.0
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the pool owner, or if
   * `remotePoolAddress` is not currently registered on this lane
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: ParsedRemoveRemotePoolParams,
  ): Promise<UnsignedEVMTx> {
    const { type, version } = await resolveTokenPool(chain, params.poolAddress)
    // resolved before any further RPC, so an unsupported version fails on one call
    const encode = resolveEncoder(this.encoders, version, this.name)
    // owner-gated on-chain; surface it as a param error here instead of an on-chain revert
    if (params.sender !== undefined)
      await assertPoolOwner(this.name, chain, params.poolAddress, params.sender)

    const registered = await readRegisteredRemotePools(chain, params)
    if (!isRegisteredRemotePool(registered, params.remotePoolAddress, params.remoteChainSelector))
      throw new CCTParamsInvalidError(
        this.name,
        'remotePoolAddress',
        `is not registered on chain selector ${params.remoteChainSelector} (registered: ${registered.join(', ') || 'none'}); removing it reverts`,
      )

    chain.logger.debug(
      `${this.name}: pool = ${params.poolAddress}, lane = ${params.remoteChainSelector}, registered = ${registered.length}`,
    )
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
    params: EVMExecuteParams<RemoveRemotePoolParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
