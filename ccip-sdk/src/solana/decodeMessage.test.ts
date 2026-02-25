import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { CCIPMessage, CCIPVersion, ChainLog } from '../types.ts'
import '../index.ts'
import { SolanaChain } from './index.ts'

describe('SolanaChain.decodeMessage', () => {
  it('should correctly decode CCIPMessageSent event from Solana log', () => {
    // Test data from parseCCIPMessageSentEvent test
    // https://ccip.chain.link/#/side-drawer/msg/0xc8cad4f80de5b5c436c102beedfb2bef0797169730c340c1c2147c70ea7e05c0
    // https://explorer.solana.com/tx/4PJ8xD1ip6Limj49cdH6kqQHK2yGbqFj3ZgyySuNDHx2xppBVMDdFth9ArJwWb6GN5GFxZyWFDJiN8rKqRuXsA84?cluster=devnet
    const programData =
      'F01Jt3u5cznZGtnJT7pB3mcIAAAAAAAAyMrU+A3ltcQ2wQK+7fsr7weXFpcww0DBwhR8cOp+BcDfN+OU4sfs49ka2clPukHeZwgAAAAAAAAAAAAAAAAAAFYj5CcDWSru4rkavfS0b24pHEzu18G5iTPcau9cy94HAAAAACAAAAAAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUBUAAAAYHc8Qf8kSAAAAAAAAAAAAAAAAAAEGm4hX/quBhPtof2NGGMA12sQ53BrrO1WYoPAAAAAAAQEAAACyj5pu4elxk1FJg6M6L9oSK+l+h7GziUa6ZHUBTaWBEyAAAAAAAAAAAAAAAAAAAAAcfUsZbLDHsB10P7xhFqkCN5xyOEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACkWwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFECcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAMNQEigAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOq+HeV/AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

    const mockLog: ChainLog = {
      data: programData,
      topics: [],
      index: 0,
      address: 'CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P',
      blockNumber: 12345,
      transactionHash: '0x123',
    }

    const message = SolanaChain.decodeMessage(mockLog) as CCIPMessage<typeof CCIPVersion.V1_6>

    // ----- MESSAGE HEADER -----
    assert.equal(
      message.messageId.toLowerCase(),
      '0xc8cad4f80de5b5c436c102beedfb2bef0797169730c340c1c2147c70ea7e05c0',
    )
    assert.equal(message.sourceChainSelector, 16423721717087811551n) // Solana Devnet
    assert.equal(message.destChainSelector, 16015286601757825753n) // Ethereum Sepolia
    assert.equal(message.sequenceNumber, 2151n)
    assert.equal(message.nonce, 0n)

    // ----- MESSAGE -----
    assert.equal(message.sender, '6oFoex6ZdFuMcb7X3HHBKpqZUkEAyFAjwjTD8swn8iWA')
    assert.equal(message.receiver.toLowerCase(), '0xbd27cdab5c9109b3390b25b4dff7d970918cc550')
    assert.equal(message.data, '0x')

    // ----- TOKEN AMOUNTS -----
    assert.equal(message.tokenAmounts.length, 1)
    const tokenAmount = message.tokenAmounts[0]!

    assert.equal(tokenAmount.sourcePoolAddress, 'D22aGkYvJiFJ9tpxUV1RUWkNUy4FSUBk2NAvwQQD2G9Y')
    assert.equal(
      tokenAmount.destTokenAddress.toLowerCase(),
      '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
    )
    assert.equal(tokenAmount.amount, 10000n)
    assert.equal(
      tokenAmount.extraData.toLowerCase(),
      '0x000000000000000000000000000000000000000000000000000000000000a45b0000000000000000000000000000000000000000000000000000000000000005',
    )
    assert.equal(tokenAmount.destExecData.toLowerCase(), '0x00030d40')
    assert.equal(tokenAmount.destGasAmount, 200000n)

    // ----- FEE FIELDS -----
    assert.equal(message.feeToken, 'So11111111111111111111111111111111111111112')
    assert.equal(message.feeTokenAmount, 41032n)
    assert.equal(message.feeValueJuels, 422097000000000n)

    // ----- EXTRA ARGS -----
    assert.equal(message.extraArgs.toLowerCase(), '0x181dcf107fc9120000000000000000000000000001')
    assert.ok('gasLimit' in message)
    assert.equal(message.gasLimit, 1231231n)
  })

  it('should throw error for invalid log data', () => {
    const invalidLog: ChainLog = {
      data: '0xinvaliddata',
      topics: [],
      index: 0,
      address: 'CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P',
      blockNumber: 12345,
      transactionHash: '0x123',
    }

    assert.equal(SolanaChain.decodeMessage(invalidLog), undefined)
  })

  it('should throw error for missing log data', () => {
    const invalidLog: ChainLog = {
      data: '',
      topics: [],
      index: 0,
      address: 'CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P',
      blockNumber: 12345,
      transactionHash: '0x123',
    }

    assert.equal(SolanaChain.decodeMessage(invalidLog), undefined)
  })
})
