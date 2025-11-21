import { select } from '@inquirer/prompts'
import {
  dataLength,
  formatUnits,
  getBytes,
  hexlify,
  isBytesLike,
  isHexString,
  parseUnits,
  toUtf8String,
} from 'ethers'

import {
  type CCIPCommit,
  type CCIPExecution,
  type CCIPRequest,
  type Chain,
  type ChainStatic,
  type Lane,
  type OffchainTokenData,
  ExecutionState,
  networkInfo,
  supportedChains,
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

export function formatDuration(secs: number) {
  if (secs < 0) secs = -secs
  if (secs >= 118 && Math.floor(secs) % 60 >= 58) secs += 60 - (secs % 60) // round up 58+s
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

export async function prettyRequest(
  source: Chain,
  request: CCIPRequest,
  offchainTokenData?: OffchainTokenData[],
) {
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
  prettyTable({
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
    ...(isBytesLike(request.message.data) &&
    dataLength(request.message.data) > 0 &&
    getBytes(request.message.data).every((b) => 32 <= b && b <= 126) // printable characters
      ? { data: toUtf8String(request.message.data) }
      : formatData('data', request.message.data)),
    ...('accounts' in request.message ? formatArray('accounts', request.message.accounts) : {}),
    ...rest,
  })

  if (!offchainTokenData?.length || offchainTokenData.every((d) => !d)) return
  console.info('Attestations:')
  for (const attestation of offchainTokenData) {
    const { _tag: type, ...rest } = attestation!
    prettyTable({
      type,
      ...Object.fromEntries(
        Object.entries(rest)
          .map(([key, value]) => Object.entries(formatData(key, hexlify(value))))
          .flat(1),
      ),
    })
  }
}

export async function prettyCommit(
  dest: Chain,
  commit: CCIPCommit,
  request: { timestamp: number },
) {
  console.info('Commit (dest):')
  const timestamp = await dest.getBlockTimestamp(commit.log.blockNumber)
  prettyTable({
    merkleRoot: commit.report.merkleRoot,
    min: Number(commit.report.minSeqNr),
    max: Number(commit.report.maxSeqNr),
    origin: commit.log.tx?.from ?? (await dest.getTransaction(commit.log.transactionHash)).from,
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

export function prettyTable(
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
  return console.table(Object.fromEntries(out))
}

export function prettyReceipt(
  receipt: CCIPExecution,
  request: { timestamp: number },
  origin?: string,
) {
  prettyTable({
    state: receipt.receipt.state === ExecutionState.Success ? '✅ success' : '❌ failed',
    ...(receipt.receipt.state !== ExecutionState.Success ||
    (receipt.receipt.returnData && receipt.receipt.returnData !== '0x')
      ? { returnData: receipt.receipt.returnData }
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
  for (const chain of Object.values<ChainStatic>(supportedChains)) {
    const parsed = chain.parse?.(err)
    if (!parsed) continue
    const { method, Instruction: instruction, ...rest } = parsed
    if (method || instruction) {
      console.error(
        `🛑 Failed to call "${(method || instruction) as string}"`,
        ...Object.entries(rest)
          .map(([k, e]) => [`\n${k.substring(0, 1).toUpperCase()}${k.substring(1)} =`, e])
          .flat(1),
      )
    } else {
      console.error('🛑 Error:', parsed)
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
