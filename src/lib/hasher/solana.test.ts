/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { PublicKey } from '@solana/web3.js'
import { hexlify, toUtf8Bytes } from 'ethers'
import { type CCIPMessage, type CCIPVersion } from '../types.js'
import { hashSolanaMessage, hashSolanaMetadata } from './solana.js'

describe('solana hasher', () => {
  it('should hash Solana msg', () => {
    const msgId = '0x2c5e01a5f3de3e74d1fd196ca431d7b40cba0b51d8c9a7c7927ddc7c81581500'
    const metadataHash = '0x9b885ffea8ce84fb687f634618c035dac43adc1ad8c9a7c7927ddc7c81581520'

    const receiverKey = new PublicKey('EZWYeuSRZ82fptywrP6RsBTZsvxpMsYgd2va7T33ByKa')
    const sourcePool1 = new PublicKey('9KRL5MTQXJPtsvSRVxrgRfAoZXtnCKjwkq4udt8nf1NV')
    const sourcePool2 = new PublicKey('DLXh3D1MCP3KWxMK4gdnBDknTVqSXm2znPLkQwNHcd6S')
    const destToken1 = new PublicKey('6K7sGRcM57i6JLe5qTkifBUfb6aGzuNChjFusSYirwxE')
    const destToken2 = new PublicKey('2Mh3GbFtVRcqb4H9BbznL1dBqxQw5FUAPVSwa8Ky7qsn')

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

    const hash = hashSolanaMessage(msg, metadataHash)
    expect(hash).toMatch(/^0x[a-f0-9]{64}$/)
  })

  it('should hash Solana metadata', () => {
    const source = 123456789n
    const dest = 987654321n
    const onrampKey = new PublicKey('HXoMKDD4hb6VvrgrTZ6kpvJELQrVs4ABgZKTwa1yJNgb')
    const onramp = onrampKey.toBase58()

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
    expect(() => hashSolanaMessage(invalidMsg, metadataHash)).toThrow(
      'Invalid Solana address: invalid-solana-address',
    )
    const validReceiverMsg = {
      ...invalidMsg,
      receiver: new PublicKey('11111111111111111111111111111111').toBase58(),
    }
    expect(() => hashSolanaMessage(validReceiverMsg, metadataHash)).toThrow(
      'Invalid Solana address: not-a-valid-solana-pool-address',
    )
  })
})
