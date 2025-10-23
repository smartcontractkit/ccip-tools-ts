import { hexlify, toUtf8Bytes, zeroPadValue } from 'ethers'

import { encodeExtraArgs } from '../extra-args.ts'
import { hashAptosMetadata, hashV16AptosMessage } from './hasher.ts'
import type { CCIPMessage_V1_6_EVM } from '../evm/messages.ts'

describe('aptos hasher', () => {
  // Aptos encoding tests mimic the Move test: https://github.com/smartcontractkit/chainlink-internal-integrations/blob/develop/aptos/contracts/ccip/sources/offramp.move#L1517
  it('should hash Aptos msg', () => {
    const messageId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    const metadataHash = '0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
    const gasLimit = 500000n

    const msg: CCIPMessage_V1_6_EVM = {
      header: {
        messageId,
        sequenceNumber: 42n,
        nonce: 123n,
        sourceChainSelector: 1n,
        destChainSelector: 2n,
      },
      sender: '0x8765432109fedcba8765432109fedcba87654321',
      data: hexlify(toUtf8Bytes('sample message data')),
      receiver: zeroPadValue('0x1234', 32),
      feeToken: '',
      feeTokenAmount: 0n,
      feeValueJuels: 0n,
      tokenAmounts: [
        {
          sourcePoolAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
          destTokenAddress: zeroPadValue('0x5678', 32),
          destGasAmount: 10000n,
          extraData: '0x00112233',
          amount: 1000000n,
          destExecData: '',
        },
        {
          sourcePoolAddress: '0x123456789abcdef123456789abcdef123456789a',
          destTokenAddress: zeroPadValue('0x9abc', 32),
          destGasAmount: 20000n,
          extraData: '0xffeeddcc',
          amount: 5000000n,
          destExecData: '',
        },
      ],
      extraArgs: encodeExtraArgs({ gasLimit }),
      gasLimit,
      allowOutOfOrderExecution: false,
    }

    expect(hashV16AptosMessage(msg, metadataHash)).toBe(
      '0xc8d6cf666864a60dd6ecd89e5c294734c53b3218d3f83d2d19a3c3f9e200e00d',
    )
  })

  it('should hash Aptos metadata', () => {
    const source = 123456789n
    const dest = 987654321n
    const onramp = hexlify(toUtf8Bytes('source-onramp-address'))

    expect(hashAptosMetadata(source, dest, onramp)).toBe(
      '0x812acb01df318f85be452cf6664891cf5481a69dac01e0df67102a295218dd17',
    )
  })
})
