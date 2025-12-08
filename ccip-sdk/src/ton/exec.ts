import { beginCell, toNano } from '@ton/core'
import type { ExecutionReport } from '../types.ts'
import type { CCIPMessage_V1_6_TON } from './types.ts'
import { serializeExecutionReport } from './types.ts'
import { TonConnect } from '@tonconnect/sdk'

export async function executeReport(
  tonConnect: TonConnect,
  offRamp: string,
  execReport: ExecutionReport<CCIPMessage_V1_6_TON>,
  opts?: { gasLimit?: number },
): Promise<{ hash: string }> {
  // Serialize the execution report
  const serializedReport = serializeExecutionReport(execReport)

  // Use provided gasLimit as override, or 0 for no override
  const gasOverride = opts?.gasLimit ? BigInt(opts.gasLimit) : 0n

  // Construct the OffRamp_ManuallyExecute message
  const payload = beginCell()
    .storeUint(0xa00785cf, 32) // Opcode for OffRamp_ManuallyExecute
    .storeUint(0, 64) // queryID (default 0)
    .storeRef(serializedReport) // ExecutionReport as reference
    .storeCoins(gasOverride) // gasOverride (optional, 0 = no override)
    .endCell()

  const bocHex = '0x' + payload.toBoc().toString('hex')

  // Send transaction via TonConnect
  const transaction = {
    validUntil: Math.floor(Date.now() / 1000) + 300,
    messages: [
      {
        address: offRamp,
        amount: toNano('0.5').toString(), // Base fee for manual execution
        payload: bocHex,
      },
    ],
  }

  const result = await tonConnect.sendTransaction(transaction)
  return { hash: result.boc }
}
