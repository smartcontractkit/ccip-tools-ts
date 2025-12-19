import { type Address, Cell, Dictionary, beginCell } from '@ton/core'
import type { TonClient4 } from '@ton/ton'

import {
  CCIPTransactionNotFinalizedError,
  CCIPTransactionNotFoundError,
} from '../errors/specialized.ts'
import type { WithLogger } from '../types.ts'
import { bytesToBuffer, sleep } from '../utils.ts'

/**
 * Converts hex string to Buffer, handling 0x prefix normalization
 * Returns empty buffer for empty input
 */
export const hexToBuffer = (value: string): Buffer => {
  if (!value || value === '0x' || value === '0X') return Buffer.alloc(0)
  // Normalize to lowercase 0x prefix for bytesToBuffer/getDataBytes
  let normalized: string
  if (value.startsWith('0x')) {
    normalized = value
  } else if (value.startsWith('0X')) {
    normalized = `0x${value.slice(2)}`
  } else {
    normalized = `0x${value}`
  }
  return bytesToBuffer(normalized)
}

/**
 * Attempts to parse hex string as TON BOC (Bag of Cells) format
 * Falls back to storing raw bytes as cell data if BOC parsing fails
 * Used for parsing message data, extra data, and other hex-encoded fields
 */
export const tryParseCell = (hex: string): Cell => {
  const bytes = hexToBuffer(hex)
  if (bytes.length === 0) return beginCell().endCell()
  try {
    return Cell.fromBoc(bytes)[0]
  } catch {
    return beginCell().storeBuffer(bytes).endCell()
  }
}

/**
 * Extracts the 32-bit magic tag from a BOC-encoded cell
 * Magic tags identify the type of TON structures (e.g., extra args types)
 * Used for type detection and validation when decoding CCIP extra args
 * Returns tag as 0x-prefixed hex string for easy comparison
 */
export function extractMagicTag(bocHex: string): string {
  const cell = Cell.fromBoc(hexToBuffer(bocHex))[0]
  const tag = cell.beginParse().loadUint(32)
  return `0x${tag.toString(16).padStart(8, '0')}`
}

/**
 * Waits for a transaction to be confirmed by polling until the wallet's seqno advances.
 * Once seqno advances past expectedSeqno, fetches the latest transaction details.
 *
 * @param client - TON V4 client
 * @param walletAddress - Address of the wallet that sent the transaction
 * @param expectedSeqno - The seqno used when sending the transaction
 * @param expectedDestination - Optional destination address to verify (e.g., offRamp)
 * @param maxAttempts - Maximum polling attempts (default: 25)
 * @param intervalMs - Polling interval in ms (default: 1000)
 * @returns Transaction info with lt and hash
 */
export async function waitForTransaction(
  client: TonClient4,
  walletAddress: Address,
  expectedSeqno: number,
  expectedDestination?: Address,
  maxAttempts = 25,
  intervalMs = 1000,
): Promise<{ lt: string; hash: string; timestamp: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Get latest block for state lookup (V4 API requires block seqno)
      const lastBlock = await client.getLastBlock()

      // Check current seqno by running the getter
      const seqnoResult = await client.runMethod(lastBlock.last.seqno, walletAddress, 'seqno')
      const currentSeqno = seqnoResult.reader.readNumber()

      const seqnoAdvanced = currentSeqno > expectedSeqno

      if (seqnoAdvanced) {
        // Get account state to find latest transaction
        const account = await client.getAccountLite(lastBlock.last.seqno, walletAddress)
        if (!account.account.last) {
          await sleep(intervalMs)
          continue
        }

        // Get recent transactions using V4 API
        const txs = await client.getAccountTransactions(
          walletAddress,
          BigInt(account.account.last.lt),
          Buffer.from(account.account.last.hash, 'base64'),
        )

        for (const { tx } of txs) {
          // If destination verification requested, check outgoing messages
          if (expectedDestination) {
            const outMessages = tx.outMessages.values()
            let destinationMatch = false

            for (const msg of outMessages) {
              if (msg.info.type === 'internal' && msg.info.dest.equals(expectedDestination)) {
                destinationMatch = true
                break
              }
            }

            if (!destinationMatch) continue
          }

          return {
            lt: tx.lt.toString(),
            hash: tx.hash().toString('hex'),
            timestamp: tx.now,
          }
        }
      }

      // Handle case where contract was just deployed (seqno 0 -> 1)
      if (expectedSeqno === 0 && attempt > 0) {
        const account = await client.getAccountLite(lastBlock.last.seqno, walletAddress)
        if (account.account.last) {
          const txs = await client.getAccountTransactions(
            walletAddress,
            BigInt(account.account.last.lt),
            Buffer.from(account.account.last.hash, 'base64'),
          )
          if (txs.length > 0) {
            const { tx } = txs[0]
            return {
              lt: tx.lt.toString(),
              hash: tx.hash().toString('hex'),
              timestamp: tx.now,
            }
          }
        }
      }
    } catch {
      // Contract might not be initialized yet, or network error - retry
    }

    await sleep(intervalMs)
  }

  throw new CCIPTransactionNotFinalizedError(String(expectedSeqno))
}

