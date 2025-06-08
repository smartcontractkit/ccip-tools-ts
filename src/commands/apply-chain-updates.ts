import { Contract, Interface } from 'ethers'
import { readFile } from 'fs/promises'
import { createInterface } from 'readline/promises'
import bs58 from 'bs58'
import TokenPoolABI from '../abi/TokenPool.ts'
import { bigIntReplacer, chainIdFromName, getProviderNetwork } from '../lib/utils.ts'
import type { Providers } from '../providers.ts'
import { Format } from './types.ts'
import { getWallet } from './utils.ts'
import type { TypedContract } from 'ethers-abitype'

type ChainToAdd = {
  remoteChainSelector: bigint
  remotePoolAddresses: string[]
  remoteTokenAddress: string
  outboundRateLimiterConfig: {
    isEnabled: boolean
    capacity: bigint
    rate: bigint
  }
  inboundRateLimiterConfig: {
    isEnabled: boolean
    capacity: bigint
    rate: bigint
  }
}

/**
 * @description Checks if a given string is in a valid Solana address Base58 format.
 *
 * Solana addresses are 32-byte arrays encoded with the Bitcoin Base58 alphabet, resulting
 * in ASCII text strings of 32-44 characters. This function only validates the character
 * pattern and length.
 *
 * @warning Since this function depends on user's input only, it:
 * - DOES NOT validate if the address is a valid ed25519 public key
 * - DOES NOT validate checksum (typos cannot be detected)
 * - Single character typos, reversed characters, and case errors may still pass
 *
 * @param address - A string representing a Solana address in Base58 format.
 * @returns {boolean} - Returns true if the address is valid, false otherwise.
 */
function isSolanaAddress(address: string): boolean {
  const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

  return SOLANA_ADDRESS_REGEX.test(address)
}

/**
 * @description Converts a Solana address from Base58 format to a 32-byte hex string which CCIP expects.
 *
 * If the address is not valid or cannot be decoded to 32 bytes, it returns the original address.
 *
 * @param address - A string representing a Solana address in Base58 format.
 * @returns {string} - Returns the address as a 32-byte hex string prefixed with '0x'.
 */
function convertSolanaAddressToBytes32Hex(address: string): string {
  try {
    const decoded = bs58.decode(address)
    if (decoded.length !== 32) {
      console.warn(
        `⚠️  Invalid Solana address: "${address}" decoded to ${decoded.length} bytes, expected 32 bytes.`,
      )
      return address // Return original address if length is not 32 bytes
    } else {
      const hexAddress = '0x' + Buffer.from(decoded).toString('hex')
      console.warn('Converted Solana Base58 address to 32 bytes hex:', hexAddress)
      return hexAddress
    }
  } catch (error) {
    console.warn(`⚠️  Error converting Solana address "${address}":`, error)
    return address // Return original address in case of error
  }
}

/**
 * @description Generates calldata for the `applyChainUpdates` function of the TokenPool.sol smart contract.
 *
 * This function is useful if you work with multisig wallets.
 *
 * @param argv.json_args - Path to a JSON file containing chain updates arguments.
 * @param argv.format - The format in which to display the output (log, pretty, or json).
 * @returns {calldata: string, remoteChainSelectorsToRemove: bigint[], chainsToAdd: ChainToAdd[]}
 */
