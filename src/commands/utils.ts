import { select } from '@inquirer/prompts'
import bs58 from 'bs58'
import { Result, dataSlice, formatUnits, isBytesLike, isHexString, parseUnits } from 'ethers'

import type { Chain } from '../lib/chain.ts'
import {
  type CCIPCommit,
  type CCIPExecution,
  type CCIPRequest,
  type Lane,
  ExecutionState,
  chainIdFromSelector,
  chainNameFromId,
  getErrorData,
  networkInfo,
  parseWithFragment,
  recursiveParseError,
} from '../lib/index.ts'

export async function selectRequest(
  requests: readonly CCIPRequest[],
  promptSuffix?: string,
  hints?: { logIndex?: number },
): Promise<CCIPRequest> {
  if (hints?.logIndex != null) requests = requests.filter((req) => req.log.index === hints.logIndex)
  if (requests.length === 1) return requests[0]
  const answer = await select({
    message: `${requests.length} messageIds found; select one${promptSuffix ? ' ' + promptSuffix : ''}`,
    choices: [
      ...requests.map((req, i) => ({
        value: i,
        name: `${req.log.index} => ${req.message.header.messageId}`,
        description:
          `sender =\t\t${req.message.sender}
receiver =\t\t${req.message.receiver}
gasLimit =\t\t${(req.message as { gasLimit: bigint }).gasLimit}
tokenTransfers =\t[${req.message.tokenAmounts.map((ta) => ('token' in ta ? ta.token : ta.destTokenAddress)).join(',')}]` +
          ('lane' in req
            ? `\ndestination =\t\t${chainNameFromId(chainIdFromSelector(req.lane.destChainSelector))} [${chainIdFromSelector(req.lane.destChainSelector)}]`
            : ''),
      })),
      {
        value: -1,
        name: 'Exit',
        description: 'Quit the application',
      },
    ],
  })
  if (answer < 0) throw new Error('User requested exit')
  return requests[answer]
}

export function withDateTimestamp<T extends { readonly timestamp: number }>(
  obj: T,
): Omit<T, 'timestamp'> & { timestamp: Date } {
  return { ...obj, timestamp: new Date(obj.timestamp * 1e3) }
}