/**
 * Parses snake format data from a cell.
 * Snake format: first byte indicates format (0x00), followed by string data that may span multiple cells.
 */
function parseSnakeData(cell: Cell): string {
  const slice = cell.beginParse()

  // Check first byte. Should be 0x00 for snake format
  if (slice.remainingBits >= 8) {
    const firstByte = slice.preloadUint(8)
    if (firstByte === 0x00) {
      // Standard snake format. skip the indicator byte
      slice.loadUint(8)
    }
    // If not 0x00, the data might be stored directly without indicator
  }

  // Load the string, following references if needed
  let result = ''

  // Load available bits as string
  const bits = slice.remainingBits
  if (bits > 0) {
    // Round down to nearest byte
    const bytes = Math.floor(bits / 8)
    if (bytes > 0) {
      const buffer = slice.loadBuffer(bytes)
      result = buffer.toString('utf-8')
    }
  }

  // Follow references for continuation (snake format can span multiple cells)
  while (slice.remainingRefs > 0) {
    const refCell = slice.loadRef()
    const refSlice = refCell.beginParse()
    const refBits = refSlice.remainingBits
    if (refBits > 0) {
      const refBytes = Math.floor(refBits / 8)
      if (refBytes > 0) {
        const buffer = refSlice.loadBuffer(refBytes)
        result += buffer.toString('utf-8')
      }
    }
    break
  }

  return result
}

/**
 * Fetches Jetton metadata from an external URI.
 * Handles IPFS and HTTP(S) URIs.
 */
