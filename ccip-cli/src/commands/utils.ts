import { Console } from 'node:console'

import {
  type CCIPCommit,
  type CCIPExecution,
  type CCIPRequest,
  type Chain,
  type ChainFamily,
  type ChainStatic,
  type Lane,
  CCIPError,
  CCIPErrorCode,
  ExecutionState,
  getCCIPExplorerUrl,
  getDataBytes,
  networkInfo,
  supportedChains,
} from '@chainlink/ccip-sdk/src/index.ts'
import { select } from '@inquirer/prompts'
import {
  dataLength,
  formatUnits,
  hexlify,
  isBytesLike,
  isHexString,
  parseUnits,
  toBigInt,
  toUtf8String,
} from 'ethers'
import type { PickDeep } from 'type-fest'

import type { Ctx } from './types.ts'

/**
 * Prompts user to select a CCIP request from a list.
 * @param requests - List of CCIP requests to choose from.
 * @param promptSuffix - Optional suffix for the prompt message.
 * @param hints - Optional hints for pre-filtering requests.
 * @returns Selected CCIP request.
 */
export async function selectRequest(
  requests: readonly CCIPRequest[],
  promptSuffix?: string,
  hints?: { logIndex?: number },
): Promise<CCIPRequest> {
  if (hints?.logIndex != null) requests = requests.filter((req) => req.log.index === hints.logIndex)
  if (requests.length === 1) return requests[0]!
  const answer = await select({
    message: `${requests.length} messageIds found; select one${promptSuffix ? ' ' + promptSuffix : ''}`,
    choices: [
      ...requests.map((req, i) => ({
        value: i,
        name: `${req.log.index} => ${req.message.messageId}`,
        description:
          `sender =\t\t${req.message.sender}
receiver =\t\t${req.message.receiver}
gasLimit =\t\t${(req.message as { gasLimit: bigint }).gasLimit}
tokenTransfers =\t[${req.message.tokenAmounts.map((ta) => ('token' in ta ? ta.token : ta.destTokenAddress)).join(',')}]` +
          ('lane' in req
            ? `\ndestination =\t\t${networkInfo(req.lane.destChainSelector).name} [${networkInfo(req.lane.destChainSelector).chainId}]`
            : ''),
      })),
      {
        value: -1,
        name: 'Exit',
        description: 'Quit the application',
      },
    ],
  })
  if (answer < 0) throw new CCIPError(CCIPErrorCode.UNKNOWN, 'User requested exit')
  return requests[answer]!
}

/**
 * Converts a Unix timestamp to a Date object.
 * @param obj - Object with timestamp property.
 * @returns Object with Date timestamp.
 */
export function withDateTimestamp<
  T extends { readonly timestamp: number } | { readonly tx: { readonly timestamp: number } },
>(obj: T): Omit<T, 'timestamp'> & { timestamp: Date } {
  return {
    ...obj,
    timestamp: new Date(('timestamp' in obj ? obj.timestamp : obj.tx.timestamp) * 1e3),
  }
}

/**
 * Prints lane information in a human-readable format.
 * @param lane - Lane configuration.
 */
export function prettyLane(this: Ctx, lane: Lane) {
  this.logger.info('Lane:')
  const source = networkInfo(lane.sourceChainSelector),
    dest = networkInfo(lane.destChainSelector)
  this.logger.table({
    name: { source: source.name, dest: dest.name },
    chainId: { source: source.chainId, dest: dest.chainId },
    chainSelector: { source: source.chainSelector, dest: dest.chainSelector },
    'onRamp/version': {
      source: formatDisplayAddress(lane.onRamp, source.family),
      dest: lane.version,
    },
  })
}

/**
 * Format an address for display using chain-specific formatting.
 * @param address - Address string
 * @param family - Chain family for formatting
 * @returns Formatted address for display
 */
export function formatDisplayAddress(address: string, family: ChainFamily): string {
  return supportedChains[family]?.formatAddress?.(address) ?? address
}

/**
 * Format a transaction hash for display using chain-specific formatting.
 * @param hash - Transaction hash string
 * @param family - Chain family for formatting
 * @returns Formatted hash for display
 */
