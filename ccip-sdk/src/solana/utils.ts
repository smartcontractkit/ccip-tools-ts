import { type IdlTypes, eventDiscriminator } from '@coral-xyz/anchor'
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import {
  type AccountInfo,
  type AddressLookupTableAccount,
  type Connection,
  type Signer,
  type SimulateTransactionConfig,
  type SimulatedTransactionResponse,
  type Transaction,
  type TransactionInstruction,
  type VersionedTransactionResponse,
  ComputeBudgetProgram,
  PublicKey,
  SendTransactionError,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import bs58 from 'bs58'
import { dataLength, dataSlice, encodeBase64, hexlify } from 'ethers'

import type { RateLimiterState } from '../chain.ts'
import {
  CCIPDataFormatUnsupportedError,
  CCIPPartialTransactionSubmissionError,
  CCIPTokenMintInvalidError,
  CCIPTokenMintNotFoundError,
  CCIPTransactionNotFinalizedError,
  CCIPTransactionTooLargeError,
} from '../errors/index.ts'
import type { WithLogger } from '../types.ts'
import { getDataBytes, jsonStringify, sleep } from '../utils.ts'
import type { IDL as BASE_TOKEN_POOL_IDL } from './idl/1.6.0/BASE_TOKEN_POOL.ts'
import type { UnsignedSolanaTx, Wallet } from './types.ts'
import { PACKET_DATA_SIZE, compileV1Message, serializeV1Transaction } from './v1.ts'
import type { SolanaLog } from './index.ts'

/**
 * Result of resolving an Associated Token Account for a given mint and owner.
 */
export type ResolvedATA = {
  /** The derived ATA address */
  ata: PublicKey
  /** The token program that owns the mint (SPL Token or Token-2022) */
  tokenProgram: PublicKey
  /** The raw mint account info */
  mintInfo: AccountInfo<Buffer>
}

/**
 * Resolves the Associated Token Account (ATA) for a given mint and owner.
 * Automatically detects the correct token program (SPL Token vs Token-2022).
 *
 * @param connection - Solana connection instance
 * @param mint - Token mint address
 * @param owner - Owner's wallet address
 * @returns ResolvedATA with ata, tokenProgram, and mintInfo
 * @throws CCIPTokenMintNotFoundError If the mint account doesn't exist
 * @throws CCIPTokenMintInvalidError If the mint exists but isn't a valid SPL token
 *
 * @example
 * ```typescript
 * const { ata, tokenProgram } = await resolveATA(connection, mintPubkey, ownerPubkey)
 * ```
 */
export async function resolveATA(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
): Promise<ResolvedATA> {
  const mintInfo = await connection.getAccountInfo(mint)
  if (!mintInfo) {
    throw new CCIPTokenMintNotFoundError(mint.toBase58())
  }

  // Validate the mint is owned by a valid token program
  const isValidTokenProgram =
    mintInfo.owner.equals(TOKEN_PROGRAM_ID) || mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)

  if (!isValidTokenProgram) {
    throw new CCIPTokenMintInvalidError(mint.toBase58(), mintInfo.owner.toBase58(), [
      TOKEN_PROGRAM_ID.toBase58(),
      TOKEN_2022_PROGRAM_ID.toBase58(),
    ])
  }

  // Allow PDAs as owners (for program vaults, etc.)
  const ata = getAssociatedTokenAddressSync(mint, owner, true, mintInfo.owner)
  return {
    ata,
    tokenProgram: mintInfo.owner,
    mintInfo,
  }
}

/**
 * Generates a hex-encoded discriminator for a Solana event.
 * @param eventName - Name of the event.
 * @returns Hex-encoded discriminator string.
 */
export function hexDiscriminator(eventName: string): string {
  return hexlify(eventDiscriminator(eventName))
}

/**
 * Waits for a Solana transaction to reach finalized status.
 * @param connection - Solana connection instance.
 * @param signature - Transaction signature to wait for.
 * @param intervalMs - Polling interval in milliseconds.
 * @param maxAttempts - Maximum polling attempts before timeout.
 */
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

  throw new CCIPTransactionNotFinalizedError(signature)
}