export async function generateApplyChainUpdatesCalldata(argv: {
  json_args: string // Path to a JSON file containing chain updates arguments
  format: Format
}): Promise<{
  calldata: string
  remoteChainSelectorsToRemove: bigint[]
  chainsToAdd: ChainToAdd[]
}> {
  // ================================================================
  // │              Extract Arguments from JSON File                │
  // ================================================================
  const argsContent = await readFile(argv.json_args, 'utf-8')
  const args = JSON.parse(argsContent)

  const remoteChainSelectorsToRemove = Array.isArray(args)
    ? args[0]
    : args.remoteChainSelectorsToRemove || []

  let chainsToAdd = Array.isArray(args) ? args[1] : args.chainsToAdd || []

  if (!Array.isArray(remoteChainSelectorsToRemove) || !Array.isArray(chainsToAdd)) {
    throw new Error(
      'Invalid JSON format. Expected either:\n' +
        '1. Array format: [remoteChainSelectorsToRemove[], chainsToAdd[]]\n' +
        '2. Object format: { remoteChainSelectorsToRemove: [], chainsToAdd: [] }',
    )
  }

  chainsToAdd = chainsToAdd.map((chain) => ({
    ...chain,
    remotePoolAddresses: chain.remotePoolAddresses.map((address: string) => {
      if (isSolanaAddress(address)) {
        console.warn('\nDetected Solana pool address:', address)
        return convertSolanaAddressToBytes32Hex(address)
      }
      return address
    }),
    remoteTokenAddress: isSolanaAddress(chain.remoteTokenAddress)
      ? (() => {
          console.warn('\nDetected Solana token address:', chain.remoteTokenAddress)
          return convertSolanaAddressToBytes32Hex(chain.remoteTokenAddress)
        })()
      : chain.remoteTokenAddress,
  }))

  // ================================================================
  // │                     Generate Calldata                        │
  // ================================================================
  const poolContractInterface = new Interface(TokenPoolABI)

  const calldata = poolContractInterface.encodeFunctionData('applyChainUpdates', [
    remoteChainSelectorsToRemove,
    chainsToAdd,
  ])

  // ================================================================
  // │                     Display Arguments                        │
  // ================================================================
  switch (argv.format) {
    case Format.log:
      console.log({
        remoteChainSelectorsToRemove,
        chainsToAdd: chainsToAdd.map((chain: ChainToAdd) => ({
          ...chain,
          remotePoolAddresses: chain.remotePoolAddresses.join(', '),
        })),
      })
      break
    case Format.pretty:
      console.log('\nremoteChainSelectorsToRemove:')
      console.table(remoteChainSelectorsToRemove.map((selector) => ({ selector })))

      console.log('\nchainsToAdd:')
      chainsToAdd.forEach((chain: ChainToAdd, i: number) => {
        console.log(`\nChain at index[${i}]:`)
        console.table({
          remoteChainSelector: chain.remoteChainSelector,
          remotePoolAddresses: chain.remotePoolAddresses.join(', '),
          remoteTokenAddress: chain.remoteTokenAddress,
          'outboundRateLimiter.isEnabled': chain.outboundRateLimiterConfig.isEnabled,
          'outboundRateLimiter.capacity': chain.outboundRateLimiterConfig.capacity,
          'outboundRateLimiter.rate': chain.outboundRateLimiterConfig.rate,
          'inboundRateLimiter.isEnabled': chain.inboundRateLimiterConfig.isEnabled,
          'inboundRateLimiter.capacity': chain.inboundRateLimiterConfig.capacity,
          'inboundRateLimiter.rate': chain.inboundRateLimiterConfig.rate,
        })
      })
      break
    case Format.json:
      console.log(
        JSON.stringify(
          {
            remoteChainSelectorsToRemove,
            chainsToAdd,
          },
          bigIntReplacer,
          2,
        ),
      )
      break
  }

  console.log('\nTransaction Calldata:')
  console.log(`\n${calldata}`)

  return { calldata, remoteChainSelectorsToRemove, chainsToAdd }
}

/**
 * @description Calls the `applyChainUpdates` function of the TokenPool.sol smart contract.
 *
 * @param providers - An instance of Providers to get the correct chain provider.
 * @param argv.source - The source chain's EIP-155 chainID or string chain name.
 * @param argv.pool - The address of the TokenPool.sol smart contract.
 * @param argv.json_args - Path to a JSON file containing chain updates arguments.
 * @param argv.format - The format in which to display the output (log, pretty, or json).
 * @param argv.wallet - Optional wallet address to use for signing the transaction.
 * @returns {Promise<void>}
 */
