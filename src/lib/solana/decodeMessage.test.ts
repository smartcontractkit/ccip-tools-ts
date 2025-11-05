import '../index.ts'
import type { CCIPMessage, CCIPVersion, Log_ } from '../types.ts'
import { SolanaChain } from './index.ts'

describe('SolanaChain.decodeMessage', () => {
  it('should correctly decode CCIPMessageSent event from Solana log', () => {
    // Test data from parseCCIPMessageSentEvent test
    // https://ccip.chain.link/#/side-drawer/msg/0xc8cad4f80de5b5c436c102beedfb2bef0797169730c340c1c2147c70ea7e05c0
    // https://explorer.solana.com/tx/4PJ8xD1ip6Limj49cdH6kqQHK2yGbqFj3ZgyySuNDHx2xppBVMDdFth9ArJwWb6GN5GFxZyWFDJiN8rKqRuXsA84?cluster=devnet
    const programData =
      'F01Jt3u5cznZGtnJT7pB3mcIAAAAAAAAyMrU+A3ltcQ2wQK+7fsr7weXFpcww0DBwhR8cOp+BcDfN+OU4sfs49ka2clPukHeZwgAAAAAAAAAAAAAAAAAAFYj5CcDWSru4rkavfS0b24pHEzu18G5iTPcau9cy94HAAAAACAAAAAAAAAAAAAAAAAAAAC9J82rXJEJszkLJbTf99lwkYzFUBUAAAAYHc8Qf8kSAAAAAAAAAAAAAAAAAAEGm4hX/quBhPtof2NGGMA12sQ53BrrO1WYoPAAAAAAAQEAAACyj5pu4elxk1FJg6M6L9oSK+l+h7GziUa6ZHUBTaWBEyAAAAAAAAAAAAAAAAAAAAAcfUsZbLDHsB10P7xhFqkCN5xyOEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACkWwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFECcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAMNQEigAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOq+HeV/AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

    const mockLog: Log_ = {
      data: '0x' + Buffer.from(programData, 'base64').toString('hex'),
      topics: [],
      index: 0,
      address: 'CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P',
      blockNumber: 12345,
      transactionHash: '0x123',
    }

    const message = SolanaChain.decodeMessage(mockLog) as CCIPMessage<typeof CCIPVersion.V1_6>

    // ----- MESSAGE HEADER -----
    expect(message.header.messageId.toLowerCase()).toBe(
      '0xc8cad4f80de5b5c436c102beedfb2bef0797169730c340c1c2147c70ea7e05c0',
    )
    expect(message.header.sourceChainSelector).toBe(16423721717087811551n) // Solana Devnet
    expect(message.header.destChainSelector).toBe(16015286601757825753n) // Ethereum Sepolia
    expect(message.header.sequenceNumber).toBe(2151n)
    expect(message.header.nonce).toBe(0n)

    // ----- MESSAGE -----
    expect(message.sender).toBe('6oFoex6ZdFuMcb7X3HHBKpqZUkEAyFAjwjTD8swn8iWA')
    expect(message.receiver.toLowerCase()).toBe('0xbd27cdab5c9109b3390b25b4dff7d970918cc550')
    expect(message.data).toBe('0x')

    // ----- TOKEN AMOUNTS -----
    expect(message.tokenAmounts.length).toBe(1)
    const tokenAmount = message.tokenAmounts[0]

    expect(tokenAmount.sourcePoolAddress).toBe('D22aGkYvJiFJ9tpxUV1RUWkNUy4FSUBk2NAvwQQD2G9Y')
    expect(tokenAmount.destTokenAddress.toLowerCase()).toBe(
      '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
    )
    expect(tokenAmount.amount).toBe(10000n)
    expect(tokenAmount.extraData.toLowerCase()).toBe(
      '0x000000000000000000000000000000000000000000000000000000000000a45b0000000000000000000000000000000000000000000000000000000000000005',
    )
    expect(tokenAmount.destExecData.toLowerCase()).toBe('0x00030d40')
    expect(tokenAmount.destGasAmount).toBe(200000n)

    // ----- FEE FIELDS -----
    expect(message.feeToken).toBe('So11111111111111111111111111111111111111112')
    expect(message.feeTokenAmount).toBe(41032n)
    expect(message.feeValueJuels).toBe(422097000000000n)

    // ----- EXTRA ARGS -----
    expect(message.extraArgs.toLowerCase()).toBe('0x181dcf107fc9120000000000000000000000000001')
    expect('gasLimit' in message && message.gasLimit).toBe(1231231n)
  })

  it('should throw error for invalid log data', () => {
    const invalidLog: Log_ = {
      data: '0xinvaliddata',
      topics: [],
      index: 0,
      address: 'CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P',
      blockNumber: 12345,
      transactionHash: '0x123',
    }

    expect(SolanaChain.decodeMessage(invalidLog)).toBeUndefined()
  })

  it('should throw error for missing log data', () => {
    const invalidLog: Log_ = {
      data: '',
      topics: [],
      index: 0,
      address: 'CcipQ6z7nULJPwQyZnbRwiupj9Virv8oLJwSgxN2b55P',
      blockNumber: 12345,
      transactionHash: '0x123',
    }

    expect(SolanaChain.decodeMessage(invalidLog)).toBeUndefined()
  })
})
