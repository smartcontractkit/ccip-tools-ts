/**
 * CreateX salt handling and off-chain address prediction.
 *
 * @remarks CreateX does not pass the caller's salt to `CREATE2` as given — `_guard` rewrites it
 * based on how its first 21 bytes are laid out, and the resulting *guarded* salt is what the opcode
 * sees. Predicting a deployment address therefore means reproducing that rewrite exactly; a port
 * that is subtly wrong yields a plausible-looking address that nothing ever deploys to. Everything
 * here mirrors `CreateX.sol`'s `_parseSalt` / `_guard`.
 *
 * @see https://github.com/pcaversaccio/createx
 *
 * @packageDocumentation
 */

import {
  AbiCoder,
  ZeroAddress,
  concat,
  dataSlice,
  getAddress,
  getCreate2Address,
  isHexString,
  keccak256,
  toBeHex,
  toUtf8Bytes,
  zeroPadValue,
} from 'ethers'

import { CCTParamsInvalidError } from '../../errors.ts'
import { CREATEX_ADDRESS } from './contracts.ts'

/**
 * How CreateX will interpret a salt, from its first 21 bytes.
 *
 * - `permissioned` — bytes 0..19 are the caller, byte 20 is `0x00`. Only that caller can ever use
 *   this salt, so the address cannot be front-run, but it is bound to the deployer.
 * - `permissionedChainScoped` — as above with byte 20 `0x01`, additionally mixing in the chain id,
 *   which deliberately produces a *different* address per chain.
 * - `chainScoped` — bytes 0..19 are the zero address, byte 20 is `0x01`. Chain-bound, not caller-bound.
 * - `random` — anything else. Caller-agnostic and chain-agnostic, so the same salt and init code
 *   give the same address everywhere — and anyone can get there first.
 * - `invalid` — CreateX reverts `InvalidSalt` on these rather than guessing.
 */
export type SaltMode =
  | { kind: 'permissioned' }
  | { kind: 'permissionedChainScoped' }
  | { kind: 'chainScoped' }
  | { kind: 'random' }
  | { kind: 'invalid'; reason: string }

/** Bytes 0..19 of a salt, which CreateX compares against `msg.sender` and the zero address. */
function saltSenderBytes(salt: string): string {
  return getAddress(dataSlice(salt, 0, 20))
}

/** Byte 20 of a salt: the redeploy-protection flag. */
function saltFlag(salt: string): string {
  return dataSlice(salt, 20, 21)
}

/**
 * Classifies `salt` the way CreateX's `_parseSalt` would for `deployer`.
 *
 * @remarks The two `invalid` cases are the ones where CreateX can read an intent from the sender
 * bytes but the flag byte is neither `0x00` nor `0x01`, so it refuses to assume one. Catching them
 * here turns an on-chain `InvalidSalt` revert into a local error.
 */
export function parseSalt(salt: string, deployer: string): SaltMode {
  const sender = saltSenderBytes(salt)
  const flag = saltFlag(salt)

  if (sender === getAddress(deployer)) {
    if (flag === '0x01') return { kind: 'permissionedChainScoped' }
    if (flag === '0x00') return { kind: 'permissioned' }
    return {
      kind: 'invalid',
      reason: `salt is sender-permissioned but byte 20 is ${flag}, which must be 0x00 or 0x01`,
    }
  }

  if (sender === ZeroAddress) {
    if (flag === '0x01') return { kind: 'chainScoped' }
    if (flag === '0x00') return { kind: 'random' }
    return {
      kind: 'invalid',
      reason: `salt has zero-address sender bytes but byte 20 is ${flag}, which must be 0x00 or 0x01`,
    }
  }

  return { kind: 'random' }
}

/**
 * Applies CreateX's `_guard` to `salt`, returning the value `CREATE2` actually receives.
 *
 * @remarks The `random` branch is `keccak256(abi.encode(salt))` in all realistic cases. On-chain,
 * CreateX passes the salt through untouched if it happens to equal `_generateSalt()`, a hash over
 * the current block's coinbase, number, timestamp and prevrandao; that value is not knowable ahead
 * of time and not reproducible off-chain, so a caller cannot construct a salt that hits it.
 *
 * @throws {@link CCTParamsInvalidError} if CreateX would revert `InvalidSalt` on this salt
 */
