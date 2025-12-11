import { beginCell } from '@ton/core'

import type { ExecutionReport } from '../types.ts'
import {
  type CCIPMessage_V1_6_TON,
  MANUALLY_EXECUTE_OPCODE,
  serializeExecutionReport,
} from './types.ts'

/**
 * Generates an unsigned execute report payload for the TON OffRamp contract.
 *
 * @param offRamp - OffRamp contract address.
 * @param execReport - Execution report containing the CCIP message and proofs.
 * @param opts - Optional execution options. Gas limit override for execution (0 = no override).
 * @returns Object with target address, value, and payload cell.
 */
export function generateUnsignedExecuteReport(
  offRamp: string,
  execReport: ExecutionReport<CCIPMessage_V1_6_TON>,
  opts?: { gasLimit?: number },
): {
  to: string
  body: ReturnType<typeof beginCell>['endCell'] extends () => infer R ? R : never
} {
  // Serialize the execution report
  const serializedReport = serializeExecutionReport(execReport)

  // Use provided gasLimit as override, or 0 for no override
  const gasOverride = opts?.gasLimit ? BigInt(opts.gasLimit) : 0n

  // Construct the OffRamp_ManuallyExecute message
  const payload = beginCell()
    .storeUint(MANUALLY_EXECUTE_OPCODE, 32) // Opcode for OffRamp_ManuallyExecute
    .storeUint(0, 64) // queryID (default 0)
    .storeRef(serializedReport) // ExecutionReport as reference
    .storeCoins(gasOverride) // gasOverride (optional, 0 = no override)
    .endCell()

  return {
    to: offRamp,
    body: payload,
  }
}
