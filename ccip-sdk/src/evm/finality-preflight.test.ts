import assert from 'node:assert/strict'
import { after, beforeEach, describe, it, mock } from 'node:test'

import { getAddress, hexlify, randomBytes, toBeHex } from 'ethers'

import { interfaces } from './const.ts'
import { EVMChain, isTokenOnlyEstimate } from './index.ts'
import { CCIPFinalityNotAllowedError } from '../errors/index.ts'
import { ChainFamily, NetworkType } from '../networks.ts'
import { CCIPVersion } from '../types.ts'

const recv = interfaces.Receiver_v2_0
const SUPPORTS_SEL = recv.getFunction('supportsInterface')!.selector
const CCV_SEL = recv.getFunction('getCCVsAndFinalityConfig')!.selector

const SOURCE_SELECTOR = 16015286601757825753n // ethereum-sepolia
const DEST_SELECTOR = 10344971235874465080n // base-sepolia

// bytes4 allowedFinalityConfig values
const FINALIZED_ONLY = '0x00000000' // finalityDepth 0, finalitySafe false
const ALLOWS_DEPTH_1 = '0x00000001' // finalityDepth 1

// ============================================================================
// 1) Pure classifier — the durable both-field-names regression proof
// ============================================================================
describe('isTokenOnlyEstimate', () => {
  it('token-only: empty data + no receive-gas => true', () => {
    assert.equal(isTokenOnlyEstimate({ data: '0x' }), true)
    assert.equal(isTokenOnlyEstimate({}), true)
    assert.equal(isTokenOnlyEstimate({ data: '0x', ccipReceiveGasLimit: 0, gasLimit: 0n }), true)
  })

  it('data present => NOT token-only', () => {
    assert.equal(isTokenOnlyEstimate({ data: '0xdeadbeef' }), false)
  })

  it('empty data but ccipReceiveGasLimit > 0 (decoded MessageV1 path) => NOT token-only', () => {
    // regression guard: this message DOES call the receiver, must not be skipped
    assert.equal(isTokenOnlyEstimate({ data: '0x', ccipReceiveGasLimit: 200_000 }), false)
  })

  it('empty data but gasLimit > 0 (user/CLI input path) => NOT token-only', () => {
    // regression guard for the OTHER field name
    assert.equal(isTokenOnlyEstimate({ data: '0x', gasLimit: 200_000n }), false)
    assert.equal(isTokenOnlyEstimate({ data: '0x', gasLimit: 200_000 }), false)
  })
})

// ============================================================================
// 2) Gate behaviour — mirror the OffRamp: skip receiver-finality for token-only
// ============================================================================
function makeChain(finalityConfig: string) {
  const provider = {
    // eth_estimateGas (finder probe + final ccipReceive sim) always returns a gas value
    send: mock.fn(async () => toBeHex(44_000)),
    // selector-aware eth_call: supportsInterface=true, getCCVsAndFinalityConfig=([],[],0,cfg)
    call: mock.fn(async (tx: { data?: string }) => {
      const data = tx.data ?? '0x'
      const sel = data.slice(0, 10)
      if (sel === SUPPORTS_SEL) return recv.encodeFunctionResult('supportsInterface', [true])
      if (sel === CCV_SEL)
        return recv.encodeFunctionResult('getCCVsAndFinalityConfig', [[], [], 0, finalityConfig])
      return toBeHex(0n, 32) // balanceOf / totalSupply => 0
    }),
  }
  const chain = Object.create(EVMChain.prototype) as EVMChain
  Object.assign(chain, {
    provider,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    network: {
      name: 'base-sepolia',
      chainId: 84532,
      chainSelector: DEST_SELECTOR,
      family: ChainFamily.EVM,
      networkType: NetworkType.Testnet,
    },
    getRouterForOffRamp: mock.fn(async () => getAddress(hexlify(randomBytes(20)))),
  })
  return { chain, provider }
}

type Shape = {
  data: string
  tokenAmounts: readonly { token: string; amount: bigint }[]
}
const TT: Shape = {
  data: '0x',
  tokenAmounts: [{ token: getAddress(hexlify(randomBytes(20))), amount: 1000n }],
}
const DATA_ONLY: Shape = { data: '0xdeadbeef', tokenAmounts: [] }
const PTT: Shape = {
  data: '0xdeadbeef',
  tokenAmounts: [{ token: getAddress(hexlify(randomBytes(20))), amount: 1000n }],
}

function baseMessage(shape: Shape, finality: number | 'finalized') {
  return {
    receiver: getAddress(hexlify(randomBytes(20))),
    sender: getAddress(hexlify(randomBytes(20))),
    sourceChainSelector: SOURCE_SELECTOR,
    finality,
    data: shape.data,
    tokenAmounts: shape.tokenAmounts,
  }
}

