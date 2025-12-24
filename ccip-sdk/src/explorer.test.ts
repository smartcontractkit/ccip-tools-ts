import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CCIP_EXPLORER_BASE_URL, getCCIPExplorerLinks, getCCIPExplorerUrl } from './explorer.ts'
import './index.ts'
import type { CCIPRequest } from './types.ts'

describe('getCCIPExplorerUrl', () => {
  it('should generate message URL', () => {
    const messageId = '0x54da064fc6080248aa42cc8dec9e1d19e55c5e21d9a662e06fe30915201ce553'
    const url = getCCIPExplorerUrl('msg', messageId)
    assert.equal(url, `${CCIP_EXPLORER_BASE_URL}/msg/${messageId}`)
  })

  it('should generate transaction URL', () => {
    const txHash = '0xaf8c73a7f872c831da535a62e3837fe5a62f1b92e4b09fddc773b956c3c27d56'
    const url = getCCIPExplorerUrl('tx', txHash)
    assert.equal(url, `${CCIP_EXPLORER_BASE_URL}/tx/${txHash}`)
  })

  it('should generate address URL', () => {
    const address = '0xbff1d393d0f318c4aaf54fdb670e63cb44ed3461'
    const url = getCCIPExplorerUrl('address', address)
    assert.equal(url, `${CCIP_EXPLORER_BASE_URL}/address/${address}`)
  })

  it('should use correct base URL', () => {
    assert.equal(CCIP_EXPLORER_BASE_URL, 'https://ccip.chain.link')
  })
})

describe('getCCIPExplorerLinks', () => {
  // Addresses are pre-decoded in the request (not 32-byte padded)
  // For EVM: 20-byte hex addresses
  // For Solana: base58 addresses
  const mockRequest: CCIPRequest = {
    lane: {
      sourceChainSelector: 16015286601757825753n,
      destChainSelector: 4949039107694359620n,
      onRamp: '0x1234567890123456789012345678901234567890',
      version: '1.6.0',
    },
    message: {
      messageId: '0x54da064fc6080248aa42cc8dec9e1d19e55c5e21d9a662e06fe30915201ce553',
      sender: '0xbff1d393d0f318c4aaf54fdb670e63cb44ed3461',
      receiver: '0xabc1234567890123456789012345678901234567',
      sourceChainSelector: 16015286601757825753n,
      destChainSelector: 4949039107694359620n,
      sequenceNumber: 100n,
      gasLimit: 200000n,
      nonce: 1n,
      feeToken: '0x0000000000000000000000000000000000000000',
      feeTokenAmount: 0n,
      feeValueJuels: 0n,
      strict: false,
      data: '0x',
      tokenAmounts: [],
      extraArgs: '0x',
      allowOutOfOrderExecution: false,
    },
    log: {
      address: '0x1234567890123456789012345678901234567890',
      index: 0,
      topics: [],
      data: '0x',
      blockNumber: 12345,
      transactionHash: '0xaf8c73a7f872c831da535a62e3837fe5a62f1b92e4b09fddc773b956c3c27d56',
    },
    tx: {
      hash: '0xaf8c73a7f872c831da535a62e3837fe5a62f1b92e4b09fddc773b956c3c27d56',
      logs: [],
      blockNumber: 12345,
      timestamp: 1234567890,
      from: '0xbff1d393d0f318c4aaf54fdb670e63cb44ed3461',
    },
  }

  it('should generate all explorer links from CCIPRequest', () => {
    const links = getCCIPExplorerLinks(mockRequest)

    assert.equal(
      links.message,
      'https://ccip.chain.link/msg/0x54da064fc6080248aa42cc8dec9e1d19e55c5e21d9a662e06fe30915201ce553',
    )
    assert.equal(
      links.transaction,
      'https://ccip.chain.link/tx/0xaf8c73a7f872c831da535a62e3837fe5a62f1b92e4b09fddc773b956c3c27d56',
    )
    // Addresses are used as-is (pre-decoded in the request)
    assert.equal(
      links.sender,
      'https://ccip.chain.link/address/0xbff1d393d0f318c4aaf54fdb670e63cb44ed3461',
    )
    assert.equal(
      links.receiver,
      'https://ccip.chain.link/address/0xabc1234567890123456789012345678901234567',
    )
  })
})
