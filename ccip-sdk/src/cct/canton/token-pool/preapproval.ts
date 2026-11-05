/**
 * Resolve a pool owner's registry `TransferPreapproval` for an instrument —
 * used to wire the pool's `transfer-preapproval` receive-context entry at
 * deploy time so inbound locks settle directly for any sender.
 *
 * @packageDocumentation
 */

import { type CantonChain, decodeDamlRecord, extractFieldValue } from '../../../canton/index.ts'
import { TRANSFER_PREAPPROVAL_TEMPLATE_ID } from '../constants.ts'

// Constants live in ../constants.ts (single home for Canton constants).
export { TRANSFER_PREAPPROVAL_CONTEXT_KEY, TRANSFER_PREAPPROVAL_TEMPLATE_ID } from '../constants.ts'

/**
 * The CID of `receiver`'s active preapproval covering `instrumentId`
 * (an empty allowance list covers all instruments of its admin), if any.
 */
export async function resolveTransferPreapprovalCid(
  chain: CantonChain,
  receiver: string,
  instrumentId: { admin: string; id: string },
): Promise<string | undefined> {
  // Why the symbolic filter: the wallet gateway's ACS proxy accepts ONLY
  // package-name template filters (concrete package-ID lookups are rejected),
  // and the name form matches contracts across all vetted versions of the app
  // package — which is exactly what a preapproval created under an older app
  // version needs.
  const contracts = await chain.findActiveContractsByTemplate(
    TRANSFER_PREAPPROVAL_TEMPLATE_ID,
    [receiver],
    (createArgument) => {
      const fields = decodeDamlRecord(createArgument)
      if (extractFieldValue(fields['receiver']) !== receiver) return false
      if (extractFieldValue(fields['instrumentAdmin']) !== instrumentId.admin) return false
      const allowances = fields['instrumentAllowances']
      if (!Array.isArray(allowances) || allowances.length === 0) return true // empty = all instruments
      return allowances.some(
        (a) => extractFieldValue(decodeDamlRecord(a)['id']) === instrumentId.id,
      )
    },
  )
  return contracts[0]?.contractId
}
