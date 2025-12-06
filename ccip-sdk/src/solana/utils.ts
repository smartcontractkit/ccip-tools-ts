import { eventDiscriminator } from '@coral-xyz/anchor'
import {
  type AddressLookupTableAccount,
  type Connection,
  type Signer,
  type SimulateTransactionConfig,
  type Transaction,
  type TransactionInstruction,
  ComputeBudgetProgram,
  PublicKey,
  SendTransactionError,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { type BytesLike, dataLength, dataSlice, hexlify } from 'ethers'

import type { Log_ } from '../types.ts'
import { getDataBytes, sleep } from '../utils.ts'
import type { UnsignedTx, Wallet } from './types.ts'

export function hexDiscriminator(eventName: string): string {
  return hexlify(eventDiscriminator(eventName))
}

export function bytesToBuffer(bytes: BytesLike): Buffer {
  return Buffer.from(getDataBytes(bytes).buffer)
}

export async function waitForFinalization(
  connection: Connection,
  signature: string,
  intervalMs = 500,
  maxAttempts = 500,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await connection.getSignatureStatuses([signature])
    const info = status.value[0]

    if (info?.confirmationStatus === 'finalized') {
      return
    }
    await sleep(intervalMs)
  }

  throw new Error(`Transaction ${signature} not finalized after timeout`)
}

export function camelToSnakeCase(str: string): string {
  return str
    .replace(/([A-Z]+)([A-Z][a-z]|$)/g, (_, p1: string, p2: string) => {
      if (p2) {
        return `_${p1.slice(0, -1).toLowerCase()}_${p2.toLowerCase()}`
      }
      return `_${p1.toLowerCase()}`
    })
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/^_/, '')
}

type ParsedLog = Pick<Log_, 'topics' | 'index' | 'address' | 'data'> & {
  data: string
  level: number
}

/**
 * Utility function to parse Solana logs with proper address and topic extraction.
 *
 * Solana logs are structured as a stack-based execution trace:
 * - "Program <address> invoke [<depth>]" - Program call starts
 * - "Program log: <data>" - Program emitted a log message
 * - "Program data: <base64>" - Program emitted structured data (Anchor events)
 * - "Program <address> success/failed" - Program call ends
 *
 * This function:
 * 1. Tracks the program call stack to determine which program emitted each log
 * 2. Extracts the first 8 bytes from base64 "Program data:" logs as topics (event discriminants)
 * 3. Converts logs to EVM-compatible Log_ format for CCIP compatibility
 * 4. Returns ALL logs from the transaction - filtering should be done by the caller
 *
 * @param logs - Array of logMessages from Solana transaction
 * @returns Array of parsed log objects from all programs in the transaction
 */
export function parseSolanaLogs(logs: readonly string[]): ParsedLog[] {
  const results: ReturnType<typeof parseSolanaLogs> = []
  const programStack: string[] = []

  for (const [i, log] of logs.entries()) {
    // Track program calls and returns to maintain the address stack
    let match
    if ((match = log.match(/^Program (\w+) invoke\b/))) {
      programStack.push(match[1])
    } else if ((match = log.match(/^Program (\w+) (success|failed)\b/))) {
      // Pop from stack when program returns
      programStack.pop()
    } else if ((match = log.match(/^Program (log|data): /))) {
      // Extract the actual log data
      const logData = log.slice(match[0].length)
      const currentProgram = programStack[programStack.length - 1]
      let topics: string[] = []

      if (log.startsWith('Program data: ')) {
        try {
          // Try to decode base64 and extract first 8 bytes as topic/discriminant
          const buffer = getDataBytes(logData)
          if (dataLength(buffer) >= 8) {
            topics = [dataSlice(buffer, 0, 8)]
          }
        } catch {
          // If base64 decoding fails, leave topics empty
        }
      }
      // For regular log messages, use the current program on stack
      results.push({
        topics,
        index: i,
        address: currentProgram,
        data: logData,
        level: programStack.length,
      })
    }
  }

  return results
}

export function getErrorFromLogs(
  logs_: readonly string[] | readonly Pick<Log_, 'address' | 'index' | 'data' | 'topics'>[] | null,
): { program: string; [k: string]: string } | undefined {
  if (!logs_?.length) return
  let logs
  if (logs_.every((l) => typeof l === 'string')) logs = parseSolanaLogs(logs_)
  else logs = logs_

  const lastLog = logs[logs.length - 1]
  // collect all logs from the last program execution (the one which failed)
  const lastProgramLogs = logs
    .reduceRight(
      (acc, l) =>
        // if acc is empty (i.e. on last log), or it is emitted by the same program and not a Program data:
        !acc.length || (l.address === acc[0].address && !l.topics?.length) ? [l, ...acc] : acc,
      [] as Pick<Log_, 'address' | 'index' | 'data'>[],
    )
    .map(({ data }) => data as string)
    .reduceRight(
      (acc, l) =>
        l.endsWith(':') && acc.length
          ? [`${l} ${acc[0]}`, ...acc.slice(1)]
          : l.split(': ').length > 1 && l.split('. ').length > 1
            ? [...l.replace(/\.$/, '').split('. '), ...acc]
            : [l, ...acc],
      [] as string[],
    ) // cosmetic: join lines ending in ':' with next
    .map((l) => {
      try {
        // convert number[]s (common in solana logs) into slightly more readable 0x-bytearrays
        return l.replace(/\[(\d{1,3}, ){3,}\d+\]/g, (m) =>
          hexlify(
            new Uint8Array(
              m
                .substring(1, m.length - 1)
                .split(', ')
                .map((x) => +x),
            ),
          ),
        )
      } catch (_) {
        return l
      }
    })
  if (lastProgramLogs.every((l) => l.indexOf(': ') >= 0)) {
    return {
      program: lastLog.address,
      ...Object.fromEntries(
        lastProgramLogs.map((l) => [
          l.substring(0, l.indexOf(': ')),
          l.substring(l.indexOf(': ') + 2),
        ]),
      ),
    }
  } else {
    return {
      program: lastLog.address,
      error: lastProgramLogs.join('\n'),
    }
  }
}

