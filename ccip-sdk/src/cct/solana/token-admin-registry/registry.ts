import * as V1_6_2 from './v1_6_2/index.ts'
import { CCIPVersionUnsupportedError } from '../../../errors/index.ts'
import { SolanaCCTVersion } from '../versions.ts'

/** TokenAdminRegistry implementations keyed by exact Solana CCT program version. */
export const TOKEN_ADMIN_REGISTRY_IMPLEMENTATIONS = {
  [SolanaCCTVersion.V1_6_2]: V1_6_2,
} as const

/** Supported TokenAdminRegistry implementation version. */
export type TokenAdminRegistryVersion = keyof typeof TOKEN_ADMIN_REGISTRY_IMPLEMENTATIONS

function isSupportedVersion(version: unknown): version is TokenAdminRegistryVersion {
  return typeof version === 'string' && version in TOKEN_ADMIN_REGISTRY_IMPLEMENTATIONS
}

/** Returns the TokenAdminRegistry implementation for a version. */
export function getTokenAdminRegistry(version: unknown) {
  if (!isSupportedVersion(version)) throw new CCIPVersionUnsupportedError(String(version))
  return TOKEN_ADMIN_REGISTRY_IMPLEMENTATIONS[version]
}
