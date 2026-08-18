/**
 * getTokenAdminRegistry — read the TAR state for an instrument: admin,
 * pendingAdmin, registered pool, `isCCIPManaged`, and the `TokenConfig` CID.
 *
 * Implements the `CantonChain.getTokenAdminRegistryFor` stub by exercising the
 * TAR read choices (`Get`, `GetTokenConfigByCid`, `IsAdministrator`) or by
 * reading the ACS snapshot directly.
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import type { CantonInstrumentId } from '../../../../canton/types.ts'
import { CantonQuery } from '../../query.ts'
import { parseInstrumentId } from '../../validate.ts'

/** Parameters for `getTokenAdminRegistry`. */
export interface GetTokenAdminRegistryParams {
  /** Instrument to look up (`{ admin, id }` or `"admin::1220…::id"`). */
  instrumentId: { admin: string; id: string } | string
  /** TAR contract ID. When omitted, resolved via ACS. */
  tarCid?: string
}

/** Result of `getTokenAdminRegistry`: the TAR view of an instrument. */
export interface GetTokenAdminRegistryResult {
  /** Current admin party for the instrument. */
  admin?: string
  /** Pending admin party (set by `registerAdmin`/`transferAdmin`, before `acceptAdmin`). */
  pendingAdmin?: string
  /** Registered pool (`{ poolOwner, poolInstanceId }`), if `setPool` has been called. */
  tokenPool?: { poolOwner: string; poolInstanceId: string }
  /** Whether the instrument is CCIP-managed (admin is the CCIP owner). */
  isCCIPManaged: boolean
  /** `TokenConfig` contract ID for the instrument. */
  tokenConfigCid: string
}

/** Read the TAR state for an instrument. */
export class GetTokenAdminRegistry extends CantonQuery<
  GetTokenAdminRegistryParams,
  GetTokenAdminRegistryResult,
  { instrumentId: CantonInstrumentId; tarCid?: string }
> {
  readonly name = 'getTokenAdminRegistry'

  /** Parses the instrument ID into `{ admin, id }`. */
  protected prepare(p: GetTokenAdminRegistryParams): {
    instrumentId: CantonInstrumentId
    tarCid?: string
  } {
    return {
      instrumentId: parseInstrumentId(this.name, 'instrumentId', p.instrumentId),
      tarCid: p.tarCid,
    }
  }

  /**
   * Reads the TAR state. TODO(cct-canton): exercise the TAR read choices
   * (`Get` / `GetTokenConfigByCid` / `IsAdministrator`) via the JSON Ledger API,
   * or read the ACS snapshot via `chain.acsDisclosureProvider`. Until the read
   * path is wired, this throws a not-implemented error so callers fail fast
   * rather than silently getting empty state.
   */
  protected async read(
    chain: CantonChain,
    p: { instrumentId: CantonInstrumentId; tarCid?: string },
  ): Promise<GetTokenAdminRegistryResult> {
    void chain
    void p
    throw new Error(
      'getTokenAdminRegistry: TAR read choices (Get / GetTokenConfigByCid / IsAdministrator) ' +
        'are not yet wired — implement as part of the CantonChain stub resolution follow-up',
    )
  }
}