export function prettyLane(lane: Lane) {
  console.info('Lane:')
  const source = networkInfo(lane.sourceChainSelector),
    dest = networkInfo(lane.destChainSelector)
  console.table({
    name: { source: source.name, dest: dest.name },
    chainId: { source: source.chainId, dest: dest.chainId },
    chainSelector: { source: source.chainSelector, dest: dest.chainSelector },
    'onRamp/version': { source: lane.onRamp, dest: lane.version },
  })
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

export function formatArray<T>(name: string, values: readonly T[]): Record<string, T> {
  if (values.length <= 1) return { [name]: values[0] }
  return Object.fromEntries(values.map((v, i) => [`${name}[${i}]`, v] as const))
}

function formatData(name: string, data: string, parseError = false): Record<string, string> {
  if (parseError) {
    const res: Record<string, string> = {}
    for (const [key, error] of recursiveParseError(name, data)) {
      if (isHexString(error)) Object.assign(res, formatData(key, error))
      else res[key] = error as string
    }
    return res
  }
  const split = []
  if (data.length <= 66) split.push(data)
  else
    for (let i = data.length; i > 2; i -= 64) {
      split.unshift(data.substring(Math.max(i - 64, 0), i))
    }
  return formatArray(name, split)
}

export function formatResult(
  result: unknown,
  parseValue?: (val: unknown, key: string | number) => unknown,
): unknown {
  if (!(result instanceof Result)) return result
  try {
    const res = result.toObject()
    if (!(Object.keys(res)[0] ?? '').match(/^[a-z]/)) throw new Error('Not an object')
    for (const [k, v] of Object.entries(res)) {
      if (v instanceof Result) {
        res[k] = formatResult(v, parseValue)
      } else if (parseValue) {
        res[k] = parseValue(v, k)
      }
    }
    return res
  } catch (_) {
    const res = result.toArray()
    for (let i = 0; i < res.length; i++) {
      const v = res[i] as unknown
      if (v instanceof Result) {
        res[i] = formatResult(v, parseValue)
      } else if (parseValue) {
        res[i] = parseValue(v, i)
      }
    }
    return res
  }
}

function formatDate(timestamp: number) {
  return new Date(timestamp * 1e3).toISOString().substring(0, 19).replace('T', ' ')
}

export function formatDuration(secs: number) {
  if (secs < 0) secs = -secs
  const time = {
    d: Math.floor(secs / 86400),
    h: Math.floor(secs / 3600) % 24,
    m: Math.floor(secs / 60) % 60,
    s: Math.floor(secs) % 60,
  }
  return Object.entries(time)
    .filter((val) => val[1] !== 0)
    .map(([key, val]) => `${val}${key}${key === 'd' ? ' ' : ''}`)
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

export async function prettyRequest(source: Chain, request: CCIPRequest) {
  prettyLane(request.lane)
  console.info('Request (source):')

  let finalized
  try {
    finalized = await source.getBlockTimestamp('finalized')
  } catch (_) {
    // no finalized tag support
  }
  const nonce = Number(request.message.header.nonce)

  const rest = omit(
    request.message,
    'header',
    'sender',
    'receiver',
    'tokenAmounts',
    'data',
    'feeToken',
    'feeTokenAmount',
    'sourceTokenData',
    'sourceChainSelector',
    'extraArgs',
    'accounts',
  )
  console.table({
    messageId: request.message.header.messageId,
    ...(request.tx.from ? { origin: request.tx.from } : {}),
    sender: request.message.sender,
    receiver: request.message.receiver,
    sequenceNumber: Number(request.message.header.sequenceNumber),
    nonce: nonce === 0 ? '0 => allow out-of-order exec' : nonce,
    ...('gasLimit' in request.message
      ? { gasLimit: Number(request.message.gasLimit) }
      : 'computeUnits' in request.message
        ? { computeUnits: Number(request.message.computeUnits) }
        : {}),
    transactionHash: request.log.transactionHash,
    logIndex: request.log.index,
    blockNumber: request.log.blockNumber,
    timestamp: `${formatDate(request.timestamp)} (${formatDuration(Date.now() / 1e3 - request.timestamp)} ago)`,
    finalized:
      finalized &&
      (finalized < request.timestamp
        ? formatDuration(request.timestamp - finalized) + ' left'
        : true),
    fee: await formatToken(source, {
      token: request.message.feeToken,
      amount: request.message.feeTokenAmount,
    }),
    ...formatArray(
      'tokens',
      await Promise.all(request.message.tokenAmounts.map(formatToken.bind(null, source))),
    ),
    ...formatData('data', request.message.data),
    ...('accounts' in request.message ? formatArray('accounts', request.message.accounts) : {}),
    ...rest,
  })
}

export async function prettyCommit(
  dest: Chain,
  commit: CCIPCommit,
  request: { timestamp: number },
) {
  console.info('Commit (dest):')
  const timestamp = await dest.getBlockTimestamp(commit.log.blockNumber)
  console.table({
    merkleRoot: commit.report.merkleRoot,
    min: Number(commit.report.minSeqNr),
    max: Number(commit.report.maxSeqNr),
    origin: (await dest.getTransaction(commit.log.transactionHash)).from,
    contract: commit.log.address,
    transactionHash: commit.log.transactionHash,
    blockNumber: commit.log.blockNumber,
    timestamp: `${formatDate(timestamp)} (${formatDuration(timestamp - request.timestamp)} after request)`,
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

export function prettyReceipt(
  receipt: CCIPExecution,
  request: { timestamp: number },
  origin?: string,
) {
  console.table({
    state: receipt.receipt.state === ExecutionState.Success ? '✅ success' : '❌ failed',
    ...(receipt.receipt.state !== ExecutionState.Success ||
    (receipt.receipt.returnData && receipt.receipt.returnData !== '0x')
      ? isBytesLike(receipt.receipt.returnData)
        ? formatData('returnData', receipt.receipt.returnData, true)
        : Object.fromEntries(
            wrapText(
              receipt.receipt.returnData,
              Math.max(100, +(process.env.COLUMNS || 80) * 0.9),
            ).map((l, i) => [i ? ' '.repeat(i) : 'returnData', l]),
          )
      : {}),
    ...(receipt.receipt.gasUsed ? { gasUsed: Number(receipt.receipt.gasUsed) } : {}),
    ...(origin ? { origin } : {}),
    contract: receipt.log.address,
    transactionHash: receipt.log.transactionHash,
    logIndex: receipt.log.index,
    blockNumber: receipt.log.blockNumber,
    timestamp: `${formatDate(receipt.timestamp)} (${formatDuration(receipt.timestamp - request.timestamp)} after request)`,
  })
}

export function logParsedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const shortMessage = (err as { shortMessage: string }).shortMessage
  const transaction = (err as { transaction: { to: string; data: string } }).transaction
  if (!shortMessage || !transaction?.data) return false

  const invocation_ = (err as { invocation: { method: string; args: Result } | null }).invocation
  let method, invocation
  if (invocation_) {
    const { method: method_, args, ...rest } = invocation_
    method = method_
    invocation = { ...rest, args }
  } else {
    method = dataSlice(transaction.data, 0, 4)
    const func = parseWithFragment(method)?.[0]
    if (func) method = func.name
  }
  const reason: unknown[] = []
  const errorData = getErrorData(err)
  if (errorData) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    reason.push(...recursiveParseError('Revert', errorData).map(([k, e]) => `\n${k} = ${e}`))
  }
  console.error(`🛑 Failed to call "${method}"\nError =`, shortMessage, ...reason, '\nCall =', {
    ...transaction,
    ...invocation,
  })
  return true
}

/**
 * Parse `--transfer-tokens token1=amount1 token2=amount2 ...` into `{ token, amount }[]`
 **/
export async function parseTokenAmounts(source: Chain, transferTokens: readonly string[]) {
  return Promise.all(
    transferTokens.map(async (tokenAmount) => {
      const [token, amount_] = tokenAmount.split('=')
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

export async function sourceToDestTokenAmounts<S extends { token: string; amount: bigint }>(
  source: Chain,
  destChainSelector: bigint,
  onRamp: string,
  sourceTokenAmounts: readonly S[],
): Promise<(Omit<S, 'token'> & { sourcePoolAddress: string; destTokenAddress: string })[]> {
  const tokenAdminRegistry = await source.getTokenAdminRegistryForOnRamp(onRamp)
  return Promise.all(
    sourceTokenAmounts.map(async ({ token, ...rest }) => {
      const sourcePoolAddress = await source.getTokenPoolForToken(tokenAdminRegistry, token)
      const destTokenAddress = await source.getRemoteTokenForTokenPool(
        sourcePoolAddress,
        destChainSelector,
      )
      return { ...rest, sourcePoolAddress, destTokenAddress }
    }),
  )
}

/**
 * Validate transaction hash - supports EVM and Solana formats
 * @param tx_hash - Transaction hash to validate
 * @returns true if valid, throws Error if invalid
 */
export function validateSupportedTxHash(tx_hash: string): boolean {
  // EVM transaction hash (hex, 32 bytes)
  if (isHexString(tx_hash, 32)) return true

  // Solana transaction signature (base58, exactly 64 bytes when decoded)
  try {
    const decoded = bs58.decode(tx_hash)
    if (decoded.length === 64) return true
  } catch {
    // Invalid base58 or decoding error
  }

  throw new Error(
    'Only EVM and Solana transactions are currently supported.\n' +
      'Transaction hash must be a valid format:\n' +
      '  • EVM: 32-byte hex string (0x...)\n' +
      '  • Solana: base58 signature (64 bytes when decoded)',
  )
}
