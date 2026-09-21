/**
 * Shared helpers for TAR (Token Admin Registry) CCT operations: exercise-command
 * construction and TAR / TokenConfig contract resolution.
 *
 * @packageDocumentation
 */

import type { CantonActiveContract, CantonChain } from '../../../canton/index.ts'
import { hashedUtf8Hex } from '../../../shared/codec.ts'
import { CCTParamsInvalidError } from '../../errors.ts'

/** TAR template ID (`#<package>:<Module>:<Entity>`). */
export const TAR_TEMPLATE_ID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry'

/** TokenConfig template ID (the per-instrument config contract the TAR manages). */
export const TOKEN_CONFIG_TEMPLATE_ID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenConfig'

/**
 * Derive a TokenConfig's raw instance address (`"instanceId@registryOwner"`)
 * offline from the instrument ID. Mirrors the on-ledger derivation
 * `tokenConfigInstanceId = keccak256(utf8("<instrumentId.id>@<instrumentId.admin>"))`
 * (`CCIP.CodecV2.MessageCodecV1.encodeInstrumentId`) — the TokenConfig's
 * signatory is the registry owner (ccipOwner), so the raw instance address is
 * `<instanceId>@<ccipOwner>`.
 */
export function deriveTokenConfigInstanceAddress(
  instrumentId: { admin: string; id: string },
  ccipOwner: string,
): string {
  const instanceId = hashedUtf8Hex(`${instrumentId.id}@${instrumentId.admin}`)
  return `${instanceId}@${ccipOwner}`
}

/** A contract reference: a CID plus its disclosure blob. */
export interface TarContractRef {
  /** Contract ID. */
  contractId: string
  /** `createdEventBlob` from the ACS (required for prepared/signed submission). */
  createdEventBlob: string
  /** Synchronizer the contract was read from. */
  synchronizerId: string
  /**
   * Concrete package-ID template ID (`<pkg-id>:<Module>:<Entity>`) as returned
   * by the EDS / ACS. Preferred over the symbolic `#<pkg-name>:…` form —
   * the participant's interactive-submission path rejects package-name
   * references (`#…`) in exercise commands.
   */
  templateId?: string
}

/** Project a resolved {@link CantonActiveContract} into a {@link TarContractRef}. */
export function toContractRef(contract: CantonActiveContract): TarContractRef {
  return {
    contractId: contract.contractId,
    createdEventBlob: contract.createdEventBlob,
    synchronizerId: contract.synchronizerId,
    templateId: contract.templateId,
  }
}

/** A resolved TAR contract: the ref for disclosure plus its signatories (ccipOwner). */
export interface ResolvedTar {
  /** TAR contract reference (CID + disclosure blob + synchronizer). */
  tarContract: TarContractRef
  /** TAR signatories — `[0]` is the ccipOwner (needed to derive TokenConfig addresses). */
  ccipOwner: string | undefined
}

/**
 * Resolve the TAR for a TAR-admin op, WITHOUT requiring the caller's
 * participant to host ccipOwner.
 *
 * The TAR's only stakeholder is its signatory (ccipOwner) — no observers — so
 * an issuer's participant cannot ACS-read it. Resolution order:
 *
 * 1. **Disclosure service** (`EdsDisclosureProvider.fetchContractDisclosure`)
 *    — the issuer-friendly path: the blob comes from a public endpoint, no
 *    ccipOwner visibility or readAs needed. This is the default; it makes
 *    token-admin ops self-sufficient for issuers.
 * 2. **ACS fallback** — for operators whose participant DOES host ccipOwner
 *    (or when no disclosure service is configured): query with
 *    `[sender, chain.ccipParty]` (JWT needs readAs over both).
 */
export async function resolveTar(
  chain: CantonChain,
  sender: string,
  tarInstanceAddress: string,
): Promise<ResolvedTar> {
  const disclosed = await chain.edsDisclosureProvider
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- test mocks omit this provider
    ?.fetchContractDisclosure(TAR_TEMPLATE_ID, tarInstanceAddress)
    .catch(() => null)
  if (disclosed) {
    const ownerFromRaw = tarInstanceAddress.includes('@')
      ? tarInstanceAddress.slice(tarInstanceAddress.indexOf('@') + 1)
      : undefined
    return {
      tarContract: {
        contractId: disclosed.contractId,
        createdEventBlob: disclosed.createdEventBlob,
        synchronizerId: disclosed.synchronizerId,
        // EDS returns the concrete package-ID template — preferred over the
        // symbolic form, which the interactive-submission path rejects.
        templateId: disclosed.templateId,
      },
      ccipOwner: disclosed.signatories?.[0] ?? ownerFromRaw,
    }
  }

  const contract = await chain.findActiveContractByInstanceAddress(
    TAR_TEMPLATE_ID,
    tarInstanceAddress,
    [...new Set([sender, chain.ccipParty])],
  )
  if (!contract) {
    throw new CCTParamsInvalidError(
      'resolveTar',
      'tarInstanceAddress',
      `TokenAdminRegistry ${tarInstanceAddress} not found via disclosure service and not visible to ${sender} or ${chain.ccipParty}`,
    )
  }
  return { tarContract: toContractRef(contract), ccipOwner: contract.signatories[0] }
}
