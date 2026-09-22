/**
 * EVM lockbox contract layer for CCT: the cached `ERC20LockBox` {@link Interface}
 * ({@link LOCKBOX_INTERFACE}) for calldata encoding, its deploy artifact
 * ({@link getLockboxArtifact}), and the pre-tx reads every lockbox write runs before building
 * calldata — the on-chain identity check ({@link assertLockbox}), the escrowed token
 * ({@link assertLockboxToken}), the authorized-caller set ({@link assertLockboxCaller}) and the
 * ERC-20 position behind the transfer ({@link assertLockboxFunding} /
 * {@link assertLockboxLiquidity}).
 *
 * Mirrors `token/contracts.ts` in shape, and `token-pool/contracts.ts` in the split between
 * `read*` helpers and the `assert*` guards the ops call.
 *
 * @packageDocumentation
 */

import { Interface, getAddress } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { EVMChain } from '../../../evm/index.ts'
import { resultToObject } from '../../../evm/types.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTParamsInvalidError,
  CCTTxFailedError,
} from '../../errors.ts'
import FACTORY_BURN_MINT_ERC20_V1_5_1_ABI from '../artifacts/abi/V1_5_1/factory-burn-mint-erc20.ts'
import ERC20_LOCKBOX_V2_0_0_ABI from '../artifacts/abi/V2_0_0/erc20-lockbox.ts'
import ERC20_LOCKBOX_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/erc20-lockbox.ts'
import type { DeployArtifact } from '../operation.ts'
import { getTypedContract, isMissingFunction } from '../query.ts'

/** Shared, cached `ERC20LockBox` interface for constructor and calldata encoding. */
export const LOCKBOX_INTERFACE = new Interface(ERC20_LOCKBOX_V2_0_0_ABI)

/** `ERC20LockBox` creation bytecode for `deployLockbox`. */
export const LOCKBOX_BYTECODE = ERC20_LOCKBOX_V2_0_0_BYTECODE

/** `ERC20LockBox` deploy artifact: contract name + ctor {@link Interface} + creation bytecode. */
export function getLockboxArtifact(): DeployArtifact {
  return {
    contract: 'ERC20LockBox',
    iface: LOCKBOX_INTERFACE,
    bytecode: LOCKBOX_BYTECODE,
  }
}

/** Contract type an `ERC20LockBox` reports from `typeAndVersion`, e.g. `ERC20LockBox 2.0.0`. */
const LOCKBOX_TYPE = 'ERC20LockBox'

/**
 * Lockbox versions this SDK supports. One entry, and one deployable ABI behind it, so this is a
 * flat list rather than the token pool layer's version-keyed interface table: nothing dispatches
 * on a lockbox version, so {@link assertLockbox} checks membership and hands nothing back.
 */
const LOCKBOX_VERSIONS: string[] = ['2.0.0']

/**
 * Asserts `lockbox` is a deployed, supported `ERC20LockBox` by reading its `typeAndVersion`.
 *
 * @remarks Every lockbox op is a call to a caller-supplied address, and the EVM answers a call to
 * an address with no code by succeeding and doing nothing. Without this read a lockbox typo, an
 * EOA, or a pool address mines as a "successful" authorization, and the SDK hands back a tx hash
 * for an update that never happened. One `eth_call` turns all three into a typed error before any
 * calldata is built, let alone signed.
 * @remarks The read doubles as the code-existence check: an address with no code returns `0x`,
 * which ethers surfaces as a `BAD_DATA` decode failure, so no separate `getCode` round trip is
 * needed. Only that shape and a `CALL_EXCEPTION` revert are read as "not a lockbox"
 * ({@link isMissingFunction}); a transport error or rate limit propagates untouched rather than
 * being reported as a bad address. The underlying failure is kept as the `cause`.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read from.
 * @param lockbox - The caller-supplied lockbox address, already validated as non-zero.
 * @throws {@link CCTParamsInvalidError} if the `typeAndVersion` read fails, i.e. there is no
 * contract at `lockbox`, or it does not answer the call
 * @throws {@link CCTContractTypeInvalidError} if the contract is not an `ERC20LockBox`
 * @throws {@link CCTContractVersionUnsupportedError} if it reports an unsupported version
 * @throws `CCIPTypeVersionInvalidError` if the contract answers with a string that is not a
 * `type version` pair at all, as `chain.typeAndVersion` raises it
 */
