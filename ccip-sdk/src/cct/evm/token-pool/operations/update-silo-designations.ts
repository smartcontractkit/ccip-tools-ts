/**
 * updateSiloDesignations: turns lanes of a `SiloedLockReleaseTokenPool` into silos, or back into
 * shared-bucket lanes (v1.6.0–v1.6.1). Removes are applied before adds, in one call:
 * `updateSiloDesignations(uint64[] removes, SiloConfigUpdate[] adds)`.
 *
 * @remarks Owner-only. **A remove moves the silo's whole balance into the shared unsiloed bucket**
 * and revokes its silo rebalancer; from then on the lane draws on the unsiloed bucket and its
 * unsiloed rebalancer. **An add starts the silo at 0**: liquidity already in the unsiloed bucket
 * stays there, and the new silo's rebalancer funds it with {@link ProvideSiloedLiquidity}.
 *
 * @remarks An added lane must already be a supported chain (added with `applyChainUpdates`) and
 * not already siloed; a removed lane must currently be siloed. All three are pre-flighted against
 * the pool before any calldata is built, as each would revert the whole batch.
 *
 * @remarks **Removed in v2.0.0**, where a siloed pool binds a lockbox per lane instead (see
 * {@link ConfigureSiloedLockboxes}).
 *
 * @packageDocumentation
 */