async function fetchOffchainJettonMetadata(
  uri: string,
  rateLimitedFetch: typeof fetch,
  logger?: { debug?: (...args: unknown[]) => void },
): Promise<{ symbol: string; decimals: number }> {
  // Default values
  let symbol = 'JETTON'
  let decimals = 9

  try {
    // Normalize URI
    let normalizedUri = uri
    if (uri.startsWith('ipfs://')) {
      normalizedUri = 'https://ipfs.io/ipfs/' + uri.slice(7)
    } else if (uri.startsWith('Qm') && uri.length >= 46) {
      normalizedUri = 'https://ipfs.io/ipfs/' + uri
    }

    if (!normalizedUri.startsWith('http://') && !normalizedUri.startsWith('https://')) {
      return { symbol, decimals }
    }

    const response = await rateLimitedFetch(normalizedUri, {
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      return { symbol, decimals }
    }

    const metadata = (await response.json()) as {
      symbol?: string
      decimals?: number | string
    }

    if (metadata.symbol && typeof metadata.symbol === 'string') {
      symbol = metadata.symbol
    }

    if (metadata.decimals !== undefined) {
      const dec =
        typeof metadata.decimals === 'string' ? parseInt(metadata.decimals, 10) : metadata.decimals
      if (!isNaN(dec) && dec >= 0 && dec <= 255) {
        decimals = dec
      }
    }
  } catch (error) {
    logger?.debug?.(`Failed to fetch offchain jetton metadata from ${uri}:`, error)
  }

  return { symbol, decimals }
}

/** SHA256 hashes of known TEP-64 attribute names */
const TEP64_HASHES = {
  symbol: BigInt('0xb76a7ca153c24671658335bbd08946350ffc621fa1c516e7123095d4ffd5c581'),
  decimals: BigInt('0xee80fd2f1e03480e2282363596ee752d7bb27f50776b95086a0279189675923e'),
  uri: BigInt('0x70e5d7b6a29b392f85076fe15ca2f2053c56c2338728c4e33c9e8ddb1ee827cc'),
} as const

/**
 * Parses onchain metadata dictionary to extract symbol and decimals.
 * If symbol is not found, checks for URI key to fetch offchain metadata.
 */
async function parseOnchainDict(
  dict: Dictionary<bigint, Cell>,
  rateLimitedFetch: typeof fetch,
  logger?: { debug?: (...args: unknown[]) => void },
): Promise<{ symbol: string; decimals: number }> {
  let symbol = 'JETTON'
  let decimals = 9

  // Try to get symbol from dict
  const symbolCell = dict.get(TEP64_HASHES.symbol)
  if (symbolCell) {
    const parsed = parseSnakeData(symbolCell)
    if (parsed) {
      symbol = parsed
    }
  }

  // Try to get decimals from dict
  const decimalsCell = dict.get(TEP64_HASHES.decimals)
  if (decimalsCell) {
    const decStr = parseSnakeData(decimalsCell)
    const parsed = parseInt(decStr, 10)
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 255) {
      decimals = parsed
    }
  }

  // If symbol not found in dict, check for URI key and fetch offchain
  if (symbol === 'JETTON') {
    const uriCell = dict.get(TEP64_HASHES.uri)
    if (uriCell) {
      const uri = parseSnakeData(uriCell)
      if (uri && (uri.startsWith('http') || uri.startsWith('ipfs://') || uri.startsWith('Qm'))) {
        const offchain = await fetchOffchainJettonMetadata(uri, rateLimitedFetch, logger)
        symbol = offchain.symbol
        // Only use offchain decimals if we didn't get it from onchain
        if (decimals === 9) {
          decimals = offchain.decimals
        }
      }
    }
  }

  return { symbol, decimals }
}

/**
 * Parses Jetton content cell to extract metadata.
 * Supports onchain (0x00), offchain (0x01), and semichain (0x02) formats per TEP-64.
 */