export function formatDisplayTxHash(hash: string, family: ChainFamily): string {
  return supportedChains[family]?.formatTxHash?.(hash) ?? hash
}

async function formatToken(
  source: Chain,
  ta: { amount: bigint } & ({ token: string } | { sourcePoolAddress: string }),
): Promise<string> {
  let token
  if ('token' in ta) token = ta.token
  else {
    token = await source.getTokenForTokenPool(ta.sourcePoolAddress)
  }
  const { symbol, decimals } = await source.getTokenInfo(token)
  return `${formatUnits(ta.amount, decimals)} ${symbol}`
}

/**
 * Formats an array into a record with indexed keys.
 * @param name - Base name for the keys.
 * @param values - Array values to format.
 * @returns Record with indexed keys.
 */
export function formatArray<T>(name: string, values: readonly T[]): Record<string, T> {
  if (values.length <= 1) return { [name]: values[0]! }
  return Object.fromEntries(values.map((v, i) => [`${name}[${i}]`, v] as const))
}

// join truthy property names, separated by a dot
function j(...args: string[]): string {
  return args.filter(Boolean).join('.')
}

function formatData(name: string, data: string, parseError = false): Record<string, string> {
  if (parseError) {
    let parsed
    for (const chain of Object.values(supportedChains)) {
      parsed = chain.parse?.(data)
      if (parsed) break
    }
    if (parsed) {
      const res: Record<string, string> = {}
      for (const [key, error] of Object.entries(parsed)) {
        if (isHexString(error)) Object.assign(res, formatData(j(name, key), error))
        else res[j(name, key)] = error as string
      }
      return res
    }
  }
  if (!isHexString(data)) return { [name]: data }
  const split = []
  if (data.length <= 66) split.push(data)
  else
    for (let i = data.length; i > 2; i -= 64) {
      split.unshift(data.substring(Math.max(i - 64, 0), i))
    }
  return formatArray(name, split)
}

function formatDate(timestamp: number) {
  return new Date(timestamp * 1e3).toISOString().substring(0, 19).replace('T', ' ')
}

/**
 * Formats duration in seconds to human-readable string.
 * @param secs - Duration in seconds.
 * @returns Formatted duration string (e.g., "2d 1h30m").
 */
export function formatDuration(secs: number) {
  if (secs < 0) secs = -secs
  if (secs >= 3540 && Math.floor(secs) % 60 >= 50)
    secs += 60 - (secs % 60) // round up 50+s
  else if (secs >= 118 && Math.floor(secs) % 60 >= 58) secs += 60 - (secs % 60) // round up 58+s
  const time = {
    d: Math.floor(secs / 86400),
    h: Math.floor(secs / 3600) % 24,
    m: Math.floor(secs / 60) % 60,
    s: Math.floor(secs) % 60,
  }
  return Object.entries(time)
    .filter((val) => val[1] !== 0)
    .map(([key, val], i, arr) => `${val}${key}${key === 'd' && i < arr.length - 1 ? ' ' : ''}`)
    .join('')
}

function omit<T extends Record<string, unknown>, K extends string>(
  obj: T,
  ...keys: K[]
): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) {
    delete result[key]
  }
  return result
}

// while formatData just breaks 0x bytes into 32B chunks for readability, this function first
// tests if the data looks like a UTF-8 string (with length prefix) and decode that before
function formatDataString(data: string): Record<string, string> {
  const bytes = getDataBytes(data)
  const isPrintableChars = (bytes_: Uint8Array) => bytes_.every((b) => 32 <= b && b <= 126)
  if (bytes.length > 64 && toBigInt(bytes.subarray(0, 32)) === 32n) {
    const len = toBigInt(bytes.subarray(32, 64))
    if (
      len < 512 &&
      bytes.length - 64 === Math.ceil(Number(len) / 32) * 32 &&
      isPrintableChars(bytes.subarray(64, 64 + Number(len))) &&
      bytes.subarray(64 + Number(len)).every((b) => b === 0)
    ) {
      return { data: toUtf8String(bytes.subarray(64, 64 + Number(len))) }
    }
  }
  if (bytes.length > 0 && isPrintableChars(bytes)) return { data: toUtf8String(bytes) }
  return formatData('data', data)
}

