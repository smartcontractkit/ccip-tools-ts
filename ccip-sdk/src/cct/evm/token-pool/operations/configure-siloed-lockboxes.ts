/**
 * configureSiloedLockboxes: binds lanes of a v2.0.0 `SiloedLockReleaseTokenPool` to the
 * `ERC20LockBox`es their transfers escrow through: the pool's `configureLockBoxes`.
 *
 * @remarks Owner-only. Lanes may share a lockbox (shared liquidity) or each get their own
 * (isolated liquidity). A binding can be **replaced** by configuring the lane again, but never
 * removed. A lane with no lockbox reverts `LockBoxNotConfigured` on every transfer.
 *
 * @remarks The pool checks each lockbox escrows its token (`InvalidToken` otherwise); that is
 * pre-flighted here, along with each address actually being an `ERC20LockBox`. The pool does
 * **not** check that it is an authorized caller of the lockbox, and neither does this op: every
 * transfer on the lane reverts `UnauthorizedCaller` until the lockbox owner adds the pool with
 * `updateLockboxAuthorizedCallers`, which a multisig may batch with this call.
 *
 * @packageDocumentation
 */

import { type Interface, getAddress } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import type { UnsignedEVMTx } from '../../../../evm/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransactionResult } from '../../../operation.ts'
import { assertLockbox, readLockboxToken } from '../../lockbox/contracts.ts'
import { type EVMExecuteParams, EVMOperation, callTx } from '../../operation.ts'
import {
  parseRecord,
  validateArray,
  validateNonZeroAddress,
  validateUint64,
} from '../../validate.ts'
import {
  type LockboxConfig,
  TokenPoolVersion,
  assertPoolOwner,
  assertSiloedLockReleasePool,
  getTokenPoolInterface,
  readTokenPoolLockboxConfigs,
  readTokenPoolToken,
  resolveEncoder,
  resolveTokenPool,
} from '../contracts.ts'

/** Parameters for {@link ConfigureSiloedLockboxes}. */
export type ConfigureSiloedLockboxesParams = {
  /** v2.0.0 `SiloedLockReleaseTokenPool` to configure. Must be non-zero: it is the tx `to`, and
   * a call to `0x0` hits no code, so it would mine as a successful no-op. */
  poolAddress: string
  /**
   * Lane → lockbox bindings to set; at least one. Each lane (non-zero) at most once, each lockbox
   * a non-zero `ERC20LockBox` for the pool's token. A lane already bound to a different lockbox is
   * re-bound; one already bound to the same lockbox is rejected as a no-op.
   */
  lockboxConfigs: LockboxConfig[]
  /**
   * The pool owner. Sets `tx.from` for offline / multisig signing, and when supplied is checked
   * against the pool's on-chain `owner()` before any calldata is built. Optional for
   * {@link ConfigureSiloedLockboxes.generate}; {@link ConfigureSiloedLockboxes.execute} defaults it to the
   * signing wallet.
   */
  sender?: string
}

/** Encodes `configureLockBoxes` calldata against the resolved pool {@link Interface}. */
type Encoder = (iface: Interface, params: ConfigureSiloedLockboxesParams) => UnsignedEVMTx

const encodeConfigureSiloedLockboxes: Encoder = (iface, { poolAddress, lockboxConfigs }) =>
  callTx(
    poolAddress,
    iface.encodeFunctionData('configureLockBoxes', [
      lockboxConfigs.map((c) => [c.remoteChainSelector, c.lockbox]),
    ]),
  )

/** Binds lanes of a v2.0.0 siloed pool to their lockboxes. Owner-only. */
export class ConfigureSiloedLockboxes extends EVMOperation<ConfigureSiloedLockboxesParams> {
  readonly name = 'configureSiloedLockboxes'

  /** Introduced at 2.0.0, which replaced the 1.6.x in-pool silos with per-lane lockboxes. */
  private readonly encoders: Partial<Record<TokenPoolVersion, Encoder | null>> = {
    [TokenPoolVersion.V2_0_0]: encodeConfigureSiloedLockboxes,
  }