import { type Interface, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import {
  parseRecord,
  validateArray,
  validateNonZeroAddress,
  validateUint64,
} from '../../validate.ts'
import {
  TokenPoolVersion,
  assertPoolOwner,
  assertSiloedLockReleasePool,
  getTokenPoolInterface,
  readTokenPoolIsSiloed,
  readTokenPoolIsSupportedChain,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** One silo to create: the contract's `SiloConfigUpdate` struct. */
export type SiloConfigUpdate = {
  /** The lane to silo (`uint64`). Must be non-zero, supported by the pool, and not yet siloed. */
  remoteChainSelector: bigint
  /** The silo's first rebalancer. Must be non-zero: the pool reverts `ZeroAddressNotAllowed`. */
  rebalancer: string
}

/** Parameters for {@link UpdateSiloDesignations}. At least one entry across both arrays. */
export type UpdateSiloDesignationsParams = {
  /** v1.6.x `SiloedLockReleaseTokenPool` to update. Must be non-zero: it is the tx `to`, and a
   * call to `0x0` hits no code, so it would mine as a successful no-op. */
  poolAddress: string
  /**
   * Lanes to un-silo, applied *before* {@link adds} on-chain. Each must currently be siloed. Its
   * silo balance moves into the shared unsiloed bucket. `[]` for none. No duplicates, and no lane
   * that also appears in {@link adds}.
   */
  removes: bigint[]
  /** Silos to create, each starting with a balance of 0. `[]` for none. No duplicate lanes. */
  adds: SiloConfigUpdate[]
  /**
   * The pool owner. Sets `tx.from` for offline / multisig signing, and when supplied is checked
   * against the pool's on-chain `owner()` before any calldata is built. Optional for
   * {@link UpdateSiloDesignations.generate}; {@link UpdateSiloDesignations.execute} defaults it
   * to the signing wallet.
   */
  sender?: string
}

/**
 * Normalized params for {@link UpdateSiloDesignations}: every rebalancer checksummed, every lane
 * validated and duplicate-free, so {@link UpdateSiloDesignations.buildUnsigned} never re-derives
 * them.
 */
type ParsedUpdateSiloDesignationsParams = {
  poolAddress: string
  removes: bigint[]
  adds: SiloConfigUpdate[]
  sender?: string
}

/** Encodes `updateSiloDesignations` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: ParsedUpdateSiloDesignationsParams) => UnsignedEVMTx

// `removes` FIRST, then `adds`: the ABI's own order, which byte-parity tests pin.
const encodeUpdateSiloDesignations: Encoder = (iface, { poolAddress, removes, adds }) =>
  callTx(
    poolAddress,
    iface.encodeFunctionData('updateSiloDesignations', [
      removes,
      adds.map((a) => [a.remoteChainSelector, a.rebalancer]),
    ]),
  )

/** Designates and un-designates silos on a siloed pool (v1.6.0–v1.6.1). Owner-only. */
export class UpdateSiloDesignations extends EVMOperation<
  UpdateSiloDesignationsParams,
  ParsedUpdateSiloDesignationsParams
> {
  readonly name = 'updateSiloDesignations'

  /**
   * One 1.6.0 entry covers 1.6.1 by floor-match (the signature never changed), and the explicit
   * `null` at 2.0.0 marks the removal.
   */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V1_6_0]: encodeUpdateSiloDesignations,
    [TokenPoolVersion.V2_0_0]: null,
  }

  /**
   * Validates the pool address and every entry before any RPC, keeping the checksummed
   * rebalancers so {@link buildUnsigned} and the encoder never re-derive them.
   *
   * Three judgement calls, all rejections:
   * - **both arrays empty**: such a call mines while changing nothing.
   * - **duplicates within an array**: a second remove of the same lane reverts `ChainNotSiloed`
   *   (the first deleted it), and a second add reverts `InvalidChainSelector` (the first siloed
   *   it); reported here against the second occurrence.
   * - **a lane in BOTH arrays**: legal on-chain, where it "resets" the silo: its balance moves to
   *   the unsiloed bucket and it restarts at 0 under the new rebalancer. Far likelier to be a
   *   caller who meant to change the rebalancer, which `setSiloRebalancer` does without moving any
   *   liquidity; a deliberate reset can still be done in two calls.
   *
   * Lane 0 and a zero rebalancer in `adds` are rejected as the reverts they would be
   * (`InvalidChainSelector`, `ZeroAddressNotAllowed`).
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is invalid, an array is not a dense
   * array, both are empty, an entry is malformed (reported as `removes[i]`,
   * `adds[i].remoteChainSelector` or `adds[i].rebalancer`), or a lane is duplicated or in both
   */
  protected override prepare({
    poolAddress,
    removes: rawRemoves,
    adds: rawAdds,
    sender,
  }: UpdateSiloDesignationsParams): ParsedUpdateSiloDesignationsParams {
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateArray(this.name, 'removes', rawRemoves)
    validateArray(this.name, 'adds', rawAdds)
    if (rawRemoves.length + rawAdds.length === 0)
      throw new CCTParamsInvalidError(
        this.name,
        'adds',
        'at least one lane must be added or removed',
      )

    const removes = rawRemoves.map((selector, i) => {
      validateUint64(this.name, `removes[${i}]`, selector)
      if (rawRemoves.indexOf(selector) !== i)
        throw new CCTParamsInvalidError(this.name, `removes[${i}]`, 'duplicates an earlier entry')
      return selector
    })
    const removed = new Set(removes)
    const seen = new Set<bigint>()
    const adds = rawAdds.map((raw, i): SiloConfigUpdate => {
      const entry = parseRecord(this.name, `adds[${i}]`, raw, 'silo config update')
      const param = `adds[${i}].remoteChainSelector`
      const selector = entry.remoteChainSelector
      validateUint64(this.name, param, selector)
      if (selector === 0n)
        throw new CCTParamsInvalidError(
          this.name,
          param,
          'must not be 0, which the pool rejects with InvalidChainSelector',
        )
      if (seen.has(selector))
        throw new CCTParamsInvalidError(this.name, param, 'duplicates an earlier entry')
      seen.add(selector)
      if (removed.has(selector))
        throw new CCTParamsInvalidError(
          this.name,
          param,
          `lane ${selector} is also in removes, which would move its silo balance into the unsiloed bucket and restart it at 0; to change its rebalancer, use setSiloRebalancer`,
        )
      validateNonZeroAddress(this.name, `adds[${i}].rebalancer`, entry.rebalancer)
      return { remoteChainSelector: selector, rebalancer: getAddress(entry.rebalancer) }
    })
    return { poolAddress, removes, adds, sender }
  }

  /**
   * Resolves the pool's type/version, confirms `sender` (when given) is the pool owner, then
   * pre-flights every lane against the pool in one parallel batch.
   *
   * Three state preconditions, each of which reverts the whole batch:
   * - **every `removes` lane must be siloed**: else `ChainNotSiloed`.
   * - **no `adds` lane may already be siloed**: else `InvalidChainSelector`.
   * - **every `adds` lane must be a supported chain**: else `InvalidChainSelector`.
   *
   * @remarks The lane checks do not depend on the signer and always run; the owner check is
   * skipped without a `sender`. All of them live here, not in {@link execute}, so the offline /
   * multisig path gets them too.
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a `SiloedLockReleaseTokenPool`
   * @throws {@link CCTOperationUnsupportedError} on a v2.0.0 pool
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the pool owner, or a
   * lane fails a precondition above
   * @throws {@link CCTContractVersionUnsupportedError} if the pool reports an unknown version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: ParsedUpdateSiloDesignationsParams,
  ): Promise<UnsignedEVMTx> {
    const { poolAddress, removes, adds, sender } = params
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    assertSiloedLockReleasePool(this.name, poolAddress, type)
    const encode = resolveEncoder(this.encoders, version, this.name)
    if (sender !== undefined) await assertPoolOwner(this.name, chain, poolAddress, sender)

    const added = adds.map((a) => a.remoteChainSelector)
    const [removedSiloed, addedSiloed, addedSupported] = await Promise.all([
      Promise.all(removes.map((sel) => readTokenPoolIsSiloed(chain, poolAddress, sel))),
      Promise.all(added.map((sel) => readTokenPoolIsSiloed(chain, poolAddress, sel))),
      Promise.all(added.map((sel) => readTokenPoolIsSupportedChain(chain, poolAddress, sel))),
    ])
    const notSiloed = removedSiloed.indexOf(false)
    if (notSiloed !== -1)
      throw new CCTParamsInvalidError(
        this.name,
        `removes[${notSiloed}]`,
        `lane ${removes[notSiloed]} is not siloed on ${poolAddress}; it would revert ChainNotSiloed`,
      )
    const alreadySiloed = addedSiloed.indexOf(true)
    if (alreadySiloed !== -1)
      throw new CCTParamsInvalidError(
        this.name,
        `adds[${alreadySiloed}].remoteChainSelector`,
        `lane ${added[alreadySiloed]} is already siloed on ${poolAddress}; it would revert InvalidChainSelector; change its rebalancer with setSiloRebalancer`,
      )
    const unsupported = addedSupported.indexOf(false)
    if (unsupported !== -1)
      throw new CCTParamsInvalidError(
        this.name,
        `adds[${unsupported}].remoteChainSelector`,
        `lane ${added[unsupported]} is not a supported chain on ${poolAddress}; add the lane with applyChainUpdates first, as it would revert InvalidChainSelector`,
      )

    chain.logger.debug(
      `${this.name}: pool = ${poolAddress}, removes = ${removes.length}, adds = ${adds.length}`,
    )
    return encode(getTokenPoolInterface(type, version), params)
  }

  /**
   * Signs and submits as the pool owner, defaulting `sender` to the signing wallet: the only
   * address that can satisfy {@link buildUnsigned}'s owner check for a broadcast tx. See
   * {@link EVMOperation.resolveWalletSender} for why a divergent `sender` is rejected rather
   * than signed.
   * @throws {@link CCIPWalletInvalidError} if `wallet` is not a valid signer
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the wallet's address,
   * the wallet is not the pool owner, or any other param is invalid
   * @throws {@link CCIPExecTxRevertedError} if the tx reverts on-chain
   */
  override async execute(
    chain: EVMChain,
    params: EVMExecuteParams<UpdateSiloDesignationsParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
