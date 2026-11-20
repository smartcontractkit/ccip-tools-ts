/**
 * Deterministic unit tests for TON lane configuration reads and router routing.
 *
 * These cover the RPC shape of {@link TONChain.getOnRampConfig} /
 * {@link TONChain.getOffRampConfig} and the `router.onRamp` / `router.offRamp`
 * lookups with mocked TVM stacks, so a change in field order or contract method
 * fails without reaching a live network.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type Cell, Address, beginCell } from '@ton/core'
import type { TonClient } from '@ton/ton'

import { CCIPErrorCode, CCIPSourceChainUnsupportedError } from '../errors/index.ts'
import { EVMChain } from '../evm/index.ts'
import { networkInfo } from '../networks.ts'
import { TONChain } from './index.ts'

type StackValue =
  | { bigint: bigint }
  | { address: Address }
  | { boolean: boolean }
  | { number: number }
  | { cell: Cell }

/** A `TupleReader`-shaped mock that consumes typed values in call order. */
function mockStack(values: readonly StackValue[]) {
  let index = 0
  function take<T>(kind: string): T {
    const item = values[index++] as Record<string, T> | undefined
    assert.ok(item && kind in item, `stack item ${index - 1} is not a ${kind}`)
    return item[kind]!
  }
  return {
    readBigNumber: () => take<bigint>('bigint'),
    readAddress: () => take<Address>('address'),
    readBoolean: () => take<boolean>('boolean'),
    readNumber: () => take<number>('number'),
    readCell: () => take<Cell>('cell'),
  }
}

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

const TON_NETWORK = networkInfo('ton-testnet')
const SEPOLIA_SELECTOR = 16015286601757825753n
const TON_SELECTOR = 13879075125137744094n

const ROUTER = Address.parse('EQDWS-oJCjyrf-6c1wF5eGP7b2qNWn7wUqS3dlNgb_YzKNHG')
const ON_RAMP = Address.parse('EQC-GtbjW4hz_gXOiBOxT0_Jj-EYkI_zjQ-H8VyYHH9fbSd6')
const FEE_QUOTER = Address.parse('EQAoCywn6WT8_R_ydtFzcYlcwWTWXG35w4Zbbhye_u2I0RnI')
const FEE_AGGREGATOR = new Address(0, Buffer.alloc(32, 0x11))
const ALLOWLIST_ADMIN = new Address(0, Buffer.alloc(32, 0x22))
const LINK_TOKEN = new Address(0, Buffer.alloc(32, 0x33))
const OFF_RAMP = new Address(0, Buffer.alloc(32, 0x44))

/** Builds a chain whose `runMethod` answers from `routes`, keyed by `rawAddress:method`. */
function chainWithRoutes(routes: Record<string, readonly StackValue[]>): TONChain {
  const client = {
    runMethod: async (address: Address, method: string) => {
      const key = `${address.toRawString()}:${method}`
      const values = routes[key]
      assert.ok(values, `unexpected runMethod ${key}`)
      return { stack: mockStack(values) }
    },
  } as unknown as TonClient
  return new TONChain(client, TON_NETWORK, { logger: silentLogger })
}

function fixedTypeAndVersion(
  chain: TONChain,
  value: [type: string, version: string, typeAndVersion: string],
) {
  chain.typeAndVersion = async () => value
}

