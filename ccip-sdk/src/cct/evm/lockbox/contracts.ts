/**
 * EVM lockbox contract layer for CCT: the cached `ERC20LockBox` {@link Interface}
 * ({@link LOCKBOX_INTERFACE}) for calldata encoding, its deploy artifact
 * ({@link getLockboxArtifact}), and the on-chain checks the lockbox write ops run before building
 * calldata: identity ({@link assertLockbox}) and ownership ({@link assertLockboxOwner}). Mirrors
 * `token/contracts.ts`, and `token-pool/contracts.ts` in the shape of the resolver.
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
} from '../../errors.ts'
import ERC20_LOCKBOX_V2_0_0_ABI from '../artifacts/abi/V2_0_0/erc20-lockbox.ts'
import ERC20_LOCKBOX_V2_0_0_BYTECODE from '../artifacts/bytecode/V2_0_0/erc20-lockbox.ts'
import type { DeployArtifact } from '../operation.ts'
import { getTypedContract, isMissingFunction } from '../query.ts'

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
 * @throws {@link CCIPTypeVersionInvalidError} if the contract answers with a string that is not a
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

/** The one `ERC20LockBox` getter {@link readLockboxOwner} calls. */
type LockboxOwnerGetter = Pick<TypedContract<typeof ERC20_LOCKBOX_V2_0_0_ABI>, 'owner'>

/**
 * Reads an `ERC20LockBox`'s `owner()` in one `eth_call`.
 * @remarks Callers run {@link assertLockbox} first: `owner()` is declared by pools and tokens too,
 * so it says nothing about whether `lockbox` is a lockbox.
 * @param chain - Chain to read from.
 * @param lockbox - Lockbox contract to read `owner()` from.
 * @returns The current owner, checksummed.
 */
export async function readLockboxOwner(chain: EVMChain, lockbox: string): Promise<string> {
  const contract: LockboxOwnerGetter = getTypedContract(chain, lockbox, ERC20_LOCKBOX_V2_0_0_ABI)
  return getAddress(resultToObject(await contract.owner()))
}

/**
 * Pre-flights `sender` against the lockbox's on-chain `owner()` for an owner-gated write, so an
 * unauthorized caller fails as a {@link CCTParamsInvalidError} here instead of as an
 * `OnlyCallableByOwner` revert after a multisig has already reviewed and signed. The lockbox-side
 * counterpart of `assertPoolOwner` and `assertTokenOwner`.
 * @param operation - Operation name, for the error's `operation` field.
 * @param chain - Chain to read the owner from.
 * @param lockbox - Lockbox being written to.
 * @param sender - The address the tx will be sent from; compared checksummed.
 * @throws {@link CCTParamsInvalidError} if `sender` is not the lockbox owner
 */
export async function assertLockboxOwner(
  operation: string,
  chain: EVMChain,
  lockbox: string,
  sender: string,
): Promise<void> {
  const owner = await readLockboxOwner(chain, lockbox)
  if (getAddress(sender) === owner) return
  throw new CCTParamsInvalidError(
    operation,
    'sender',
    `must be the current lockbox owner (${owner})`,
  )
}