/**
 * Converts a camelCase string to snake_case.
 * @param str - String to convert.
 * @returns snake_case formatted string.
 */
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

type ParsedLog = Pick<SolanaLog, 'topics' | 'index' | 'address' | 'data' | 'level' | 'type'>
type OrderedParsedLog = ParsedLog & { order: number }

type InnerInstructionLike = {
  programId?: PublicKey | string
  programIdIndex?: number
  accounts?: readonly (number | string)[]
  data?: string
}

function resolveTransactionAccountKeys(tx: VersionedTransactionResponse): string[] {
  const { message } = tx.transaction
  return [
    ...message.staticAccountKeys.map((key) => key.toBase58()),
    ...(tx.meta?.loadedAddresses?.writable ?? []).map((key) => key.toBase58()),
    ...(tx.meta?.loadedAddresses?.readonly ?? []).map((key) => key.toBase58()),
  ]
}

function resolveInstructionProgramId(
  ix: InnerInstructionLike,
  accountKeys: readonly string[],
): string | undefined {
  if (ix.programId) return ix.programId.toString()
  if (ix.programIdIndex != null) return accountKeys[ix.programIdIndex]
}

function resolveInstructionAccounts(
  ix: InnerInstructionLike,
  accountKeys: readonly string[],
): string[] {
  return (ix.accounts ?? [])
    .map((account) => (typeof account === 'number' ? accountKeys[account] : account))
    .filter((account): account is string => !!account)
}

function findNextInvokeLog(
  invokeLogs: ({ used?: boolean } & Pick<ParsedLog, 'address' | 'index' | 'level'>)[],
  programId: string,
) {
  const invokeLog = invokeLogs.find(
    (log) => !log.used && log.level > 1 && log.address === programId,
  )
  if (invokeLog) invokeLog.used = true
  return invokeLog
}

function parseAnchorCpiEventLogs(
  tx: VersionedTransactionResponse,
  invokeLogs: ({ used?: boolean } & Pick<ParsedLog, 'address' | 'index' | 'level'>)[],
  fallbackIndex: number,
): OrderedParsedLog[] {
  const accountKeys = resolveTransactionAccountKeys(tx)
  const results: OrderedParsedLog[] = []

  for (const group of tx.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions as InnerInstructionLike[]) {
      const programId = resolveInstructionProgramId(ix, accountKeys)
      if (!programId || typeof ix.data !== 'string') continue

      const accounts = resolveInstructionAccounts(ix, accountKeys)
      let eventAuthority: string | undefined
      try {
        eventAuthority = PublicKey.findProgramAddressSync(
          [Buffer.from('__event_authority')],
          new PublicKey(programId),
        )[0].toBase58()
      } catch {
        continue
      }
      if (!accounts.includes(eventAuthority)) continue

      let raw: Uint8Array
      try {
        raw = bs58.decode(ix.data)
      } catch {
        continue
      }
      if (raw.length < 16) continue

      // Anchor `emit_cpi!` stores events in a self-CPI instruction:
      // [8-byte self-CPI instruction discriminator][8-byte event discriminator][borsh event data].
      const eventData = raw.slice(8)
      const invokeLog = findNextInvokeLog(invokeLogs, programId)
      const index = invokeLog?.index ?? fallbackIndex + results.length
      results.push({
        topics: [hexlify(eventData.slice(0, 8))],
        index,
        address: programId,
        data: encodeBase64(eventData),
        level: invokeLog?.level ?? 1,
        type: 'data',
        order: index + 0.5,
      })
    }
  }

  return results
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
 * 3. Converts Anchor `emit_cpi!` inner instructions into synthetic `data` logs
 * 4. Converts logs to EVM-compatible ChainLog format for CCIP compatibility
 * 5. Returns ALL logs from the transaction - filtering should be done by the caller
 *
 * @param logs - Array of logMessages from Solana transaction
 * @param tx - Optional full transaction used to synthesize Anchor CPI event logs
 * @returns Array of parsed log objects from all programs in the transaction
 */
