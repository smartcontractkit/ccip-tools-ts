/**
 * EVM token-admin-registry contract layer for CCT — the two contracts the admin ops talk to:
 *
 * - **`TokenAdminRegistry`** ({@link getTokenAdminRegistryInterface}) — holds each token's
 *   administrator/pool entry. Every admin write is gated on who currently holds those roles, so
 *   the ops also share one spelling of that read ({@link readTokenAdminRegistryConfig},
 *   {@link isRegistryModule}) rather than each deriving a handle.
 * - **`RegistryModuleOwnerCustom`** ({@link getRegistryModuleOwnerCustomInterface}) — the
 *   self-service module `registerAdmin` calls to propose an administrator without the registry
 *   owner's help.
 *
 * Neither is deployed by this SDK, so unlike `token/contracts.ts` and `token-pool/contracts.ts`
 * there are no bytecode or {@link DeployArtifact} entries here — only interfaces and reads.
 * Mirrors `lockbox/contracts.ts` in shape, `token/contracts.ts` in the version-keyed accessors.
 *
 * @packageDocumentation
 */

import { Interface, getAddress } from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import type { EVMChain } from '../../../evm/index.ts'
import { resultToObject } from '../../../evm/types.ts'
import { CCTContractTypeInvalidError, CCTContractVersionUnsupportedError } from '../../errors.ts'
import REGISTRY_MODULE_OWNER_CUSTOM_V1_5_0_ABI from '../artifacts/abi/V1_5_0/registry-module-owner-custom.ts'
import TOKEN_ADMIN_REGISTRY_V1_5_0_ABI from '../artifacts/abi/V1_5_0/token-admin-registry.ts'
import REGISTRY_MODULE_OWNER_CUSTOM_V1_6_0_ABI from '../artifacts/abi/V1_6_0/registry-module-owner-custom.ts'
import { getTypedContract } from '../query.ts'

/**
 * Known `TokenAdminRegistry` versions. Only `1.5.0` is vendored: the admin surface this SDK uses
 * (`getTokenConfig`, `isRegistryModule`, `proposeAdministrator`, `transferAdminRole`,
 * `acceptAdminRole`, `setPool`) is byte-identical from v1.5 through v2.0, so one ABI serves them
 * all and no version dispatch is needed.
 */
export const TokenAdminRegistryVersion = {
  V1_5_0: '1.5.0',
} as const

/** A known `TokenAdminRegistry` version. */
export type TokenAdminRegistryVersion =
  (typeof TokenAdminRegistryVersion)[keyof typeof TokenAdminRegistryVersion]

/**
 * Known `RegistryModuleOwnerCustom` versions, low to high. `1.6.0` added
 * `registerAccessControlDefaultAdmin`; the two share `registerAdminViaOwner` and
 * `registerAdminViaGetCCIPAdmin`.
 */
export const RegistryModuleOwnerCustomVersion = {
  V1_5_0: '1.5.0',
  V1_6_0: '1.6.0',
} as const

/** A known `RegistryModuleOwnerCustom` version. */
export type RegistryModuleOwnerCustomVersion =
  (typeof RegistryModuleOwnerCustomVersion)[keyof typeof RegistryModuleOwnerCustomVersion]

/**
 * Cached `TokenAdminRegistry` {@link Interface}s per {@link TokenAdminRegistryVersion}, built once
 * from the vendored ABI (no per-call `new Interface`). Mirrors `TOKEN_INTERFACES` in
 * `token/contracts.ts`.
 */
export const TOKEN_ADMIN_REGISTRY_INTERFACES: Record<TokenAdminRegistryVersion, Interface> = {
  [TokenAdminRegistryVersion.V1_5_0]: new Interface(TOKEN_ADMIN_REGISTRY_V1_5_0_ABI),
}

/**
 * Cached `RegistryModuleOwnerCustom` {@link Interface}s per
 * {@link RegistryModuleOwnerCustomVersion}, each built from its own vendored ABI. The shared
 * functions encode identically at both versions, so the split is not about calldata — it is about
 * *which functions exist*: only `1.6.0` knows `registerAccessControlDefaultAdmin`, so encoding it
 * against the `1.5.0` interface throws instead of producing calldata a v1.5.0 module would reject.
 */
export const REGISTRY_MODULE_OWNER_CUSTOM_INTERFACES: Record<
  RegistryModuleOwnerCustomVersion,
  Interface
> = {
  [RegistryModuleOwnerCustomVersion.V1_5_0]: new Interface(REGISTRY_MODULE_OWNER_CUSTOM_V1_5_0_ABI),
  [RegistryModuleOwnerCustomVersion.V1_6_0]: new Interface(REGISTRY_MODULE_OWNER_CUSTOM_V1_6_0_ABI),
}

