import { encodeBase64, toBigInt } from 'ethers'
import { encodeExtraArgs } from '../extra-args.ts'
import { decodeMessage } from '../requests.ts'
import { type CCIPMessage, CCIPVersion } from '../types.ts'
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

  // https://github.com/smartcontractkit/chainlink-ccip/blob/34a541118d89c346e2c642b089a63c3f2b2df320/chains/solana/utils/ccip/ccip_messages_test.go#L28
  it('should handle a message evm->solana', () => {
    const extraArgs = encodeExtraArgs({
      computeUnits: 1_000,
      accountIsWritableBitmap: 1n,
      allowOutOfOrderExecution: false,
      tokenReceiver: 'DS2tt4BX7YwCw7yrDNwbAdnYrxjeCPeGJbHmZEYC8RTb',
      accounts: [
        'C8WSPj3yyus1YN3yNB6YA5zStYtbjQWtpmKadmvyUXq8',
        'CtEVnHsQzhTNWav8skikiV2oF6Xx7r7uGGa8eCDQtTjH',
      ],
    })
    const serializedMessage = `{
      "sender": "0x0102030000000000000000000000000000000000000000000000000000000000",
      "extraArgs": "${extraArgs}",
      "data": "${encodeBase64('0x040506')}",
      "header": {
        "nonce": 90,
        "messageId": "0x0805030000000000000000000000000000000000000000000000000000000000",
        "sequenceNumber": 89,
        "destChainSelector": 78,
        "sourceChainSelector": 67
      },
      "feeToken": "0x",
      "receiver": "",
      "tokenAmounts": [{
        "sourcePoolAddress": "0x00010203",
        "destTokenAddress": "DS2tt4BX7YwCw7yrDNwbAdnYrxjeCPeGJbHmZEYC8RTc",
        "destGasAmount": 100,
        "extraData": "0x040506",
        "amount": ${toBigInt('0x0101010101010101010101010101010101010101010101010101010101010101')}
      }],
      "feeValueJuels": 0,
      "feeTokenAmount": 0
    }`
    const onRamp = '0x010203'
    const message = decodeMessage(serializedMessage) as CCIPMessage<typeof CCIPVersion.V1_6>
    const lane = {
      sourceChainSelector: message.header.sourceChainSelector,
      destChainSelector: message.header.destChainSelector,
      onRamp: onRamp,
      version: CCIPVersion.V1_6,
    }

    const hasher = getV16SolanaLeafHasher(
      lane.sourceChainSelector,
      lane.destChainSelector,
      lane.onRamp,
    )

    const finalHash = hasher(message)

    expect(finalHash).toBe('0xbd8025f7b32386d93be284b6b4eb6f36c7b46ea157c0228f00ccba38fe7a448e')
  })
})
