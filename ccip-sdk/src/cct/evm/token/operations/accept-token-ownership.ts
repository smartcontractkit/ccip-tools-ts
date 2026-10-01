/**
 * acceptTokenOwnership — deprecated alias of {@link AcceptDefaultAdminTransfer}, on either token
 * version. Errors keep this op's name.
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
 * Completes a token-admin handoff.
 * @deprecated Use {@link AcceptDefaultAdminTransfer} instead.
 */
export class AcceptTokenOwnership extends AcceptDefaultAdminTransfer {
  override readonly name = 'acceptTokenOwnership'
}