/**
 * Prints a CCIP request in a human-readable format.
 * @param source - Source chain instance.
 * @param request - CCIP request to print.
 */
export async function prettyRequest(this: Ctx, source: Chain, request: CCIPRequest) {
  prettyLane.call(this, request.lane)
  this.logger.info('Request (source):')

  let finalized
  try {
    finalized = await source.getBlockTimestamp('finalized')
  } catch (_) {
    // no finalized tag support
  }
  const nonce = Number(request.message.nonce)

  const sourceFamily = networkInfo(request.lane.sourceChainSelector).family
  const destFamily = networkInfo(request.lane.destChainSelector).family

  // Normalize receiver to destination chain format for display
  const displaySender = formatDisplayAddress(request.message.sender, sourceFamily)
  const displayReceiver = formatDisplayAddress(request.message.receiver, destFamily)
  const displayOrigin = request.tx.from
    ? formatDisplayAddress(request.tx.from, sourceFamily)
    : undefined
  const displayTxHash = formatDisplayTxHash(request.log.transactionHash, sourceFamily)

  const rest = omit(
    request.message,
    'messageId',
    'sequenceNumber',
    'nonce',
    'sender',
    'receiver',
    'tokenAmounts',
    'data',
    'feeToken',
    'feeTokenAmount',
    'sourceTokenData',
    'sourceChainSelector',
    'destChainSelector',
    'extraArgs',
    'accounts',
    'receipts',
    'encodedMessage',
  )
  prettyTable.call(this, {
    messageId: request.message.messageId,
    ...(displayOrigin ? { origin: displayOrigin } : {}),
    sender: displaySender,
    receiver: displayReceiver,
    sequenceNumber: Number(request.message.sequenceNumber),
    nonce: nonce === 0 ? '0 => allow out-of-order exec' : nonce,
    ...('gasLimit' in request.message
      ? { gasLimit: Number(request.message.gasLimit) }
      : 'computeUnits' in request.message
        ? { computeUnits: Number(request.message.computeUnits) }
        : {}),
    transactionHash: displayTxHash,
    logIndex: request.log.index,
    blockNumber: request.log.blockNumber,
    timestamp: `${formatDate(request.tx.timestamp)} (${formatDuration(Date.now() / 1e3 - request.tx.timestamp)} ago)`,
    finalized:
      finalized &&
      (finalized < request.tx.timestamp
        ? formatDuration(request.tx.timestamp - finalized) + ' left'
        : true),
    fee: await formatToken(source, {
      token: request.message.feeToken,
      amount: request.message.feeTokenAmount,
    }),
    ...formatArray(
      'tokens',
      await Promise.all(request.message.tokenAmounts.map(formatToken.bind(null, source))),
    ),
    ...formatDataString(request.message.data),
    ...('accounts' in request.message ? formatArray('accounts', request.message.accounts) : {}),
    ...('receipts' in request.message ? formatArray('receipts', request.message.receipts) : {}),
    ...rest,
  })
  this.logger.info('CCIP Explorer:', getCCIPExplorerUrl('msg', request.message.messageId))
}

/**
 * Prints a CCIP commit in a human-readable format.
 * @param dest - Destination chain instance.
 * @param commit - CCIP commit to print.
 * @param request - CCIP request for timestamp comparison.
 */
export async function prettyCommit(
  this: Ctx,
  dest: Chain,
  commit: CCIPCommit,
  request: PickDeep<CCIPRequest, 'tx.timestamp' | 'lane.destChainSelector'>,
) {
  const timestamp = await dest.getBlockTimestamp(commit.log.blockNumber)
  const destFamily = networkInfo(request.lane.destChainSelector).family
  const origin = commit.log.tx?.from ?? (await dest.getTransaction(commit.log.transactionHash)).from

  prettyTable.call(this, {
    merkleRoot: commit.report.merkleRoot,
    min: Number(commit.report.minSeqNr),
    max: Number(commit.report.maxSeqNr),
    origin: formatDisplayAddress(origin, destFamily),
    contract: formatDisplayAddress(commit.log.address, destFamily),
    transactionHash: formatDisplayTxHash(commit.log.transactionHash, destFamily),
    blockNumber: commit.log.blockNumber,
    timestamp: `${formatDate(timestamp)} (${formatDuration(timestamp - request.tx.timestamp)} after request)`,
  })
}

