import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { concat, toBeHex } from 'ethers'

import '../index.ts' // Import to ensure all chains are registered for decodeAddress
import { type SourceTokenData, decodeMessageV1, parseSourceTokenData } from './messages.ts'

describe('encode/parseSourceTokenData', () => {
  const decoded: SourceTokenData = {
    sourcePoolAddress: '0x0000000000000000000000006987756a2fc8e4f3f0a5e026cb200cc2b5221b1f',
    destTokenAddress: '0x000000000000000000000000cc44ff0e5a1fc9a6f3224ef0f47f0c03b3f8eaee',
    extraData: '0xd8e78c2c6144d59c308cee0365b6d223a9cea73dd7a46e990505271b4abb47b4',
    destGasAmount: 1515322476n,
  }
  const encoded =
    '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000005a51fc6c00000000000000000000000000000000000000000000000000000000000000200000000000000000000000006987756a2fc8e4f3f0a5e026cb200cc2b5221b1f0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000cc44ff0e5a1fc9a6f3224ef0f47f0c03b3f8eaee0000000000000000000000000000000000000000000000000000000000000020d8e78c2c6144d59c308cee0365b6d223a9cea73dd7a46e990505271b4abb47b4'

  it('should parse v1.5 message.sourceTokenData', () => {
    assert.deepEqual(parseSourceTokenData(encoded), decoded)
  })
})

