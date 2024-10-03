/* eslint-disable @typescript-eslint/restrict-template-expressions,@typescript-eslint/no-base-to-string */
import { readFile } from 'node:fs/promises'

import { password, select } from '@inquirer/prompts'
import {
  type Addressable,
  BaseWallet,
  Contract,
  dataSlice,
  formatUnits,
  hexlify,
  parseUnits,
  type Provider,
  type Result,
  SigningKey,
  Wallet,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import TokenABI from './abi/BurnMintERC677Token.js'
import {
  type CCIPCommit,
  type CCIPExecution,
  type CCIPRequest,
  chainIdFromSelector,
  chainNameFromId,
  chainNameFromSelector,
  ExecutionState,
  getErrorData,
  getFunctionBySelector,
  type Lane,
  lazyCached,
  networkInfo,
  parseErrorData,
} from './lib/index.js'

export async function getWallet(argv?: { wallet?: string }): Promise<BaseWallet> {
  if (argv?.wallet) {
    let pw = process.env['USER_KEY_PASSWORD']
    if (!pw) pw = await password({ message: 'Enter password for json wallet' })
    return Wallet.fromEncryptedJson(await readFile(argv.wallet, 'utf8'), pw)
  }
  const keyFromEnv = process.env['USER_KEY'] || process.env['OWNER_KEY']
  if (keyFromEnv) {
    return new BaseWallet(
      new SigningKey(hexlify((keyFromEnv.startsWith('0x') ? '' : '0x') + keyFromEnv)),
    )
  }
  throw new Error(
    'Could not get wallet; please, set USER_KEY envvar as a hex-encoded private key, or --wallet option',
  )
}

export async function selectRequest(
  requests: readonly CCIPRequest[],
  promptSuffix?: string,
): Promise<CCIPRequest> {
  if (requests.length === 1) return requests[0]
  const answer = await select({
    message: `${requests.length} messageIds found; select one${promptSuffix ? ' ' + promptSuffix : ''}`,
    choices: [
      ...requests.map((req, i) => ({
        value: i,
        name: `${req.log.index} => ${req.message.messageId}`,
        description:
          `sender =\t\t${req.message.sender}
receiver =\t\t${req.message.receiver}
gasLimit =\t\t${req.message.gasLimit}
tokenTransfers =\t[${req.message.tokenAmounts.map(({ token }) => token).join(',')}]` +
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
  provider: Provider,
  { token, amount }: { token: string | Addressable; amount: bigint },
): Promise<string> {
  const [decimals_, symbol] = await lazyCached(`token ${token}`, async () => {
    const contract = new Contract(token, TokenABI, provider) as unknown as TypedContract<
      typeof TokenABI
    >
    return Promise.all([contract.decimals(), contract.symbol()] as const)
  })
  const decimals = Number(decimals_)
  return `${formatUnits(amount, decimals)} ${symbol}`
}

function formatArray<T>(name: string, values: readonly T[]): Record<string, T> {
  if (values.length <= 1) return { [name]: values[0] }
  return Object.fromEntries(values.map((v, i) => [`${name}[${i}]`, v] as const))
}

function formatData(name: string, data: string, parseError = false): Record<string, string> {
  if (parseError) {
    const parsed = parseErrorData(data)
    if (parsed) {
      const res: Record<string, string> = { [name]: parsed[0].signature }
      Object.entries(parsed[0].args.toObject()).forEach(([key, val]) => {
        Object.assign(res, formatData(`${name}.${key}`, val as string, true))
      })
      return res
    }
  }
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

function formatDuration(secs: number) {
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

export async function prettyRequest(source: Provider, request: CCIPRequest) {
  prettyLane(request.lane)
  console.info('Request (source):')

  let finalized
  try {
    finalized = await source.getBlock('finalized')
  } catch (_) {
    // no finalized tag support
  }
  const nonce = Number(request.message.nonce)
  console.table({
    messageId: request.message.messageId,
    sender: request.message.sender,
    receiver: request.message.receiver,
    sequenceNumber: Number(request.message.sequenceNumber),
    nonce: nonce === 0 ? '0 => allow out-of-order exec' : nonce,
    gasLimit: Number(request.message.gasLimit),
    transactionHash: request.log.transactionHash,
    logIndex: request.log.index,
    blockNumber: request.log.blockNumber,
    timestamp: formatDate(request.timestamp),
    finalized:
      finalized &&
      (finalized.timestamp < request.timestamp
        ? formatDuration(request.timestamp - finalized.timestamp) + ' left'
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
  })
}

export async function prettyCommit(
  dest: Provider,
  commit: CCIPCommit,
  request: { timestamp: number },
) {
  console.info('Commit (dest):')
  const timestamp = (await dest.getBlock(commit.log.blockNumber))!.timestamp
  console.table({
    merkleRoot: commit.report.merkleRoot,
    'interval.min': Number(commit.report.interval.min),
    'interval.max': Number(commit.report.interval.max),
    ...Object.fromEntries(
      commit.report.priceUpdates.tokenPriceUpdates.map(
        ({ sourceToken, usdPerToken }) =>
          [`tokenPrice[${sourceToken}]`, `${formatUnits(usdPerToken)} USD`] as const,
      ),
    ),
    ...Object.fromEntries(
      commit.report.priceUpdates.gasPriceUpdates.map(({ destChainSelector, usdPerUnitGas }) => {
        const execLayerGas = usdPerUnitGas % (1n << 112n)
        const daLayerGas = usdPerUnitGas / (1n << 112n)
        return [
          `gasPrice[${chainNameFromSelector(destChainSelector)}]`,
          `${formatUnits(execLayerGas)}` +
          (daLayerGas > 0 ? ` (DA: ${formatUnits(daLayerGas)})` : ''),
        ] as const
      }),
    ),
    commitStore: commit.log.address,
    transactionHash: commit.log.transactionHash,
    blockNumber: commit.log.blockNumber,
    timestamp: `${formatDate(timestamp)} (${formatDuration(timestamp - request.timestamp)} after request)`,
  })
}

export function prettyReceipt(receipt: CCIPExecution, request: { timestamp: number }) {
  console.table({
    state: receipt.receipt.state === ExecutionState.Success ? '✅ success' : '❌ failed',
    ...formatData('returnData', receipt.receipt.returnData, true),
    offRamp: receipt.log.address,
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
  if (!shortMessage || !transaction) return false

  const invocation_ = (err as { invocation: { method: string; args: Result } | null }).invocation
  let method, invocation
  if (invocation_) {
    const { method: method_, args, ...rest } = invocation_
    method = method_
    invocation = { ...rest, args }
  } else {
    method = dataSlice(transaction.data, 0, 4)
    const func = getFunctionBySelector(method)?.[0]
    if (func) method = func.name
  }
  let reason: unknown[] = []
  const errorData = getErrorData(err)
  if (errorData) {
    const parsed = parseErrorData(errorData)?.[0]
    if (parsed) {
      reason = ['\nReason =', parsed.signature, parsed.args.toObject()]
    }
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
export async function parseTokenAmounts(source: Provider, transferTokens: readonly string[]) {
  return Promise.all(
    transferTokens.map(async (tokenAmount) => {
      const [token, amount_] = tokenAmount.split('=')
      const decimals = await lazyCached(`decimals ${token}`, () => {
        const contract = new Contract(token, TokenABI, source) as unknown as TypedContract<
          typeof TokenABI
        >
        return contract.decimals()
      })
      const amount = parseUnits(amount_, decimals)
      return { token, amount }
    }),
  )
}
