import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZeroAddress, concat, toBeHex, zeroPadValue } from 'ethers'

import { EVMChain } from './index.ts'
import {
  EVMExtraArgsV1Tag,
  EVMExtraArgsV2Tag,
  SVMExtraArgsV1Tag,
  SuiExtraArgsV1Tag,
} from '../extra-args.ts'
import { defaultAbiCoder, interfaces } from './const.ts'
import { CCIPVersion, ExecutionState } from '../types.ts'

import '../index.ts'

const testAddresses = {
  sender: '0x1110000000000000000000000000000000000001',
  receiver: '0x2220000000000000000000000000000000000002',
  feeToken: '0x3330000000000000000000000000000000000003',
  onRamp: '0x4440000000000000000000000000000000000004',
  token1: '0x5550000000000000000000000000000000000005',
  token2: '0x6660000000000000000000000000000000000006',
  sourcePool: '0x7770000000000000000000000000000000000007',
  destToken: '0x8880000000000000000000000000000000000008',
  onRamp2: '0x9990000000000000000000000000000000000009',
  other: '0xaaa000000000000000000000000000000000000a',
}

const testHash = {
  messageId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  messageId2: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  merkleRoot: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
  merkleRoot2: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  messageHash: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  unknown: '0x9999999999999999999999999999999999999999999999999999999999999999',
}

const bytes32 = {
  tokenReceiver: '0x0102030405060708091011121314151617181920212223242526272829303132',
  account1: '0x1111111111111111111111111111111111111111111111111111111111111111',
  account2: '0x2222222222222222222222222222222222222222222222222222222222222222',
}

function padAddress(addr: string): string {
  return zeroPadValue(addr, 32)
}