export async function simulateTransaction({
  connection,
  payerKey,
  computeUnitsOverride,
  ...rest
}: {
  connection: Connection
  payerKey: PublicKey
  computeUnitsOverride?: number
  addressLookupTableAccounts?: AddressLookupTableAccount[]
} & ({ instructions: TransactionInstruction[] } | { tx: Transaction | VersionedTransaction })) {
  // Add max compute units for simulation
  const maxComputeUnits = 1_400_000
  const recentBlockhash = '11111111111111111111111111111112'
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: computeUnitsOverride || maxComputeUnits,
  })

  let tx: VersionedTransaction
  if (!('tx' in rest)) {
    // Create message with compute budget instruction
    const message = new TransactionMessage({
      payerKey,
      recentBlockhash,
      instructions: [computeBudgetIx, ...rest.instructions],
    })

    const messageV0 = message.compileToV0Message(rest.addressLookupTableAccounts)
    tx = new VersionedTransaction(messageV0)
  } else if (!('version' in rest.tx)) {
    // Create message with compute budget instruction
    const message = new TransactionMessage({
      payerKey,
      recentBlockhash,
      instructions: [computeBudgetIx, ...rest.tx.instructions],
    })

    const messageV0 = message.compileToV0Message(rest.addressLookupTableAccounts)
    tx = new VersionedTransaction(messageV0)
  } else {
    tx = rest.tx
  }

  const config: SimulateTransactionConfig = {
    commitment: 'confirmed',
    replaceRecentBlockhash: true,
    sigVerify: false,
  }

  const result = await connection.simulateTransaction(tx, config)

  if (result.value.err) {
    console.debug('Simulation results:', {
      logs: result.value.logs,
      unitsConsumed: result.value.unitsConsumed,
      returnData: result.value.returnData,
      err: result.value.err,
    })
    // same error sendTransaction sends, to be catched up
    throw new SendTransactionError({
      action: 'simulate',
      signature: '',
      transactionMessage: JSON.stringify(result.value.err),
      logs: result.value.logs!,
    })
  }

  return result.value
}

/**
 * Used as `provider` in anchor's `Program` constructor, to support `.view()` simulations
 * without * requiring a full AnchorProvider with wallet
 * @param connection - Connection to the Solana network
 * @param feePayer - Fee payer for the simulated transaction
 * @returns Value returned by the simulated method
 */
export function simulationProvider(
  connection: Connection,
  feePayer: PublicKey = new PublicKey('11111111111111111111111111111112'),
) {
  return {
    connection,
    wallet: {
      publicKey: feePayer,
    },
    simulate: async (tx: Transaction | VersionedTransaction, _signers?: Signer[]) =>
      simulateTransaction({
        connection,
        payerKey: feePayer,
        tx,
      }),
  }
}

/**
 * Sign, simulate, send and confirm as many instructions as possible on each transaction
 * @param connection - Solana Connection
 * @param wallet - Wallet to sign and pay for txs
 * @param instructions - Instructions to send; they may not fit all in a single
 *   transaction, in which case they will be split into multiple transactions
 * @param mainIndex - Index of the main instruction
 * @param lookupTables - lookupTables to be used for main instruction
 * @param computeUnits - max computeUnits limit to be used for main instruction
 * @returns - signature of successful transaction including main instruction
 */
export async function simulateAndSendTxs(
  connection: Connection,
  wallet: Wallet,
  { instructions, mainIndex, lookupTables }: UnsignedTx,
  computeUnits?: number,
): Promise<string> {
  let mainHash: string
  for (
    let [start, end] = [0, instructions.length];
    start < instructions.length;
    [start, end] = [end, instructions.length]
  ) {
    let computeUnitLimit, lastErr, addressLookupTableAccounts, ixs, includesMain
    do {
      ixs = instructions.slice(start, end)
      includesMain = mainIndex != null && start <= mainIndex && mainIndex < end
      addressLookupTableAccounts = includesMain ? lookupTables : undefined

      try {
        const simulated =
          (
            await simulateTransaction({
              connection,
              payerKey: wallet.publicKey,
              instructions: ixs,
              addressLookupTableAccounts,
            })
          ).unitsConsumed || 0

        if (simulated <= 200000) {
          computeUnitLimit = undefined
        } else if (!includesMain || computeUnits == null || simulated <= computeUnits) {
          computeUnitLimit = Math.ceil(simulated * 1.1)
        } else {
          throw new Error(
            `Main simulation exceeds specified computeUnits limit. simulated=${simulated}, limit=${computeUnits}`,
          )
        }
        break
      } catch (err) {
        lastErr = err
        end-- // truncate until finding a slice which fits (both computeUnits and tx size limits)
      }
    } while (end > start)
    if (end <= start) throw lastErr

    const blockhash = await connection.getLatestBlockhash('confirmed')
    const txMsg = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash.blockhash,
      instructions: [
        ...(computeUnitLimit
          ? [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit })]
          : []),
        ...ixs,
      ],
    })
    const messageV0 = txMsg.compileToV0Message(addressLookupTableAccounts)
    const tx = new VersionedTransaction(messageV0)

    const signed = await wallet.signTransaction(tx)
    const signature = await connection.sendTransaction(signed)
    await connection.confirmTransaction({ signature, ...blockhash }, 'confirmed')
    if (includesMain) mainHash = signature
  }
  return mainHash!
}
