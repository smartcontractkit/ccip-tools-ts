import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Interface, getAddress, makeError, toBeHex } from 'ethers'

import type { EVMChain } from '../../../../evm/index.ts'
import { encodeFinality } from '../../../../extra-args.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTOperationUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import {
  type GetAllTokenTransferFeeConfigsParams,
  GetAllTokenTransferFeeConfigs,
} from './get-all-token-transfer-fee-configs.ts'

const POOL = '0x' + '11'.repeat(20)
const TOKEN = '0x' + '22'.repeat(20)
const ETHEREUM = 5009297550715157269n
const BASE_SEPOLIA = 10344971235874465080n
/** A selector no `networkInfo` entry knows. */
const UNKNOWN_SELECTOR = 1n

/** Independent oracle for selectors, calldata and return encoding, not the SDK's cached ABI. */
const ORACLE = new Interface([
  'function getToken() view returns (address)',
  'function getSupportedChains() view returns (uint64[])',
  'function getTokenTransferFeeConfig(address localToken, uint64 destChainSelector, bytes4 requestedFinalityConfig, bytes tokenArgs) view returns ((uint32 destGasOverhead, uint32 destBytesOverhead, uint32 finalityFeeUSDCents, uint32 fastFinalityFeeUSDCents, uint16 finalityTransferFeeBps, uint16 fastFinalityTransferFeeBps, bool isEnabled))',
])

/** Distinct config per lane: a config filed under the other lane's selector must fail the deepEqual. */
const CONFIGS = new Map([
  [
    ETHEREUM,
    {
      destGasOverhead: 100_000,
      destBytesOverhead: 32,
      finalityFeeUSDCents: 10,
      fastFinalityFeeUSDCents: 20,
      finalityTransferFeeBps: 25,
      fastFinalityTransferFeeBps: 50,
      isEnabled: true,
    },
  ],
  [
    BASE_SEPOLIA,
    {
      destGasOverhead: 200_000,
      destBytesOverhead: 64,
      finalityFeeUSDCents: 30,
      fastFinalityFeeUSDCents: 40,
      finalityTransferFeeBps: 75,
      fastFinalityTransferFeeBps: 100,
      isEnabled: false,
    },
  ],
  [
    UNKNOWN_SELECTOR,
    {
      destGasOverhead: 300_000,
      destBytesOverhead: 96,
      finalityFeeUSDCents: 50,
      fastFinalityFeeUSDCents: 60,
      finalityTransferFeeBps: 125,
      fastFinalityTransferFeeBps: 150,
      isEnabled: true,
    },
  ],
])

/** Every pool type that resolves at v2.0.0, the only version declaring the getter. */
const POOLS = ['BurnMintTokenPool', 'LockReleaseTokenPool', 'SiloedLockReleaseTokenPool'] as const

/** The reads the op makes, as function names (`typeAndVersion` included), plus each lane's args. */
type Seen = { calls: string[]; lanes: unknown[][] }
const newSeen = (): Seen => ({ calls: [], lanes: [] })

