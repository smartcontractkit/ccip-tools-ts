import { id as keccak256Utf8 } from 'ethers'

/** Normalize a hex CCV InstanceAddress for comparison (lowercase, no 0x). */
export function normalizeCcvHex(value: string): string {
  return (value.startsWith('0x') ? value.slice(2) : value).toLowerCase()
}

/** keccak256 of a RawInstanceAddress.unpack string → InstanceAddress hex. */
export function hashedRawInstanceAddress(raw: string): string {
  return normalizeCcvHex(keccak256Utf8(raw))
}

/** Normalize canton-config `ccvs` to a trimmed, non-empty list. */
export function normalizeCantonCcvList(ccvs?: readonly string[]): string[] {
  if (!ccvs?.length) return []
  return ccvs.map((ccv) => ccv.trim()).filter(Boolean)
}

/** Whether two CCV references denote the same InstanceAddress (hex or raw unpack form). */
export function ccvAddressesMatch(a: string, b: string): boolean {
  const left = a.trim()
  const right = b.trim()
  if (!left || !right) return false
  if (normalizeCcvHex(left) === normalizeCcvHex(right)) return true
  if (left.includes('@') && normalizeCcvHex(right) === hashedRawInstanceAddress(left)) return true
  if (right.includes('@') && normalizeCcvHex(left) === hashedRawInstanceAddress(right)) return true
  return false
}

/** True when any receiver required CCV matches any configured execute CCV. */
export function receiverRequiresConfiguredCcvs(
  requiredCCVs: readonly string[],
  configuredCcvs: readonly string[],
): boolean {
  if (!configuredCcvs.length) return false
  return requiredCCVs.some((required) =>
    configuredCcvs.some((configured) => ccvAddressesMatch(required, configured)),
  )
}

/**
 * Resolve which CCV address to pass to EDS for execute disclosures.
 * Uses the indexer dest address when it already matches a configured CCV;
 * otherwise falls back to the first configured CCV (indexer raw addresses often 404 on EDS).
 */
export function resolveEdsCcvAddress(
  indexerDestAddress: string,
  configuredCcvs: readonly string[],
): string {
  if (!configuredCcvs.length) return indexerDestAddress
  for (const configured of configuredCcvs) {
    if (ccvAddressesMatch(indexerDestAddress, configured)) return configured
  }
  return configuredCcvs[0]!
}

/**
 * CCV addresses for Canton send EDS (`senderRequiredCCVs`).
 * Explicit `extraArgs.ccvRawAddresses` (e.g. CLI `-x ccvRawAddresses=…`) wins;
 * otherwise falls back to canton-config `ccvs`.
 */
export function resolveSenderRequiredCcvs(
  cliCcvRawAddresses: readonly string[] | undefined,
  configuredCcvs: readonly string[],
): string[] {
  if (cliCcvRawAddresses !== undefined) return [...cliCcvRawAddresses]
  return [...configuredCcvs]
}

/**
 * Token pool execute disclosures declare required CCVs (often the Canton CommitteeVerifier).
 * Message verifications carry send-side CCV results (e.g. Sepolia resolver); canton-config
 * `ccvs` overrides which CCV EDS address to use at execute — same as Go ccvOverride.
 * Returns required CCV addresses not satisfied by verifications or configured execute CCVs.
 */
export function missingTokenPoolRequiredCcvs(
  required: readonly string[],
  verificationDestAddresses: readonly string[],
  configuredCcvs: readonly string[],
): string[] {
  const isCovered = (requiredCcv: string): boolean => {
    if (configuredCcvs.some((configured) => ccvAddressesMatch(requiredCcv, configured))) {
      return true
    }
    return verificationDestAddresses.some(
      (dest) =>
        ccvAddressesMatch(requiredCcv, dest) ||
        ccvAddressesMatch(requiredCcv, resolveEdsCcvAddress(dest, configuredCcvs)),
    )
  }
  return required.filter((address) => !isCovered(address))
}
