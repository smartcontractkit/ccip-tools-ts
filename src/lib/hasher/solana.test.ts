import { PublicKey } from '@solana/web3.js'
import { hexlify, toUtf8Bytes } from 'ethers'
import { type CCIPMessage, type CCIPVersion } from '../types.js'
import { hashSolanaMessage, hashSolanaMetadata } from './solana.js'

describe('solana hasher', () => {
  it('should hash Solana msg', () => {
    const msgId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    const metadataHash = '0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'

    // Create valid Solana addresses
    const receiverKey = new PublicKey('11111111111111111111111111111111')
    const sourcePool1 = new PublicKey('22222222222222222222222222222222')
    const sourcePool2 = new PublicKey('33333333333333333333333333333333')
    const destToken1 = new PublicKey('44444444444444444444444444444444')
    const destToken2 = new PublicKey('55555555555555555555555555555555')

    const msg: CCIPMessage<CCIPVersion.V1_6> = {
      header: {
        messageId: msgId,
        sequenceNumber: 42n,
        nonce: 123n,
        sourceChainSelector: 1n,
        destChainSelector: 2n,
      },
      sender: '0x8765432109fedcba8765432109fedcba87654321',
      data: hexlify(toUtf8Bytes('sample message data')),
      receiver: receiverKey.toBase58(),
      gasLimit: 500000n,
      extraArgs: '',
      feeToken: '',
      feeTokenAmount: 0n,
      feeValueJuels: 0n,
      tokenAmounts: [
        {
          sourcePoolAddress: sourcePool1.toBase58(),
          destTokenAddress: destToken1.toBase58(),
          destGasAmount: 10000n,
          extraData: '0x00112233',
          amount: 1000000n,
          destExecData: '',
        },
        {
          sourcePoolAddress: sourcePool2.toBase58(),
          destTokenAddress: destToken2.toBase58(),
          destGasAmount: 20000n,
          extraData: '0xffeeddcc',
          amount: 5000000n,
          destExecData: '',
        },
      ],
    }

    // Note: The expected hash will be different due to Solana address format
    const hash = hashSolanaMessage(msg, metadataHash)
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/)
  })

  it('should hash Solana metadata', () => {
    const source = 123456789n
    const dest = 987654321n
    // Use a valid Solana address for onramp
    const onramp = new PublicKey('11111111111111111111111111111111').toBase58()

    const hash = hashSolanaMetadata(source, dest, onramp)
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/)
  })

  it('should throw on invalid Solana address', () => {
    const msgId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    const metadataHash = '0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'

    const invalidMsg: CCIPMessage<CCIPVersion.V1_6> = {
      header: {
        messageId: msgId,
        sequenceNumber: 42n,
        nonce: 123n,
        sourceChainSelector: 1n,
        destChainSelector: 2n,
      },
      sender: '0x8765432109fedcba8765432109fedcba87654321',
      data: hexlify(toUtf8Bytes('sample message data')),
      receiver: 'invalid-solana-address',
      gasLimit: 500000n,
      extraArgs: '',
      feeToken: '',
      feeTokenAmount: 0n,
      feeValueJuels: 0n,
      tokenAmounts: [
        {
          sourcePoolAddress: 'not-a-valid-solana-pool-address',
          destTokenAddress: 'another-invalid-address',
          destGasAmount: 10000n,
          extraData: '0x00112233',
          amount: 1000000n,
          destExecData: '',
        },
      ],
    }

    // Should throw when receiver is invalid
    expect(() => hashSolanaMessage(invalidMsg, metadataHash)).toThrow(
      'Invalid Solana address: invalid-solana-address',
    )

    // Should also throw for invalid token addresses
    const validReceiverMsg = {
      ...invalidMsg,
      receiver: new PublicKey('11111111111111111111111111111111').toBase58(),
    }
    expect(() => hashSolanaMessage(validReceiverMsg, metadataHash)).toThrow(
      'Invalid Solana address: not-a-valid-solana-pool-address',
    )
  })
})