export function parseSolanaLogs(
  logs: readonly string[],
  tx?: VersionedTransactionResponse,
): ParsedLog[] {
  const results: OrderedParsedLog[] = []
  const invokeLogs: ({ used?: boolean } & Pick<ParsedLog, 'address' | 'index' | 'level'>)[] = []
  const programStack: string[] = []

  for (const [i, log] of logs.entries()) {
    // Track program calls and returns to maintain the address stack
    const matchInvoke = log.match(/^Program (\w+) invoke\b/)
    const matchReturn = !matchInvoke && log.match(/^Program (\w+) (success|failed)\b/)
    const matchLog = !matchInvoke && !matchReturn && log.match(/^Program (log|data): /)
    if (matchInvoke) {
      programStack.push(matchInvoke[1]!)
      invokeLogs.push({
        address: matchInvoke[1]!,
        index: i,
        level: programStack.length,
      })
    } else if (matchReturn) {
      // Pop from stack when program returns
      programStack.pop()
    } else if (matchLog) {
      const type = matchLog[1]! as 'log' | 'data' | 'cpi'
      // Extract the actual log data
      const logData = log.slice(matchLog[0].length)
      const currentProgram = programStack[programStack.length - 1]!
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
        type,
        order: i,
      })
    }
  }

  if (tx) results.push(...parseAnchorCpiEventLogs(tx, invokeLogs, logs.length))

  return results.sort((a, b) => a.order - b.order).map(({ order: _, ...log }) => log)
}

/**
 * Extracts error information from Solana transaction logs.
 * @param logs_ - Raw log strings or parsed log objects (may include `tx` field with error info).
 * @returns Parsed error info with program and error details.
 */
export function getErrorFromLogs(
  logs_:
    | readonly string[]
    | readonly Pick<SolanaLog, 'address' | 'index' | 'data' | 'topics' | 'tx' | 'level' | 'type'>[]
    | null,
): { program: string; [k: string]: string } | undefined {
  if (!logs_?.length) return
  let logs
  if (logs_.every((l) => typeof l === 'string')) logs = parseSolanaLogs(logs_)
  else logs = logs_

  const lastLog = logs[logs.length - 1]!
  // collect all logs from the last program execution (the one which failed)
  const lastProgramLogs = logs
    .reduceRight(
      (acc, l) =>
        // if acc is empty (i.e. on last log), or it is emitted by the same program and not a Program data:
        !acc.length || (l.address === acc[0]!.address && !l.topics.length) ? [l, ...acc] : acc,
      [] as typeof logs,
    )
    .filter(({ type }) => type !== 'data' && type !== 'cpi')
    .reduceRight((acc, { data: l }) => {
      l = l.replace(/ (with message|thrown in|at) /, ' $1: ')
      if (l.endsWith(':') && acc.length) l = `${l} ${acc.shift()!}` // cosmetic: join lines ending in ':' with next
      try {
        // convert number[]s (common in solana logs) into slightly more readable 0x-bytearrays
        l = l.replace(/\[(\d{1,3}, ){3,}\d+\]/g, (m) =>
          hexlify(
            new Uint8Array(
              m
                .substring(1, m.length - 1)
                .split(', ')
                .map((x) => +x),
            ),
          ),
        )
      } catch {
        // ignore
      }
      const L = l.replace(/\.$/, '').split(/(?<=\w)\. /g)
      acc.unshift(...L)
      return acc
    }, [] as string[])

  const res: { program: string; [k: string]: string } = {
    program: lastLog.address,
  }
  if (lastProgramLogs.every((l) => l.match(/\w: /))) {
    Object.assign(
      res,
      Object.fromEntries(
        lastProgramLogs.map((l) => [
          l.substring(0, l.indexOf(': ')),
          l.substring(l.indexOf(': ') + 2),
        ]),
      ),
    )
  } else {
    res['error'] = lastProgramLogs.join('\n')
  }
  if (!!logs[0] && 'tx' in logs[0] && !!logs[0].tx?.error)
    Object.assign(
      res,
      Object.fromEntries(
        Object.entries(logs[0].tx.error as Record<string, [number, string]>).map(
          ([k, [i, e]]) => [`${k}[${i}]`, e] as const,
        ),
      ),
    )
  return res
}

