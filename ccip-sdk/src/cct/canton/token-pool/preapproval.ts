/**
 * Resolve a pool owner's registry `TransferPreapproval` for an instrument —
 * used to wire the pool's `transfer-preapproval` receive-context entry at
 * deploy time so inbound locks settle directly for any sender.
 *
 * @packageDocumentation
 */

import { type CantonChain, decodeDamlRecord, extractFieldValue } from '../../../canton/index.ts'

/** Registry-app `TransferPreapproval` template (package-name form; resolves per network). */
export const TRANSFER_PREAPPROVAL_TEMPLATE_ID =
  '#utility-registry-app-v0:Utility.Registry.App.V0.Model.TransferPreapproval'

/** Receive-context key the pool merges into transfer extraArgs for direct settlement. */
export const TRANSFER_PREAPPROVAL_CONTEXT_KEY = 'transfer-preapproval'

/**
 * The CID of `receiver`'s active preapproval covering `instrumentId`
 * (an empty allowance list covers all instruments of its admin), if any.
 */
export async function resolveTransferPreapprovalCid(
  chain: CantonChain,
  receiver: string,
  instrumentId: { admin: string; id: string },
): Promise<string | undefined> {
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
