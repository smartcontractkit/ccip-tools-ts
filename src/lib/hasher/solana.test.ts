import { hashSolanaMessage, hashSolanaMetadata } from './solana.ts'

describe('MessageHasher', () => {
  // it('should produce the correct hash for a given message', () => {
  //   // Input data
  //   const message = {
  //     header: {
  //       messageId: '0x1aa2a86dc31efafa83d23bcfb995cbd7f6782dbf716934fd7569c6efea0a619a',
  //       sourceChainSelector: BigInt('5009297550715157269'),
  //       destChainSelector: BigInt('18115915870697877033'),
  //       sequenceNumber: BigInt('11823385412078131434'),
  //       nonce: BigInt('12514368170944462735'),
  //       onRamp: 'F7C7643B92CC4877C02A8F192C9104E6BA35F3DD', // Solana format
  //     },
  //     sender: '', // solana address format
  //     receiver: '0xb8b5e7cb58dbd4fc6977a589dd99683c899da18565bd48514ca9861d311f13ce',
  //     data: '0xeddc29e3705e3fff5f0a4b9a76862de85288414d50562fbbedaf2ad96fd4f9487',
  //     // may not needed extraArgs
  //     extraArgs:
  //       '0x1f3b3aba0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000002ce6699cf4b8c4eb1e3ad15208ca1949a7a922968d81a996dba0ba2c489c32aa000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000012ce6699cf4b8c4eb1e3ad15208ca1949a7a922968d81a996dba0ba2c489c32aa',
  //     tokenAmounts: Array(5).fill({
  //       sourcePoolAddress:
  //         '0x44533274743442583759774377377972444e776241646e5972786a65435065474a62486d5a45594338525462',
  //       destTokenAddress: '0xb8b5e7cb58dbd4fc6977a589dd99683c899da18565bd48514ca9861d311f13ce',
  //       amount: BigInt('6242580831175532837'),
  //       destExecData: '0x000000000000000000000000000000000000000000000000000000000000000a',
  //       extraData: '0x',
  //       destGasAmount: BigInt(0),
  //     }),
  //     gasLimit: BigInt(10000),
  //     feeToken: '0x0000000000000000000000000000000000000000',
  //     feeTokenAmount: BigInt(0),
  //     feeValueJuels: BigInt(0),
  //   }

  //   // Calculate the hash
  //   const metadataHash = hashSolanaMetadata(
  //     message,
  //     message.header.sourceChainSelector,
  //     message.header.destChainSelector,
  //     message.header.onRamp,
  //   )

  //   const finalHash = hashSolanaMessage(message, metadataHash)

  //   // Expected hash
  //   const expectedHash = 'be81fff0b59c56bb857845d1576d60e307032055bbcae43e1da7b9ff4d9a0589'

  //   // Assert the hash matches
  //   expect(finalHash).toBe(expectedHash)
  // })

  // it('should throw error for invalid receiver length', () => {
  //   const message = {
  //     header: {
  //       messageId: '0x1aa2a86dc31efafa83d23bcfb995cbd7f6782dbf716934fd7569c6efea0a619a',
  //       sourceChainSelector: BigInt('5009297550715157269'),
  //       destChainSelector: BigInt('18115915870697877033'),
  //       sequenceNumber: BigInt('11823385412078131434'),
  //       nonce: BigInt('12514368170944462735'),
  //       onRamp: 'F7C7643B92CC4877C02A8F192C9104E6BA35F3DD', // Solana format
  //     },
  //     sender: '0x0000000000000000000000007912e127a46ca9a55e51700ed62a37a1960c9b2f',
  //     receiver: '0x1234', // Invalid length
  //     data: '0xeddc29e3705e3fff5f0a4b9a76862de85288414d50562fbbedaf2ad96fd4f9487',
  //     extraArgs:
  //       '0x1f3b3aba0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000002ce6699cf4b8c4eb1e3ad15208ca1949a7a922968d81a996dba0ba2c489c32aa000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000012ce6699cf4b8c4eb1e3ad15208ca1949a7a922968d81a996dba0ba2c489c32aa',
  //     tokenAmounts: [],
  //     gasLimit: BigInt(10000),
  //     feeToken: '0x0000000000000000000000000000000000000000',
  //     feeTokenAmount: BigInt(0),
  //     feeValueJuels: BigInt(0),
  //   }

  //   const metadataHash = hashSolanaMetadata(
  //     message,
  //     message.header.sourceChainSelector,
  //     message.header.destChainSelector,
  //     message.header.onRamp,
  //   )

  //   expect(() => hashSolanaMessage(message, metadataHash)).toThrow('invalid receiver length')
  // })

  // it('should throw error for invalid token address length', () => {
  //   const message = {
  //     header: {
  //       messageId: '0x1aa2a86dc31efafa83d23bcfb995cbd7f6782dbf716934fd7569c6efea0a619a',
  //       sourceChainSelector: BigInt('5009297550715157269'),
  //       destChainSelector: BigInt('18115915870697877033'),
  //       sequenceNumber: BigInt('11823385412078131434'),
  //       nonce: BigInt('12514368170944462735'),
  //       onRamp: 'F7C7643B92CC4877C02A8F192C9104E6BA35F3DD', // Solana format
  //     },
  //     sender: '0x0000000000000000000000007912e127a46ca9a55e51700ed62a37a1960c9b2f',
  //     receiver: '0xb8b5e7cb58dbd4fc6977a589dd99683c899da18565bd48514ca9861d311f13ce',
  //     data: '0xeddc29e3705e3fff5f0a4b9a76862de85288414d50562fbbedaf2ad96fd4f9487',
  //     extraArgs:
  //       '0x1f3b3aba0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000002ce6699cf4b8c4eb1e3ad15208ca1949a7a922968d81a996dba0ba2c489c32aa000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000012ce6699cf4b8c4eb1e3ad15208ca1949a7a922968d81a996dba0ba2c489c32aa',
  //     tokenAmounts: [
  //       {
  //         sourcePoolAddress:
  //           '0x44533274743442583759774377377972444e776241646e5972786a65435065474a62486d5a45594338525462',
  //         destTokenAddress: '0x1234', // Invalid length
  //         amount: BigInt('6242580831175532837'),
  //         destExecData: '0x000000000000000000000000000000000000000000000000000000000000000a',
  //         extraData: '0x',
  //         destGasAmount: BigInt(0),
  //       },
  //     ],
  //     gasLimit: BigInt(10000),
  //     feeToken: '0x0000000000000000000000000000000000000000',
  //     feeTokenAmount: BigInt(0),
  //     feeValueJuels: BigInt(0),
  //   }

  //   const metadataHash = hashSolanaMetadata(
  //     message,
  //     message.header.sourceChainSelector,
  //     message.header.destChainSelector,
  //     message.header.onRamp,
  //   )

  //   expect(() => hashSolanaMessage(message, metadataHash)).toThrow(
  //     'invalid DestTokenAddress length',
  //   )
  // })

  it('should handle a message with empty token amounts and Solana-specific addresses', () => {
    const message = {
      header: {
        messageId: '0x68acd1941a62d6c8c6558c6a718941a362298e6ab462e4ac5efe18adaf79826f',
        sourceChainSelector: BigInt('16423721717087811551'),
        destChainSelector: BigInt('16015286601757825753'),
        sequenceNumber: BigInt('22'),
        nonce: BigInt('22'),
        onRamp: '7oZnxiocDK1aa9XAQC3CZ1VHKFkKwLuwRK8NddhU3FT2',
      },
      sender: '7oZnxiocDK1aa9XAQC3CZ1VHKFkKwLuwRK8NddhU3FT2',
      receiver: '0xb8697ccb48fc82ccc6cc7fe5ec2bf6f3c4a20b90',
      data: '0x48617264636f6465642074657374206d65737361676520f09f9a80',
      extraArgs: '0x181dcf10400d030000000000000000000000000000',
      tokenAmounts: [],
      gasLimit: BigInt(200000),
      feeToken: 'So11111111111111111111111111111111111111112',
      feeTokenAmount: BigInt(0),
      feeValueJuels: BigInt(0),
    }

    const metadataHash = hashSolanaMetadata(
      message,
      message.header.sourceChainSelector,
      message.header.destChainSelector,
      message.header.onRamp,
    )

    const finalHash = hashSolanaMessage(message, metadataHash)

    // The hash should be a valid hex string
    expect(finalHash).toMatch(/^[0-9a-f]{64}$/)
  })
})
