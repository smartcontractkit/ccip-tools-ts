import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { checkbox, confirm, input } from '@inquirer/prompts'
import { formatEther, hexlify, isHexString, toUtf8Bytes } from 'ethers'
import type { Argv } from 'yargs'
import yaml from 'yaml'

import type { GlobalOpts } from '../index.ts'
import {
  type EVMChain,
  type ExtraArgs,
  bigIntReplacer,
  ChainFamily,
  fetchCCIPMessagesInTx,
} from '../lib/index.ts'
import selectors from '../lib/selectors.ts'
import { fetchChainsFromRpcs } from '../providers/index.ts'
import { Format } from './types.ts'
import { logParsedError, prettyRequest, withDateTimestamp } from './utils.ts'

// Types for chainlink-deployments data
interface RpcConfig {
  rpc_name?: string
  http_url?: string
  ws_url?: string
  preferred_url_scheme?: string
}

interface NetworkConfig {
  type?: string
  chain_selector?: number | bigint
  rpcs?: RpcConfig[]
}

interface AddressesData {
  [chainSelector: string]: Record<string, { Type?: string; Version?: string }>
}

// Cached data
let cachedNetworks: Map<string, NetworkConfig> | null = null
let cachedAddresses: AddressesData | null = null

export const command = 'sendMultiple <deployments-path>'
export const describe = 'Interactively select multiple source and destination chains to send CCIP messages'

export const builder = (yargs: Argv) =>
  yargs
    .positional('deployments-path', {
      type: 'string',
      demandOption: true,
      describe: 'Path to local chainlink-deployments repository clone',
    })
    .options({
      testnet: {
        type: 'boolean',
        describe: 'Use testnet chains instead of mainnet',
        default: false,
      },
      receiver: {
        type: 'string',
        describe: 'Receiver of the messages; defaults to the sender wallet address',
      },
      data: {
        type: 'string',
        describe: 'Data to send in the messages (non-hex will be utf-8 encoded)',
      },
      'gas-limit': {
        type: 'number',
        describe: 'Gas limit for receiver callback execution',
        default: 0,
      },
      'allow-out-of-order-exec': {
        type: 'boolean',
        describe: 'Allow execution of messages out of order (v1.5+ lanes only)',
      },
      wallet: {
        type: 'string',
        describe: 'Wallet to use for sending',
      },
    })

export async function handler(argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts) {
  let destroy: () => void
  const destroy$ = new Promise<void>((resolve) => {
    destroy = resolve
  })
  return sendMultiple(argv, destroy$)
    .catch((err) => {
      process.exitCode = 1
      if (!logParsedError(err)) console.error(err)
    })
    .finally(destroy!)
}

async function fetchNetworks(deploymentsPath: string, isTestnet: boolean): Promise<Map<string, NetworkConfig>> {
  if (cachedNetworks) return cachedNetworks

  const networkFile = isTestnet ? 'testnet.yaml' : 'mainnet.yaml'
  const filePath = join(deploymentsPath, 'domains/ccip/.config/networks', networkFile)

  const text = await readFile(filePath, 'utf8')
  const parsed = yaml.parse(text, { maxAliasCount: 10000, intAsBigInt: true }) as {
    networks?: NetworkConfig[]
  }

  const networksMap = new Map<string, NetworkConfig>()
  for (const network of parsed.networks || []) {
    if (network.chain_selector) {
      networksMap.set(network.chain_selector.toString(), network)
    }
  }

  cachedNetworks = networksMap
  return networksMap
}

async function fetchAddresses(deploymentsPath: string, isTestnet: boolean): Promise<AddressesData> {
  if (cachedAddresses) return cachedAddresses

  const addressesDir = isTestnet ? 'testnet' : 'mainnet'
  const filePath = join(deploymentsPath, 'domains/ccip', addressesDir, 'addresses.json')

  const text = await readFile(filePath, 'utf8')
  cachedAddresses = JSON.parse(text) as AddressesData
  return cachedAddresses
}