/**
 * Add line breaks to a string to fit within a specified column width
 * @param text - The input string to wrap
 * @param maxWidth - Maximum column width before wrapping
 * @param threshold - Percentage of maxWidth to look back for spaces (default 0.1 = 10%)
 * @returns The wrapped string with line breaks inserted
 */
function wrapText(text: string, maxWidth: number, threshold: number = 0.1): string[] {
  const lines: string[] = []

  // First split by existing line breaks
  const existingLines = text.split('\n')

  for (const line of existingLines) {
    const words = line.split(' ')
    let currentLine = ''

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word

      if (testLine.length <= maxWidth) {
        currentLine = testLine
      } else {
        if (currentLine) {
          lines.push(currentLine)
          currentLine = word
        } else {
          // Word is longer than maxWidth, break it
          const thresholdDistance = Math.floor(maxWidth * threshold)
          let remaining = word

          while (remaining.length > maxWidth) {
            let breakPoint = maxWidth
            // Look for a good break point within threshold distance
            for (let i = maxWidth - thresholdDistance; i < maxWidth; i++) {
              if (remaining[i] === '-' || remaining[i] === '_') {
                breakPoint = i + 1
                break
              }
            }
            lines.push(remaining.substring(0, breakPoint))
            remaining = remaining.substring(breakPoint)
          }
          currentLine = remaining
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }
  }

  return lines
}

/**
 * Prints a formatted table of key-value pairs.
 * @param args - Key-value pairs to print.
 * @param opts - Formatting options.
 */
export function prettyTable(
  this: Ctx,
  args: Record<string, unknown>,
  opts = { parseErrorKeys: ['returnData'], spcount: 0 },
) {
  const out: (readonly [string, unknown])[] = []
  for (const [key, value] of Object.entries(args)) {
    if (isBytesLike(value)) {
      let parseError
      if (opts.parseErrorKeys.includes(key)) parseError = true
      if (dataLength(value) <= 32 && !parseError) out.push([key, value])
      else out.push(...Object.entries(formatData(key, hexlify(value), parseError)))
    } else if (typeof value === 'string') {
      out.push(
        ...wrapText(value, Math.max(100, +(process.env.COLUMNS || 80) * 0.9)).map(
          (l, i) => [!i ? key : ' '.repeat(opts.spcount++), l] as const,
        ),
      )
    } else if (Array.isArray(value)) {
      if (value.length <= 1) out.push([key, value[0] as unknown])
      else out.push(...value.map((v, i) => [`${key}[${i}]`, v as unknown] as const))
    } else if (value && typeof value === 'object') {
      out.push(...Object.entries(value).map(([k, v]) => [`${key}.${k}`, v] as const))
    } else out.push([key, value])
  }
  return this.logger.table(Object.fromEntries(out))
}

/**
 * Prints a CCIP execution receipt in a human-readable format.
 * @param receipt - CCIP execution receipt to print.
 * @param request - CCIP request for timestamp comparison.
 * @param origin - Optional transaction origin address.
 */
export function prettyReceipt(
  this: Ctx,
  receipt: CCIPExecution,
  request: PickDeep<CCIPRequest, 'tx.timestamp' | 'lane.destChainSelector'>,
  origin?: string,
) {
  const destFamily = networkInfo(request.lane.destChainSelector).family

  prettyTable.call(this, {
    state: receipt.receipt.state === ExecutionState.Success ? '✅ success' : '❌ failed',
    ...(receipt.receipt.state !== ExecutionState.Success ||
    (receipt.receipt.returnData && receipt.receipt.returnData !== '0x')
      ? { returnData: receipt.receipt.returnData }
      : {}),
    ...(receipt.receipt.gasUsed ? { gasUsed: Number(receipt.receipt.gasUsed) } : {}),
    ...(origin ? { origin: formatDisplayAddress(origin, destFamily) } : {}),
    contract: formatDisplayAddress(receipt.log.address, destFamily),
    transactionHash: formatDisplayTxHash(receipt.log.transactionHash, destFamily),
    logIndex: receipt.log.index,
    blockNumber: receipt.log.blockNumber,
    timestamp: `${formatDate(receipt.timestamp)} (${formatDuration(receipt.timestamp - request.tx.timestamp)} after request)`,
  })
}

/**
 * Format a CCIPError with recovery hints for user-friendly display.
 * @param err - Error to format.
 * @param verbose - If true, include stack trace for debugging.
 * @returns Formatted error string if CCIPError, null otherwise.
 */
export function formatCCIPError(err: unknown, verbose = false): string | null {
  if (!CCIPError.isCCIPError(err)) return null

  const lines: string[] = []

  lines.push(`error[${err.code}]: ${err.message}`)

  if (err.recovery) {
    lines.push(`  help: ${err.recovery}`)
  }

  if (err.isTransient) {
    let note = 'this error may resolve on retry'
    if (err.retryAfterMs) {
      note += ` (wait ${Math.round(err.retryAfterMs / 1000)}s)`
    }
    lines.push(`  note: ${note}`)
  }

  if (verbose && err.stack) {
    lines.push('')
    lines.push('  Stack trace:')
    const stackLines = err.stack.split('\n').slice(1)
    for (const line of stackLines) {
      lines.push(`  ${line}`)
    }
  }

  return lines.join('\n')
}

/**
 * Logs a parsed error message if the error can be decoded.
 * @param err - Error to parse and log.
 * @returns True if error was successfully parsed and logged.
 */
export function logParsedError(this: Ctx, err: unknown): boolean {
  // First check if it's a CCIPError with recovery hints
  const formatted = formatCCIPError(err, this.verbose)
  if (formatted) {
    this.logger.error(formatted)
    return true
  }

  // Then try chain-specific parsing for revert data
  for (const chain of Object.values<ChainStatic>(supportedChains)) {
    const parsed = chain.parse?.(err)
    if (!parsed) continue
    const { method, Instruction: instruction, ...rest } = parsed
    if (method || instruction) {
      this.logger.error(
        `error: Failed to call "${(method || instruction) as string}"`,
        ...Object.entries(rest)
          .map(([k, e]) => [`\n${k.substring(0, 1).toUpperCase()}${k.substring(1)} =`, e])
          .flat(1),
      )
    } else {
      this.logger.error('error:', parsed)
    }
    return true
  }
  return false
}

/**
 * Parse `--transfer-tokens token1=amount1 token2=amount2 ...` into `{ token, amount }[]`
 **/
export async function parseTokenAmounts(source: Chain, transferTokens: readonly string[]) {
  return Promise.all(
    transferTokens.map(async (tokenAmount) => {
      const [token, amount_] = tokenAmount.split('=') as [string, string]
      const { decimals } = await source.getTokenInfo(token)
      const amount = parseUnits(amount_, decimals)
      return { token, amount }
    }),
  )
}

/**
 * Yield resolved promises (like Promise.all), but as they resolve.
 * Throws as soon as any promise rejects.
 *
 * @param promises - Promises to resolve
 * @returns Resolved values as they resolve
 **/
export async function* yieldResolved<T>(promises: readonly Promise<T>[]): AsyncGenerator<T> {
  const map = new Map(promises.map((p) => [p, p.then((res) => [p, res] as const)] as const))
  while (map.size > 0) {
    const [p, res] = await Promise.race(map.values())
    map.delete(p)
    yield res
  }
}

/**
 * Create context for command execution
 * @param argv - yargs argv containing verbose flag
 * @returns AbortController and context object with destroy$ signal and logger
 */
export function getCtx(argv: { verbose?: boolean }): [ctx: Ctx, destroy: () => void] {
  let destroy
  const destroy$ = new Promise<void>((resolve) => (destroy = resolve))

  const logger = new Console(process.stdout, process.stderr, true)
  if (argv.verbose) {
    logger.debug('Verbose mode enabled')
  } else {
    logger.debug = () => {}
  }

  return [{ destroy$, logger, verbose: argv.verbose }, destroy!]
}
