import type { ExecutionReport } from '../types.ts'

export type MessageWithAccounts = ExecutionReport['message'] & {
  tokenReceiver: string
  computeUnits?: string | number | bigint
  accountIsWritableBitmap?: string | number | bigint
  accounts?: string[]
}

export function isMessageWithAccounts(
  message: ExecutionReport['message'],
): message is MessageWithAccounts {
  return (
    'tokenReceiver' in message && 'computeUnits' in message && 'accountIsWritableBitmap' in message
  )
}