export async function assertLockbox(
  operation: string,
  chain: EVMChain,
  lockbox: string,
): Promise<void> {
  let contractType: string, version: string
  try {
    ;[contractType, version] = await chain.typeAndVersion(lockbox)
  } catch (err) {
    if (!isMissingFunction(err)) throw err
    throw new CCTParamsInvalidError(
      operation,
      'lockbox',
      `nothing at ${lockbox} answers typeAndVersion() — it holds no contract code, holds code that is not a lockbox, or was deployed so recently that this RPC node has not caught up; check the address, or deploy a lockbox with deployLockbox`,
      { cause: err instanceof Error ? err : undefined },
    )
  }
  if (contractType !== LOCKBOX_TYPE)
    throw new CCTContractTypeInvalidError(lockbox, LOCKBOX_TYPE, contractType)
  if (!LOCKBOX_VERSIONS.includes(version))
    throw new CCTContractVersionUnsupportedError(LOCKBOX_TYPE, version, {
      context: { address: lockbox },
    })
}

/**
 * The `uint64 remoteChainSelector` argument `ILockBox.deposit` / `.withdraw` declare and
 * `ERC20LockBox` v2.0.0 ignores — its parameter is unnamed and never read.
 *
 * @remarks Pinned at zero here rather than exposed as an op parameter. The argument exists for
 * `ILockBox` compatibility with the *siloed* escrow, which does key liquidity by lane; this
 * lockbox pools it across lanes, so no value a caller could pass changes anything, and asking for
 * one would imply per-lane escrow that does not exist here. If a future lockbox reads the field,
 * the ops gain an optional parameter defaulting to this, which is additive.
 */
export const IGNORED_SELECTOR = 0n

/** An `ERC20LockBox` handle typed for the reads the liquidity ops pre-flight. */
type LockboxReader = Pick<
  TypedContract<typeof ERC20_LOCKBOX_V2_0_0_ABI>,
  'getToken' | 'getAllAuthorizedCallers'
>

/**
 * The token a lockbox escrows, plus an ERC-20 handle to it, in one `eth_call`. Mirrors
 * `token-pool/contracts.ts`'s `readTokenPoolToken`.
 * @param chain - Chain to read from.
 * @param lockbox - Lockbox to read `getToken()` from.
 * @returns The escrowed token, checksummed, and an ERC-20 contract bound to it.
 */
export async function readLockboxToken(
  chain: EVMChain,
  lockbox: string,
): Promise<{ token: string; erc20: TypedContract<typeof FACTORY_BURN_MINT_ERC20_V1_5_1_ABI> }> {
  const box: LockboxReader = getTypedContract(chain, lockbox, ERC20_LOCKBOX_V2_0_0_ABI)
  const token = getAddress(resultToObject(await box.getToken()))
  return { token, erc20: getTypedContract(chain, token, FACTORY_BURN_MINT_ERC20_V1_5_1_ABI) }
}

/**
 * Asserts the lockbox escrows exactly `token`, and returns an ERC-20 handle to it so the funding
 * and balance checks need no second read.
 *
 * @remarks A lockbox fixes `i_token` in its constructor, and `_validateDepositWithdraw` reverts
 * `UnsupportedToken(token)` for anything else, so a mismatch can only ever fail. Checked against
 * `getToken()` rather than `isTokenSupported(token)`: same one call, but the answer names the
 * token the lockbox does escrow, which is what a caller who paired the wrong lockbox with the
 * wrong token needs to see.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read from.
 * @param lockbox - Lockbox being written to.
 * @param token - The caller-supplied token, already validated as an address.
 * @returns An ERC-20 handle to the escrowed token.
 * @throws {@link CCTParamsInvalidError} if the lockbox escrows a different token
 */
export async function assertLockboxToken(
  operation: string,
  chain: EVMChain,
  lockbox: string,
  token: string,
): Promise<TypedContract<typeof FACTORY_BURN_MINT_ERC20_V1_5_1_ABI>> {
  const { token: escrowed, erc20 } = await readLockboxToken(chain, lockbox)
  if (escrowed === getAddress(token)) return erc20
  throw new CCTParamsInvalidError(
    operation,
    'token',
    `lockbox ${lockbox} escrows ${escrowed}, not ${getAddress(token)}; it would revert UnsupportedToken`,
  )
}

/**
 * Pre-flights `account` against the lockbox's `getAllAuthorizedCallers()`.
 *
 * @remarks The check the documented LockRelease sequences stop short of:
 * `_validateDepositWithdraw` ends in `_validateCaller`, so a *depositor* must itself be an
 * authorized caller, not only the pool. Without this the only signal is an
 * `UnauthorizedCaller(address)` revert (selector `0xd86ad9cf`) at wallet-confirmation time, which
 * names neither the lockbox nor the op that cures it. The error names `authorizeLockboxCallers`,
 * which grants exactly this.
 * @remarks Owner-gated ops use `owner()`; this set is separate and wider — being the lockbox
 * owner does not make an account an authorized caller.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read from.
 * @param lockbox - Lockbox being written to.
 * @param account - The address the tx will be sent from; compared checksummed.
 * @throws {@link CCTParamsInvalidError} if `account` is not an authorized caller
 */
