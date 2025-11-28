import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { checkbox, confirm, input } from '@inquirer/prompts'
import {
  Contract,
  JsonRpcProvider,
  ZeroAddress,
  formatEther,
  hexlify,
  isHexString,
  toUtf8Bytes,
  zeroPadValue,
} from 'ethers'
import type { TypedContract } from 'ethers-abitype'
import yaml from 'yaml'

import RouterABI from '../abi/Router.ts'
import { bigIntReplacer, encodeExtraArgs, fetchCCIPMessagesInTx } from '../lib/index.ts'
import SELECTORS from '../lib/selectors.ts'
import { Format } from './types.ts'
import { getWallet, prettyRequest, withDateTimestamp } from './utils.ts'

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
  [chainSelector: string]: {
    [contractName: string]: string
  }
}

// Cached data - Map keyed by chain_selector (as string)
let cachedMainnetNetworks: Map<string, NetworkConfig> | null = null
let cachedTestnetNetworks: Map<string, NetworkConfig> | null = null
let cachedMainnetAddresses: AddressesData | null = null
let cachedTestnetAddresses: AddressesData | null = null
let deploymentsPath: string | null = null

/**
 * Set the path to the chainlink-deployments repository
 */
export function setDeploymentsPath(path: string): void {
  deploymentsPath = path
}

/**
 * Fetch networks configuration from chainlink-deployments (local clone)
 */
async function fetchNetworks(isTestnet: boolean): Promise<Map<string, NetworkConfig>> {
  if (!isTestnet && cachedMainnetNetworks) return cachedMainnetNetworks
  if (isTestnet && cachedTestnetNetworks) return cachedTestnetNetworks

  if (!deploymentsPath) {
    throw new Error(
      'Deployments path not set. Please provide --deployments-path pointing to your local chainlink-deployments clone.',
    )
  }

  const networkFile = isTestnet ? 'testnet.yaml' : 'mainnet.yaml'
  const filePath = join(deploymentsPath, 'domains/ccip/.config/networks', networkFile)

  try {
    const text = await readFile(filePath, 'utf8')
    // The chainlink-deployments YAML files use many anchors/aliases, so we need to increase the limit
    // Use intAsBigInt to preserve precision for large chain selectors
    const parsed = yaml.parse(text, { maxAliasCount: 10000, intAsBigInt: true }) as {
      networks?: NetworkConfig[]
    }

    // Build the networks map keyed by chain_selector
    const networksMap = new Map<string, NetworkConfig>()
    const networksArray = parsed.networks || []

    for (const network of networksArray) {
      if (network.chain_selector) {
        // Store with chain_selector as string key (bigint.toString() preserves precision)
        networksMap.set(network.chain_selector.toString(), network)
      }
    }


    if (isTestnet) {
      cachedTestnetNetworks = networksMap
    } else {
      cachedMainnetNetworks = networksMap
    }
    return networksMap
  } catch (err) {
    throw new Error(
      `Failed to read networks file at ${filePath}: ${(err as Error).message}\n` +
        'Make sure --deployments-path points to a valid chainlink-deployments clone.',
    )
  }
}

/**
 * Fetch addresses from chainlink-deployments (local clone)
 */
async function fetchAddresses(isTestnet: boolean): Promise<AddressesData> {
  if (!isTestnet && cachedMainnetAddresses) return cachedMainnetAddresses
  if (isTestnet && cachedTestnetAddresses) return cachedTestnetAddresses

  if (!deploymentsPath) {
    throw new Error(
      'Deployments path not set. Please provide --deployments-path pointing to your local chainlink-deployments clone.',
    )
  }

  const addressesDir = isTestnet ? 'testnet' : 'mainnet'
  const filePath = join(deploymentsPath, 'domains/ccip', addressesDir, 'addresses.json')

  try {
    const text = await readFile(filePath, 'utf8')
    const data = JSON.parse(text) as AddressesData

    if (isTestnet) {
      cachedTestnetAddresses = data
    } else {
      cachedMainnetAddresses = data
    }
    return data
  } catch (err) {
    throw new Error(
      `Failed to read addresses file at ${filePath}: ${(err as Error).message}\n` +
        'Make sure --deployments-path points to a valid chainlink-deployments clone.',
    )
  }
}

