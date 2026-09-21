/**
 * EVM lockbox contract layer for CCT: the cached `ERC20LockBox` {@link Interface}
 * ({@link LOCKBOX_INTERFACE}) for calldata encoding, its deploy artifact
 * ({@link getLockboxArtifact}), and the on-chain identity check the lockbox write ops run before
 * building calldata ({@link assertLockbox}). Mirrors `token/contracts.ts`, and
 * `token-pool/contracts.ts` in the shape of the resolver.
 *
 * @packageDocumentation
 */

import { Interface } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTParamsInvalidError,
} from '../../errors.ts'
import ERC20_LOCKBOX_V2_0_0_ABI from '../artifacts/abi/V2_0_0/erc20-lockbox.ts'
import ERC20_LOCKBOX_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/erc20-lockbox.ts'
import type { DeployArtifact } from '../operation.ts'
import { isMissingFunction } from '../query.ts'

/** Shared, cached `ERC20LockBox` interface for constructor and calldata encoding. */
export const LOCKBOX_INTERFACE = new Interface(ERC20_LOCKBOX_V2_0_0_ABI)

/** `ERC20LockBox` creation bytecode for `deployLockbox`. */
export const LOCKBOX_BYTECODE = ERC20_LOCKBOX_V2_0_0_BYTECODE

/** Contract type an `ERC20LockBox` reports from `typeAndVersion`, e.g. `ERC20LockBox 2.0.0`. */
const LOCKBOX_TYPE = 'ERC20LockBox'

/** `ERC20LockBox` deploy artifact: contract name + ctor {@link Interface} + creation bytecode. */
export function getLockboxArtifact(): DeployArtifact {
  return {
    contract: LOCKBOX_TYPE,
    iface: LOCKBOX_INTERFACE,
    bytecode: LOCKBOX_BYTECODE,
  }
}

/**
 * Lockbox versions this SDK supports. One entry, and one deployable ABI behind it, so this is a
 * flat list rather than the token pool layer's version-keyed interface table: nothing dispatches
 * on a lockbox version yet, and {@link assertLockbox} hands none back.
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
