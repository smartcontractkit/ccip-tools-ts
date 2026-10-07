/**
 * acceptTokenOwnership — deprecated alias of {@link AcceptDefaultAdminTransfer}. Errors keep this
 * op's name.
 *
 * @packageDocumentation
 */

import {
  type AcceptDefaultAdminTransferParams,
  AcceptDefaultAdminTransfer,
} from './accept-default-admin-transfer.ts'

/**
 * Parameters for {@link AcceptTokenOwnership}.
 * @deprecated Use `AcceptDefaultAdminTransferParams` instead.
 */
export type AcceptTokenOwnershipParams = AcceptDefaultAdminTransferParams

/**
 * Completes a pending token-admin transfer.
 * @deprecated Use {@link AcceptDefaultAdminTransfer} instead.
 */
export class AcceptTokenOwnership extends AcceptDefaultAdminTransfer {
  override readonly name = 'acceptTokenOwnership'
}
