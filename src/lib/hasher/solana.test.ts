/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { PublicKey } from '@solana/web3.js'
import { hexlify, toUtf8Bytes } from 'ethers'
import { type CCIPMessage, type CCIPVersion } from '../types.js'
import { hashSolanaMessage, hashSolanaMetadata } from './solana.js'

describe('solana hasher', () => {
  it('should hash Solana msg', () => {
    const msgId = '0xcdad95e113e35cf691295c1f42455d41062ba9a1b96a6280c1a5a678ef801721'
    const metadataHash = '0x9b885ffea8ce84fb687f634618c035dac43adc1ad8c9a7c7927ddc7c81581520'

    const solanaKey = new PublicKey('HXoMKDD4hb6VvrgrTZ6kpvJELQrVs4ABgZKTwa1yJNgb')

    const msg: CCIPMessage<CCIPVersion.V1_6> = {
      header: {
        messageId: msgId,
        sequenceNumber: 386n,
        nonce: 1n,
        sourceChainSelector: 124615329519749607n,
        destChainSelector: 16015286601757825753n,
      },
      sender: solanaKey.toBase58(),
      data: '0x',
      receiver: '0x269895ac2a2ec6e1df37f68acfbbda53e62b71b1',
      gasLimit: 5000n,
      extraArgs: '0x181dcf1000000000000000000000000000000000138800000000000000', // EVM extra args v2 + borsh encoded args
      feeToken: solanaKey.toBase58(),
      feeTokenAmount: 114310554250104n,
      feeValueJuels: 16499514422603741n,
      tokenAmounts: [
        {
          sourcePoolAddress: solanaKey.toBase58(),
          destTokenAddress: '0xb8d6a6a41d5dd732aec3c438e91523b7613b963b',
          destGasAmount: 10n,
          extraData: '0x0000000000000000000000000000000000000000000000000000000000000012',
          amount: 100000000000000000n,
          destExecData: '0x0a000000', // little-endian encoded uint32(10)
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
})
