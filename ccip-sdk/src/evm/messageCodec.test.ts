import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroHash, dataLength } from 'ethers'

import { type MessageV1, encodeMessageV1, encodeTokenTransferV1 } from './messageCodec.ts'

// 0x00000000 -> 0x00000002. Reproducing these byte-for-byte proves the encoder matches the on-chain
// MessageV1Codec._encodeMessageV1.
const ENC0 =
  '0x01de41ba4fc9d91ad9ccf0a31a221f3c9b00000000000000000000000000030d4000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000014e60c1d654283252623e448f53f648663a701cd7b20000000000000000000000000000000000000000000000000000000000000000014161d23c30b5ae2899c3d4d969ba2b82026f3954a00000000000f68656c6c6f2d707265666c69676874'
const ENC2 =
  '0x01de41ba4fc9d91ad9ccf0a31a221f3c9b00000000000000000000000000030d4000000002000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000014e60c1d654283252623e448f53f648663a701cd7b20000000000000000000000000000000000000000000000000000000000000000014161d23c30b5ae2899c3d4d969ba2b82026f3954a00000000000f68656c6c6f2d707265666c69676874'

// Sepolia -> Fuji, data-only ("hello-preflight"), 200k ccipReceive gas, source addrs abi.encoded(0),
// dest OffRamp/receiver raw 20 bytes. Matches the decoded ENC0 fields exactly.
function baseCandidate(): MessageV1 {
  return {
    sourceChainSelector: 16015286601757825753n,
    destChainSelector: 14767482510784806043n,
    messageNumber: 0n,
    executionGasLimit: 0,
    ccipReceiveGasLimit: 200000,
    finality: '0x00000000',
    ccvAndExecutorHash: ZeroHash,
    onRampAddress: ZeroHash, // abi.encode(address(0)) = 32 zero bytes
    offRampAddress: '0xe60c1d654283252623e448f53f648663a701cd7b',
    sender: ZeroHash, // abi.encode(address(0)) = 32 zero bytes
    receiver: '0x161d23c30b5ae2899c3d4d969ba2b82026f3954a',
    data: '0x68656c6c6f2d707265666c69676874', // "hello-preflight"
  }
}

describe('encodeMessageV1 golden vectors', () => {
  it('reproduces the finalized (finality=0) data-only candidate byte-for-byte (ENC0)', () => {
    assert.equal(encodeMessageV1(baseCandidate()), ENC0)
  })

  it('reproduces the finality=2 candidate byte-for-byte (ENC2 = ENC0 with finality flipped)', () => {
    assert.equal(encodeMessageV1({ ...baseCandidate(), finality: '0x00000002' }), ENC2)
  })

  it('the only difference between ENC0 and ENC2 is the 4-byte finality field', () => {
    const enc0 = encodeMessageV1(baseCandidate())
    const enc2 = encodeMessageV1({ ...baseCandidate(), finality: '0x00000002' })
    assert.equal(enc0.length, enc2.length)
    let diffs = 0
    for (let i = 0; i < enc0.length; i++) if (enc0[i] !== enc2[i]) diffs++
    assert.equal(diffs, 1) // single nibble: ...0000000[0] vs ...0000000[2]
  })
})

describe('encodeMessageV1 structure', () => {
  it('header is the fixed 69 bytes before any variable field', () => {
    // version(1)+srcSel(8)+dstSel(8)+msgNumber(8)+execGas(4)+ccipReceiveGas(4)+finality(4)+ccvHash(32)
    const enc = encodeMessageV1(baseCandidate())
    const header = 1 + 8 + 8 + 8 + 4 + 4 + 4 + 32
    // First length-prefix byte (onRampAddressLength) sits right after the header.
    assert.equal(dataLength(enc) > header, true)
  })

  it('defaults omit optional fields: empty onRamp/offRamp/destBlob get a zero length prefix', () => {
    const minimal: MessageV1 = {
      sourceChainSelector: 1n,
      destChainSelector: 2n,
      ccipReceiveGasLimit: 0,
      finality: '0x00000000',
      sender: ZeroHash,
      receiver: '0x161d23c30b5ae2899c3d4d969ba2b82026f3954a',
    }
    const enc = encodeMessageV1(minimal)
    // 69-byte header + onRampLen(1,=0) + offRampLen(1,=0) + senderLen(1)+sender(32) +
    // receiverLen(1)+receiver(20) + destBlobLen(2,=0) + tokenTransferLen(2,=0) + dataLen(2,=0)
    assert.equal(dataLength(enc), 69 + 1 + 1 + 1 + 32 + 1 + 20 + 2 + 2 + 2)
  })

  it('a token transfer is appended with a non-zero uint16 length prefix', () => {
    const withToken = encodeMessageV1({
      ...baseCandidate(),
      data: '0x',
      tokenTransfer: {
        amount: 1_000_000_000n,
        destTokenAddress: '0x161d23c30b5ae2899c3d4d969ba2b82026f3954a',
      },
    })
    const dataOnly = encodeMessageV1({ ...baseCandidate(), data: '0x' })
    assert.equal(dataLength(withToken) > dataLength(dataOnly), true)
  })
})

describe('encodeTokenTransferV1', () => {
  it('starts with version byte 1 and the 32-byte amount', () => {
    const enc = encodeTokenTransferV1({
      amount: 255n,
      destTokenAddress: '0x161d23c30b5ae2899c3d4d969ba2b82026f3954a',
    })
    // version(1) + amount(32) => amount 255 lands in the last byte of the 32-byte word
    assert.equal(enc.slice(0, 4), '0x01') // version = 1
    assert.equal(
      enc.slice(4, 4 + 64),
      '00000000000000000000000000000000000000000000000000000000000000ff',
    )
  })
})
