import { encodeBase64, toBigInt } from 'ethers'
import { encodeExtraArgs } from '../extra-args.ts'
import { decodeMessage } from '../requests.ts'
import { type CCIPMessage, CCIPVersion } from '../types.ts'
import { getV16SolanaLeafHasher } from './solana.ts'

describe('MessageHasher', () => {
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
