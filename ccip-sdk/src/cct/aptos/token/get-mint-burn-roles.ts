/**
 * getMintBurnRoles (Aptos) — reads the mint/burn role members on a managed or
 * regulated token.
 *
 * Resolves the token's code object from its Fungible Asset metadata address, then
 * probes `managed_token` view functions first and falls back to `regulated_token`.
 * Read-only — a free `async function`, not a write {@link Operation}.
 *
 * - **managed**: `get_allowed_minters()` / `get_allowed_burners()`
 * - **regulated**: `get_minters()` / `get_burners()` / `get_bridge_minters_or_burners()`
 *
 * @packageDocumentation
 */

import type { AptosChain } from '../../../aptos/index.ts'
import { resolveTokenCodeObject } from '../common.ts'

/** A token's mint/burn role members, with the detected token module type. */
export type MintBurnRolesResult = {
  /** Detected token module type. */
  tokenModule: 'managed' | 'regulated' | 'unknown'
  /** Owner of the code object — can always mint/burn, independent of the allowed lists. */
  owner?: string
  /** Addresses allowed to mint. */
  allowedMinters?: string[]
  /** Addresses allowed to burn. */
  allowedBurners?: string[]
  /** Addresses with the BRIDGE_MINTER_OR_BURNER role (regulated only). */
  bridgeMintersOrBurners?: string[]
}

/**
 * Reads the mint/burn role members for an Aptos managed or regulated token.
 *
 * @param chain - Aptos chain facade
 * @param tokenAddress - Fungible asset metadata address (hex string)
 * @returns Role info including the detected token module type
 */
export async function getMintBurnRoles(
  chain: AptosChain,
  tokenAddress: string,
): Promise<MintBurnRolesResult> {
  const codeObject = await resolveTokenCodeObject(chain, tokenAddress)

  // Resolve the owner of the code object (wallet that deployed the token).
  let owner: string | undefined
  try {
    const [codeObjectOwner] = await chain.provider.view<[string]>({
      payload: {
        function: '0x1::object::owner',
        typeArguments: ['0x1::object::ObjectCore'],
        functionArguments: [codeObject],
      },
    })
    owner = codeObjectOwner
  } catch {
    chain.logger.debug('getMintBurnRoles: failed to resolve code object owner')
  }

  // Try managed_token first.
  try {
    const [minters] = await chain.provider.view<[string[]]>({
      payload: { function: `${codeObject}::managed_token::get_allowed_minters` },
    })
    const [burners] = await chain.provider.view<[string[]]>({
      payload: { function: `${codeObject}::managed_token::get_allowed_burners` },
    })

    chain.logger.debug(
      `getMintBurnRoles: managed token, minters=${minters.length}, burners=${burners.length}`,
    )

    return { tokenModule: 'managed', owner, allowedMinters: minters, allowedBurners: burners }
  } catch {
    // Not a managed token, try regulated.
  }

  // Try regulated_token.
  try {
    const [minters] = await chain.provider.view<[string[]]>({
      payload: { function: `${codeObject}::regulated_token::get_minters` },
    })
    const [burners] = await chain.provider.view<[string[]]>({
      payload: { function: `${codeObject}::regulated_token::get_burners` },
    })
    const [bridgeMintersOrBurners] = await chain.provider.view<[string[]]>({
      payload: { function: `${codeObject}::regulated_token::get_bridge_minters_or_burners` },
    })

    chain.logger.debug(
      `getMintBurnRoles: regulated token, minters=${minters.length}, burners=${burners.length}, bridge=${bridgeMintersOrBurners.length}`,
    )

    return {
      tokenModule: 'regulated',
      owner,
      allowedMinters: minters,
      allowedBurners: burners,
      bridgeMintersOrBurners,
    }
  } catch {
    // Not a regulated token either.
  }

  chain.logger.debug('getMintBurnRoles: unknown token module type')

  return { tokenModule: 'unknown', owner }
}