/**
 * Simulates a Solana transaction to estimate compute units.
 *
 * Prefers a v0 transaction (supports address lookup tables); when the v0 wire does
 * not fit the 1232-byte packet (or v0 can't represent the accounts), falls back to a
 * v1 transaction (SIMD-0385: all accounts static, compute-unit limit inlined into
 * the message's transactionConfig, 4096-byte wire limit) simulated via raw RPC.
 * @param params - Simulation parameters including connection and payer.
 * @returns Simulation result with estimated compute units.
 */
export async function simulateTransaction(
  { connection, logger = console }: { connection: Connection } & WithLogger,
  {
    payerKey,
    computeUnitsOverride,
    ...rest
  }: {
    payerKey: PublicKey
    computeUnitsOverride?: number
    addressLookupTableAccounts?: AddressLookupTableAccount[]
  } & ({ instructions: TransactionInstruction[] } | { tx: Transaction | VersionedTransaction }),
) {
  // Add max compute units for simulation
  const maxComputeUnits = 1_400_000
  const recentBlockhash = '11111111111111111111111111111112'
  const computeUnitLimit = computeUnitsOverride || maxComputeUnits
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: computeUnitLimit,
  })

  const config: SimulateTransactionConfig = {
    commitment: 'confirmed',
    replaceRecentBlockhash: true,
    sigVerify: false,
  }

  const finish = (result: SimulatedTransactionResponse) => {
    logger.debug('Simulation results:', {
      logs: result.logs,
      unitsConsumed: result.unitsConsumed,
      returnData: result.returnData,
      err: result.err,
    })
    if (result.err) {
      // Same error sendTransaction sends, retaining the structured simulation error for callers.
      throw Object.assign(
        new SendTransactionError({
          action: 'simulate',
          signature: '',
          transactionMessage: jsonStringify(result.err),
          logs: result.logs!,
        }),
        { simulationError: result.err },
      )
    }
    return result
  }

  if (!('tx' in rest)) {
    // build the v0 transaction; undefined when v0 can't represent it (e.g. too many
    // accounts to compile) or its wire exceeds the 1232-byte packet
    let tx: VersionedTransaction | undefined
    try {
      const message = new TransactionMessage({
        payerKey,
        recentBlockhash,
        instructions: [computeBudgetIx, ...rest.instructions],
      })
      tx = new VersionedTransaction(message.compileToV0Message(rest.addressLookupTableAccounts))
      if (tx.serialize().length > PACKET_DATA_SIZE) tx = undefined
    } catch {
      tx = undefined
    }

    if (tx) {
      return finish((await connection.simulateTransaction(tx, config)).value)
    }

    // v1 fallback: no address lookup tables — every account static; zero-filled
    // signature slots (the count comes from the header) so sigVerify: false passes
    const message = compileV1Message({
      payerKey,
      recentBlockhash,
      instructions: rest.instructions,
      computeUnitLimit,
    })
    const wire = serializeV1Transaction(
      message,
      new Array(message.header.numRequiredSignatures).fill(null),
    )
    return finish(await simulateRawV1(connection, wire))
  }

  if (!('version' in rest.tx)) {
    // legacy Transaction: rebuild as v0, with the same v1 fallback shape as above
    let tx: VersionedTransaction | undefined
    try {
      const message = new TransactionMessage({
        payerKey,
        recentBlockhash,
        instructions: [computeBudgetIx, ...rest.tx.instructions],
      })
      tx = new VersionedTransaction(message.compileToV0Message())
      if (tx.serialize().length > PACKET_DATA_SIZE) tx = undefined
    } catch {
      tx = undefined
    }

    if (tx) {
      return finish((await connection.simulateTransaction(tx, config)).value)
    }

    const message = compileV1Message({
      payerKey,
      recentBlockhash,
      instructions: rest.tx.instructions,
      computeUnitLimit,
    })
    const wire = serializeV1Transaction(
      message,
      new Array(message.header.numRequiredSignatures).fill(null),
    )
    return finish(await simulateRawV1(connection, wire))
  }

  // already-versioned transaction: simulate as-is
  return finish((await connection.simulateTransaction(rest.tx, config)).value)
}

