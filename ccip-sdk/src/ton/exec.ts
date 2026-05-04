import { type Cell, beginCell } from '@ton/core'

import type { ExecutionInput } from '../types.ts'
import { MANUALLY_EXECUTE_OPCODE, serializeExecutionReport } from './types.ts'
import type { CCIPMessage_V1_6_EVM } from '../evm/messages.ts'

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
  execReport: ExecutionInput<CCIPMessage_V1_6_EVM>,
  opts?: { gasLimit?: number },
): { to: string; body: Cell } {
  // Serialize the execution report
  const serializedReport = serializeExecutionReport(execReport)

  // Use provided gasLimit as override, or 0 for no override
  const gasOverride = opts?.gasLimit ? BigInt(opts.gasLimit) : 0n

  // Construct the OffRamp_ManuallyExecute message
  const payload = beginCell()
    .storeUint(MANUALLY_EXECUTE_OPCODE, 32) // Opcode for OffRamp_ManuallyExecute
    .storeUint(0, 64) // queryID (default 0)
    .storeBuilder(serializedReport) // as builder!
    .storeCoins(gasOverride) // gasOverride (optional, 0 = no override)
    .endCell()

  return {
    to: offRamp,
    body: payload,
  }
}
