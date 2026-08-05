import assert from 'node:assert/strict'
import { after, beforeEach, describe, it, mock } from 'node:test'

import { getAddress, hexlify, makeError, randomBytes, toBeHex } from 'ethers'

import { interfaces } from './const.ts'
import { EVMChain, isTokenOnlyEstimate } from './index.ts'
import { CCIPFinalityNotAllowedError, CCIPVersionUnsupportedError } from '../errors/index.ts'
import { decodeFinalityAllowed } from '../extra-args.ts'
import { ChainFamily, NetworkType } from '../networks.ts'
import { CCIPVersion } from '../types.ts'

// Under the authoritative preflight, estimateReceiveExecution resolves finality + CCVs via the OffRamp's
// getCCVsForMessage(bytes) view (through EVMChain.getRequiredCCVs), not by reading the receiver directly.
const offRampIface = interfaces.OffRamp_v2_0
const GET_CCVS_SEL = offRampIface.getFunction('getCCVsForMessage')!.selector

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
    // selector-aware eth_call that mirrors the OffRamp getCCVsForMessage resolver: revert
    // InvalidRequestedFinality when the receiver is finalized-only (depth 0), else return a required CCV
    // set. All finality-gated cases here request depth 1, so depth-1 configs accept and depth-0 rejects.
    call: mock.fn(async (tx: { data?: string }) => {
      const data = tx.data ?? '0x'
      const sel = data.slice(0, 10)
      if (sel === GET_CCVS_SEL) {
        if (decodeFinalityAllowed(finalityConfig).finalityDepth === 0) {
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: offRampIface.encodeErrorResult('InvalidRequestedFinality', [
              '0x00000001',
              finalityConfig,
            ]),
            reason: null,
            transaction: { to: null, data, from: undefined },
            invocation: null,
            revert: null,
          })
        }
        return offRampIface.encodeFunctionResult('getCCVsForMessage', [
          [getAddress(hexlify(randomBytes(20)))],
          [],
          0,
        ])
      }
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

// ============================================================================
// 3) Best-effort: a non-finality resolver failure (v1 lane / transient RPC) is
//    swallowed so the gas estimate still returns; the finality gate still throws.
// ============================================================================
describe('EVMChain.estimateReceiveExecution — finality preflight is best-effort', () => {
  after(() => mock.restoreAll())

  function makeChainFailingCCVs() {
    const provider = {
      send: mock.fn(async () => toBeHex(44_000)),
      call: mock.fn(async (tx: { data?: string }) => {
        const sel = (tx.data ?? '0x').slice(0, 10)
        if (sel === GET_CCVS_SEL)
          // non-finality revert (unknown selector) — stands in for a v1 lane / transient failure
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0xdeadbeef',
            reason: null,
            transaction: { to: null, data: tx.data ?? '0x', from: undefined },
            invocation: null,
            revert: null,
          })
        return toBeHex(0n, 32)
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
    return chain
  }

  it('swallows a non-finality resolver failure and STILL returns a gas estimate', async () => {
    const chain = makeChainFailingCCVs()
    const offRamp = getAddress(hexlify(randomBytes(20)))
    // data-only at fast finality: the finality gate would run, but the resolver fails for a
    // non-finality reason → must NOT throw; the estimate proceeds.
    const result = await chain.estimateReceiveExecution({
      offRamp,
      message: baseMessage(DATA_ONLY, 1),
    })
    assert.equal(typeof result, 'number')
  })

  it('getRequiredCCVs throws CCIPVersionUnsupportedError on a non-v2 OffRamp', async () => {
    const chain = makeChainFailingCCVs()
    chain.typeAndVersion = mock.fn(async () => [
      'EVM2EVMOffRamp',
      CCIPVersion.V1_5,
      'EVM2EVMOffRamp 1.5.0',
    ]) as unknown as EVMChain['typeAndVersion']
    await assert.rejects(
      () =>
        chain.getRequiredCCVs({
          offRamp: getAddress(hexlify(randomBytes(20))),
          message: {
            sourceChainSelector: SOURCE_SELECTOR,
            receiver: getAddress(hexlify(randomBytes(20))),
            finality: 2,
          },
        }),
      CCIPVersionUnsupportedError,
    )
  })
})
