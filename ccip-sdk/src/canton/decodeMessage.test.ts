import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getAddress, hexlify, toBeArray } from 'ethers'

// Register the EVM chain family so CantonChain.decodeMessage can decode the
// EVM-destination addresses embedded in the MessageV1 wire payload
import '../evm/index.ts'
import { CantonChain } from './index.ts'

const CANTON_TESTNET_SELECTOR = 9268731218649498074n
const SEPOLIA_SELECTOR = 16015286601757825753n
const MESSAGE_ID = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

/**
 * Build a minimal MessageV1 wire payload (layout per src/messages.ts):
 *   version(1) | source(8) | dest(8) | messageNumber(8) | executionGas(4) |
 *   ccipReceiveGas(4) | finality(4) | ccvAndExecutorHash(32) | onRamp(LV) |
 *   offRamp(LV) | sender(LV) | receiver(LV) | destBlob(LV16) |
 *   tokenTransfer(LV16) | data(LV16)
 */
function buildEncodedMessage(): string {
  // addresses use a 1-byte length prefix; blob/transfer/data use 2 bytes
  const lv = (bytes: Uint8Array | string): Uint8Array => {
    const b = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
    const len = new Uint8Array(2)
    new DataView(len.buffer).setUint16(0, b.length)
    return new Uint8Array([...len, ...b])
  }
  const l = (bytes: Uint8Array | string): Uint8Array => {
    const b = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
    return new Uint8Array([b.length, ...b])
  }
  const u32 = (n: number): Uint8Array => {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, n)
    return b
  }
  const u64 = (n: bigint): Uint8Array => {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setBigUint64(0, n)
    return b
  }
  const offRamp = toBeArray(getAddress(`0x${'ab'.repeat(20)}`))

  return hexlify(
    new Uint8Array([
      1, // version
      ...u64(CANTON_TESTNET_SELECTOR),
      ...u64(SEPOLIA_SELECTOR),
      ...u64(7n), // messageNumber
      ...u32(200_000), // executionGasLimit
      ...u32(0), // ccipReceiveGasLimit
      ...u32(0), // finality
      ...new Uint8Array(32).fill(0xab), // ccvAndExecutorHash
      ...l('onramp-party'), // onRamp (Canton party — not decodable from bytes)
      ...l(offRamp), // offRamp (EVM dest)
      ...l('sender::0'), // sender
      ...l(offRamp), // receiver
      ...lv(new Uint8Array(0)), // destBlob
      ...lv(new Uint8Array(0)), // tokenTransfer
      ...lv(toBeArray('0xdeadbeef')), // data
    ]),
  )
}

const ENCODED_MESSAGE = buildEncodedMessage()
// Daml stores hex payloads without the `0x` prefix
const ENCODED_MESSAGE_UNPREFIXED = ENCODED_MESSAGE.slice(2)

// A CCIPMessageSent CreatedEvent as returned per-log by CantonChain.getTransaction
const CREATED_EVENT = {
  offset: 100,
  nodeId: 1,
  contractId: '#1:1',
  templateId:
    'bfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f:CCIP.EventsV2.Events:CCIPMessageSent',
  packageName: 'ccip-events-v2',
  createArgument: {
    ccipOwner: 'ccip-owner::0',
    ccvOwners: [],
    sender: 'sender::0',
    observers: [],
    event: {
      destChainSelector: String(SEPOLIA_SELECTOR),
      sequenceNumber: '42.',
      messageId: MESSAGE_ID,
      feeToken: { admin: 'fee-admin::0', id: 'Amulet' },
      tokenAmountBeforeTokenPoolFees: '0',
      encodedMessage: ENCODED_MESSAGE_UNPREFIXED,
      verifierBlobs: [],
      receipts: [
        {
          issuerType: 'IssuerType_CCV',
          issuerAddress: 'ccv::0',
          versionTag: null,
          destGasLimit: '300000',
          destBytesOverhead: '200000',
          feeTokenAmount: '1500000000000',
          extraArgs: '',
        },
      ],
    },
  },
}