/** EVMChain stub answering `typeAndVersion` and the three pool getters; any other call reverts. */
function stubChain({
  type = 'BurnMintTokenPool',
  version = '2.0.0',
  selectors = [ETHEREUM, BASE_SEPOLIA],
  seen = newSeen(),
}: {
  type?: string
  version?: string
  selectors?: bigint[]
  seen?: Seen
} = {}): EVMChain {
  return {
    provider: {
      call: ({ to, data }: { to: string; data: string }) => {
        const fn = ORACLE.getFunction(data.slice(0, 10))
        if (!fn || getAddress(to) !== getAddress(POOL))
          throw makeError('execution reverted', 'CALL_EXCEPTION')
        seen.calls.push(fn.name)
        if (fn.name === 'getToken') return Promise.resolve(ORACLE.encodeFunctionResult(fn, [TOKEN]))
        if (fn.name === 'getSupportedChains')
          return Promise.resolve(ORACLE.encodeFunctionResult(fn, [selectors]))
        const args = Array.from(ORACLE.decodeFunctionData(fn, data))
        seen.lanes.push(args)
        const config = CONFIGS.get(args[1])
        if (!config) throw makeError('execution reverted', 'CALL_EXCEPTION')
        return Promise.resolve(ORACLE.encodeFunctionResult(fn, [config]))
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => {
      seen.calls.push('typeAndVersion')
      return Promise.resolve(parseTypeAndVersion(`${type} ${version}`))
    },
  } as unknown as EVMChain
}

const op = new GetAllTokenTransferFeeConfigs()
const query = (chain: EVMChain, overrides: Partial<GetAllTokenTransferFeeConfigsParams> = {}) =>
  op.query(chain, { poolAddress: POOL, ...overrides })

describe('GetAllTokenTransferFeeConfigs (cct/evm)', () => {
  describe('query', () => {
    for (const type of POOLS) {
      it(`reads every lane of a ${type} 2.0.0, each with its selector, in getSupportedChains order`, async () => {
        const seen = newSeen()
        assert.deepEqual(await query(stubChain({ type, seen })), [
          { remoteChainSelector: ETHEREUM, ...CONFIGS.get(ETHEREUM) },
          { remoteChainSelector: BASE_SEPOLIA, ...CONFIGS.get(BASE_SEPOLIA) },
        ])
        // resolved once, token read once, then one config read per lane
        assert.equal(seen.calls.filter((c) => c === 'typeAndVersion').length, 1)
        assert.equal(seen.calls.filter((c) => c === 'getToken').length, 1)
        assert.deepEqual(seen.lanes, [
          [getAddress(TOKEN), ETHEREUM, toBeHex(encodeFinality('finalized'), 4), '0x'],
          [getAddress(TOKEN), BASE_SEPOLIA, toBeHex(encodeFinality('finalized'), 4), '0x'],
        ])
      })
    }

    it('passes the given finality and tokenArgs to every lane', async () => {
      const seen = newSeen()
      await query(stubChain({ seen }), { finality: 'safe', tokenArgs: '0xabcd' })
      assert.deepEqual(
        seen.lanes.map(([, , finality, tokenArgs]) => [finality, tokenArgs]),
        [
          [toBeHex(encodeFinality('safe'), 4), '0xabcd'],
          [toBeHex(encodeFinality('safe'), 4), '0xabcd'],
        ],
      )
    })

    it('returns a lane whose selector the SDK does not know instead of failing the whole read', async () => {
      assert.deepEqual(await query(stubChain({ selectors: [UNKNOWN_SELECTOR] })), [
        { remoteChainSelector: UNKNOWN_SELECTOR, ...CONFIGS.get(UNKNOWN_SELECTOR) },
      ])
    })

    it('returns [] for a pool with no supported lane, reading no lane config', async () => {
      const seen = newSeen()
      assert.deepEqual(await query(stubChain({ selectors: [], seen })), [])
      assert.deepEqual(seen.lanes, [])
    })
  })

  describe('validation', () => {
    const cases: Array<
      [keyof GetAllTokenTransferFeeConfigsParams, Partial<GetAllTokenTransferFeeConfigsParams>]
    > = [
      ['poolAddress', { poolAddress: 'not-an-address' }],
      ['finality', { finality: 0 }],
      ['finality', { finality: 65536 }],
      ['finality', { finality: 1.5 }],
      ['tokenArgs', { tokenArgs: 'abcd' }],
      ['tokenArgs', { tokenArgs: '0xabc' }],
    ]
    for (const [param, overrides] of cases) {
      it(`rejects ${param} ${JSON.stringify(overrides[param])} before any RPC`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => query(stubChain({ seen }), overrides),
          (err: unknown) =>
            err instanceof CCTParamsInvalidError &&
            err.context.operation === 'getAllTokenTransferFeeConfigs' &&
            err.context.param === param,
        )
        assert.deepEqual(seen.calls, [])
      })
    }
  })

  describe('version', () => {
    const PRE_V2 = [
      ['BurnMintTokenPool', '1.5.0'],
      ['BurnMintTokenPool', '1.5.1'],
      ['BurnMintTokenPool', '1.6.1'],
      ['LockReleaseTokenPool', '1.5.0'],
      ['LockReleaseTokenPool', '1.5.1'],
      ['LockReleaseTokenPool', '1.6.1'],
      ['SiloedLockReleaseTokenPool', '1.6.0'],
      ['SiloedLockReleaseTokenPool', '1.6.1'],
    ] as const
    for (const [type, version] of PRE_V2) {
      it(`rejects a ${type} ${version}, which has no getTokenTransferFeeConfig`, async () => {
        const seen = newSeen()
        await assert.rejects(
          () => query(stubChain({ type, version, seen })),
          (err: unknown) =>
            err instanceof CCTOperationUnsupportedError &&
            err.context.operation === 'getAllTokenTransferFeeConfigs' &&
            err.context.version === version,
        )
        // reported from the version alone; not even getSupportedChains() is read
        assert.deepEqual(seen.calls, ['typeAndVersion'])
      })
    }

    it('rejects an unsupported pool type before any getter', async () => {
      const seen = newSeen()
      await assert.rejects(
        () => query(stubChain({ type: 'USDCTokenPool', seen })),
        (err: unknown) =>
          err instanceof CCTContractTypeInvalidError && err.context.actual === 'USDCTokenPool',
      )
      assert.deepEqual(seen.calls, ['typeAndVersion'])
    })

    it('rejects an unknown version before any getter', async () => {
      const seen = newSeen()
      await assert.rejects(
        () => query(stubChain({ version: '1.4.0', seen })),
        (err: unknown) =>
          err instanceof CCTContractVersionUnsupportedError && err.context.version === '1.4.0',
      )
      assert.deepEqual(seen.calls, ['typeAndVersion'])
    })
  })
})