describe('EVMChain.decodeMessage', () => {
  describe('v1.5 CCIPSendRequested', () => {
    it('should decode a basic v1.5 message', () => {
      const fragment = interfaces.EVM2EVMOnRamp_v1_5.getEvent('CCIPSendRequested')!
      const encoded = interfaces.EVM2EVMOnRamp_v1_5.encodeEventLog(fragment, [
        {
          sourceChainSelector: 1n,
          sender: testAddresses.sender,
          receiver: testAddresses.receiver,
          sequenceNumber: 100n,
          gasLimit: 200_000n,
          strict: false,
          nonce: 1n,
          feeToken: testAddresses.feeToken,
          feeTokenAmount: 1000n,
          data: '0x1234',
          tokenAmounts: [],
          sourceTokenData: [],
          messageId: testHash.messageId,
        },
      ])

      const result = EVMChain.decodeMessage({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)
      assert.equal(result.sender.toLowerCase(), testAddresses.sender.toLowerCase())
      assert.equal(result.receiver.toLowerCase(), testAddresses.receiver.toLowerCase())
      assert.equal(result.feeToken.toLowerCase(), testAddresses.feeToken.toLowerCase())
      assert.equal(result.messageId, testHash.messageId)
      assert.equal(result.sequenceNumber, 100n)
      assert.equal(result.nonce, 1n)
      assert.equal(result.sourceChainSelector, 1n)
    })

    it('should decode message with token amounts', () => {
      const fragment = interfaces.EVM2EVMOnRamp_v1_5.getEvent('CCIPSendRequested')!
      const encoded = interfaces.EVM2EVMOnRamp_v1_5.encodeEventLog(fragment, [
        {
          sourceChainSelector: 1n,
          sender: testAddresses.sender,
          receiver: testAddresses.receiver,
          sequenceNumber: 1n,
          gasLimit: 100_000n,
          strict: false,
          nonce: 1n,
          feeToken: ZeroAddress,
          feeTokenAmount: 0n,
          data: '0x',
          tokenAmounts: [
            { token: testAddresses.token1, amount: 1000n },
            { token: testAddresses.token2, amount: 2000n },
          ],
          sourceTokenData: [],
          messageId: testHash.messageId,
        },
      ])

      const result = EVMChain.decodeMessage({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)
      assert.equal(result.tokenAmounts.length, 2)
      const ta0 = result.tokenAmounts[0] as { token?: string; amount: bigint }
      const ta1 = result.tokenAmounts[1] as { token?: string; amount: bigint }
      assert.equal(ta0.token?.toLowerCase(), testAddresses.token1.toLowerCase())
      assert.equal(ta0.amount, 1000n)
      assert.equal(ta1.token?.toLowerCase(), testAddresses.token2.toLowerCase())
      assert.equal(ta1.amount, 2000n)
    })

    it('should set allowOutOfOrderExecution when nonce is 0', () => {
      const fragment = interfaces.EVM2EVMOnRamp_v1_5.getEvent('CCIPSendRequested')!
      const encoded = interfaces.EVM2EVMOnRamp_v1_5.encodeEventLog(fragment, [
        {
          sourceChainSelector: 1n,
          sender: testAddresses.sender,
          receiver: testAddresses.receiver,
          sequenceNumber: 1n,
          gasLimit: 100_000n,
          strict: false,
          nonce: 0n,
          feeToken: ZeroAddress,
          feeTokenAmount: 0n,
          data: '0x',
          tokenAmounts: [],
          sourceTokenData: [],
          messageId: testHash.messageId,
        },
      ])

      const result = EVMChain.decodeMessage({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)
      assert.equal(
        (result as { allowOutOfOrderExecution?: boolean }).allowOutOfOrderExecution,
        true,
      )
    })
  })

  describe('v1.6 CCIPMessageSent', () => {
    it('should decode a basic v1.6 message', () => {
      const sourceChainSelector = 5009297550715157269n
      const destChainSelector = 4949039107694359620n

      const extraArgs = concat([
        EVMExtraArgsV2Tag,
        defaultAbiCoder.encode(['tuple(uint256,bool)'], [[200_000n, false]]),
      ])

      const fragment = interfaces.OnRamp_v1_6.getEvent('CCIPMessageSent')!
      const encoded = interfaces.OnRamp_v1_6.encodeEventLog(fragment, [
        destChainSelector,
        500n,
        {
          header: {
            messageId: testHash.messageId,
            sourceChainSelector,
            destChainSelector,
            sequenceNumber: 500n,
            nonce: 10n,
          },
          sender: testAddresses.sender,
          data: '0xabcd',
          receiver: padAddress(testAddresses.receiver),
          extraArgs,
          feeToken: testAddresses.feeToken,
          feeTokenAmount: 5000n,
          feeValueJuels: 100n,
          tokenAmounts: [],
        },
      ])

      const result = EVMChain.decodeMessage({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)
      assert.equal(result.sender.toLowerCase(), testAddresses.sender.toLowerCase())
      assert.equal(result.receiver.toLowerCase(), testAddresses.receiver.toLowerCase())
      assert.equal(result.feeToken.toLowerCase(), testAddresses.feeToken.toLowerCase())
      assert.equal(result.messageId, testHash.messageId)
      assert.equal(result.sequenceNumber, 500n)
      assert.equal(result.nonce, 10n)
      assert.equal(result.sourceChainSelector, sourceChainSelector)
      assert.equal((result as { destChainSelector?: bigint }).destChainSelector, destChainSelector)
      assert.equal(result.data, '0xabcd')
    })

    it('should decode and merge EVMExtraArgsV2', () => {
      const extraArgs = concat([
        EVMExtraArgsV2Tag,
        defaultAbiCoder.encode(['tuple(uint256,bool)'], [[300_000n, true]]),
      ])

      const fragment = interfaces.OnRamp_v1_6.getEvent('CCIPMessageSent')!
      const encoded = interfaces.OnRamp_v1_6.encodeEventLog(fragment, [
        1n,
        1n,
        {
          header: {
            messageId: testHash.messageId,
            sourceChainSelector: 5009297550715157269n,
            destChainSelector: 1n,
            sequenceNumber: 1n,
            nonce: 1n,
          },
          sender: testAddresses.sender,
          data: '0x',
          receiver: padAddress(testAddresses.receiver),
          extraArgs,
          feeToken: ZeroAddress,
          feeTokenAmount: 0n,
          feeValueJuels: 0n,
          tokenAmounts: [],
        },
      ])

      const result = EVMChain.decodeMessage({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)
      const evmResult = result as { gasLimit?: bigint; allowOutOfOrderExecution?: boolean }
      assert.equal(evmResult.gasLimit, 300_000n)
      assert.equal(evmResult.allowOutOfOrderExecution, true)
    })

    it('should decode and merge EVMExtraArgsV1', () => {
      const extraArgs = concat([
        EVMExtraArgsV1Tag,
        defaultAbiCoder.encode(['tuple(uint256)'], [[150_000n]]),
      ])

      const fragment = interfaces.OnRamp_v1_6.getEvent('CCIPMessageSent')!
      const encoded = interfaces.OnRamp_v1_6.encodeEventLog(fragment, [
        1n,
        1n,
        {
          header: {
            messageId: testHash.messageId,
            sourceChainSelector: 5009297550715157269n,
            destChainSelector: 1n,
            sequenceNumber: 1n,
            nonce: 1n,
          },
          sender: testAddresses.sender,
          data: '0x',
          receiver: padAddress(testAddresses.receiver),
          extraArgs,
          feeToken: ZeroAddress,
          feeTokenAmount: 0n,
          feeValueJuels: 0n,
          tokenAmounts: [],
        },
      ])

      const result = EVMChain.decodeMessage({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)
      assert.equal((result as { gasLimit?: bigint }).gasLimit, 150_000n)
    })

    it('should decode v1.6 token amounts with destExecData', () => {
      const destGasAmount = 100_000n

      const extraArgs = concat([
        EVMExtraArgsV2Tag,
        defaultAbiCoder.encode(['tuple(uint256,bool)'], [[200_000n, false]]),
      ])

      const fragment = interfaces.OnRamp_v1_6.getEvent('CCIPMessageSent')!
      const encoded = interfaces.OnRamp_v1_6.encodeEventLog(fragment, [
        1n,
        1n,
        {
          header: {
            messageId: testHash.messageId,
            sourceChainSelector: 5009297550715157269n,
            destChainSelector: 1n,
            sequenceNumber: 1n,
            nonce: 1n,
          },
          sender: testAddresses.sender,
          data: '0x',
          receiver: padAddress(testAddresses.receiver),
          extraArgs,
          feeToken: ZeroAddress,
          feeTokenAmount: 0n,
          feeValueJuels: 0n,
          tokenAmounts: [
            {
              sourcePoolAddress: testAddresses.sourcePool,
              destTokenAddress: padAddress(testAddresses.destToken),
              extraData: '0x',
              amount: 5000n,
              destExecData: zeroPadValue(toBeHex(destGasAmount), 32),
            },
          ],
        },
      ])

      const result = EVMChain.decodeMessage({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)
      assert.equal(result.tokenAmounts.length, 1)
      const ta = result.tokenAmounts[0] as {
        sourcePoolAddress?: string
        destTokenAddress?: string
        amount: bigint
        destGasAmount?: bigint
      }
      assert.equal(ta.sourcePoolAddress?.toLowerCase(), testAddresses.sourcePool.toLowerCase())
      assert.equal(ta.destTokenAddress?.toLowerCase(), testAddresses.destToken.toLowerCase())
      assert.equal(ta.amount, 5000n)
      assert.equal(ta.destGasAmount, destGasAmount)
    })

    it('should not have numeric keys in decoded message', () => {
      const sourceChainSelector = 5009297550715157269n
      const destChainSelector = 4949039107694359620n

      const extraArgs = concat([
        EVMExtraArgsV2Tag,
        defaultAbiCoder.encode(['tuple(uint256,bool)'], [[200_000n, false]]),
      ])

      const fragment = interfaces.OnRamp_v1_6.getEvent('CCIPMessageSent')!
      const encoded = interfaces.OnRamp_v1_6.encodeEventLog(fragment, [
        destChainSelector,
        500n,
        {
          header: {
            messageId: testHash.messageId,
            sourceChainSelector,
            destChainSelector,
            sequenceNumber: 500n,
            nonce: 10n,
          },
          sender: testAddresses.sender,
          data: '0xabcd',
          receiver: padAddress(testAddresses.receiver),
          extraArgs,
          feeToken: testAddresses.feeToken,
          feeTokenAmount: 5000n,
          feeValueJuels: 100n,
          tokenAmounts: [],
        },
      ])

      const result = EVMChain.decodeMessage({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)

      // Check that no numeric keys are present
      const numericKeys = Object.keys(result).filter((k) => /^\d+$/.test(k))
      assert.deepEqual(numericKeys, [], `Found unexpected numeric keys: ${numericKeys.join(', ')}`)
    })
  })

  describe('error handling', () => {
    it('should throw on invalid data (not BytesLike)', () => {
      assert.throws(
        () => EVMChain.decodeMessage({ data: 123 as unknown as string }),
        /Invalid log data/,
      )
    })

    it('should throw on invalid data (object)', () => {
      assert.throws(
        () => EVMChain.decodeMessage({ data: { foo: 'bar' } as unknown as string }),
        /Invalid log data/,
      )
    })

    it('should return undefined for unknown topic', () => {
      const result = EVMChain.decodeMessage({
        topics: [testHash.unknown],
        data: '0x1234567890',
      })
      assert.equal(result, undefined)
    })

    it('should return undefined when data cannot be decoded', () => {
      // Get a valid topic but with garbage data
      const fragment = interfaces.OnRamp_v1_6.getEvent('CCIPMessageSent')!
      const result = EVMChain.decodeMessage({
        topics: [fragment.topicHash],
        data: '0x0000',
      })
      assert.equal(result, undefined)
    })

    it('should throw on unknown extraArgs tag in v1.6 message', () => {
      const unknownExtraArgs = concat(['0xdeadbeef', '0x00000000'])

      const fragment = interfaces.OnRamp_v1_6.getEvent('CCIPMessageSent')!
      const encoded = interfaces.OnRamp_v1_6.encodeEventLog(fragment, [
        1n,
        1n,
        {
          header: {
            messageId: testHash.messageId,
            sourceChainSelector: 5009297550715157269n,
            destChainSelector: 1n,
            sequenceNumber: 1n,
            nonce: 1n,
          },
          sender: testAddresses.sender,
          data: '0x',
          receiver: padAddress(testAddresses.receiver),
          extraArgs: unknownExtraArgs,
          feeToken: ZeroAddress,
          feeTokenAmount: 0n,
          feeValueJuels: 0n,
          tokenAmounts: [],
        },
      ])

      assert.throws(
        () => EVMChain.decodeMessage({ topics: encoded.topics, data: encoded.data }),
        /Could not parse extraArgs/,
      )
    })
  })

  describe('topic handling', () => {
    it('should try all fragments when no topics provided', () => {
      const fragment = interfaces.EVM2EVMOnRamp_v1_5.getEvent('CCIPSendRequested')!
      const encoded = interfaces.EVM2EVMOnRamp_v1_5.encodeEventLog(fragment, [
        {
          sourceChainSelector: 1n,
          sender: testAddresses.sender,
          receiver: testAddresses.receiver,
          sequenceNumber: 1n,
          gasLimit: 100_000n,
          strict: false,
          nonce: 1n,
          feeToken: ZeroAddress,
          feeTokenAmount: 0n,
          data: '0x',
          tokenAmounts: [],
          sourceTokenData: [],
          messageId: testHash.messageId,
        },
      ])

      const result = EVMChain.decodeMessage({ data: encoded.data })

      assert.ok(result)
      assert.equal(result.sequenceNumber, 1n)
    })
  })
})

describe('EVMChain.decodeCommits', () => {
  describe('v1.5 ReportAccepted', () => {
    it('should decode a v1.5 commit report with lane', () => {
      const sourceChainSelector = 5009297550715157269n

      const fragment = interfaces.CommitStore_v1_5.getEvent('ReportAccepted')!
      const encoded = interfaces.CommitStore_v1_5.encodeEventLog(fragment, [
        {
          priceUpdates: {
            tokenPriceUpdates: [],
            gasPriceUpdates: [],
          },
          interval: { min: 10n, max: 20n },
          merkleRoot: testHash.merkleRoot,
        },
      ])

      const lane = { sourceChainSelector, onRamp: testAddresses.onRamp, version: CCIPVersion.V1_5 }
      const result = EVMChain.decodeCommits({ topics: encoded.topics, data: encoded.data }, lane)

      assert.ok(result)
      assert.equal(result.length, 1)
      assert.equal(result[0].merkleRoot, testHash.merkleRoot)
      assert.equal(result[0].minSeqNr, 10n)
      assert.equal(result[0].maxSeqNr, 20n)
      assert.equal(result[0].sourceChainSelector, sourceChainSelector)
      assert.equal(result[0].onRampAddress, testAddresses.onRamp)
    })

    it('should throw when decoding v1.5 without lane', () => {
      const fragment = interfaces.CommitStore_v1_5.getEvent('ReportAccepted')!
      const encoded = interfaces.CommitStore_v1_5.encodeEventLog(fragment, [
        {
          priceUpdates: {
            tokenPriceUpdates: [],
            gasPriceUpdates: [],
          },
          interval: { min: 1n, max: 5n },
          merkleRoot: testHash.merkleRoot,
        },
      ])

      assert.throws(
        () => EVMChain.decodeCommits({ topics: encoded.topics, data: encoded.data }),
        /Decoding commits from CCIP v1\.5 requires lane/,
      )
    })
  })

  describe('v1.6 CommitReportAccepted', () => {
    const emptyPriceUpdates = {
      tokenPriceUpdates: [],
      gasPriceUpdates: [],
    }

    it('should decode a v1.6 commit report', () => {
      const sourceChainSelector = 5009297550715157269n

      const fragment = interfaces.OffRamp_v1_6.getEvent('CommitReportAccepted')!
      const encoded = interfaces.OffRamp_v1_6.encodeEventLog(fragment, [
        [
          {
            sourceChainSelector,
            onRampAddress: padAddress(testAddresses.onRamp),
            minSeqNr: 100n,
            maxSeqNr: 200n,
            merkleRoot: testHash.merkleRoot,
          },
        ],
        [],
        emptyPriceUpdates,
      ])

      const result = EVMChain.decodeCommits({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)
      assert.equal(result.length, 1)
      assert.equal(result[0].merkleRoot, testHash.merkleRoot)
      assert.equal(result[0].minSeqNr, 100n)
      assert.equal(result[0].maxSeqNr, 200n)
      assert.equal(result[0].sourceChainSelector, sourceChainSelector)
    })

    it('should decode multiple commit reports', () => {
      const sourceChainSelector1 = 5009297550715157269n
      const sourceChainSelector2 = 4949039107694359620n

      const fragment = interfaces.OffRamp_v1_6.getEvent('CommitReportAccepted')!
      const encoded = interfaces.OffRamp_v1_6.encodeEventLog(fragment, [
        [
          {
            sourceChainSelector: sourceChainSelector1,
            onRampAddress: padAddress(testAddresses.onRamp),
            minSeqNr: 1n,
            maxSeqNr: 10n,
            merkleRoot: testHash.merkleRoot,
          },
        ],
        [
          {
            sourceChainSelector: sourceChainSelector2,
            onRampAddress: padAddress(testAddresses.onRamp2),
            minSeqNr: 50n,
            maxSeqNr: 60n,
            merkleRoot: testHash.merkleRoot2,
          },
        ],
        emptyPriceUpdates,
      ])

      const result = EVMChain.decodeCommits({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)
      assert.equal(result.length, 2)
      assert.equal(result[0].sourceChainSelector, sourceChainSelector1)
      assert.equal(result[1].sourceChainSelector, sourceChainSelector2)
    })

    it('should filter by lane when provided', () => {
      const targetChainSelector = 5009297550715157269n
      const otherChainSelector = 4949039107694359620n

      const fragment = interfaces.OffRamp_v1_6.getEvent('CommitReportAccepted')!
      const encoded = interfaces.OffRamp_v1_6.encodeEventLog(fragment, [
        [
          {
            sourceChainSelector: targetChainSelector,
            onRampAddress: padAddress(testAddresses.onRamp),
            minSeqNr: 1n,
            maxSeqNr: 10n,
            merkleRoot: testHash.merkleRoot,
          },
          {
            sourceChainSelector: otherChainSelector,
            onRampAddress: padAddress(testAddresses.onRamp2),
            minSeqNr: 20n,
            maxSeqNr: 30n,
            merkleRoot: testHash.merkleRoot2,
          },
        ],
        [],
        emptyPriceUpdates,
      ])

      const lane = {
        sourceChainSelector: targetChainSelector,
        onRamp: testAddresses.onRamp,
        version: CCIPVersion.V1_6,
      }
      const result = EVMChain.decodeCommits({ topics: encoded.topics, data: encoded.data }, lane)

      assert.ok(result)
      assert.equal(result.length, 1)
      assert.equal(result[0].sourceChainSelector, targetChainSelector)
      assert.equal(result[0].merkleRoot, testHash.merkleRoot)
    })

    it('should return undefined when no reports match lane filter', () => {
      const fragment = interfaces.OffRamp_v1_6.getEvent('CommitReportAccepted')!
      const encoded = interfaces.OffRamp_v1_6.encodeEventLog(fragment, [
        [
          {
            sourceChainSelector: 5009297550715157269n,
            onRampAddress: padAddress(testAddresses.onRamp),
            minSeqNr: 1n,
            maxSeqNr: 10n,
            merkleRoot: testHash.merkleRoot,
          },
        ],
        [],
        emptyPriceUpdates,
      ])

      const lane = {
        sourceChainSelector: 999n,
        onRamp: testAddresses.other,
        version: CCIPVersion.V1_6,
      }
      const result = EVMChain.decodeCommits({ topics: encoded.topics, data: encoded.data }, lane)

      assert.equal(result, undefined)
    })
  })

  describe('error handling', () => {
    it('should throw on invalid data', () => {
      assert.throws(
        () => EVMChain.decodeCommits({ data: 123 as unknown as string }),
        /Invalid log data/,
      )
    })

    it('should return undefined for unknown topic', () => {
      const result = EVMChain.decodeCommits({
        topics: [testHash.unknown],
        data: '0x1234',
      })
      assert.equal(result, undefined)
    })
  })
})

describe('EVMChain.decodeReceipt', () => {
  describe('v1.6 ExecutionStateChanged', () => {
    it('should decode ExecutionState.Success', () => {
      const sourceChainSelector = 5009297550715157269n

      const fragment = interfaces.OffRamp_v1_6.getEvent('ExecutionStateChanged')!
      const encoded = interfaces.OffRamp_v1_6.encodeEventLog(fragment, [
        sourceChainSelector,
        42n,
        testHash.messageId,
        testHash.messageHash,
        ExecutionState.Success,
        '0x',
        50_000n,
      ])

      const result = EVMChain.decodeReceipt({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)
      assert.equal(result.state, ExecutionState.Success)
      assert.equal(result.sequenceNumber, 42n)
      assert.equal(result.messageId, testHash.messageId)
      assert.equal(result.messageHash, testHash.messageHash)
      assert.equal(result.sourceChainSelector, sourceChainSelector)
      assert.equal(result.gasUsed, 50_000n)
    })

    it('should decode ExecutionState.Failed', () => {
      const fragment = interfaces.OffRamp_v1_6.getEvent('ExecutionStateChanged')!
      const returnData = '0xdeadbeef'
      const encoded = interfaces.OffRamp_v1_6.encodeEventLog(fragment, [
        1n,
        1n,
        testHash.messageId,
        testHash.messageHash,
        ExecutionState.Failed,
        returnData,
        100_000n,
      ])

      const result = EVMChain.decodeReceipt({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)
      assert.equal(result.state, ExecutionState.Failed)
      assert.equal(result.returnData, returnData)
    })

    it('should decode ExecutionState.InProgress', () => {
      const fragment = interfaces.OffRamp_v1_6.getEvent('ExecutionStateChanged')!
      const encoded = interfaces.OffRamp_v1_6.encodeEventLog(fragment, [
        1n,
        1n,
        testHash.messageId,
        testHash.messageHash,
        ExecutionState.InProgress,
        '0x',
        0n,
      ])

      const result = EVMChain.decodeReceipt({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)
      assert.equal(result.state, ExecutionState.InProgress)
    })
  })

  describe('v1.5 ExecutionStateChanged', () => {
    it('should decode v1.5 receipt (fewer fields)', () => {
      const fragment = interfaces.EVM2EVMOffRamp_v1_5.getEvent('ExecutionStateChanged')!
      const encoded = interfaces.EVM2EVMOffRamp_v1_5.encodeEventLog(fragment, [
        99n,
        testHash.messageId,
        ExecutionState.Success,
        '0x',
      ])

      const result = EVMChain.decodeReceipt({ topics: encoded.topics, data: encoded.data })

      assert.ok(result)
      assert.equal(result.state, ExecutionState.Success)
      assert.equal(result.sequenceNumber, 99n)
      assert.equal(result.messageId, testHash.messageId)
    })
  })

  describe('error handling', () => {
    it('should throw on invalid data', () => {
      assert.throws(
        () => EVMChain.decodeReceipt({ data: null as unknown as string }),
        /Invalid log data/,
      )
    })

    it('should return undefined for unknown topic', () => {
      const result = EVMChain.decodeReceipt({
        topics: [testHash.unknown],
        data: '0x1234',
      })
      assert.equal(result, undefined)
    })

    it('should return undefined when data cannot be decoded', () => {
      const fragment = interfaces.OffRamp_v1_6.getEvent('ExecutionStateChanged')!
      const result = EVMChain.decodeReceipt({
        topics: [fragment.topicHash],
        data: '0x0000',
      })
      assert.equal(result, undefined)
    })
  })

  describe('topic handling', () => {
    it('should try all fragments when no topics provided', () => {
      const fragment = interfaces.OffRamp_v1_6.getEvent('ExecutionStateChanged')!
      const encoded = interfaces.OffRamp_v1_6.encodeEventLog(fragment, [
        1n,
        1n,
        testHash.messageId,
        testHash.messageHash,
        ExecutionState.Success,
        '0x',
        0n,
      ])

      const result = EVMChain.decodeReceipt({ data: encoded.data })

      assert.ok(result)
      assert.equal(result.state, ExecutionState.Success)
    })
  })
})

describe('EVMChain.decodeExtraArgs', () => {
  describe('EVMExtraArgsV1', () => {
    it('should decode EVMExtraArgsV1', () => {
      const gasLimit = 123_456n
      const encoded = concat([
        EVMExtraArgsV1Tag,
        defaultAbiCoder.encode(['tuple(uint256)'], [[gasLimit]]),
      ])

      const result = EVMChain.decodeExtraArgs(encoded)

      assert.ok(result)
      assert.equal(result._tag, 'EVMExtraArgsV1')
      assert.equal(result.gasLimit, gasLimit)
    })
  })

  describe('EVMExtraArgsV2', () => {
    it('should decode EVMExtraArgsV2 with allowOutOfOrderExecution=true', () => {
      const gasLimit = 200_000n
      const encoded = concat([
        EVMExtraArgsV2Tag,
        defaultAbiCoder.encode(['tuple(uint256,bool)'], [[gasLimit, true]]),
      ])

      const result = EVMChain.decodeExtraArgs(encoded)

      assert.ok(result)
      assert.equal(result._tag, 'EVMExtraArgsV2')
      assert.equal(result.gasLimit, gasLimit)
      assert.equal((result as { allowOutOfOrderExecution: boolean }).allowOutOfOrderExecution, true)
    })

    it('should decode EVMExtraArgsV2 with allowOutOfOrderExecution=false', () => {
      const encoded = concat([
        EVMExtraArgsV2Tag,
        defaultAbiCoder.encode(['tuple(uint256,bool)'], [[100_000n, false]]),
      ])

      const result = EVMChain.decodeExtraArgs(encoded)

      assert.ok(result)
      assert.equal(result._tag, 'EVMExtraArgsV2')
      assert.equal(
        (result as { allowOutOfOrderExecution: boolean }).allowOutOfOrderExecution,
        false,
      )
    })
  })

  describe('SVMExtraArgsV1', () => {
    it('should decode SVMExtraArgsV1 with Base58 addresses', () => {
      const encoded = concat([
        SVMExtraArgsV1Tag,
        defaultAbiCoder.encode(
          ['tuple(uint64,uint64,bool,bytes32,bytes32[])'],
          [[500_000n, 3n, true, bytes32.tokenReceiver, [bytes32.account1, bytes32.account2]]],
        ),
      ])

      const result = EVMChain.decodeExtraArgs(encoded)

      assert.ok(result)
      assert.equal(result._tag, 'SVMExtraArgsV1')
      const svmResult = result as {
        computeUnits: bigint
        accountIsWritableBitmap: bigint
        allowOutOfOrderExecution: boolean
        tokenReceiver: string
        accounts: string[]
      }
      assert.equal(svmResult.computeUnits, 500_000n)
      assert.equal(svmResult.accountIsWritableBitmap, 3n)
      assert.equal(svmResult.allowOutOfOrderExecution, true)
      assert.ok(typeof svmResult.tokenReceiver === 'string')
      assert.ok(!svmResult.tokenReceiver.startsWith('0x'))
      assert.equal(svmResult.accounts.length, 2)
    })
  })

  describe('SuiExtraArgsV1', () => {
    it('should decode SuiExtraArgsV1', () => {
      const encoded = concat([
        SuiExtraArgsV1Tag,
        defaultAbiCoder.encode(
          ['tuple(uint256,bool,bytes32,bytes32[])'],
          [[300_000n, false, bytes32.tokenReceiver, [bytes32.account1, bytes32.account2]]],
        ),
      ])

      const result = EVMChain.decodeExtraArgs(encoded)

      assert.ok(result)
      assert.equal(result._tag, 'SuiExtraArgsV1')
      const suiResult = result as {
        gasLimit: bigint
        allowOutOfOrderExecution: boolean
        tokenReceiver: string
        receiverObjectIds: string[]
      }
      assert.equal(suiResult.gasLimit, 300_000n)
      assert.equal(suiResult.allowOutOfOrderExecution, false)
      assert.equal(suiResult.receiverObjectIds.length, 2)
    })
  })

  describe('error handling', () => {
    it('should return undefined for unknown tag', () => {
      const encoded = concat(['0xdeadbeef', '0x0000000000000000'])

      const result = EVMChain.decodeExtraArgs(encoded)

      assert.equal(result, undefined)
    })

    it('should throw on empty data', () => {
      // dataSlice throws when trying to slice beyond buffer bounds
      assert.throws(
        () => EVMChain.decodeExtraArgs('0x'),
        /cannot slice beyond data bounds|BUFFER_OVERRUN/,
      )
    })

    it('should throw on data shorter than 4 bytes', () => {
      // dataSlice throws when trying to slice beyond buffer bounds
      assert.throws(
        () => EVMChain.decodeExtraArgs('0x1234'),
        /cannot slice beyond data bounds|BUFFER_OVERRUN/,
      )
    })
  })

  describe('round-trip', () => {
    it('should round-trip EVMExtraArgsV2', () => {
      const original = { gasLimit: 250_000n, allowOutOfOrderExecution: true }
      const encoded = EVMChain.encodeExtraArgs(original)
      const decoded = EVMChain.decodeExtraArgs(encoded)

      assert.ok(decoded)
      assert.equal(decoded._tag, 'EVMExtraArgsV2')
      assert.equal(decoded.gasLimit, original.gasLimit)
      assert.equal(
        (decoded as { allowOutOfOrderExecution: boolean }).allowOutOfOrderExecution,
        original.allowOutOfOrderExecution,
      )
    })

    it('should round-trip EVMExtraArgsV1', () => {
      const original = { gasLimit: 100_000n }
      const encoded = EVMChain.encodeExtraArgs(original)
      const decoded = EVMChain.decodeExtraArgs(encoded)

      assert.ok(decoded)
      assert.equal(decoded._tag, 'EVMExtraArgsV1')
      assert.equal(decoded.gasLimit, original.gasLimit)
    })
  })
})
