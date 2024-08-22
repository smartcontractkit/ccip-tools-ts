import { select } from '@inquirer/prompts'
import {
  BaseWallet,
  hexlify,
  isHexString,
  JsonRpcProvider,
  type Provider,
  SigningKey,
  WebSocketProvider,
} from 'ethers'
import util from 'util'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import {
  calculateManualExecProof,
  chainIdFromSelector,
  chainNameFromId,
  fetchAllMessagesInBatch,
  fetchCCIPMessageInLog,
  fetchCCIPMessagesInTx,
  fetchCommitReport,
  fetchExecutionReceipts,
  fetchOffchainTokenData,
  fetchOffRamp,
  getOnRampStaticConfig,
  getProviderNetwork,
  getTypeAndVersion,
} from './lib/index.js'
import type { CCIPRequest } from './lib/types.js'

util.inspect.defaultOptions.depth = 4 // print down to tokenAmounts in requests
const cleanup: (() => Promise<unknown> | void)[] = []

async function getProvider(
  endpoint: string,
): Promise<readonly [provider: Provider, isTestnet: boolean]> {
  let provider: Provider
  if (endpoint.startsWith('ws')) {
    provider = new WebSocketProvider(endpoint)
  } else if (endpoint.startsWith('http')) {
    provider = new JsonRpcProvider(endpoint)
  } else {
    throw new Error(
      `Unknown JSON RPC protocol in endpoint (should be wss?:// or https?://): ${endpoint}`,
    )
  }
  cleanup.push(() => provider.destroy())

  const { name: networkName } = await getProviderNetwork(provider)
  return [provider, networkName.includes('-testnet')]
}

function getWallet(): BaseWallet {
  const keyFromEnv = process.env['USER_KEY']
  if (keyFromEnv) {
    return new BaseWallet(
      new SigningKey(hexlify((keyFromEnv.startsWith('0x') ? '' : '0x') + keyFromEnv)),
    )
  }
  throw new Error('Could not get wallet; please, set USER_KEY envvar as a hex-encoded private key')
}

async function selectRequest<R extends CCIPRequest>(
  requests: R[],
  promptSuffix?: string,
): Promise<R> {
  if (requests.length === 1) return requests[0]
  const answer = await select({
    message: `${requests.length} messageIds found; select one${promptSuffix ? ' ' + promptSuffix : ''}`,
    choices: [
      ...requests.map((req, i) => ({
        value: i,
        name: `${req.log.index} => ${req.message.messageId}`,
        // eslint-disable-next-line @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions
        description: `sender =\t\t${req.message.sender}\nreceiver =\t\t${req.message.receiver}\ngasLimit =\t\t${req.message.gasLimit}\ntokenTransfers =\t[${req.message.tokenAmounts.map(({ token }) => token).join(',')}]`,
      })),
      {
        value: -1,
        name: 'Exit',
        description: 'Quit the application',
      },
    ],
  })
  if (answer < 0) {
    throw new Error('User requested exit')
  }
  return requests[answer]
}

function withDateTimestamp<T extends { readonly timestamp: number }>(
  obj: T,
): Omit<T, 'timestamp'> & { timestamp: Date } {
  return { ...obj, timestamp: new Date(obj.timestamp * 1e3) }
}

interface CCIPRequestWithLane extends CCIPRequest {
  lane: {
    sourceChainSelector: bigint
    sourceChainId: number
    sourceNetworkName: string
    destChainSelector: bigint
    destChainId: number
    destNetworkName: string
    onRamp: string
  }
}

async function showRequests(argv: { 'source-rpc': string; 'dest-rpc'?: string; tx_hash: string }) {
  const [source] = await getProvider(argv['source-rpc'])
  const sourceNetworkInfo = await getProviderNetwork(source)
  console.log('source =', sourceNetworkInfo)

  const requests = await fetchCCIPMessagesInTx(source, argv.tx_hash)

  let dest: Provider | undefined
  if (argv['dest-rpc']) {
    ;[dest] = await getProvider(argv['dest-rpc'])
    console.log('dest =', await getProviderNetwork(dest))
  }

  const requestsWithLane: CCIPRequestWithLane[] = []
  for (const request of requests) {
    const onRamp = request.log.address
    const [{ destChainSelector }] = await getOnRampStaticConfig(source, onRamp)
    const destChainId = chainIdFromSelector(destChainSelector)
    const destNetworkName = chainNameFromId(destChainId)

    const requestWithLane = {
      ...request,
      lane: {
        sourceChainSelector: sourceNetworkInfo.chainSelector,
        sourceChainId: sourceNetworkInfo.chainId,
        sourceNetworkName: sourceNetworkInfo.name,
        destChainSelector,
        destChainId: Number(destChainId),
        destNetworkName,
        onRamp,
      },
    }
    requestsWithLane.push(requestWithLane)
    console.log(`message ${request.log.index} =`, withDateTimestamp(requestWithLane))
  }

  if (!dest) return

  const request = await selectRequest(requestsWithLane, 'to know more')
  const destNetworkInfo = await getProviderNetwork(dest)
  if (request.lane.destChainSelector !== destNetworkInfo.chainSelector) {
    throw new Error(
      `Wrong dest RPC network: OnRamp is for "${request.lane.destNetworkName}", dest-rpc is for "${destNetworkInfo.name}"`,
    )
  }

  const commit = await fetchCommitReport(dest, request)
  console.log('commit =', withDateTimestamp(commit))

  for await (const receipt of fetchExecutionReceipts(dest, [request], {
    fromBlock: commit.log.blockNumber,
  })) {
    console.log('receipt =', withDateTimestamp(receipt))
  }
  return
}