/**
 * Simulates a raw (already serialized) transaction via raw RPC — web3.js'
 * `Connection.simulateTransaction` only serializes legacy/v0 envelopes.
 */
async function simulateRawV1(connection: Connection, wire: Uint8Array) {
  const res = await (
    connection as unknown as {
      _rpcRequest(method: string, args: unknown[]): Promise<{ result?: { value?: unknown } }>
    }
  )._rpcRequest('simulateTransaction', [
    Buffer.from(wire).toString('base64'),
    {
      commitment: 'confirmed',
      encoding: 'base64',
      replaceRecentBlockhash: true,
      sigVerify: false,
    },
  ])
  const value = res.result?.value
  if (!value) {
    throw new CCIPDataFormatUnsupportedError(
      'simulateTransaction RPC response for a v1 transaction',
    )
  }
  return value as SimulatedTransactionResponse
}

/**
 * Used as `provider` in anchor's `Program` constructor, to support `.view()` simulations
 * without * requiring a full AnchorProvider with wallet
 * @param ctx - Context object containing connection and logger
 * @param feePayer - Fee payer for the simulated transaction
 * @returns Value returned by the simulated method
 */
export function simulationProvider(
  ctx: { connection: Connection } & WithLogger,
  feePayer: PublicKey = new PublicKey('11111111111111111111111111111112'),
) {
  return {
    connection: ctx.connection,
    wallet: {
      publicKey: feePayer,
    },
    simulate: async (tx: Transaction | VersionedTransaction, _signers?: Signer[]) =>
      simulateTransaction(ctx, {
        payerKey: feePayer,
        tx,
      }),
  }
}

/** Returns whether a simulation error was caused by Solana compute-budget exhaustion. */
function isComputeBudgetError(error: unknown): boolean {
  if (!(error instanceof SendTransactionError)) return false
  const structured = (error as { simulationError?: unknown }).simulationError
  if (typeof structured === 'string') return structured === 'ComputationalBudgetExceeded'
  if (structured && typeof structured === 'object' && 'InstructionError' in structured) {
    const detail = (structured as { InstructionError?: unknown }).InstructionError
    return Array.isArray(detail) && detail[1] === 'ComputationalBudgetExceeded'
  }
  return false
}

/**
 * Sign, simulate, send and confirm as many instructions as possible on each transaction.
 * The default `'partial'` mode may confirm a valid instruction prefix before a later failure.
 *
 * @param ctx - Context object containing connection and logger
 * @param wallet - Wallet to sign and pay for txs
 * @param unsignedTx - instructions to sign and send
 *   - instructions - Instructions to send; they may not fit all in a single transaction,
 *       in which case they will be split into multiple transactions
 *   - mainIndex - Index of the main instruction
 *   - lookupTables - lookupTables to be used for main instruction
 * @param computeUnits - max computeUnits limit to be used for main instruction
 * @param splitMode - `'partial'` splits after any simulation failure, `'resource'` splits only
 *   compute-budget and transaction-size failures, and `'atomic'` never splits.
 * @returns - signature of successful transaction including main instruction
 *
 * @throws {@link CCIPPartialTransactionSubmissionError} If a later transaction fails after
 * earlier transactions confirmed; `context.committedHashes` contains their signatures.
 */