export async function parseJettonContent(
  contentCell: Cell,
  rateLimitedFetch: typeof fetch,
  logger?: { debug?: (...args: unknown[]) => void },
): Promise<{ symbol: string; decimals: number }> {
  const slice = contentCell.beginParse()

  // Default values
  const symbol = 'JETTON'
  const decimals = 9

  try {
    // Check content type (first byte)
    const contentType = slice.loadUint(8)

    if (contentType === 0x00) {
      // Onchain metadata - dictionary may be inline or in a reference
      let dict: Dictionary<bigint, Cell> | undefined

      // Check if there's remaining data for inline dict
      if (slice.remainingBits > 1) {
        try {
          dict = slice.loadDict(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell())
        } catch {
          // Failed, will try from ref below
        }
      }

      // If no inline dict, check for Maybe ^Cell pattern (1 bit + ref)
      if (!dict && slice.remainingBits >= 1 && slice.remainingRefs > 0) {
        const hasDict = slice.loadBit()
        if (hasDict) {
          const dictCell = slice.loadRef()
          try {
            dict = dictCell
              .beginParse()
              .loadDictDirect(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell())
          } catch {
            try {
              dict = Dictionary.loadDirect(
                Dictionary.Keys.BigUint(256),
                Dictionary.Values.Cell(),
                dictCell.beginParse(),
              )
            } catch {
              logger?.debug?.('Onchain: failed to load dict from ref')
            }
          }
        }
      }

      // If still no dict, try loading directly from first ref
      if (!dict && contentCell.refs.length > 0) {
        try {
          const refSlice = contentCell.refs[0].beginParse()
          dict = refSlice.loadDictDirect(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell())
        } catch {
          logger?.debug?.('Onchain: failed to load dict directly from ref')
        }
      }

      if (dict) {
        return await parseOnchainDict(dict, rateLimitedFetch, logger)
      }

      return { symbol, decimals }
    } else if (contentType === 0x01) {
      // Offchain metadata: URI stored in remaining bits
      const uri = slice.loadStringTail()
      return fetchOffchainJettonMetadata(uri, rateLimitedFetch, logger)
    } else if (contentType === 0x02) {
      // Semichain metadata per TEP-64
      let onchainResult = { symbol: 'JETTON', decimals: 9 }
      let uri = ''

      // Load dictionary directly from remaining slice data
      try {
        const dict = slice.loadDictDirect(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell())
        onchainResult = await parseOnchainDict(dict, rateLimitedFetch, logger)
      } catch (e) {
        logger?.debug?.('Semichain: failed to load dict directly:', e)
      }

      // After dictionary, there may be a URI in remaining bits or refs
      if (slice.remainingBits > 0) {
        try {
          uri = slice.loadStringTail()
        } catch {
          logger?.debug?.('Semichain: failed to load URI from remaining bits')
        }
      }

      // If no URI in bits, try from cell reference
      if (!uri && slice.remainingRefs > 0) {
        try {
          const uriCell = slice.loadRef()
          const uriSlice = uriCell.beginParse()

          if (uriSlice.remainingBits >= 8) {
            const firstByte = uriSlice.preloadUint(8)
            if (firstByte === 0x01) {
              uriSlice.loadUint(8)
            }
          }
          uri = uriSlice.loadStringTail()
        } catch {
          logger?.debug?.('Semichain: failed to load URI from ref')
        }
      }

      // If we got valid symbol from onchain dict, use it
      if (onchainResult.symbol !== 'JETTON') {
        return onchainResult
      }

      // Otherwise try fetching from URI
      if (uri && (uri.startsWith('http') || uri.startsWith('ipfs://') || uri.startsWith('Qm'))) {
        const offchainResult = await fetchOffchainJettonMetadata(uri, rateLimitedFetch, logger)
        return {
          symbol: offchainResult.symbol,
          decimals: onchainResult.decimals !== 9 ? onchainResult.decimals : offchainResult.decimals,
        }
      }

      return onchainResult
    }
  } catch (error) {
    logger?.debug?.('Failed to parse jetton content:', error)
  }

  return { symbol, decimals }
}

/**
 * Looks up a transaction by raw hash using the TonCenter V3 API.
 *
 * This is necessary because TON's V4 API requires (address, lt, hash) for lookups,
 * but users typically only have the raw transaction hash from explorers.
 * TonCenter V3 provides an index that allows hash-only lookups.
 *
 * @param hash - Raw 64-char hex transaction hash
 * @param isTestnet - Whether to use testnet API
 * @param rateLimitedFetch - Rate-limited fetch function
 * @param logger - Logger instance
 * @returns Transaction identifier components needed for V4 API lookup
 */
export async function lookupTxByRawHash(
  hash: string,
  isTestnet: boolean,
  rateLimitedFetch: typeof fetch,
  logger: WithLogger['logger'],
): Promise<{
  account: string
  lt: string
  hash: string
}> {
  const baseUrl = isTestnet
    ? 'https://testnet.toncenter.com/api/v3/transactions'
    : 'https://toncenter.com/api/v3/transactions'

  // TonCenter V3 accepts hex directly
  const cleanHash = hash.startsWith('0x') ? hash.slice(2) : hash

  const url = `${baseUrl}?hash=${cleanHash}`
  logger?.debug?.(`TonCenter V3 lookup: ${url}`)

  let response: Response
  try {
    response = await rateLimitedFetch(url, {
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    logger?.error?.(`TonCenter V3 fetch failed:`, error)
    throw new CCIPTransactionNotFoundError(hash, { cause: error as Error })
  }

  let data: { transactions?: Array<{ account: string; lt: string; hash: string }> }
  try {
    data = (await response.json()) as typeof data
  } catch (error) {
    logger?.error?.(`TonCenter V3 JSON parse failed:`, error)
    throw new CCIPTransactionNotFoundError(hash, { cause: error as Error })
  }

  logger?.debug?.(`TonCenter V3 response:`, data)

  if (!data.transactions || data.transactions.length === 0) {
    logger?.debug?.(`TonCenter V3: no transactions found for hash ${cleanHash}`)
    throw new CCIPTransactionNotFoundError(hash)
  }

  return data.transactions[0]
}
