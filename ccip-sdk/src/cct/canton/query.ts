/**
 * Canton {@link Query} base — the read-only counterpart of
 * {@link CantonOperation}. Subclasses supply {@link prepare} and {@link read};
 * no wallet, no submit.
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../canton/index.ts'
import { Query } from '../query.ts'

/**
 * Canton CCT read base. Subclasses validate/normalize in {@link prepare} and
 * query the ledger (ACS / TAR read choices) in {@link read}.
 *
 * @remarks Canton reads query the ACS via `chain.acsDisclosureProvider` or
 * exercise read-only TAR choices (e.g. `Get`, `GetTokenConfigByCid`,
 * `IsAdministrator`, `GetRequiredCCVs`) through the JSON Ledger API. No wallet
 * is required.
 */
export abstract class CantonQuery<
  Params extends object,
  Result,
  Parsed = Params,
> extends Query<CantonChain, Params, Result, Parsed> {}