function getAvailableChains(isTestnet: boolean): { chainId: string; name: string; selector: bigint }[] {
  const chains: { chainId: string; name: string; selector: bigint }[] = []

  for (const [chainId, entry] of Object.entries(selectors)) {
    if (!entry.name || entry.family !== ChainFamily.EVM) continue

    const isTestnetChain = !entry.name.includes('-mainnet')
    if (isTestnetChain === isTestnet) {
      chains.push({ chainId, name: entry.name, selector: entry.selector })
    }
  }

  return chains.sort((a, b) => a.name.localeCompare(b.name))
}

async function getRpcForChain(
  deploymentsPath: string,
  chainSelector: bigint,
  isTestnet: boolean,
): Promise<string | null> {
  const networks = await fetchNetworks(deploymentsPath, isTestnet)
  const networkConfig = networks.get(chainSelector.toString())
  if (!networkConfig?.rpcs?.length) return null
  return networkConfig.rpcs[0].http_url || networkConfig.rpcs[0].ws_url || null
}

async function getRouterForChain(
  deploymentsPath: string,
  chainSelector: bigint,
  isTestnet: boolean,
): Promise<string | null> {
  const addresses = await fetchAddresses(deploymentsPath, isTestnet)
  const chainAddresses = addresses[chainSelector.toString()]
  if (!chainAddresses) return null

  const routerEntry = Object.entries(chainAddresses).find(
    ([, value]) => value.Type?.toLowerCase() === 'router',
  )
  return routerEntry ? routerEntry[0] : null
}

async function selectChainsInteractive(
  availableChains: { chainId: string; name: string; selector: bigint }[],
  prompt: string,
): Promise<{ chainId: string; name: string; selector: bigint }[]> {
  const choices = availableChains.map((chain) => ({
    name: `${chain.name} (${chain.chainId})`,
    value: chain.chainId,
  }))

  const selectedIds = await checkbox({
    message: prompt,
    choices,
    pageSize: 20,
    loop: true,
  })

  return availableChains.filter((chain) => selectedIds.includes(chain.chainId))
}

