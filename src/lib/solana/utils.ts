import type { SourceTokenData } from '../extra-args.ts'
import type { EVM2AnyMessageSent, ExecutionReport } from '../types.ts'
import { Connection, VersionedTransaction } from '@solana/web3.js'

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

function hexToBase64(hex: string): string {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex
  const buffer = Buffer.from(cleanHex, 'hex')
  return buffer.toString('base64')
}

// Execution reports can be generated in different ways, depending on whether the message
// was parsed from EVM or from solana logs. This function ensures that they both result
// in the same encoding (some values are b64 when parsed from a SVM context and hex from EVM.)
export function normalizeExecutionReportForSolana(report: ExecutionReport): ExecutionReport {
  const isHex = (str: string): boolean => {
    return /^0x[0-9a-fA-F]*$/.test(str)
  }

  return {
    ...report,
    message: {
      ...report.message,
      data: isHex(report.message.data) ? hexToBase64(report.message.data) : report.message.data,
      tokenAmounts: report.message.tokenAmounts.map((amount) =>
        normalizeTokenAmountForSolana(amount),
      ),
    },
  }
}

type TokenAmount = EVM2AnyMessageSent['tokenAmounts'][number] & SourceTokenData

export function normalizeTokenAmountForSolana(data: TokenAmount): TokenAmount {
  const isHex = (str: string): boolean => /^0x[0-9a-fA-F]*$/.test(str)

  return {
    ...data,
    extraData: isHex(data.extraData) ? hexToBase64(data.extraData) : data.extraData,
    destExecData: isHex(data.destExecData) ? hexToBase64(data.destExecData) : data.destExecData,
  }
}

export async function waitForFinalization(
  connection: Connection,
  signature: string,
  intervalMs = 500,
  maxAttempts = 1000,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await connection.getSignatureStatuses([signature])
    const info = status.value[0]

    if (info?.confirmationStatus === 'finalized') {
      return
    }
    await new Promise((res) => setTimeout(res, intervalMs))
  }

  throw new Error(`Transaction ${signature} not finalized after timeout`)
}

export async function retrySendTransaction(
  connection: Connection,
  transaction: VersionedTransaction,
  maxRetries = 5,
): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const base64 = Buffer.from(transaction.serialize()).toString('base64')
      console.log(`Sending transaction, attempt ${attempt + 1}. Serialized: ${base64}`)
      const sig = await connection.sendTransaction(transaction)
      console.log(`Sent transaction ${sig}`)
      return sig
    } catch (err) {
      lastError = err
      console.error(`Send attempt ${attempt + 1} failed: ${err}`)
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1))) // Exponential backoff
    }
  }

  throw new Error(`Failed to send transaction after ${maxRetries} attempts: ${lastError}`)
}