export function guardSalt(
  operation: string,
  salt: string,
  deployer: string,
  chainId: bigint,
): string {
  if (!isHexString(salt, 32))
    throw new CCTParamsInvalidError(
      operation,
      'salt',
      `must be exactly 32 bytes of 0x-prefixed hex, got ${String(salt)}`,
    )

  const mode = parseSalt(salt, deployer)
  const sender = getAddress(deployer)

  switch (mode.kind) {
    case 'permissionedChainScoped':
      return keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ['address', 'uint256', 'bytes32'],
          [sender, chainId, salt],
        ),
      )
    case 'permissioned':
      return keccak256(concat([zeroPadValue(sender, 32), salt]))
    case 'chainScoped':
      return keccak256(concat([zeroPadValue(toBeHex(chainId), 32), salt]))
    case 'random':
      return keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32'], [salt]))
    case 'invalid':
      throw new CCTParamsInvalidError(operation, 'salt', mode.reason)
  }
}

/**
 * Builds a sender-permissioned salt: `deployer(20) ‖ 0x00 ‖ entropy(11)`.
 *
 * This is the scheme CCT uses. Only `deployer` can consume the salt, so the resulting address
 * cannot be occupied by anyone else. The cost is that the address is a function of the deployer:
 * it is identical across chains only where the deploying account has the same address on each,
 * which for a Safe means one deployed through the deterministic proxy factory.
 *
 * @throws {@link CCTParamsInvalidError} if `entropy` is not exactly 11 bytes
 */
export function buildPermissionedSalt(
  operation: string,
  deployer: string,
  entropy: string,
): string {
  // One check, not two: `isHexString` with a byte length also rejects odd-length hex, which
  // `dataLength` would otherwise blow up on with a raw ethers TypeError, leaking past this
  // module's documented CCTParamsInvalidError contract.
  if (!isHexString(entropy, 11))
    throw new CCTParamsInvalidError(
      operation,
      'entropy',
      `must be exactly 11 bytes of 0x-prefixed hex, got ${String(entropy)}`,
    )
  return concat([getAddress(deployer), '0x00', entropy])
}

/**
 * Derives the 11 entropy bytes of a salt from a documented preimage, so a deployment address is
 * reproducible from public inputs rather than from a registry someone has to maintain.
 *
 * @remarks Deliberately deterministic, not random: reproducing an address on another chain
 * requires the same entropy, and predicting it before signing requires knowing it in advance.
 * Deploying the same contract twice with the same inputs therefore needs an extra distinguishing
 * part (a bump) — otherwise the address is already taken, which the deploy pre-flight rejects.
 *
 * @example
 * ```typescript
 * deriveEntropy(['cct-sdk', 'BurnMintTokenPool', '2.0.0', token, String(chainSelector)])
 * ```
 */
export function deriveEntropy(parts: readonly string[]): string {
  return dataSlice(keccak256(toUtf8Bytes(parts.join(':'))), 0, 11)
}

/** Everything needed to predict where a CreateX deployment lands. */
export type PredictCreateXAddressParams = {
  salt: string
  initCode: string
  deployer: string
  chainId: bigint
}

/**
 * Predicts the address a CreateX `deployCreate2` / `deployCreate2AndInit` will deploy to.
 *
 * @remarks The `deployer` in the `CREATE2` preimage is CreateX itself, not the caller — the caller
 * only enters through {@link guardSalt}. Getting those two round the wrong way is the easy mistake
 * here, and it produces an address that looks entirely reasonable.
 *
 * @throws {@link CCTParamsInvalidError} if the salt is one CreateX would reject
 */
export function predictCreateXAddress(
  operation: string,
  { salt, initCode, deployer, chainId }: PredictCreateXAddressParams,
): string {
  const guarded = guardSalt(operation, salt, deployer, chainId)
  return getCreate2Address(CREATEX_ADDRESS, guarded, keccak256(initCode))
}
