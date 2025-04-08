import { getV16SolanaLeafHasher } from './solana.ts'

describe('MessageHasher', () => {
  // it('should handle a message solana->evm', () => {
  //   const message = {
  //     header: {
  //       messageId: '0x68acd1941a62d6c8c6558c6a718941a362298e6ab462e4ac5efe18adaf79826f',
  //       sourceChainSelector: BigInt('16423721717087811551'),
  //       destChainSelector: BigInt('16015286601757825753'),
  //       sequenceNumber: BigInt('22'),
  //       nonce: BigInt('22'),
  //       onRamp: '7oZnxiocDK1aa9XAQC3CZ1VHKFkKwLuwRK8NddhU3FT2',
  //     },
  //     sender: '7oZnxiocDK1aa9XAQC3CZ1VHKFkKwLuwRK8NddhU3FT2',
  //     receiver: '0xb8697ccb48fc82ccc6cc7fe5ec2bf6f3c4a20b90',
  //     data: '0x48617264636f6465642074657374206d65737361676520f09f9a80',
  //     extraArgs: '0x181dcf10400d030000000000000000000000000000',
  //     tokenAmounts: [],
  //     gasLimit: BigInt(200000),
  //     feeToken: 'So11111111111111111111111111111111111111112',
  //     feeTokenAmount: BigInt(0),
  //     feeValueJuels: BigInt(0),
  //   }

  //   const hasher = getV16SolanaLeafHasher(
  //     message.header.sourceChainSelector,
  //     message.header.destChainSelector,
  //     message.header.onRamp,
  //   )

  //   const finalHash = hasher(message)

  //   // The hash should be a valid hex string
  //   expect(finalHash).toMatch(/^0x[0-9a-f]+$/)
  // })

  it('should handle a message evm->solana', () => {
    const message = {
      header: {
        messageId: '0x898b23c46e54b60617d25fcce8bbfa3f76ca19d088f7c4262bfbe3d01224fa9b',
        sourceChainSelector: BigInt('16015286601757825753'),
        destChainSelector: BigInt('16423721717087811551'),
        sequenceNumber: BigInt('12'),
        nonce: BigInt('0'),
        onRamp: '6VecPuitt4qMaZrv13XegktViQEoSxVqqD6YbRYvBNVK',
      },
      sender: '0x5c25312c82791e6cb76dc9efabe2f5fa695d966b',
      receiver: '6VecPuitt4qMaZrv13XegktViQEoSxVqqD6YbRYvBNVK',
      data: '0xSSBhbSBhIENDSVAgdGVzdCBtZXNzYWdl',
      extraArgs:
        '0x1f3b3aba000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000051a1392cd840fad0274b2a4006fc2a0b8419d6ccd5411cbc651b476132de3e9e00000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000451a1392cd840fad0274b2a4006fc2a0b8419d6ccd5411cbc651b476132de3e9e00a175b24b08bb00ee274df7399741f55a8b9f8f128a6d690fd9d5d16eb48122763e9cd32a76a72a81c0fdc5bb5ef9a160c4e0bbde4d51852859d7672a9b72710000000000000000000000000000000000000000000000000000000000000000',
      tokenAmounts: [
        {
          sourcePoolAddress: '0xed10e7f1146769f2f9ef5615f8295e957ee67529',
          destTokenAddress: 'F3d8qABZEKYvVFEGbjgezvXC6eE5x4cBvwuusizifeaq',
          amount: BigInt('1000000000'),
          destExecData: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABX5A=',
          extraData: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABI=',
          destGasAmount: BigInt(0),
        },
      ],
      gasLimit: BigInt(32),
      feeToken: '0x097d90c9d3e0b50ca60e1ae45f6a81010f9fb534',
      feeTokenAmount: BigInt('157848216053394'),
      feeValueJuels: BigInt('22171214803845911'),
    }

    const hasher = getV16SolanaLeafHasher(
      message.header.sourceChainSelector,
      message.header.destChainSelector,
      message.header.onRamp,
    )

    const finalHash = hasher(message)

    // from a test in Go
    expect(finalHash).toBe('0xc3d05e33227a50e103192a0a3d24b29857e8d45c80022b8251ff523f13dee9f3')
  })
})