async function sendMultiple(
  argv: Awaited<ReturnType<typeof builder>['argv']> & GlobalOpts,
  destroy: Promise<void>,
) {
  const isTestnet = argv.testnet ?? false
  const deploymentsPath = argv.deploymentsPath

  console.log(`\n🔗 CCIP Multi-Chain Message Sender (${isTestnet ? 'Testnet' : 'Mainnet'} mode)`)
  console.log(`📁 Using deployments from: ${deploymentsPath}\n`)

  // Get available chains
  const availableChains = getAvailableChains(isTestnet)
  console.log(`Found ${availableChains.length} ${isTestnet ? 'testnet' : 'mainnet'} chains\n`)

  // Step 1: Select source chains
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('STEP 1: Select SOURCE chains')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const sourceChains = await selectChainsInteractive(
    availableChains,
    '🔵 Select source chains (space to select, enter to confirm):',
  )

  if (sourceChains.length === 0) {
    console.log('\n❌ No source chains selected. Exiting.')
    return
  }

  console.log('\n✅ Selected SOURCE chains:')
  sourceChains.forEach((c, i) => console.log(`  ${i + 1}. ${c.name}`))

  // Step 2: Select destination chains
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('STEP 2: Select DESTINATION chains')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const sourceChainIds = new Set(sourceChains.map((c) => c.chainId))
  const destAvailableChains = availableChains.filter((c) => !sourceChainIds.has(c.chainId))

  const destChains = await selectChainsInteractive(
    destAvailableChains,
    '🟢 Select destination chains (space to select, enter to confirm):',
  )

  if (destChains.length === 0) {
    console.log('\n❌ No destination chains selected. Exiting.')
    return
  }

  console.log('\n✅ Selected DESTINATION chains:')
  destChains.forEach((c, i) => console.log(`  ${i + 1}. ${c.name}`))

  // Build routes
  const routes = sourceChains.flatMap((source) =>
    destChains.map((dest) => ({ source, dest })),
  )

  console.log(`\n📬 Total messages to send: ${routes.length}`)
  routes.forEach((r, i) => console.log(`  ${i + 1}. ${r.source.name} → ${r.dest.name}`))

  // Step 3: Check balances and fetch info
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('STEP 3: Checking chains and fetching deployment info')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Build RPC list from deployments
  const rpcs: string[] = []
  for (const source of sourceChains) {
    const rpc = await getRpcForChain(deploymentsPath, source.selector, isTestnet)
    if (rpc) {
      rpcs.push(rpc)
      console.log(`✓ ${source.name}: ${rpc.substring(0, 50)}...`)
    } else {
      console.log(`❌ ${source.name}: No RPC found`)
    }
  }

  if (rpcs.length === 0) {
    console.log('\n❌ No valid RPCs found. Exiting.')
    return
  }

  // Get chains and wallet
  const getChain = fetchChainsFromRpcs({ rpcs }, undefined, destroy)

  // Get message data
  let messageData = argv.data
  if (!messageData) {
    const customData = await input({
      message: 'Enter message data (leave empty for 0x):',
      default: '',
    })
    messageData = customData || undefined
  }

  const proceedWithSend = await confirm({
    message: `Ready to send ${routes.length} CCIP messages. Proceed?`,
    default: true,
  })

  if (!proceedWithSend) {
    console.log('\n❌ Cancelled by user.')
    return
  }

  // Send messages
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('STEP 4: Sending Messages')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const results: { route: typeof routes[0]; success: boolean; messageId?: string; error?: string }[] = []

  for (const route of routes) {
    console.log(`\n🚀 Sending: ${route.source.name} → ${route.dest.name}`)

    try {
      const source = (await getChain(route.source.selector)) as EVMChain
      const router = await getRouterForChain(deploymentsPath, route.source.selector, isTestnet)

      if (!router) {
        throw new Error('No router found for source chain')
      }

      const walletAddress = await source.getWalletAddress(argv)
      const receiver = argv.receiver ?? walletAddress

      const data = messageData
        ? isHexString(messageData)
          ? messageData
          : hexlify(toUtf8Bytes(messageData))
        : '0x'

      const extraArgs: ExtraArgs = {
        ...(argv.allowOutOfOrderExec != null
          ? { allowOutOfOrderExecution: argv.allowOutOfOrderExec }
          : {}),
        gasLimit: BigInt(argv.gasLimit ?? 0),
      }

      const message = {
        receiver,
        data,
        extraArgs,
        feeToken: undefined,
        tokenAmounts: [] as { token: string; amount: bigint }[],
      }

      const fee = await source.getFee(router, route.dest.selector, message)
      console.log(`  Fee: ${formatEther(fee)} ETH`)

      const tx = await source.sendMessage(router, route.dest.selector, { ...message, fee }, argv)
      console.log(`  Tx hash: ${tx.hash}`)

      const request = (await fetchCCIPMessagesInTx(tx))[0]
      console.log(`  ✅ Message ID: ${request.message.header.messageId}`)

      results.push({ route, success: true, messageId: request.message.header.messageId })

      if (argv.format === Format.pretty) {
        await prettyRequest(source, request)
      } else if (argv.format === Format.json) {
        console.info(JSON.stringify(request, bigIntReplacer, 2))
      } else {
        console.log(`  Message =`, withDateTimestamp(request))
      }
    } catch (err) {
      const errorMessage = (err as Error).message
      console.log(`  ❌ Failed: ${errorMessage}`)
      results.push({ route, success: false, error: errorMessage })
    }
  }

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('FINAL SUMMARY')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const successful = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)

  console.log(`✅ Successful: ${successful.length}`)
  console.log(`❌ Failed: ${failed.length}`)

  if (successful.length > 0) {
    console.log('\nSuccessful messages:')
    successful.forEach((r) => console.log(`  ${r.route.source.name} → ${r.route.dest.name}: ${r.messageId}`))
  }

  if (failed.length > 0) {
    console.log('\nFailed messages:')
    failed.forEach((r) => console.log(`  ${r.route.source.name} → ${r.route.dest.name}: ${r.error}`))
  }
}