// CantonChain.decodeMessage returns a CCIPMessage built from the Canton event,
// which doesn't match any per-version CCIPMessage_* variant — shape it explicitly
type CantonDecodedMessage = {
  messageId: string
  encodedMessage: string
  sourceChainSelector: bigint
  destChainSelector: bigint
  sequenceNumber: bigint
  sender: string
  receiver: string
  onRampAddress: string
  offRampAddress: string
  data: string
  feeToken: string
  feeTokenAmount: bigint
  receipts: {
    issuer: string
    destGasLimit: bigint
    destBytesOverhead: bigint
    feeTokenAmount: bigint
    extraArgs: string
  }[]
  verifierBlobs: string[]
}

const DEFAULT_TX_HASH = '1220' + '0'.repeat(64)

describe('canton/CantonChain.decodeMessage', () => {
  it('decodes a CCIPMessageSent created event (log data from getTransaction)', () => {
    const message = CantonChain.decodeMessage({
      transactionHash: DEFAULT_TX_HASH,
      data: CREATED_EVENT,
    }) as CantonDecodedMessage | undefined
    assert.ok(message, 'expected the message to decode')
    assert.equal(message.messageId, `0x${MESSAGE_ID}`)
    assert.equal(message.encodedMessage, ENCODED_MESSAGE)
    // sourceChainSelector is omitted by CCIPMessageSentEvent; read from the wire payload
    assert.equal(message.sourceChainSelector, CANTON_TESTNET_SELECTOR)
    assert.equal(message.destChainSelector, SEPOLIA_SELECTOR)
    assert.equal(message.sequenceNumber, 42n)
    assert.equal(message.sender, 'sender::0')
    // offRamp comes from the wire payload; onRamp is a Canton party, passed
    // through as raw hex bytes (CantonChain.getAddress can't decode bytes)
    assert.equal(message.offRampAddress, getAddress(`0x${'ab'.repeat(20)}`))
    assert.equal(message.onRampAddress, hexlify(new TextEncoder().encode('onramp-party')))
    assert.equal(message.feeToken, 'Amulet@fee-admin::0')
    assert.equal(message.feeTokenAmount, 1_500_000_000_000n)
    assert.deepEqual(message.receipts, [
      {
        issuer: 'ccv::0',
        destGasLimit: 300_000n,
        destBytesOverhead: 200_000n,
        feeTokenAmount: 1_500_000_000_000n,
        extraArgs: '',
      },
    ])
    assert.deepEqual(message.verifierBlobs, [])
  })

  it('falls back to the transaction hash for empty message ids', () => {
    const txHash = '1220' + 'c'.repeat(64)
    const message = CantonChain.decodeMessage({
      transactionHash: txHash,
      data: {
        ...CREATED_EVENT,
        createArgument: {
          ...CREATED_EVENT.createArgument,
          event: { ...CREATED_EVENT.createArgument.event, messageId: '' },
        },
      },
    }) as CantonDecodedMessage | undefined
    assert.ok(message, 'expected the message to decode')
    assert.equal(message.messageId, `0x${txHash}`)
  })

  it('returns undefined for other events', () => {
    assert.equal(
      CantonChain.decodeMessage({
        transactionHash: DEFAULT_TX_HASH,
        data: {
          ...CREATED_EVENT,
          templateId:
            'bfe1045f369796e1f8320e3c3d3b43142009ce1e8a6773b57b12f49c357c2f3f:CCIP.EventsV2.Events:ExecutionStateChanged',
          createArgument: {},
        },
      }),
      undefined,
    )
    // Full transaction trees are not accepted — only single created events
    assert.equal(
      CantonChain.decodeMessage({
        transactionHash: DEFAULT_TX_HASH,
        data: { updateId: '1220abc', events: [{ CreatedEvent: CREATED_EVENT }] },
      }),
      undefined,
    )
    assert.equal(
      CantonChain.decodeMessage({
        transactionHash: DEFAULT_TX_HASH,
        data: { templateId: 'x:y:Z' },
      }),
      undefined,
    )
    assert.equal(
      CantonChain.decodeMessage({ transactionHash: DEFAULT_TX_HASH, data: '1220abc' }),
      undefined,
    )
  })
})