export async function applyChainUpdates(
  providers: Providers,
  argv: {
    source: string
    pool: string
    json_args: string // Path to a JSON file containing chain updates arguments
    format: Format
    wallet?: string
  },
) {
  const sourceChainId = isNaN(+argv.source) ? chainIdFromName(argv.source) : +argv.source
  const source = await providers.forChainId(sourceChainId)
  const network = await getProviderNetwork(source)

  const wallet = (await getWallet(argv)).connect(source)
  const signerAddress = await wallet.getAddress()

  const { calldata, remoteChainSelectorsToRemove, chainsToAdd } =
    await generateApplyChainUpdatesCalldata(argv)

  const poolContract = new Contract(argv.pool, TokenPoolABI, wallet) as unknown as TypedContract<
    typeof TokenPoolABI
  >

  const txRequest = await poolContract.applyChainUpdates.populateTransaction(
    remoteChainSelectorsToRemove,
    chainsToAdd,
  )

  // ================================================================
  // │                     Validate Calldata                        │
  // ================================================================
  if (calldata !== txRequest.data) {
    console.warn('\n⚠️  WARNING: Calldata mismatch detected!')
    console.warn('Generated calldata differs from the one displayed in terminal.')

    console.log('\nCalldata you are going to sign:')
    console.log(`\n${txRequest.data}`)

    // Ask user if they want to proceed
    const rl2 = createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    const proceedWithMismatch = await rl2.question(
      '\nCalldata mismatch detected. Proceed anyway? (y/N) ',
    )
    rl2.close()

    if (proceedWithMismatch.toLowerCase() !== 'y') {
      console.log('Transaction cancelled due to calldata mismatch')
      return
    }
  } else {
    console.log('✅ Calldata validation passed')
  }

  // ================================================================
  // │                        Estimate Gas                          │
  // ================================================================
  let gasEstimate
  console.log('\nEstimating gas for the transaction...')
  try {
    gasEstimate = await source.estimateGas({
      to: txRequest.to,
      data: txRequest.data,
      from: signerAddress,
      value: txRequest.value,
    })
  } catch (error) {
    console.warn(`⚠️  Gas estimation failed`)
  }

  // ================================================================
  // │                 Display Transaction Preview                  │
  // ================================================================
  console.log('\nTransaction Preview:')
  switch (argv.format) {
    case Format.log:
      console.log({
        network: `${network.name} (${network.chainId})`,
        pool: argv.pool,
        signer: signerAddress,
        estimatedGas: gasEstimate,
        calldata: txRequest.data,
      })
      break
    case Format.pretty:
      console.table({
        network: `${network.name} (${network.chainId})`,
        pool: argv.pool,
        signer: signerAddress,
        estimatedGas: gasEstimate,
      })
      break
    case Format.json:
      console.log(
        JSON.stringify(
          {
            transactionPreview: {
              network: `${network.name} (${network.chainId})`,
              pool: argv.pool,
              signer: signerAddress,
              estimatedGas: gasEstimate,
              calldata: txRequest.data,
            },
          },
          bigIntReplacer,
          2,
        ),
      )
      break
  }

  // ================================================================
  // │                        Tx Simulation                         │
  // ================================================================
  console.log('\nSimulating transaction to check for potential errors...')
  try {
    await poolContract.applyChainUpdates.staticCall(remoteChainSelectorsToRemove, chainsToAdd)
  } catch (error) {
    console.warn(
      `Transaction would likely fail with the following error message:\n ${error.message}`,
    )
  }

  // ================================================================
  // │                      User Confirmation                       │
  // ================================================================
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const answer = await rl.question('\nProceed with executing this transaction? (y/N) ')
  rl.close()

  if (answer.toLowerCase() !== 'y') {
    console.log('Transaction cancelled')
    return
  }

  // ================================================================
  // │                     Execute Transaction                      │
  // ================================================================
  console.log('\nExecuting transaction...')

  try {
    const txResponse = await poolContract.applyChainUpdates(
      remoteChainSelectorsToRemove,
      chainsToAdd,
    )
    console.log(`Transaction hash: ${txResponse.hash}`)
    console.log('⏳ Waiting for confirmation...')

    const receipt = await txResponse.wait()
    if (receipt?.status === 1) {
      console.log('✅ Transaction confirmed!')
      console.log(`Block: ${receipt.blockNumber}`)
      console.log(`Gas used: ${receipt.gasUsed}`)
      console.log(`Effective gas price: ${receipt.gasPrice}`)
    }
  } catch (error) {
    throw new Error(`Transaction execution failed: ${error.message}`)
  }
}
