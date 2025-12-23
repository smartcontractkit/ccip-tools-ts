/**
 * CCIP Explorer URL generation utilities.
 *
 * The CCIP Explorer (https://ccip.chain.link) provides visual tracking
 * for cross-chain messages, transactions, and addresses.
 *
 * @example
 * ```typescript
 * import { getCCIPExplorerUrl } from '@chainlink/ccip-sdk'
 *
 * // Get URL for a message
 * const messageUrl = getCCIPExplorerUrl('msg', '0x54da064fc6...')
 * // => 'https://ccip.chain.link/msg/0x54da064fc6...'
 *
 * // Get URL for a transaction
 * const txUrl = getCCIPExplorerUrl('tx', '0xaf8c73a7f8...')
 * // => 'https://ccip.chain.link/tx/0xaf8c73a7f8...'
 *
 * // Get URL for an address
 * const addressUrl = getCCIPExplorerUrl('address', '0xbff1d393d0...')
 * // => 'https://ccip.chain.link/address/0xbff1d393d0...'
 * ```
 */

import type { CCIPRequest, CCIPVersion } from './types.ts'

/** CCIP Explorer base URL */
export const CCIP_EXPLORER_BASE_URL = 'https://ccip.chain.link'

/** URL types supported by CCIP Explorer */
export type ExplorerLinkType = 'msg' | 'tx' | 'address'

/**
 * Generate a CCIP Explorer URL for a message, transaction, or address.
 *
 * @param type - The type of link: 'msg' for message ID, 'tx' for transaction hash, 'address' for wallet/contract address
 * @param value - The message ID, transaction hash, or address
 * @returns The full CCIP Explorer URL
 *
 * @example
 * ```typescript
 * getCCIPExplorerUrl('msg', '0x54da064fc6080248aa42cc8dec9e1d19e55c5e21d9a662e06fe30915201ce553')
 * // => 'https://ccip.chain.link/msg/0x54da064fc6080248aa42cc8dec9e1d19e55c5e21d9a662e06fe30915201ce553'
 * ```
 */
export function getCCIPExplorerUrl(type: ExplorerLinkType, value: string): string {
  return `${CCIP_EXPLORER_BASE_URL}/${type}/${value}`
}

/**
 * Explorer links generated from a CCIPRequest.
 */
export interface CCIPExplorerLinks {
  /** URL to view the CCIP message */
  message: string
  /** URL to view the source transaction */
  transaction: string
  /** URL to view all messages from the sender */
  sender: string
  /** URL to view all messages to the receiver */
  receiver: string
}

/**
 * Generate all explorer URLs from a CCIPRequest.
 *
 * @param request - The CCIP request containing message and transaction data
 * @returns Object with URLs for message, transaction, sender, and receiver
 *
 * @example
 * ```typescript
 * const request = await source.sendMessage(router, destChainSelector, message, { wallet })
 * const links = getCCIPExplorerLinks(request)
 *
 * console.log('Message:', links.message)
 * console.log('Transaction:', links.transaction)
 * console.log('Sender:', links.sender)
 * console.log('Receiver:', links.receiver)
 * ```
 */
export function getCCIPExplorerLinks<V extends CCIPVersion>(
  request: CCIPRequest<V>,
): CCIPExplorerLinks {
  return {
    message: getCCIPExplorerUrl('msg', request.message.messageId),
    transaction: getCCIPExplorerUrl('tx', request.tx.hash),
    sender: getCCIPExplorerUrl('address', request.message.sender),
    receiver: getCCIPExplorerUrl('address', request.message.receiver),
  }
}