describe('decodeMessageV1', () => {
  it('should decode a minimal MessageV1 with no tokens or data', () => {
    // Manually construct a minimal MessageV1 encoded message
    const version = '0x01'
    const sourceChainSelector = toBeHex(5009297550715157269n, 8) // Ethereum Mainnet
    const destChainSelector = toBeHex(4949039107694359620n, 8) // Arbitrum One
    const messageNumber = '0x0000000000000064' // 100
    const executionGasLimit = '0x00030d40' // 200000
    const ccipReceiveGasLimit = '0x00030d40' // 200000
    const finality = '0x000a' // 10
    const ccvAndExecutorHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

    // Variable length fields
    const onRampAddressLength = '0x14' // 20 bytes
    const onRampAddress = '0x1111111111111111111111111111111111111111'
    const offRampAddressLength = '0x14' // 20 bytes
    const offRampAddress = '0x2222222222222222222222222222222222222222'
    const senderLength = '0x14' // 20 bytes
    const sender = '0x3333333333333333333333333333333333333333'
    const receiverLength = '0x14' // 20 bytes
    const receiver = '0x4444444444444444444444444444444444444444'
    const destBlobLength = '0x0000' // 0 bytes
    const tokenTransferLength = '0x0000' // 0 bytes
    const dataLength = '0x0000' // 0 bytes

    const encoded = concat([
      version,
      sourceChainSelector,
      destChainSelector,
      messageNumber,
      executionGasLimit,
      ccipReceiveGasLimit,
      finality,
      ccvAndExecutorHash,
      onRampAddressLength,
      onRampAddress,
      offRampAddressLength,
      offRampAddress,
      senderLength,
      sender,
      receiverLength,
      receiver,
      destBlobLength,
      tokenTransferLength,
      dataLength,
    ])

    const decoded = decodeMessageV1(encoded)

    assert.equal(decoded.sourceChainSelector, 5009297550715157269n)
    assert.equal(decoded.destChainSelector, 4949039107694359620n)
    assert.equal(decoded.messageNumber, 100n)
    assert.equal(decoded.executionGasLimit, 200000)
    assert.equal(decoded.ccipReceiveGasLimit, 200000)
    assert.equal(decoded.finality, 10)
    assert.equal(decoded.ccvAndExecutorHash, ccvAndExecutorHash)
    assert.equal(decoded.onRampAddress, '0x1111111111111111111111111111111111111111')
    assert.equal(decoded.offRampAddress, '0x2222222222222222222222222222222222222222')
    assert.equal(decoded.sender, '0x3333333333333333333333333333333333333333')
    assert.equal(decoded.receiver, '0x4444444444444444444444444444444444444444')
    assert.equal(decoded.destBlob, '0x')
    assert.equal(decoded.tokenTransfer.length, 0)
    assert.equal(decoded.data, '0x')
  })

  it('should decode a MessageV1 with token transfer and data', () => {
    // Message header
    const version = '0x01'
    const sourceChainSelector = toBeHex(5009297550715157269n, 8) // Ethereum Mainnet
    const destChainSelector = toBeHex(4949039107694359620n, 8) // Arbitrum One
    const messageNumber = '0x00000000000003e8' // 1000
    const executionGasLimit = '0x000493e0' // 300000
    const ccipReceiveGasLimit = '0x000186a0' // 100000
    const finality = '0x0014' // 20
    const ccvAndExecutorHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

    const onRampAddressLength = '0x14'
    const onRampAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const offRampAddressLength = '0x14'
    const offRampAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const senderLength = '0x14'
    const sender = '0xcccccccccccccccccccccccccccccccccccccccc'
    const receiverLength = '0x14'
    const receiver = '0xdddddddddddddddddddddddddddddddddddddddd'
    const destBlobLength = '0x0000'

    // Token transfer
    const tokenVersion = '0x01'
    const amount = '0x00000000000000000000000000000000000000000000000000000000000186a0' // 100000
    const sourcePoolAddressLength = '0x14'
    const sourcePoolAddress = '0x1111111111111111111111111111111111111111'
    const sourceTokenAddressLength = '0x14'
    const sourceTokenAddress = '0x2222222222222222222222222222222222222222'
    const destTokenAddressLength = '0x14'
    const destTokenAddress = '0x3333333333333333333333333333333333333333'
    const tokenReceiverLength = '0x14'
    const tokenReceiver = '0x4444444444444444444444444444444444444444'
    const extraDataLength = '0x0000'

    const tokenTransferEncoded = concat([
      tokenVersion,
      amount,
      sourcePoolAddressLength,
      sourcePoolAddress,
      sourceTokenAddressLength,
      sourceTokenAddress,
      destTokenAddressLength,
      destTokenAddress,
      tokenReceiverLength,
      tokenReceiver,
      extraDataLength,
    ])

    const tokenTransferLength = `0x${(tokenTransferEncoded.slice(2).length / 2).toString(16).padStart(4, '0')}`

    // Message data
    const messageData = '0x48656c6c6f' // "Hello" in hex
    const dataLength = '0x0005'

    const encoded = concat([
      version,
      sourceChainSelector,
      destChainSelector,
      messageNumber,
      executionGasLimit,
      ccipReceiveGasLimit,
      finality,
      ccvAndExecutorHash,
      onRampAddressLength,
      onRampAddress,
      offRampAddressLength,
      offRampAddress,
      senderLength,
      sender,
      receiverLength,
      receiver,
      destBlobLength,
      tokenTransferLength,
      tokenTransferEncoded,
      dataLength,
      messageData,
    ])

    const decoded = decodeMessageV1(encoded)

    assert.equal(decoded.sourceChainSelector, 5009297550715157269n)
    assert.equal(decoded.destChainSelector, 4949039107694359620n)
    assert.equal(decoded.messageNumber, 1000n)
    assert.equal(decoded.tokenTransfer.length, 1)
    assert.equal(decoded.tokenTransfer[0]!.amount, 100000n)
    assert.equal(
      decoded.tokenTransfer[0]!.sourcePoolAddress,
      '0x1111111111111111111111111111111111111111',
    )
    assert.equal(
      decoded.tokenTransfer[0]!.sourceTokenAddress,
      '0x2222222222222222222222222222222222222222',
    )
    assert.equal(
      decoded.tokenTransfer[0]!.destTokenAddress,
      '0x3333333333333333333333333333333333333333',
    )
    assert.equal(
      decoded.tokenTransfer[0]!.tokenReceiver,
      '0x4444444444444444444444444444444444444444',
    )
    assert.equal(decoded.tokenTransfer[0]!.extraData, '0x')
    assert.equal(decoded.data, messageData)
  })

  it('should throw on invalid version', () => {
    const invalidVersion = '0x02' // Version 2, not supported
    const encoded = concat([
      invalidVersion,
      toBeHex(5009297550715157269n, 8),
      toBeHex(4949039107694359620n, 8),
      '0x0000000000000064',
      '0x00030d40',
      '0x00030d40',
      '0x000a',
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      '0x14',
      '0x1111111111111111111111111111111111111111',
      '0x14',
      '0x2222222222222222222222222222222222222222',
      '0x14',
      '0x3333333333333333333333333333333333333333',
      '0x14',
      '0x4444444444444444444444444444444444444444',
      '0x0000',
      '0x0000',
      '0x0000',
    ])

    assert.throws(() => decodeMessageV1(encoded), /Invalid encoding version: 2/)
  })

  it('should throw on insufficient data', () => {
    const tooShort = '0x01' // Only version byte

    assert.throws(() => decodeMessageV1(tooShort), /MESSAGE_MIN_SIZE/)
  })
})