describe('TONChain lane configuration', () => {
  describe('getOnRampConfig', () => {
    const usdPerUnitGasCell = beginCell()
      .storeUint(1_234_567_890_123_456_789n, 112) // executionGasPrice
      .storeUint(987_654_321_098_765_432n, 112) // dataAvailabilityGasPrice
      .storeUint(1_700_000_000n, 64) // timestamp
      .endCell()

    const routes: Record<string, readonly StackValue[]> = {
      [`${ON_RAMP.toRawString()}:staticConfig`]: [{ bigint: 1_111_111_111n }],
      [`${ON_RAMP.toRawString()}:dynamicConfig`]: [
        { address: FEE_QUOTER },
        { address: FEE_AGGREGATOR },
        { address: ALLOWLIST_ADMIN },
        { bigint: 5_000_000_000n },
      ],
      [`${ON_RAMP.toRawString()}:destChainConfig`]: [
        { address: ROUTER },
        { bigint: 42n },
        { boolean: true },
      ],
      [`${FEE_QUOTER.toRawString()}:staticConfig`]: [
        { bigint: 7_000_000_000_000_000_000n },
        { address: LINK_TOKEN },
        { number: 86_400 },
      ],
      [`${FEE_QUOTER.toRawString()}:destChainConfig`]: [
        { boolean: true }, // isEnabled
        { number: 5 }, // maxNumberOfTokensPerMsg
        { number: 10_000 }, // maxDataBytes
        { number: 4_000_000 }, // maxPerMsgGasLimit
        { number: 90_000 }, // destGasOverhead
        { number: 16 }, // destGasPerPayloadByteBase
        { number: 40 }, // destGasPerPayloadByteHigh
        { number: 300 }, // destGasPerPayloadByteThreshold
        { number: 1_000 }, // destDataAvailabilityOverheadGas
        { number: 4 }, // destGasPerDataAvailabilityByte
        { number: 6_840 }, // destDataAvailabilityMultiplierBps
        { number: 2_819_673_623 }, // chainFamilySelector
        { number: 50 }, // defaultTokenFeeUsdCents
        { number: 20_000 }, // defaultTokenDestGasOverhead
        { number: 200_000 }, // defaultTxGasLimit
        { bigint: 9_500_000_000_000_000_000n }, // gasMultiplierWeiPerEth
        { number: 3_600 }, // gasPriceStalenessThreshold
        { number: 25 }, // networkFeeUsdCents
        { cell: usdPerUnitGasCell },
      ],
    }

    it('merges static, dynamic, destination and FeeQuoter config', async () => {
      const chain = chainWithRoutes(routes)
      fixedTypeAndVersion(chain, ['OnRamp', '1.6.0', 'OnRamp 1.6.0'])

      const config = await chain.getOnRampConfig(ON_RAMP.toString(), SEPOLIA_SELECTOR)

      assert.equal(config.chainSelector, 1_111_111_111n)
      assert.equal(config.destChainSelector, SEPOLIA_SELECTOR)
      assert.equal(config.feeQuoter, FEE_QUOTER.toRawString())
      assert.equal(config.feeAggregator, FEE_AGGREGATOR.toRawString())
      assert.equal(config.allowlistAdmin, ALLOWLIST_ADMIN.toRawString())
      assert.equal(config.reserve, 5_000_000_000n)
      assert.equal(config.router, ROUTER.toRawString())
      assert.equal(config.sequenceNumber, 42n)
      assert.equal(config.allowlistEnabled, true)
      assert.equal(config.typeAndVersion, 'OnRamp 1.6.0')

      assert.equal(config.feeQuoterConfig.maxFeeJuelsPerMsg, 7_000_000_000_000_000_000n)
      assert.equal(config.feeQuoterConfig.linkToken, LINK_TOKEN.toRawString())
      assert.equal(config.feeQuoterConfig.tokenPriceStalenessThreshold, 86_400)
      assert.equal(config.feeQuoterConfig.isEnabled, true)
      assert.equal(config.feeQuoterConfig.maxNumberOfTokensPerMsg, 5)
      assert.equal(config.feeQuoterConfig.maxDataBytes, 10_000)
      assert.equal(config.feeQuoterConfig.maxPerMsgGasLimit, 4_000_000)
      assert.equal(config.feeQuoterConfig.destGasOverhead, 90_000)
      assert.equal(config.feeQuoterConfig.destGasPerPayloadByteBase, 16)
      assert.equal(config.feeQuoterConfig.destGasPerPayloadByteHigh, 40)
      assert.equal(config.feeQuoterConfig.destGasPerPayloadByteThreshold, 300)
      assert.equal(config.feeQuoterConfig.destDataAvailabilityOverheadGas, 1_000)
      assert.equal(config.feeQuoterConfig.destGasPerDataAvailabilityByte, 4)
      assert.equal(config.feeQuoterConfig.destDataAvailabilityMultiplierBps, 6_840)
      assert.equal(config.feeQuoterConfig.chainFamilySelector, 2_819_673_623)
      assert.equal(config.feeQuoterConfig.defaultTokenFeeUsdCents, 50)
      assert.equal(config.feeQuoterConfig.defaultTokenDestGasOverhead, 20_000)
      assert.equal(config.feeQuoterConfig.defaultTxGasLimit, 200_000)
      assert.equal(config.feeQuoterConfig.gasMultiplierWeiPerEth, 9_500_000_000_000_000_000n)
      assert.equal(config.feeQuoterConfig.gasPriceStalenessThreshold, 3_600)
      assert.equal(config.feeQuoterConfig.networkFeeUsdCents, 25)
      assert.deepEqual(config.feeQuoterConfig.usdPerUnitGas, {
        executionGasPrice: 1_234_567_890_123_456_789n,
        dataAvailabilityGasPrice: 987_654_321_098_765_432n,
        timestamp: 1_700_000_000n,
      })
    })

    it('returns zero sequence numbers and disabled allowlists verbatim', async () => {
      const disabledRoutes: Record<string, readonly StackValue[]> = {
        ...routes,
        [`${ON_RAMP.toRawString()}:destChainConfig`]: [
          { address: ROUTER },
          { bigint: 0n },
          { boolean: false },
        ],
      }
      const chain = chainWithRoutes(disabledRoutes)
      fixedTypeAndVersion(chain, ['OnRamp', '1.6.0', 'OnRamp 1.6.0'])

      const config = await chain.getOnRampConfig(ON_RAMP.toString(), SEPOLIA_SELECTOR)

      assert.equal(config.sequenceNumber, 0n)
      assert.equal(config.allowlistEnabled, false)
    })
  })

  describe('getOffRampConfig', () => {
    const evmOnRampBytes = Buffer.from('23a5084Fa78104F3DF11C63Ae59fcac4f6AD9DeE', 'hex')
    const tonOnRampBytes = Buffer.alloc(32, 0x55)

    function routesFor(onRampCell: Cell): Record<string, readonly StackValue[]> {
      return {
        [`${OFF_RAMP.toRawString()}:sourceChainConfig`]: [
          { address: ROUTER },
          { boolean: true },
          { bigint: 77n },
          { boolean: false },
          { cell: onRampCell },
        ],
        [`${OFF_RAMP.toRawString()}:config`]: [
          { bigint: TON_SELECTOR },
          { address: FEE_QUOTER },
          { number: 1_800 },
        ],
      }
    }

    function chainFor(routes: Record<string, readonly StackValue[]>, version = '1.6.0') {
      const chain = chainWithRoutes(routes)
      fixedTypeAndVersion(chain, ['OffRamp', version, `OffRamp ${version}`])
      return chain
    }

    it('decodes a 160-bit EVM OnRamp cell', async () => {
      const onRampCell = beginCell().storeBuffer(evmOnRampBytes).endCell()
      const chain = chainFor(routesFor(onRampCell))

      const config = await chain.getOffRampConfig(OFF_RAMP.toString(), SEPOLIA_SELECTOR)

      assert.equal(config.chainSelector, TON_SELECTOR)
      assert.equal(config.sourceChainSelector, SEPOLIA_SELECTOR)
      assert.equal(config.feeQuoter, FEE_QUOTER.toRawString())
      assert.equal(config.permissionlessExecutionThresholdSeconds, 1_800)
      assert.equal(config.router, ROUTER.toRawString())
      assert.equal(config.isEnabled, true)
      assert.equal(config.minSeqNr, 77n)
      assert.equal(config.isRMNVerificationDisabled, false)
      assert.equal(config.typeAndVersion, 'OffRamp 1.6.0')
      assert.deepEqual(config.onRamps, [EVMChain.getAddress(evmOnRampBytes)])
    })

    it('decodes a 256-bit TON OnRamp cell as a raw address', async () => {
      const onRampCell = beginCell().storeBuffer(tonOnRampBytes).endCell()
      const chain = chainFor(routesFor(onRampCell))

      const config = await chain.getOffRampConfig(OFF_RAMP.toString(), TON_SELECTOR)

      assert.deepEqual(config.onRamps, [`0:${tonOnRampBytes.toString('hex')}`])
    })

    it('decodes a length-prefixed OnRamp cell', async () => {
      const onRampCell = beginCell()
        .storeUint(evmOnRampBytes.length, 8)
        .storeBuffer(evmOnRampBytes)
        .endCell()
      const chain = chainFor(routesFor(onRampCell))

      const config = await chain.getOffRampConfig(OFF_RAMP.toString(), SEPOLIA_SELECTOR)

      assert.deepEqual(config.onRamps, [EVMChain.getAddress(evmOnRampBytes)])
    })

    it('maps TVM exit code 266 to a source-chain-unsupported error', async () => {
      const client = {
        runMethod: async () => {
          throw Object.assign(new Error('exit code 266'), { exitCode: 266 })
        },
      } as unknown as TonClient
      const chain = new TONChain(client, TON_NETWORK, { logger: silentLogger })

      await assert.rejects(
        () => chain.getOffRampConfig(OFF_RAMP.toString(), SEPOLIA_SELECTOR),
        (error: unknown) => {
          assert.ok(error instanceof CCIPSourceChainUnsupportedError)
          assert.equal(error.code, CCIPErrorCode.SOLANA_SOURCE_CHAIN_UNSUPPORTED)
          assert.match(error.message, new RegExp(String(SEPOLIA_SELECTOR)))
          assert.equal(error.context['chainSelector'], String(SEPOLIA_SELECTOR))
          assert.equal(error.isTransient, false)
          return true
        },
      )
    })
  })

  describe('router routing', () => {
    it('reads the destination OnRamp from the Router', async () => {
      const calls: Array<{ method: string; params: unknown }> = []
      const client = {
        provider: () => ({
          get: async (method: string, params: unknown) => {
            calls.push({ method, params })
            return { stack: mockStack([{ address: ON_RAMP }]) }
          },
        }),
      } as unknown as TonClient
      const chain = new TONChain(client, TON_NETWORK, { logger: silentLogger })

      const onRamp = await chain.getOnRampForRouter(ROUTER.toString(), SEPOLIA_SELECTOR)

      assert.equal(onRamp, ON_RAMP.toRawString())
      assert.equal(calls.length, 1)
      assert.equal(calls[0]!.method, 'onRamp')
      assert.deepEqual(calls[0]!.params, [{ type: 'int', value: SEPOLIA_SELECTOR }])
    })

    it('reads the source OffRamp from the Router', async () => {
      const calls: Array<{ method: string; params: unknown }> = []
      const client = {
        provider: () => ({
          get: async (method: string, params: unknown) => {
            calls.push({ method, params })
            return { stack: mockStack([{ address: OFF_RAMP }]) }
          },
        }),
      } as unknown as TonClient
      const chain = new TONChain(client, TON_NETWORK, { logger: silentLogger })

      const offRamps = await chain.getOffRampsForRouter(ROUTER.toString(), SEPOLIA_SELECTOR)

      assert.deepEqual(offRamps, [OFF_RAMP.toRawString()])
      assert.equal(calls.length, 1)
      assert.equal(calls[0]!.method, 'offRamp')
      assert.deepEqual(calls[0]!.params, [{ type: 'int', value: SEPOLIA_SELECTOR }])
    })

    it('returns the native GRAM sentinel for any Router', async () => {
      const chain = new TONChain({} as TonClient, TON_NETWORK, { logger: silentLogger })

      const token = await chain.getNativeTokenForRouter(ROUTER.toString())

      assert.equal(token, '0:0000000000000000000000000000000000000000000000000000000000000001')
    })
  })
})