  /**
   * Validates the pool and every binding before any RPC.
   * @remarks Lane 0 is rejected although the pool would store it: no chain has selector 0, so
   * the binding could never be used. A lane listed twice is rejected because the last entry would
   * silently win. A zero lockbox reverts `ZeroAddressInvalid`.
   * @throws {@link CCTParamsInvalidError} if `poolAddress` is invalid, `lockboxConfigs` is not a
   * non-empty dense array, or an entry is malformed or repeats a lane (reported as
   * `lockboxConfigs[i]`, `lockboxConfigs[i].remoteChainSelector` or `lockboxConfigs[i].lockbox`)
   */
  protected override prepare(
    params: ConfigureSiloedLockboxesParams,
  ): ConfigureSiloedLockboxesParams {
    const { poolAddress, lockboxConfigs } = params
    validateNonZeroAddress(this.name, 'poolAddress', poolAddress)
    validateArray(this.name, 'lockboxConfigs', lockboxConfigs, 1)
    const seen = new Set<bigint>()
    lockboxConfigs.forEach((raw, i) => {
      const entry = parseRecord(this.name, `lockboxConfigs[${i}]`, raw, 'lockbox config')
      const param = `lockboxConfigs[${i}].remoteChainSelector`
      const selector = entry.remoteChainSelector
      validateUint64(this.name, param, selector)
      if (selector === 0n)
        throw new CCTParamsInvalidError(this.name, param, 'must not be 0, which is no chain')
      if (seen.has(selector))
        throw new CCTParamsInvalidError(
          this.name,
          param,
          'duplicates an earlier entry; the last binding would silently win',
        )
      seen.add(selector)
      validateNonZeroAddress(this.name, `lockboxConfigs[${i}].lockbox`, entry.lockbox)
    })
    return params
  }

  /**
   * Resolves the pool's type/version, confirms `sender` (when given) is the pool owner, then
   * pre-flights every binding against the pool and its lockboxes.
   *
   * Two state preconditions:
   * - **no binding may already be in place**: `EnumerableMap.set` stores the same value again
   *   silently, so such an entry is a no-op; mirrors `applyAllowlistUpdates`.
   * - **every lockbox must be an `ERC20LockBox` for the pool's token**: checked once per distinct
   *   lockbox ({@link assertLockbox}, then its `getToken()`), since lanes may share one. The pool
   *   itself reverts `InvalidToken` on a mismatch.
   *
   * @remarks Deliberately not checked: that the lane is a supported chain (the documented
   * sequence binds lockboxes before configuring lanes), and that the pool is an authorized caller
   * of each lockbox (see the module remarks).
   * @throws {@link CCTContractTypeInvalidError} if the pool is not a `SiloedLockReleaseTokenPool`,
   * or a lockbox address is some other contract
   * @throws {@link CCTOperationUnsupportedError} below v2.0.0, where a siloed pool holds its silos
   * itself (see `updateSiloDesignations`)
   * @throws {@link CCTParamsInvalidError} if `sender` is given and is not the pool owner, a
   * binding is already in place, nothing at a lockbox address answers `typeAndVersion()`, or a
   * lockbox escrows another token (both reported as the first `lockboxConfigs[i].lockbox` naming
   * it)
   * @throws {@link CCTContractVersionUnsupportedError} if the pool or a lockbox reports an
   * unknown version
   */
  protected async buildUnsigned(
    chain: EVMChain,
    params: ConfigureSiloedLockboxesParams,
  ): Promise<UnsignedEVMTx> {
    const { poolAddress, sender } = params
    const { type, version } = await resolveTokenPool(chain, poolAddress)
    assertSiloedLockReleasePool(this.name, poolAddress, type)
    const encode = resolveEncoder(this.encoders, version, this.name)
    if (sender !== undefined) await assertPoolOwner(this.name, chain, poolAddress, sender)

    const configs = params.lockboxConfigs.map((c) => ({ ...c, lockbox: getAddress(c.lockbox) }))
    const [{ token }, current] = await Promise.all([
      readTokenPoolToken(chain, poolAddress),
      readTokenPoolLockboxConfigs(chain, poolAddress),
    ])
    const bound = new Map(current.map((c) => [c.remoteChainSelector, c.lockbox]))
    configs.forEach(({ remoteChainSelector, lockbox }, i) => {
      if (bound.get(remoteChainSelector) !== lockbox) return
      throw new CCTParamsInvalidError(
        this.name,
        `lockboxConfigs[${i}]`,
        `lane ${remoteChainSelector} is already bound to ${lockbox}; the tx would change nothing (a no-op)`,
      )
    })

    const lockboxes = [...new Set(configs.map((c) => c.lockbox))]
    await Promise.all(
      lockboxes.map(async (lockbox) => {
        const param = `lockboxConfigs[${configs.findIndex((c) => c.lockbox === lockbox)}].lockbox`
        await assertLockbox(this.name, chain, lockbox, param)
        const { token: escrowed } = await readLockboxToken(chain, lockbox)
        if (escrowed === token) return
        throw new CCTParamsInvalidError(
          this.name,
          param,
          `lockbox ${lockbox} escrows ${escrowed}, not the pool token ${token}; it would revert InvalidToken`,
        )
      }),
    )

    chain.logger.debug(
      `${this.name}: pool = ${poolAddress}, bound = ${current.length}, configuring = ${configs.length}, lockboxes = ${lockboxes.length}`,
    )
    return encode(getTokenPoolInterface(type, version), { ...params, lockboxConfigs: configs })
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
    params: EVMExecuteParams<ConfigureSiloedLockboxesParams>,
  ): Promise<TransactionResult> {
    const sender = await this.resolveWalletSender(params.wallet, params.sender)
    return super.execute(chain, { ...params, sender })
  }
}
