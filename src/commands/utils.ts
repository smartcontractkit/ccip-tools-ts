import { readFile } from 'node:fs/promises'

import { password, select } from '@inquirer/prompts'
import { LedgerSigner } from '@xlabs-xyz/ledger-signer-ethers-v6'
import {
  type Addressable,
  type Provider,
  type Signer,
  BaseWallet,
  Contract,
  Result,
  SigningKey,
  Wallet,
  ZeroAddress,
  dataSlice,
  formatUnits,
  hexlify,
  isHexString,
  parseUnits,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'

import TokenABI from '../abi/BurnMintERC677Token.js'
import TokenPoolABI from '../abi/BurnMintTokenPool_1_5_1.js'
import RouterABI from '../abi/Router.js'
import TokenAdminRegistry from '../abi/TokenAdminRegistry_1_5.js'
import {
  type CCIPCommit,
  type CCIPContract,
  type CCIPContractType,
  type CCIPExecution,
  type CCIPRequest,
  type Lane,
  CCIPVersion,
  ExecutionState,
  chainIdFromSelector,
  chainNameFromId,
  decodeAddress,
  getContractProperties,
  getErrorData,
  getOnRampLane,
  getProviderNetwork,
  networkInfo,
  parseWithFragment,
  recursiveParseError,
} from '../lib/index.js'

export async function getWallet(argv?: { wallet?: string }): Promise<Signer> {
  if ((argv?.wallet ?? '').startsWith('ledger')) {
    let derivationPath = argv!.wallet!.split(':')[1]
    if (derivationPath && !isNaN(Number(derivationPath)))
      derivationPath = `m/44'/60'/${derivationPath}'/0/0`
    const ledger = await LedgerSigner.create(null, derivationPath)
    console.info('Ledger connected:', await ledger.getAddress(), `at "${ledger.path}"`)
    return ledger
  }
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
        name: `${req.log.index} => ${req.message.header.messageId}`,
        description:
          `sender =\t\t${req.message.sender}
receiver =\t\t${req.message.receiver}
gasLimit =\t\t${req.message.gasLimit}
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
  source: Provider,
  ta: { amount: bigint } & ({ token: string } | { sourcePoolAddress: string }),
): Promise<string> {
  let token
  if ('token' in ta) token = ta.token
  else {
    ;[token] = await getContractProperties([ta.sourcePoolAddress, TokenPoolABI, source], 'getToken')
  }
  const [decimals_, symbol] = await getContractProperties(
    [token, TokenABI, source],
    'decimals',
    'symbol',
  )
  const decimals = Number(decimals_)
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

export async function prettyRequest(source: Provider, request: CCIPRequest) {
  prettyLane(request.lane)
  console.info('Request (source):')

  let finalized
  try {
    finalized = await source.getBlock('finalized')
  } catch (_) {
    // no finalized tag support
  }
  const nonce = Number(request.message.header.nonce)
  console.table({
    messageId: request.message.header.messageId,
    ...(request.tx.from ? { origin: request.tx.from } : {}),
    sender: request.message.sender,
    receiver: request.message.receiver,
    sequenceNumber: Number(request.message.header.sequenceNumber),
    nonce: nonce === 0 ? '0 => allow out-of-order exec' : nonce,
    gasLimit: Number(request.message.gasLimit),
    transactionHash: request.log.transactionHash,
    logIndex: request.log.index,
    blockNumber: request.log.blockNumber,
    timestamp: `${formatDate(request.timestamp)} (${formatDuration(Date.now() / 1e3 - request.timestamp)} ago)`,
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
    min: Number(commit.report.minSeqNr),
    max: Number(commit.report.maxSeqNr),
    origin: (await dest.getTransaction(commit.log.transactionHash))?.from,
    contract: commit.log.address,
    transactionHash: commit.log.transactionHash,
    blockNumber: commit.log.blockNumber,
    timestamp: `${formatDate(timestamp)} (${formatDuration(timestamp - request.timestamp)} after request)`,
  })
}

export function prettyReceipt(
  receipt: CCIPExecution,
  request: { timestamp: number },
  origin?: string,
) {
  console.table({
    state: receipt.receipt.state === ExecutionState.Success ? '✅ success' : '❌ failed',
    ...formatData('returnData', receipt.receipt.returnData, true),
    ...(receipt.receipt.gasUsed ? { gasUsed: Number(receipt.receipt.gasUsed) } : {}),
    ...(origin ? { origin } : {}),
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
export async function parseTokenAmounts(source: Provider, transferTokens: readonly string[]) {
  return Promise.all(
    transferTokens.map(async (tokenAmount) => {
      const [token, amount_] = tokenAmount.split('=')
      const [decimals] = await getContractProperties([token, TokenABI, source], 'decimals')
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

export async function sourceToDestTokenAmounts<S extends { token: string }>(
  sourceTokenAmounts: readonly S[],
  { router: routerAddress, source, dest }: { router: string; source: Provider; dest: Provider },
): Promise<[(Omit<S, 'token'> & { destTokenAddress: string })[], string]> {
  const { name: sourceName } = await getProviderNetwork(source)
  const { chainSelector: destSelector, name: destName } = await getProviderNetwork(dest)

  const router = new Contract(routerAddress, RouterABI, source) as unknown as TypedContract<
    typeof RouterABI
  >
  const onRampAddress = (await router.getOnRamp(destSelector)) as string
  if (!onRampAddress || onRampAddress === ZeroAddress)
    throw new Error(`No "${sourceName}" -> "${destName}" lane on ${routerAddress}`)
  const [lane, onRamp] = await getOnRampLane(source, onRampAddress, destSelector)

  let tokenAdminRegistryAddress
  if (lane.version < CCIPVersion.V1_5) {
    throw new Error('Deprecated lane version: ' + lane.version)
  } else {
    ;({ tokenAdminRegistry: tokenAdminRegistryAddress } = await (
      onRamp as CCIPContract<CCIPContractType.OnRamp, CCIPVersion.V1_5 | CCIPVersion.V1_6>
    ).getStaticConfig())
  }
  const tokenAdminRegistry = new Contract(
    tokenAdminRegistryAddress,
    TokenAdminRegistry,
    source,
  ) as unknown as TypedContract<typeof TokenAdminRegistry>

  let pools: readonly (string | Addressable)[] = []
  if (sourceTokenAmounts.length) {
    pools = await tokenAdminRegistry.getPools(sourceTokenAmounts.map(({ token }) => token))
    const missing = sourceTokenAmounts.filter((_, i) => (pools[i] as string).match(/^0x0+$/))
    if (missing.length) {
      throw new Error(
        `Token${missing.length > 1 ? 's' : ''} not supported: ${missing.map(({ token }) => token).join(', ')}`,
      )
    }
  }

  return [
    await Promise.all(
      sourceTokenAmounts.map(async ({ token, ...ta }, i) => {
        const pool = new Contract(pools[i], TokenPoolABI, source) as unknown as TypedContract<
          typeof TokenPoolABI
        >
        const remoteToken = await pool.getRemoteToken(destSelector)
        const destToken = decodeAddress(remoteToken)
        if (destToken === ZeroAddress)
          throw new Error(
            `Dest "${destName}" not supported by tokenPool ${pools[i] as string} for token ${token}`,
          )
        return { ...ta, destTokenAddress: destToken }
      }),
    ),
    onRampAddress,
  ]
}
