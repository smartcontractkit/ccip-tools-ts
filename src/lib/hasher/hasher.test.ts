import { ZeroAddress } from 'ethers'

import type { CCIPMessage } from '../types.js'
import { getLeafHasher, hashInternal } from './hasher.js'

describe('leaf hasher', () => {
  it('should hash msg', () => {
    const sourceChainSelector = 1n,
      destChainSelector = 4n
    const onRamp = '0x5550000000000000000000000000000000000001'
    const hasher = getLeafHasher({ sourceChainSelector, destChainSelector, onRamp })

    const message: CCIPMessage = {
      sourceChainSelector: sourceChainSelector,
      sender: '0x1110000000000000000000000000000000000001',
      receiver: '0x2220000000000000000000000000000000000001',
      sequenceNumber: 1337n,
      gasLimit: 100n,
      strict: false,
      nonce: 1337n,
      feeToken: ZeroAddress,
      feeTokenAmount: 1n,
      data: '0x',
      tokenAmounts: [{ token: '0x4440000000000000000000000000000000000001', amount: 12345678900n }],
      sourceTokenData: [],
      messageId: '0x',
    }

    const msgHash = hasher(message)
    expect(msgHash).toBe('0x46ad031bfb052db2e4a2514fed8dc480b98e5ce4acb55d5640d91407e0d8a3e9')
  })

  it('should hash internal values', () => {
    const a = '0x01'
    const b = '0x02'
    const result = hashInternal(a, b)
    expect(result).toBe('0x93b82a55d406c553471937ba1e3176dfdacfc274e84c75b0cbf212388a8bd37b')
  })
})
