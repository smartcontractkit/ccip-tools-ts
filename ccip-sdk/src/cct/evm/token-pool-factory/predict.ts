/**
 * TokenPoolFactory (v2.0.0) off-chain address prediction: reproduces the factory's salt handling
 * and CREATE2 preimages so a deployment address is known before signing. Mirrors `createx/salt.ts`.
 *
 * @remarks Every function here reproduces `TokenPoolFactory.sol` exactly; a subtly-wrong encoding
 * yields a plausible-looking address that nothing ever deploys to. The factory rewrites the
 * caller's salt as `keccak256(abi.encodePacked(salt, msg.sender))` (`_guard`-equivalent), deploys
 * the token from `tokenInitCode` as given, and deploys the pool from `tokenPoolInitCode` **plus
 * constructor args the factory itself builds** from its `rmnProxy`/`ccipRouter` — which is why the
 * pool preimage needs {@link buildPoolInitArgs} and the factory's static config.
 *
 * @packageDocumentation
 */

import {
  AbiCoder,
  ZeroAddress,
  concat,
  dataLength,
  getAddress,
  getCreate2Address,
  isHexString,
  keccak256,
  solidityPacked,
  toUtf8Bytes,
} from 'ethers'

import { CCTParamsInvalidError } from '../../errors.ts'
import { LOCKBOX_BYTECODE } from '../lockbox/contracts.ts'
import type { FACTORY_POOL_TYPE } from './contracts.ts'

/** Local pool family the factory can deploy: `BurnMint` (5 ctor args) or `LockRelease` (6). */
export type FactoryPoolFamily = keyof typeof FACTORY_POOL_TYPE

/**
 * Normalises a caller salt to the `bytes32` the factory takes: a 32-byte hex string is used as is;
 * any other non-empty string is hashed (`keccak256` of its UTF-8 bytes) into a deterministic
 * `bytes32`, so a human-readable label reproduces the same address wherever it is used.
 *
 * @throws {@link CCTParamsInvalidError} if `salt` is not a 32-byte hex string or a non-empty label
 */
export function normalizeFactorySalt(operation: string, salt: string): string {
  if (isHexString(salt, 32)) return salt
  if (typeof salt === 'string' && salt.length > 0 && !isHexString(salt))
    return keccak256(toUtf8Bytes(salt))
  throw new CCTParamsInvalidError(
    operation,
    'salt',
    `must be a 32-byte 0x-prefixed hex string or a non-empty label, got ${String(salt)}`,
  )
}

/**
 * Applies the factory's per-caller salt rewrite: `keccak256(abi.encodePacked(salt, sender))`. Only
 * `sender` can consume the resulting salt, so the deployed address is bound to it (and cannot be
 * front-run), which is also why sending the built tx from any other account deploys elsewhere.
 */
export function guardFactorySalt(salt: string, sender: string): string {
  return keccak256(solidityPacked(['bytes32', 'address'], [salt, getAddress(sender)]))
}

/** The pool constructor args the factory builds locally, per pool family. */
export type PoolInitArgsInput = {
  token: string
  decimals: number
  rmnProxy: string
  router: string
  /** Required for `LockRelease`, ignored for `BurnMint`. */
  lockBox?: string
}

/**
 * Reproduces the factory's pool constructor-arg encoding. `BurnMint`:
 * `abi.encode(token, decimals, address(0), rmnProxy, router)`; `LockRelease`: the same plus
 * `lockBox`. The `address(0)` is the pool's `advancedPoolHooks`, which the factory always leaves unset.
 */
export function buildPoolInitArgs(family: FactoryPoolFamily, input: PoolInitArgsInput): string {
  const coder = AbiCoder.defaultAbiCoder()
  if (family === 'LockRelease')
    return coder.encode(
      ['address', 'uint8', 'address', 'address', 'address', 'address'],
      [
        input.token,
        input.decimals,
        ZeroAddress,
        input.rmnProxy,
        input.router,
        input.lockBox ?? ZeroAddress,
      ],
    )
  return coder.encode(
    ['address', 'uint8', 'address', 'address', 'address'],
    [input.token, input.decimals, ZeroAddress, input.rmnProxy, input.router],
  )
}

/**
 * Predicts the token address: `getCreate2Address(factory, guardedSalt, keccak256(tokenInitCode))`,
 * where `tokenInitCode` is the full creation code (bytecode + constructor args) the factory deploys as is.
 */
export function predictFactoryToken(
  factory: string,
  guardedSalt: string,
  tokenInitCode: string,
): string {
  return getCreate2Address(getAddress(factory), guardedSalt, keccak256(tokenInitCode))
}

/**
 * Predicts the pool address:
 * `getCreate2Address(factory, guardedSalt, keccak256(tokenPoolInitCode ‖ poolInitArgs))`.
 * `poolInitArgs` is {@link buildPoolInitArgs}; `tokenPoolInitCode` is the pool creation bytecode
 * **without** constructor args (the factory appends them).
 */
export function predictFactoryPool(
  factory: string,
  guardedSalt: string,
  tokenPoolInitCode: string,
  poolInitArgs: string,
): string {
  return getCreate2Address(
    getAddress(factory),
    guardedSalt,
    keccak256(concat([tokenPoolInitCode, poolInitArgs])),
  )
}

/**
 * Predicts the address of a lockbox the factory auto-deploys for a `LockRelease` pool when no
 * `lockBox` is supplied: creation code is `ERC20LockBox` bytecode ‖ `abi.encode(token)`, deployed
 * via CREATE2 from the factory with the same guarded salt.
 */
export function predictFactoryLockBox(factory: string, guardedSalt: string, token: string): string {
  const creationCode = concat([
    LOCKBOX_BYTECODE,
    AbiCoder.defaultAbiCoder().encode(['address'], [getAddress(token)]),
  ])
  return getCreate2Address(getAddress(factory), guardedSalt, keccak256(creationCode))
}

/**
 * Rejects empty init code before it reaches the factory (which reverts `EmptyInitCode`). Guards the
 * caller-supplied token/pool creation code.
 *
 * @throws {@link CCTParamsInvalidError} if `initCode` is missing or `0x`
 */
export function assertNonEmptyInitCode(operation: string, param: string, initCode: string): void {
  if (!initCode || initCode === '0x' || dataLength(initCode) === 0)
    throw new CCTParamsInvalidError(
      operation,
      param,
      'must be non-empty creation code; the factory reverts EmptyInitCode',
    )
}