export async function assertLockboxCaller(
  operation: string,
  chain: EVMChain,
  lockbox: string,
  account: string,
): Promise<void> {
  const box: LockboxReader = getTypedContract(chain, lockbox, ERC20_LOCKBOX_V2_0_0_ABI)
  // the abitype handle types an `address[]` return as `(string | Addressable)[]`
  const callers = resultToObject(await box.getAllAuthorizedCallers()).map((c) =>
    getAddress(c as string),
  )
  if (callers.includes(getAddress(account))) return
  throw new CCTParamsInvalidError(
    operation,
    'sender',
    callers.length === 0
      ? `lockbox ${lockbox} has no authorized callers, so it accepts deposits and withdrawals from nobody; its owner must add ${getAddress(account)} with authorizeLockboxCallers({ lockbox: '${lockbox}', addedCallers: ['${getAddress(account)}'] })`
      : `${getAddress(account)} is not an authorized caller of lockbox ${lockbox} (currently ${callers.join(', ')}), so it would revert UnauthorizedCaller; its owner must add it with authorizeLockboxCallers({ lockbox: '${lockbox}', addedCallers: ['${getAddress(account)}'] })`,
  )
}

/**
 * Pre-flights a deposit against the depositor's ERC-20 position: it must hold `amount` of the
 * escrowed token *and* have approved the **lockbox** to pull it, since `deposit` is a
 * `safeTransferFrom`.
 *
 * @remarks The lockbox, not the pool, is the spender — the one difference from
 * `token-pool/contracts.ts`'s `assertLiquidityFunding`, and an easy thing to get wrong when
 * migrating a v1.5.x runbook to v2.0.0, so the error spells out the `approveToken` call.
 * @remarks Advisory: an allowance can be spent or revoked between building and signing. It moves
 * only on an explicit `approve` though, so it is stable enough to be worth the round trip.
 * @param operation - Operation name, for the error's `operation` field.
 * @param erc20 - Handle to the escrowed token, from {@link assertLockboxToken}.
 * @param lockbox - Lockbox being deposited into; the spender of the allowance.
 * @param token - The escrowed token, for the error message.
 * @param account - The depositing account.
 * @param amount - Deposit amount, in the token's smallest unit.
 * @throws {@link CCTTxFailedError} if `account` holds less than `amount`, or has approved the
 * lockbox for less than `amount`
 */
export async function assertLockboxFunding(
  operation: string,
  erc20: TypedContract<typeof FACTORY_BURN_MINT_ERC20_V1_5_1_ABI>,
  lockbox: string,
  token: string,
  account: string,
  amount: bigint,
): Promise<void> {
  const [balance, allowance] = await Promise.all([
    erc20.balanceOf(account),
    erc20.allowance(account, lockbox),
  ])
  if (balance < amount)
    throw new CCTTxFailedError(
      operation,
      `${account} holds ${balance} of ${token}, but ${amount} is required; mint or transfer tokens first`,
    )
  if (allowance < amount)
    throw new CCTTxFailedError(
      operation,
      `${account} has approved ${allowance} of ${token} to lockbox ${lockbox}, but ${amount} is required; the deposit is a transferFrom, so grant the allowance first with approveToken({ tokenAddress: '${token}', spender: '${lockbox}', amount: ${amount}n })`,
    )
}

/**
 * Pre-flights a withdrawal against the lockbox's own balance of the escrowed token, which is what
 * it pays out of.
 *
 * @remarks Weaker than {@link assertLockboxFunding}, exactly as `assertPoolLiquidity` is: the
 * balance moves with every CCIP transfer through the pool, so this catches "withdraw more than
 * was ever deposited" rather than proving the amount will still fit when the tx mines.
 * @param operation - Operation name, for the error's `operation` field.
 * @param erc20 - Handle to the escrowed token, from {@link assertLockboxToken}.
 * @param lockbox - Lockbox being withdrawn from.
 * @param token - The escrowed token, for the error message.
 * @param amount - Withdrawal amount, in the token's smallest unit.
 * @throws {@link CCTTxFailedError} if the lockbox holds less than `amount`
 */
export async function assertLockboxLiquidity(
  operation: string,
  erc20: TypedContract<typeof FACTORY_BURN_MINT_ERC20_V1_5_1_ABI>,
  lockbox: string,
  token: string,
  amount: bigint,
): Promise<void> {
  const balance = await erc20.balanceOf(lockbox)
  if (balance >= amount) return
  throw new CCTTxFailedError(
    operation,
    `lockbox ${lockbox} holds ${balance} of ${token}, but ${amount} is required; it would revert InsufficientBalance`,
  )
}