async function manualExec(argv: {
  'source-rpc': string
  'dest-rpc': string
  tx_hash: string
  'gas-limit': number
  'log-index'?: number
}) {
  const [source, isTestnet] = await getProvider(argv['source-rpc'])
  const [dest] = await getProvider(argv['dest-rpc'])
  console.log('source =', await getProviderNetwork(source))
  console.log('dest =', await getProviderNetwork(dest))

  let request: CCIPRequest
  if (argv['log-index'] != null) {
    request = await fetchCCIPMessageInLog(source, argv.tx_hash, argv['log-index'])
  } else {
    request = await selectRequest(await fetchCCIPMessagesInTx(source, argv.tx_hash), 'to execute')
  }

  const onRamp = request.log.address
  const sourceChainSelector = request.message.sourceChainSelector

  const [_, version] = await getTypeAndVersion(source, onRamp)
  const [{ destChainSelector }] = await getOnRampStaticConfig(source, onRamp)

  if (destChainSelector !== (await getProviderNetwork(dest)).chainSelector) {
    const destName = chainNameFromId(chainIdFromSelector(destChainSelector))
    throw new Error(`Wrong dest RPC network: OnRamp is for "${destName}"`)
  }

  const commit = await fetchCommitReport(dest, request)

  const requestsInBatch = await fetchAllMessagesInBatch(source, request.log, commit.report.interval)

  const leafHasherArgs = { sourceChainSelector, destChainSelector, onRamp: request.log.address }
  const manualExecReport = calculateManualExecProof(
    requestsInBatch.map(({ message }) => message),
    leafHasherArgs,
    [request.message.messageId],
    commit.report.merkleRoot,
  )

  const offchainTokenData = await fetchOffchainTokenData(request, isTestnet)
  const execReport = { ...manualExecReport, offchainTokenData: [offchainTokenData] }
  const gasOverrides = Array.from({ length: manualExecReport.messages.length }, () =>
    BigInt(argv['gas-limit']),
  )
  console.log('proof =', execReport, gasOverrides)

  let offRampContract = await fetchOffRamp(dest, leafHasherArgs, version, {
    fromBlock: commit.log.blockNumber,
  })
  console.log('offRamp =', await offRampContract.getAddress())

  const wallet = getWallet().connect(dest)
  offRampContract = offRampContract.connect(wallet) as typeof offRampContract

  const tx = await offRampContract.manuallyExecute(execReport, gasOverrides)
  console.log('manualExec tx =', tx)
}

async function main() {
  await yargs(hideBin(process.argv))
    .env('CCIP')
    .options({
      'source-rpc': {
        type: 'string',
        alias: 's',
        demandOption: true,
        describe: 'Source network RPC endpoint URL, ws[s] or http[s]',
        // default: 'wss://ethereum-sepolia-rpc.publicnode.com',
      },
      'dest-rpc': {
        type: 'string',
        alias: 'd',
        describe: 'Destination network RPC endpoint URL, ws[s] or http[s]',
        // demandOption: true,
        // default: 'wss://rpc.chiadochain.net/wss',
      },
    })
    .command(
      ['show <tx_hash>', '*'],
      'show CCIP messages info',
      (yargs) =>
        yargs
          .positional('tx_hash', {
            type: 'string',
            demandOption: true,
            describe: 'transaction hash of the request (source) message',
          })
          .check(({ tx_hash }) => isHexString(tx_hash, 32)),
      async (argv) => showRequests(argv).catch((err) => console.info(err)),
    )
    .command(
      'manualExec <tx_hash>',
      'execute manually a single message',
      (yargs) =>
        yargs
          .demandOption('dest-rpc')
          .positional('tx_hash', {
            type: 'string',
            demandOption: true,
            describe: 'transaction hash of the request (source) message',
          })
          .options({
            'log-index': {
              type: 'number',
              describe: 'Log index of message to execute (if more than one in request tx)',
            },
            'gas-limit': {
              type: 'number',
              describe: "Override gas limit for receivers callback (0 keeps request's)",
              default: 0,
            },
          })
          .check(({ tx_hash }) => isHexString(tx_hash, 32)),
      async (argv) => manualExec(argv).catch((err) => console.info(err)),
    )
    .demandCommand()
    .help()
    .alias({ h: 'help', V: 'version' })
    .parse()
}

// eslint-disable-next-line @typescript-eslint/no-misused-promises
void main().finally(async () => {
  for (const c of cleanup.reverse()) {
    await c()
  }
})