export async function simulateAndSendTxs(
  ctx: { connection: Connection } & WithLogger,
  wallet: Wallet,
  { instructions, mainIndex, lookupTables }: Omit<UnsignedSolanaTx, 'family'>,
  computeUnits?: number,
  splitMode: 'partial' | 'resource' | 'atomic' = 'partial',
): Promise<string> {
  const { connection } = ctx
  let mainHash: string
  const committedHashes: string[] = []
  try {
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
              await simulateTransaction(ctx, {
                payerKey: wallet.publicKey,
                instructions: ixs,
                addressLookupTableAccounts,
              })
            ).unitsConsumed || 0

          if (computeUnits != null) {
            computeUnitLimit = computeUnits
          } else if (simulated <= 200000) {
            computeUnitLimit = undefined
          } else {
            computeUnitLimit = Math.ceil(simulated * 1.1)
          }
          break
        } catch (err) {
          lastErr = err
          // Only partial mode treats every simulation failure as a split boundary.
          if (
            (splitMode === 'partial' ||
              (splitMode === 'resource' &&
                (isComputeBudgetError(err) || err instanceof CCIPTransactionTooLargeError))) &&
            end - 1 > start
          ) {
            end--
            continue
          }
          throw err
        }
      } while (end > start)
      if (end <= start) throw lastErr

      const blockhash = await connection.getLatestBlockhash('confirmed')

      // Prefer a v0 transaction (supports address lookup tables); fall back to a v1
      // transaction (all accounts static, compute-unit limit inlined into the message's
      // transactionConfig, 4096-byte wire limit instead of 1232) when the v0 wire does
      // not fit the packet or v0 can't represent the accounts
      let txV0: VersionedTransaction | undefined
      try {
        const txMsg = new TransactionMessage({
          payerKey: wallet.publicKey,
          recentBlockhash: blockhash.blockhash,
          instructions: [
            ...(computeUnitLimit
              ? [
                  ComputeBudgetProgram.setComputeUnitLimit({
                    units: computeUnitLimit,
                  }),
                ]
              : []),
            ...ixs,
          ],
        })
        txV0 = new VersionedTransaction(txMsg.compileToV0Message(addressLookupTableAccounts))
        if (txV0.serialize().length > PACKET_DATA_SIZE) txV0 = undefined
      } catch {
        txV0 = undefined
      }

      let signature: string
      if (txV0) {
        const signed = await wallet.signTransaction(txV0)
        signature = await connection.sendTransaction(signed)
      } else {
        const messageV1 = compileV1Message({
          payerKey: wallet.publicKey,
          recentBlockhash: blockhash.blockhash,
          instructions: ixs,
          computeUnitLimit,
        })
        const txV1 = new VersionedTransaction(messageV1)
        // v1 signing flows through the standard tx.sign()/partialSign() paths, which
        // sign the message.serialize() bytes — SerializableMessageV1 provides them
        await wallet.signTransaction(txV1)
        signature = await connection.sendRawTransaction(
          serializeV1Transaction(messageV1, txV1.signatures),
        )
      }
      await connection.confirmTransaction({ signature, ...blockhash }, 'confirmed')
      committedHashes.push(signature)
      if (includesMain) mainHash = signature
    }
    return mainHash!
  } catch (error) {
    if (!committedHashes.length) throw error
    throw new CCIPPartialTransactionSubmissionError(committedHashes, {
      cause: error instanceof Error ? error : undefined,
    })
  }
}

/**
 * Convert TokenPool's rate limit to RateLimiterState object.
 * @param input - On-chain rate limiter bucket from the TokenPool IDL.
 * @returns RateLimiterState with capacity, rate, and current tokens, or null if disabled.
 */
export function convertRateLimiter(
  input: IdlTypes<typeof BASE_TOKEN_POOL_IDL>['BaseChain']['inboundRateLimit'],
): RateLimiterState {
  if (!input.cfg.enabled) return null
  const tokens = BigInt(input.tokens.toString())
  const out: RateLimiterState = {
    capacity: BigInt(input.cfg.capacity.toString()),
    rate: BigInt(input.cfg.rate.toString()),
    get tokens() {
      const cur =
        tokens + this.rate * BigInt(Math.floor(Date.now() / 1000) - input.lastUpdated.toNumber())
      if (cur < this.capacity) return cur
      else return this.capacity
    },
  }
  return out
}
