import { ZeroAddress, getBigInt } from 'ethers'

import '../index.ts'
import type { CCIPMessage, CCIPMessage_V1_6, CCIPVersion } from '../types.ts'
import { getV12LeafHasher, getV16LeafHasher } from './hasher.ts'
import type { CCIPMessage_V1_6_EVM } from './messages.ts'

describe('EVM leaf hasher', () => {
  it('should hash v1.5 msg', () => {
    const sourceChainSelector = 1n,
      destChainSelector = 4n

    const onRamp = '0x5550000000000000000000000000000000000001'
    const hasher = getV12LeafHasher(sourceChainSelector, destChainSelector, onRamp)

    const header = {
      messageId: '0x1001',
      sequenceNumber: 1337n,
      nonce: 1337n,
      sourceChainSelector,
    }
    const message = {
      header,
      sourceChainSelector: sourceChainSelector,
      sender: '0x1110000000000000000000000000000000000001',
      receiver: '0x2220000000000000000000000000000000000001',
      sequenceNumber: header.sequenceNumber,
      gasLimit: 100n,
      strict: false,
      nonce: header.nonce,
      feeToken: ZeroAddress,
      feeTokenAmount: 1n,
      data: '0x',
      tokenAmounts: [
        { token: '0x4440000000000000000000000000000000000001', amount: 12345678900n } as any,
      ],
      sourceTokenData: [],
      messageId: header.messageId,
    } as CCIPMessage<typeof CCIPVersion.V1_5>

    const msgHash = hasher(message)
    expect(msgHash).toBe('0x46ad031bfb052db2e4a2514fed8dc480b98e5ce4acb55d5640d91407e0d8a3e9')
  })

  it('should hash v1.6 msg', () => {
    const sourceChainSelector = 5009297550715157269n,
      destChainSelector = 51875932522786413n

    const onRamp = '0x7d571a25eb5a09013580c60aeb40ed89c924082a'
    const hasher = getV16LeafHasher(sourceChainSelector, destChainSelector, onRamp)

    const header = {
      messageId: '0xf82dd9f9977f06d5c789d33299f15c3c693c9b7b084206c8c524c3620f966edd',
      sequenceNumber: 17624761845632355147n,
      nonce: 13974814057813369789n,
      sourceChainSelector,
      destChainSelector,
    }
    const extraArgs =
      '0x181dcf100000000000000000000000000000000000000000000000005eb3e65ecb9fb54e0000000000000000000000000000000000000000000000000000000000000001'
    const message: CCIPMessage_V1_6 = {
      header,
      sender: '0x00000000000000000000000021aa8a422bfb1a82e254331259c1cbbea7408b44',
      receiver: '0x56ad368c27ab9a428e9992c3843c79a35830794a',
      feeToken: '0x6627c714a7ba7cc17bddeffa83b36a3b969e4e6c',
      feeTokenAmount: 15188903849671844750n,
      feeValueJuels: 0n,
      extraArgs,
      data: '0xeed38ce567ddd944bb1c24619d50d373181a4faf1feed3f726a473df6c0a8dcd4c0fe0a09c843e930dabdd6ac5994025e99828e1d74df0641ec1f1d82c0ad1ab4c277721ba388a7742d711bbefb62182ae2c7ab1b80edaaf97f5527642e0ed167f69030792970994443aabfeceb0b12435f28cdb4925f82beacc1df9232b4f9734eed4c54b2cbe9276428a25ce2f3bea2735d205b40f8f0c488f3d584e6e197801c6d308b1e1d3f42b7cbfbeed21c72300b7126afa0002e20fadf43a8238fb8ac6f6612144fac1733fb1ef927c9d0cdf29eb08fe964e1afeeb845d547ace4ef2313df69b2f8f3d0b9714aa26e5d0a9a6d8f5b37680c617f524b7414e2f96e236b4d8efb037d025b1bcaff2f76b2696811c853283abb56d990197f21f7fbfef06044c31d42f7c8cac72a5a5b0a3f3a19cd24fec76d90efaf00a2b83e7eb9c817fbc667841c27a79168e49b68ecddb44a8e2877cf326a342a2b377dcafe3f692688dac17de842889bb0e2ee717092d2c53ce44a2d33760ab9791cbf9d1273eb2db7b59e741869037aeacfeb10132aa81f2bbc4b2626870f38d9e6a15636561bcbe93b16aef84c92d2b81798c1d332bc031911b8128765e2e74537c2416076ee587caf9178f6fc963ff0fc0a8c3d4551c7ab98bc26c42c4aa63ddbb1886f47456bf26275ef26dd1bde3ed3cabc064a3f1275240be0d799c649e30a3b9c36ba9a7a97e97cec75d6d2d1a6da15413614ebf3246126da03d41febaa07daaa205731336c1cffb3531d69c847f4fd9fb0daf1ee0975ab8a3bfc5251d9c32cca4def2f13540a6978c075d00856aa59c47ac80fb5598ab5646037121aa2b0f0512f7091a5ce33fb5a501c490b2390420c614e105f29abed474a4399c9823d56c88deef0e9de87af5b408cf0f506da2c2092da239383d1019734334125bdb489a8798e86000b6e9e8927d9193c4b0069cb5a3a54b149530229220193766e9f4e73e74d36a50b4166a65ce02aaad5ba014348d4c48562d781cbc246a4d56f5852d50f133a97d0bdf5cc176ac798d094a310f0fadb69bcd247b58199c4e7fa8e4e9662a046209af363e3cc1ebf501938b3bc2ebcbabf867e599c1f50f09be10e1c910973af651be066ed59ae9f136eba74a49f6c944c3b67b5bebdee8a1114781121ea15c9a2e53c8507d425c0cdd34e257e645427a7da23801a381366f74c75bc1c5fe9269423ad3a8be38702c91fee10bd88a6f4968819205f18a46ad290248cbfdf3f36e0ed15f0213326cdd284d40790a475b8e0678b0cdf5331e882e84236673a414259723b36d53d13dd956fef3d105bd5545da',
      tokenAmounts: [
        {
          sourcePoolAddress: '0x0000000000000000000000006987756a2fc8e4f3f0a5e026cb200cc2b5221b1f',
          destTokenAddress: '0xcc44ff0e5a1fc9a6f3224ef0f47f0c03b3f8eaee',
          extraData: '0xd8e78c2c6144d59c308cee0365b6d223a9cea73dd7a46e990505271b4abb47b4',
          amount: 4679472148560135273n,
          destExecData: '0x000000000000000000000000000000000000000000000000000000005a51fc6c',
        },
        {
          sourcePoolAddress: '0x00000000000000000000000036fdcc65c7703d0b34e88417b39e23c147e4c2b5',
          destTokenAddress: '0xfe217692ac9020d4003781c7b41b06fce0b1d936',
          extraData: '0x0180b0ebc736546d03caef8be134ba6da6cd18571e5b93c2cadbd136e8f105a7',
          amount: 2622048486368728793n,
          destExecData: '0x000000000000000000000000000000000000000000000000000000002b25ca57',
        },
        {
          sourcePoolAddress: '0x0000000000000000000000000c4aff7c5d8d71d059f7dd60642ecf43032be209',
          destTokenAddress: '0x83333769972daa43e880904c8aba7204fdfdfb1d',
          extraData: '0x0ccc82d97ad2fc9d273842e49b97d62c6a98620458afbbc947c06aedd8ce2825',
          amount: 4287026855703039806n,
          destExecData: '0x0000000000000000000000000000000000000000000000000000000042b81487',
        },
        {
          sourcePoolAddress: '0x00000000000000000000000016f7b1716017ecd77b1fc3adc01935361b60c21b',
          destTokenAddress: '0x4f65755dcf6dcd2cc097cf1bbf3edf63c10f47cc',
          extraData: '0x637ce69111efbf21ada2c3500d21a464f507b35cb773072f1f0e3e6b3727b4a2',
          amount: 12541689545585536263n,
          destExecData: '0x00000000000000000000000000000000000000000000000000000000cb9fbccb',
        },
        {
          sourcePoolAddress: '0x000000000000000000000000a04f5214f63cf4c5533854b504610ce396cf0e32',
          destTokenAddress: '0x3d2fd2372ee5e0861c1f9613becccc1d3a865e15',
          extraData: '0xf4ae17af521472c6dec069c2c457f440a69c0f4e17f2b4fbb86b230f91e9b6ca',
          amount: 14339435592708759294n,
          destExecData: '0x00000000000000000000000000000000000000000000000000000000c5bb273b',
        },
        {
          sourcePoolAddress: '0x000000000000000000000000b501a3cd1d7e1ca53d36de77657c3cd4d74e5a24',
          destTokenAddress: '0x2353f292d183dabfceaeab694e55260cd8962ec3',
          extraData: '0xba8ce764a1fd28accf94bfee7348e405c00195130dc0ba5631c3eee16edd8a44',
          amount: 14452973941833137994n,
          destExecData: '0x000000000000000000000000000000000000000000000000000000004a3374de',
        },
        {
          sourcePoolAddress: '0x000000000000000000000000a88d2eded1a56475eba868472d6d5f05cdc648d6',
          destTokenAddress: '0x01fae0388a4cd02b254eb91cc355062e6e79cb8e',
          extraData: '0x7779713152f2ba379cb8aa67afdb7ad48e7d4d9a3c526f2eb0e67c2cfbdcb914',
          amount: 15462212191244582558n,
          destExecData: '0x000000000000000000000000000000000000000000000000000000006858d6a3',
        },
        {
          sourcePoolAddress: '0x0000000000000000000000001c424bfd1ae4ce9505c446b7ccab820eff5ab9f4',
          destTokenAddress: '0x89256f8b9ff25cc28fa816f245814db8876fcbc6',
          extraData: '0x55aad1f0daf430642f21bee2349dab6f5fb7f784b1e7ef60b8e117e12124f75f',
          amount: 4088793534626193712n,
          destExecData: '0x0000000000000000000000000000000000000000000000000000000006b0cfb7',
        },
      ].map((ta) => ({ ...ta, destGasAmount: getBigInt(ta.destExecData) })),
    }

    const msgHash = hasher(message as CCIPMessage_V1_6_EVM)
    expect(msgHash).toBe('0xd56d9f4c0b0bb9cb8c83aeb676a02d5666583eee7d6d4660c87a06a9b36aa352')
  })
})