/**
 * Get available chains from selectors
 */
function getAvailableChains(isTestnet: boolean): { chainId: string; name: string; selector: bigint }[] {
  const chains: { chainId: string; name: string; selector: bigint }[] = []

  for (const [chainId, entry] of Object.entries(SELECTORS)) {
    if (!entry.name) continue
    // Skip non-EVM chains
    if (chainId.startsWith('aptos:') || chainId.includes('solana')) continue

    const isTestnetChain = !entry.name.includes('-mainnet')
    if (isTestnetChain === isTestnet) {
      chains.push({
        chainId,
        name: entry.name,
        selector: entry.selector,
      })
    }
  }

  return chains.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Get RPC endpoint for a chain by its selector
 */
async function getRpcForChain(chainSelector: bigint, isTestnet: boolean): Promise<string | null> {
  try {
    const networks = await fetchNetworks(isTestnet)

    // Look up by chain_selector
    const networkConfig = networks.get(chainSelector.toString())

    if (!networkConfig) {
      return null
    }

    // Get the first RPC's http_url
    const rpcs = networkConfig.rpcs
    if (!rpcs || rpcs.length === 0) {
      return null
    }

    // Prefer http_url, fallback to ws_url
    const rpc = rpcs[0]
    return rpc.http_url || rpc.ws_url || null
  } catch (err) {
    console.log(`    Error fetching RPC: ${(err as Error).message}`)
    return null
  }
}

/**
 * Get router address for a chain
 */
async function getRouterForChain(
  chainSelector: bigint,
  isTestnet: boolean,
): Promise<string | null> {
  try {
    const addresses = await fetchAddresses(isTestnet)
    const selectorStr = chainSelector.toString()
    const chainAddresses = addresses[selectorStr] as Record<string, { Type?: string; Version?: string }>

    if (!chainAddresses) {
      return null
    }

    // The structure is: { "0xAddress": { "Type": "Router", "Version": "1.2.0" }, ... }
    // Find the contract address with Type === "Router"
    const routerEntry = Object.entries(chainAddresses).find(
      ([, value]) => value.Type?.toLowerCase() === 'router',
    )

    if (!routerEntry) {
      return null
    }

    return routerEntry[0] // The address is the key
  } catch (err) {
    console.log(`    Error fetching router: ${(err as Error).message}`)
    return null
  }
}

/**
 * Check balance on a chain
 */
async function checkBalance(
  rpcUrl: string,
  address: string,
): Promise<{ balance: bigint; formatted: string }> {
  const provider = new JsonRpcProvider(rpcUrl)
  const balance = await provider.getBalance(address)
  return {
    balance,
    formatted: formatEther(balance),
  }
}

/**
 * Interactive chain selection with highlighting of selected items
 */
async function selectChainsInteractive(
  availableChains: { chainId: string; name: string; selector: bigint }[],
  prompt: string,
  alreadySelected: Set<string> = new Set(),
): Promise<{ chainId: string; name: string; selector: bigint }[]> {
  const choices = availableChains.map((chain) => ({
    name: alreadySelected.has(chain.chainId)
      ? `✓ ${chain.name} (${chain.chainId}) [already selected]`
      : `${chain.name} (${chain.chainId})`,
    value: chain.chainId,
    checked: alreadySelected.has(chain.chainId),
  }))

  const selectedIds = await checkbox({
    message: prompt,
    choices,
    pageSize: 20,
    loop: true,
  })

  return availableChains.filter((chain) => selectedIds.includes(chain.chainId))
}

/**
 * Display selected chains summary
 */
function displaySelectedChains(
  label: string,
  chains: { chainId: string; name: string; selector: bigint }[],
): void {
  console.log(`\n${label}:`)
  if (chains.length === 0) {
    console.log('  (none)')
  } else {
    chains.forEach((chain, i) => {
      console.log(`  ${i + 1}. ${chain.name} (chainId: ${chain.chainId})`)
    })
  }
}

export async function sendMultiple(argv: {
  testnet?: boolean
  receiver?: string
  data?: string
  gasLimit?: number
  allowOutOfOrderExec?: boolean
  format: Format
  wallet?: string
  deploymentsPath: string
}) {
  const isTestnet = argv.testnet ?? false

  // Set the deployments path for reading local files
  setDeploymentsPath(argv.deploymentsPath)

  console.log(`\n🔗 CCIP Multi-Chain Message Sender (${isTestnet ? 'Testnet' : 'Mainnet'} mode)\n`)
  console.log(`📁 Using deployments from: ${argv.deploymentsPath}\n`)

  // Get wallet first to check balance
  const wallet = await getWallet(argv)
  const walletAddress = await wallet.getAddress()
  console.log(`💼 Wallet address: ${walletAddress}\n`)

  // Fetch available chains
  console.log('📡 Fetching available chains...')
  const availableChains = getAvailableChains(isTestnet)
  console.log(`Found ${availableChains.length} ${isTestnet ? 'testnet' : 'mainnet'} chains\n`)

  // Step 1: Select source chains
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('STEP 1: Select SOURCE chains')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const sourceChains = await selectChainsInteractive(
    availableChains,
    '🔵 Select source chains (use space to select, enter to confirm):',
  )

  if (sourceChains.length === 0) {
    console.log('\n❌ No source chains selected. Exiting.')
    return
  }

  displaySelectedChains('✅ Selected SOURCE chains', sourceChains)

  // Step 2: Select destination chains
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('STEP 2: Select DESTINATION chains')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Exclude source chains from destination selection
  const sourceChainIds = new Set(sourceChains.map((c) => c.chainId))
  const destAvailableChains = availableChains.filter((c) => !sourceChainIds.has(c.chainId))

  const destChains = await selectChainsInteractive(
    destAvailableChains,
    '🟢 Select destination chains (use space to select, enter to confirm):',
  )

  if (destChains.length === 0) {
    console.log('\n❌ No destination chains selected. Exiting.')
    return
  }

  displaySelectedChains('✅ Selected DESTINATION chains', destChains)

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('SUMMARY: Message Routing')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const routes: { source: typeof sourceChains[0]; dest: typeof destChains[0] }[] = []
  for (const source of sourceChains) {
    for (const dest of destChains) {
      routes.push({ source, dest })
    }
  }

  console.log(`Total messages to send: ${routes.length}`)
  console.log('\nRoutes:')
  routes.forEach((route, i) => {
    console.log(`  ${i + 1}. ${route.source.name} → ${route.dest.name}`)
  })

  // Step 3: Check balances and fetch RPC/Router info
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('STEP 3: Checking balances and fetching deployment info')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const sourceInfo: Map<
    string,
    { chain: typeof sourceChains[0]; rpc: string; router: string; balance: bigint }
  > = new Map()

  for (const source of sourceChains) {
    console.log(`\n📊 Checking ${source.name}...`)

    // Get RPC using chain selector
    const rpc = await getRpcForChain(source.selector, isTestnet)
    if (!rpc) {
      console.log(`  ❌ No RPC endpoint found for ${source.name}`)
      continue
    }
    console.log(`  ✓ RPC: ${rpc.substring(0, 50)}...`)

    // Get Router
    const router = await getRouterForChain(source.selector, isTestnet)
    if (!router) {
      console.log(`  ❌ No Router address found for ${source.name}`)
      continue
    }
    console.log(`  ✓ Router: ${router}`)

    // Check balance
    try {
      const { balance, formatted } = await checkBalance(rpc, walletAddress)
      console.log(`  ✓ Balance: ${formatted} ETH`)

      if (balance === 0n) {
        console.log(`  ⚠️  Warning: Zero balance on ${source.name}`)
      }

      sourceInfo.set(source.chainId, { chain: source, rpc, router, balance })
    } catch (err) {
      console.log(`  ❌ Failed to check balance: ${(err as Error).message}`)
    }
  }

  // Filter routes to only include sources with valid info
  const validRoutes = routes.filter((route) => sourceInfo.has(route.source.chainId))

  if (validRoutes.length === 0) {
    console.log('\n❌ No valid routes available. Please check RPC endpoints and router addresses.')
    return
  }

  if (validRoutes.length < routes.length) {
    console.log(`\n⚠️  Only ${validRoutes.length} of ${routes.length} routes are valid.`)
  }

  // Check for zero balances
  const zeroBalanceChains = [...sourceInfo.values()].filter((info) => info.balance === 0n)
  if (zeroBalanceChains.length > 0) {
    console.log('\n⚠️  The following chains have zero balance:')
    zeroBalanceChains.forEach((info) => {
      console.log(`   - ${info.chain.name}`)
    })

    const continueWithZeroBalance = await confirm({
      message: 'Continue anyway? (messages will fail on chains with zero balance)',
      default: false,
    })

    if (!continueWithZeroBalance) {
      console.log('\n❌ Cancelled by user.')
      return
    }
  }

  // Step 4: Confirm and send
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('STEP 4: Send Messages')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Get optional message data
  let messageData = argv.data
  if (!messageData) {
    const customData = await input({
      message: 'Enter message data (leave empty for 0x, or enter text/hex):',
      default: '',
    })
    messageData = customData || '0x'
  }

  const proceedWithSend = await confirm({
    message: `Ready to send ${validRoutes.length} CCIP messages. Proceed?`,
    default: true,
  })

  if (!proceedWithSend) {
    console.log('\n❌ Cancelled by user.')
    return
  }

  // Send messages
  const results: {
    route: typeof validRoutes[0]
    success: boolean
    txHash?: string
    error?: string
    messageId?: string
  }[] = []

  for (const route of validRoutes) {
    const info = sourceInfo.get(route.source.chainId)!
    console.log(`\n🚀 Sending: ${route.source.name} → ${route.dest.name}`)

    try {
      const provider = new JsonRpcProvider(info.rpc)
      const connectedWallet = wallet.connect(provider)

      const router = new Contract(info.router, RouterABI, connectedWallet) as unknown as TypedContract<
        typeof RouterABI
      >

      const destSelector = route.dest.selector
      const receiver = argv.receiver ?? walletAddress
      const data = !messageData
        ? '0x'
        : isHexString(messageData)
          ? messageData
          : hexlify(toUtf8Bytes(messageData))

      const extraArgs = {
        ...(argv.allowOutOfOrderExec != null
          ? { allowOutOfOrderExecution: argv.allowOutOfOrderExec }
          : {}),
        ...(argv.gasLimit != null ? { gasLimit: BigInt(argv.gasLimit) } : {}),
      }

      const message = {
        receiver: zeroPadValue(receiver, 32),
        data,
        extraArgs: encodeExtraArgs(extraArgs),
        feeToken: ZeroAddress,
        tokenAmounts: [],
      }

      // Calculate fee
      const fee = await router.getFee(destSelector, message)
      console.log(`  Fee: ${formatEther(fee)} ETH`)

      // Send message
      const tx = await router.ccipSend(destSelector, message, { value: fee })
      console.log(`  Tx hash: ${tx.hash}`)

      // Wait for receipt
      const receipt = await tx.wait(1, 60_000)
      const request = (await fetchCCIPMessagesInTx(receipt!))[0]

      results.push({
        route,
        success: true,
        txHash: tx.hash,
        messageId: request.message.header.messageId,
      })

      console.log(`  ✅ Message ID: ${request.message.header.messageId}`)

      // Pretty print based on format
      if (argv.format === Format.pretty) {
        await prettyRequest(provider, request)
      } else if (argv.format === Format.json) {
        console.info(JSON.stringify(request, bigIntReplacer, 2))
      } else {
        console.log(`  Message ${request.log.index} =`, withDateTimestamp(request))
      }
    } catch (err) {
      const errorMessage = (err as Error).message
      console.log(`  ❌ Failed: ${errorMessage}`)
      results.push({
        route,
        success: false,
        error: errorMessage,
      })
    }
  }

  // Final summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('FINAL SUMMARY')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const successful = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)

  console.log(`✅ Successful: ${successful.length}`)
  console.log(`❌ Failed: ${failed.length}`)

  if (successful.length > 0) {
    console.log('\nSuccessful messages:')
    successful.forEach((r) => {
      console.log(`  ${r.route.source.name} → ${r.route.dest.name}: ${r.messageId}`)
    })
  }

  if (failed.length > 0) {
    console.log('\nFailed messages:')
    failed.forEach((r) => {
      console.log(`  ${r.route.source.name} → ${r.route.dest.name}: ${r.error}`)
    })
  }
}

