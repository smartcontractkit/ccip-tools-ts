/** Solana CCT program implementation versions. */
export const SolanaCCTVersion = {
  V1_6_2: '1.6.2',
} as const

/** Supported Solana CCT program version value. */
export type SolanaCCTVersionValue = (typeof SolanaCCTVersion)[keyof typeof SolanaCCTVersion]

/** Default Solana CCT program version. */
export const SOLANA_CCT_VERSION = SolanaCCTVersion.V1_6_2

/** Optional version hint accepted by Solana CCT operations. */
export type SolanaCCTVersionHint = {
  version?: SolanaCCTVersionValue
}

/** Resolves a Solana CCT version hint to the default when omitted. */
export function resolveSolanaCCTVersion(
  version: unknown = SOLANA_CCT_VERSION,
): SolanaCCTVersionValue {
  return version as SolanaCCTVersionValue
}