describe('EVMChain.estimateReceiveExecution — token-only finality skip', () => {
  beforeEach(() => mock.restoreAll())
  after(() => mock.restoreAll())

  const offRamp = getAddress(hexlify(randomBytes(20)))

  it('FIX: token-only transfer at fast finality to a finalized-only receiver => NO throw (matches OffRamp)', async () => {
    const { chain } = makeChain(FINALIZED_ONLY)
    // BEFORE the fix this threw CCIPFinalityNotAllowedError; AFTER it returns a gas number.
    const result = await chain.estimateReceiveExecution({ offRamp, message: baseMessage(TT, 1) })
    assert.equal(typeof result, 'number')
  })

  it('NO REGRESSION: data-only at fast finality to a finalized-only receiver => STILL throws', async () => {
    const { chain } = makeChain(FINALIZED_ONLY)
    await assert.rejects(
      () => chain.estimateReceiveExecution({ offRamp, message: baseMessage(DATA_ONLY, 1) }),
      CCIPFinalityNotAllowedError,
    )
  })

  it('NO REGRESSION: PTT (data + tokens) at fast finality to a finalized-only receiver => STILL throws', async () => {
    const { chain } = makeChain(FINALIZED_ONLY)
    await assert.rejects(
      () => chain.estimateReceiveExecution({ offRamp, message: baseMessage(PTT, 1) }),
      CCIPFinalityNotAllowedError,
    )
  })

  it('BASELINE: data-only at a COMPATIBLE finality (receiver allows depth 1) => passes', async () => {
    const { chain } = makeChain(ALLOWS_DEPTH_1)
    const result = await chain.estimateReceiveExecution({
      offRamp,
      message: baseMessage(DATA_ONLY, 1),
    })
    assert.equal(typeof result, 'number')
  })

  it('LEGIT PASS: data-only at finalized finality (to finalized-only receiver) => passes (gate not entered)', async () => {
    const { chain } = makeChain(FINALIZED_ONLY)
    const result = await chain.estimateReceiveExecution({
      offRamp,
      message: baseMessage(DATA_ONLY, 'finalized'),
    })
    assert.equal(typeof result, 'number')
  })

  it('LEGIT PASS: PTT (data + tokens) at finalized finality (to finalized-only receiver) => passes', async () => {
    // guard must NOT have changed the non-token-only path: a legitimate PTT still passes
    const { chain } = makeChain(FINALIZED_ONLY)
    const result = await chain.estimateReceiveExecution({
      offRamp,
      message: baseMessage(PTT, 'finalized'),
    })
    assert.equal(typeof result, 'number')
  })

  it('LEGIT PASS: PTT (data + tokens) at depth-1 to a depth-1-accepting receiver => passes', async () => {
    const { chain } = makeChain(ALLOWS_DEPTH_1)
    const result = await chain.estimateReceiveExecution({
      offRamp,
      message: baseMessage(PTT, 1),
    })
    assert.equal(typeof result, 'number')
  })

  it('LEGIT PASS: data-only at depth-1 to a receiver allowing safe+depth-1 (0x00010001) => passes', async () => {
    // 0x00010001 = finalityDepth 1 AND finalitySafe true — accepts the requested depth-1
    const { chain } = makeChain('0x00010001')
    const result = await chain.estimateReceiveExecution({
      offRamp,
      message: baseMessage(DATA_ONLY, 1),
    })
    assert.equal(typeof result, 'number')
  })

  it('REGRESSION GUARD (messageId path): empty data but ccipReceiveGasLimit>0 => STILL throws', async () => {
    const { chain } = makeChain(FINALIZED_ONLY)
    const receiver = getAddress(hexlify(randomBytes(20)))
    chain.getMessageById = mock.fn(async () => ({
      lane: {
        sourceChainSelector: SOURCE_SELECTOR,
        destChainSelector: DEST_SELECTOR,
        onRamp: getAddress(hexlify(randomBytes(20))),
        version: CCIPVersion.V2_0,
      },
      message: {
        messageId: hexlify(randomBytes(32)),
        sender: getAddress(hexlify(randomBytes(20))),
        receiver,
        sourceChainSelector: SOURCE_SELECTOR,
        finality: 1,
        data: '0x', // empty data ...
        ccipReceiveGasLimit: 200_000, // ... but the receiver IS invoked => NOT token-only
        tokenAmounts: [],
        offRampAddress: offRamp,
      },
    })) as unknown as EVMChain['getMessageById']

    await assert.rejects(
      () => chain.estimateReceiveExecution({ messageId: hexlify(randomBytes(32)) }),
      CCIPFinalityNotAllowedError,
    )
  })
})
