import { Cell, Dictionary, beginCell } from '@ton/core'
import { hexlify, toBeHex } from 'ethers'

import { CCIPTransactionNotFoundError } from '../errors/specialized.ts'
import { type WithLogger, NetworkType } from '../types.ts'
import { bytesToBuffer } from '../utils.ts'

/**
 * Attempts to parse hex string as TON BOC (Bag of Cells) format
 * Falls back to storing raw bytes as cell data if BOC parsing fails
 * Used for parsing message data, extra data, and other hex-encoded fields
 */
export const tryParseCell = (hex: string): Cell => {
  const bytes = bytesToBuffer(hex)
  if (bytes.length === 0) return beginCell().endCell()
  try {
    return Cell.fromBoc(bytes)[0]!
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
export function extractMagicTag(cell: string | Cell): string {
  if (typeof cell === 'string') cell = Cell.fromBoc(bytesToBuffer(cell))[0]!
  const tag = cell.beginParse().loadBuffer(4)
  return hexlify(tag)
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
          const refSlice = contentCell.refs[0]!.beginParse()
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
 * @param networkType - Network type (mainnet or testnet)
 * @param fetch - Rate-limited fetch function
 * @param logger - Logger instance
 * @returns Transaction identifier components needed for V4 API lookup
 */
export async function lookupTxByRawHash(
  hash: string,
  networkType: NetworkType,
  fetch = globalThis.fetch,
  { logger = console }: WithLogger = {},
): Promise<{
  account: string
  lt: string
  hash: string
}> {
  const baseUrl =
    networkType === NetworkType.Mainnet
      ? 'https://toncenter.com/api/v3/transactions'
      : 'https://testnet.toncenter.com/api/v3/transactions'

  // TonCenter V3 accepts hex directly
  const cleanHash = bytesToBuffer(hash).toString('hex')
  const url = `${baseUrl}?hash=${cleanHash}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    logger.error(`TonCenter V3 fetch failed:`, error)
    throw new CCIPTransactionNotFoundError(hash, { cause: error as Error })
  }

  let data: { transactions?: Array<{ account: string; lt: string; hash: string }> } | undefined
  try {
    data = (await response.json()) as typeof data
  } catch (error) {
    logger.error(`TonCenter V3 JSON parse failed:`, error)
    throw new CCIPTransactionNotFoundError(hash, { cause: error as Error })
  }

  logger.debug(`TonCenter V3 response:`, data)

  if (!data?.transactions?.length) {
    logger.debug(`TonCenter V3: no transactions found for hash ${cleanHash}`)
    throw new CCIPTransactionNotFoundError(hash)
  }

  return data.transactions[0]!
}

const crcTable =
  '00000000 77073096 EE0E612C 990951BA 076DC419 706AF48F E963A535 9E6495A3 0EDB8832 79DCB8A4 E0D5E91E 97D2D988 09B64C2B 7EB17CBD E7B82D07 90BF1D91 1DB71064 6AB020F2 F3B97148 84BE41DE 1ADAD47D 6DDDE4EB F4D4B551 83D385C7 136C9856 646BA8C0 FD62F97A 8A65C9EC 14015C4F 63066CD9 FA0F3D63 8D080DF5 3B6E20C8 4C69105E D56041E4 A2677172 3C03E4D1 4B04D447 D20D85FD A50AB56B 35B5A8FA 42B2986C DBBBC9D6 ACBCF940 32D86CE3 45DF5C75 DCD60DCF ABD13D59 26D930AC 51DE003A C8D75180 BFD06116 21B4F4B5 56B3C423 CFBA9599 B8BDA50F 2802B89E 5F058808 C60CD9B2 B10BE924 2F6F7C87 58684C11 C1611DAB B6662D3D 76DC4190 01DB7106 98D220BC EFD5102A 71B18589 06B6B51F 9FBFE4A5 E8B8D433 7807C9A2 0F00F934 9609A88E E10E9818 7F6A0DBB 086D3D2D 91646C97 E6635C01 6B6B51F4 1C6C6162 856530D8 F262004E 6C0695ED 1B01A57B 8208F4C1 F50FC457 65B0D9C6 12B7E950 8BBEB8EA FCB9887C 62DD1DDF 15DA2D49 8CD37CF3 FBD44C65 4DB26158 3AB551CE A3BC0074 D4BB30E2 4ADFA541 3DD895D7 A4D1C46D D3D6F4FB 4369E96A 346ED9FC AD678846 DA60B8D0 44042D73 33031DE5 AA0A4C5F DD0D7CC9 5005713C 270241AA BE0B1010 C90C2086 5768B525 206F85B3 B966D409 CE61E49F 5EDEF90E 29D9C998 B0D09822 C7D7A8B4 59B33D17 2EB40D81 B7BD5C3B C0BA6CAD EDB88320 9ABFB3B6 03B6E20C 74B1D29A EAD54739 9DD277AF 04DB2615 73DC1683 E3630B12 94643B84 0D6D6A3E 7A6A5AA8 E40ECF0B 9309FF9D 0A00AE27 7D079EB1 F00F9344 8708A3D2 1E01F268 6906C2FE F762575D 806567CB 196C3671 6E6B06E7 FED41B76 89D32BE0 10DA7A5A 67DD4ACC F9B9DF6F 8EBEEFF9 17B7BE43 60B08ED5 D6D6A3E8 A1D1937E 38D8C2C4 4FDFF252 D1BB67F1 A6BC5767 3FB506DD 48B2364B D80D2BDA AF0A1B4C 36034AF6 41047A60 DF60EFC3 A867DF55 316E8EEF 4669BE79 CB61B38C BC66831A 256FD2A0 5268E236 CC0C7795 BB0B4703 220216B9 5505262F C5BA3BBE B2BD0B28 2BB45A92 5CB36A04 C2D7FFA7 B5D0CF31 2CD99E8B 5BDEAE1D 9B64C2B0 EC63F226 756AA39C 026D930A 9C0906A9 EB0E363F 72076785 05005713 95BF4A82 E2B87A14 7BB12BAE 0CB61B38 92D28E9B E5D5BE0D 7CDCEFB7 0BDBDF21 86D3D2D4 F1D4E242 68DDB3F8 1FDA836E 81BE16CD F6B9265B 6FB077E1 18B74777 88085AE6 FF0F6A70 66063BCA 11010B5C 8F659EFF F862AE69 616BFFD3 166CCF45 A00AE278 D70DD2EE 4E048354 3903B3C2 A7672661 D06016F7 4969474D 3E6E77DB AED16A4A D9D65ADC 40DF0B66 37D83BF0 A9BCAE53 DEBB9EC5 47B2CF7F 30B5FFE9 BDBDF21C CABAC28A 53B39330 24B4A3A6 BAD03605 CDD70693 54DE5729 23D967BF B3667A2E C4614AB8 5D681B02 2A6F2B94 B40BBE37 C30C8EA1 5A05DF1B 2D02EF8D'
    .split(' ')
    .map((s) => parseInt(s, 16))

/**
 * Calculates the 4B (32bits, int4) crc32 of a given string
 */
export function crc32(str: string) {
  let crc = -1
  for (let i = 0, iTop = str.length; i < iTop; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ str.charCodeAt(i)) & 0xff]!
  }
  return toBeHex((crc ^ -1) >>> 0, 4)
}