/** Type guard for {@link RegistryModuleOwnerCustomVersion}. */
export function isRegistryModuleOwnerCustomVersion(
  v: string,
): v is RegistryModuleOwnerCustomVersion {
  return Object.values(RegistryModuleOwnerCustomVersion).some((known) => known === v)
}

/** `typeAndVersion` prefix every `RegistryModuleOwnerCustom` reports. */
const REGISTRY_MODULE_OWNER_CUSTOM = 'RegistryModuleOwnerCustom'

/**
 * Resolves a deployed module's version from its `typeAndVersion`, narrowed to a known
 * {@link RegistryModuleOwnerCustomVersion}. Mirrors `resolveTokenPool` in
 * `token-pool/contracts.ts`.
 * @throws {@link CCTContractTypeInvalidError} if `address` is not a `RegistryModuleOwnerCustom`
 * @throws {@link CCTContractVersionUnsupportedError} if it reports an unknown version
 */
export async function resolveRegistryModuleOwnerCustom(
  chain: EVMChain,
  address: string,
): Promise<RegistryModuleOwnerCustomVersion> {
  const [contractType, version] = await chain.typeAndVersion(address)
  if (contractType !== REGISTRY_MODULE_OWNER_CUSTOM)
    throw new CCTContractTypeInvalidError(address, REGISTRY_MODULE_OWNER_CUSTOM, contractType)
  if (!isRegistryModuleOwnerCustomVersion(version))
    throw new CCTContractVersionUnsupportedError(contractType, version, { context: { address } })
  return version
}

/** Returns the cached `TokenAdminRegistry` {@link Interface} for `version`. */
export function getTokenAdminRegistryInterface(
  version: TokenAdminRegistryVersion = TokenAdminRegistryVersion.V1_5_0,
): Interface {
  return TOKEN_ADMIN_REGISTRY_INTERFACES[version]
}

/** Returns the cached `RegistryModuleOwnerCustom` {@link Interface} for `version`. */
export function getRegistryModuleOwnerCustomInterface(
  version: RegistryModuleOwnerCustomVersion = RegistryModuleOwnerCustomVersion.V1_6_0,
): Interface {
  return REGISTRY_MODULE_OWNER_CUSTOM_INTERFACES[version]
}

/**
 * Call-typed TokenAdminRegistry handle bound to `registry` on `chain`'s provider, so the ops don't
 * each re-derive one. Goes through {@link getTypedContract}, the CCT layer's single
 * ethers → `ethers-abitype` cast.
 */
function tokenAdminRegistry(
  chain: EVMChain,
  registry: string,
): TypedContract<typeof TOKEN_ADMIN_REGISTRY_V1_5_0_ABI> {
  return getTypedContract(chain, registry, TOKEN_ADMIN_REGISTRY_V1_5_0_ABI)
}

/**
 * A token's entry in the TokenAdminRegistry, checksummed, with zero addresses preserved rather
 * than omitted — callers distinguish the registry's states by comparing against `ZeroAddress`:
 *
 * | `administrator` | `pendingAdministrator` | state                                 |
 * | --------------- | ---------------------- | ------------------------------------- |
 * | zero            | zero                   | not registered                        |
 * | zero            | set                    | registered, awaiting `acceptAdmin`    |
 * | set             | zero                   | active admin                          |
 * | set             | set                    | active admin, `transferAdmin` pending |
 */
export type TokenAdminRegistryConfig = {
  administrator: string
  pendingAdministrator: string
  tokenPool: string
}

/**
 * Reads a token's TAR entry through the vendored ABI.
 *
 * @remarks Deliberately **not** {@link EVMChain.getRegistryTokenConfig}: that helper throws
 * `CCIPTokenNotConfiguredError` whenever `administrator` is the zero address, which is precisely
 * the registered-but-not-yet-accepted state these ops must be able to observe and report. Reading
 * `getTokenConfig` directly keeps every row of the table above reachable.
 */
export async function readTokenAdminRegistryConfig(
  chain: EVMChain,
  registry: string,
  token: string,
): Promise<TokenAdminRegistryConfig> {
  const config = resultToObject(await tokenAdminRegistry(chain, registry).getTokenConfig(token))
  return {
    administrator: getAddress(config.administrator),
    pendingAdministrator: getAddress(config.pendingAdministrator),
    tokenPool: getAddress(config.tokenPool),
  }
}

/**
 * Whether the TAR recognises `module` as a registry module — the only on-chain question it can
 * answer about one, since it exposes no way to enumerate them.
 */
export function isRegistryModule(
  chain: EVMChain,
  registry: string,
  module: string,
): Promise<boolean> {
  return tokenAdminRegistry(chain, registry).isRegistryModule(module)
}
