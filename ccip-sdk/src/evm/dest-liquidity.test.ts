import assert from 'node:assert/strict'
import { after, beforeEach, describe, it, mock } from 'node:test'

import {
  AbiCoder,
  Interface,
  MaxUint256,
  getAddress,
  hexlify,
  randomBytes,
  toBeHex,
  zeroPadValue,
} from 'ethers'

import { interfaces } from './const.ts'
import { parseWithFragment } from './errors.ts'
import { estimateReceiveExecution } from '../gas.ts'
import { EVMChain } from './index.ts'
import {
  CCIP_POOL_V1_INTERFACE_ID,
  IPOOL_V2_INTERFACE_ID,
  classifyPoolRevert,
  isTransientReleaseOrMintRevert,
  simulateLockOrBurn,
  simulateReleaseOrMint,
} from './simulate.ts'
import {
  type CCIPError,
  CCIPArgumentInvalidError,
  CCIPContractTypeInvalidError,
  CCIPDestExecutionRevertError,
  CCIPDestSimulationUnavailableError,
  CCIPInsufficientBalanceError,
  CCIPRateLimitExceededError,
  CCIPSourceChainUnsupportedError,
  CCIPSourcePoolRevertError,
  CCIPTokenNotInRegistryError,
  CCIPTokenPoolChainConfigNotFoundError,
} from '../errors/index.ts'
import { ChainFamily, NetworkType, networkInfo } from '../networks.ts'

const abi = AbiCoder.defaultAbiCoder()
const pool = interfaces.TokenPool_v2_0
const SUPPORTS_SEL = pool.getFunction('supportsInterface')!.selector
const ROM_V2_FRAG = 'releaseOrMint((bytes,uint64,address,uint256,address,bytes,bytes,bytes),bytes4)'
const ROM_V1_FRAG = 'releaseOrMint((bytes,uint64,address,uint256,address,bytes,bytes,bytes))'
const LOB_V1_FRAG = 'lockOrBurn((bytes,uint64,address,uint256,address))'
const ROM_V2_SEL = pool.getFunction(ROM_V2_FRAG)!.selector
const ROM_V1_SEL = pool.getFunction(ROM_V1_FRAG)!.selector
const LOB_V1_SEL = pool.getFunction(LOB_V1_FRAG)!.selector

const SOURCE_SELECTOR = 16015286601757825753n // ethereum-sepolia
const DEST_SELECTOR = 14767482510784806043n // avalanche-fuji

// error encoders for classifier fixtures
const poolErrors = new Interface([
  'error InsufficientLiquidity()',
  'error InsufficientLiquidity(uint256 availableLiquidity, uint256 requestedAmount)',
  'error InsufficientLockboxBalance(uint256 lockboxBalance, uint256 localAmount)',
  'error InsufficientBalance(uint256 requested, uint256 available)',
  'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
  'error TokenMaxCapacityExceeded(uint256 capacity, uint256 requested, address tokenAddress)',
  'error TokenRateLimitReached(uint256 minWaitInSeconds, uint256 available, address tokenAddress)',
  'error AggregateValueRateLimitReached(uint256 minWaitInSeconds, uint256 available)',
  'error AggregateValueMaxCapacityExceeded(uint256 capacity, uint256 requested)',
  'error CursedByRMN()',
  'error ChainNotAllowed(uint64 remoteChainSelector)',
  'error InvalidSourcePoolAddress(bytes sourcePoolAddress)',
  'error InvalidToken(address token)',
  'error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)',
  'error SenderNotMinter(address sender)',
  'error SenderNotBurner(address sender)',
  'error IXERC20_NotHighEnoughLimits()',
  'error NotHighEnoughLimits()',
])
const encodeErr = (sig: string, args: readonly unknown[] = []) =>
  poolErrors.encodeErrorResult(sig, args)

// ============================================================================
// 1) Transient-revert flag (drives isTransient on the raised error; not the block decision)
// ============================================================================
describe('isTransientReleaseOrMintRevert', () => {
  const A = () => getAddress(hexlify(randomBytes(20)))

  it('flags liquidity / rate-limit / bridge-limit / curse reverts as transient (they recover on their own)', () => {
    const transient = [
      encodeErr('InsufficientLiquidity()'),
      encodeErr('InsufficientLiquidity(uint256,uint256)', [1n, 2n]),
      encodeErr('InsufficientBalance(uint256,uint256)', [2n, 1n]),
      encodeErr('ERC20InsufficientBalance(address,uint256,uint256)', [A(), 1n, 2n]),
      encodeErr('InsufficientLockboxBalance(uint256,uint256)', [1n, 2n]),
      encodeErr('TokenRateLimitReached(uint256,uint256,address)', [60n, 1n, A()]),
      encodeErr('AggregateValueRateLimitReached(uint256,uint256)', [60n, 1n]),
      encodeErr('CursedByRMN()'),
      encodeErr('NotHighEnoughLimits()'),
      encodeErr('IXERC20_NotHighEnoughLimits()'),
    ]
    for (const enc of transient)
      assert.equal(isTransientReleaseOrMintRevert(enc), true, enc.slice(0, 10))
  })

  it('flags capacity-exceeded / authority / config / unknown reverts as non-transient (they need a fix)', () => {
    const permanent = [
      // amount > the bucket's STATIC capacity — the maximum never refills, waiting cannot help
      encodeErr('TokenMaxCapacityExceeded(uint256,uint256,address)', [1n, 2n, A()]),
      encodeErr('AggregateValueMaxCapacityExceeded(uint256,uint256)', [1n, 2n]),
      encodeErr('AccessControlUnauthorizedAccount(address,bytes32)', [
        A(),
        hexlify(randomBytes(32)),
      ]),
      encodeErr('SenderNotMinter(address)', [A()]),
      encodeErr('ChainNotAllowed(uint64)', [SOURCE_SELECTOR]),
      encodeErr('InvalidSourcePoolAddress(bytes)', [hexlify(randomBytes(32))]),
      encodeErr('InvalidToken(address)', [A()]),
      '0xdeadbeef',
      '0x',
    ]
    for (const enc of permanent)
      assert.equal(isTransientReleaseOrMintRevert(enc), false, enc.slice(0, 10))
  })

  it('TokenRateLimitReached with minWait=maxUint256 (v2.0 zero-rate bucket) is permanent', () => {
    // RateLimiter v2.0: `if (rate == 0) revert TokenRateLimitReached(type(uint256).max, ...)` —
    // the bucket never refills, so retrying can never succeed
    const enc = encodeErr('TokenRateLimitReached(uint256,uint256,address)', [MaxUint256, 5n, A()])
    assert.equal(isTransientReleaseOrMintRevert(enc), false)
    assert.deepEqual(classifyPoolRevert(enc), { name: 'TokenRateLimitReached', isTransient: false })
  })

  it('classifyPoolRevert names decoded reverts and leaves unknowns unnamed', () => {
    assert.deepEqual(classifyPoolRevert(encodeErr('CursedByRMN()')), {
      name: 'CursedByRMN',
      isTransient: true,
    })
    assert.deepEqual(classifyPoolRevert('0xdeadbeef'), { isTransient: false })
  })
})

// ============================================================================
// 2) simulateReleaseOrMint — ERC165 arity dispatch off the pool's own answer
// ============================================================================
type Call = { from?: string; to?: string; data?: string }
function makeProvider(opts: {
  isV2: boolean
  isV1?: boolean
  revert?: string
  rpcError?: boolean
  destinationAmount?: bigint
  /** make the supportsInterface probes fail: a contract revert vs a transport error */
  probeError?: 'call-exception' | 'transport'
}) {
  const calls: Call[] = []
  const provider = {
    calls,
    call: mock.fn(async (tx: Call) => {
      calls.push(tx)
      const sel = (tx.data ?? '0x').slice(0, 10)
      if (sel === SUPPORTS_SEL) {
        if (opts.probeError === 'call-exception')
          // how ethers surfaces a contract reverting/returning nothing on the probe
          throw Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' })
        if (opts.probeError === 'transport') throw new Error('could not detect network')
        const [id] = pool.decodeFunctionData('supportsInterface', tx.data!)
        const supported =
          (id === IPOOL_V2_INTERFACE_ID && opts.isV2) ||
          (id === CCIP_POOL_V1_INTERFACE_ID && (opts.isV1 ?? true))
        return pool.encodeFunctionResult('supportsInterface', [supported])
      }
      if (sel === ROM_V2_SEL || sel === ROM_V1_SEL) {
        // rpcError: a transport failure with NO revert data (distinct from a contract revert)
        if (opts.rpcError) throw new Error('could not detect network')
        if (opts.revert) throw Object.assign(new Error('execution reverted'), { data: opts.revert })
        return pool.encodeFunctionResult(sel === ROM_V2_SEL ? ROM_V2_FRAG : ROM_V1_FRAG, [
          [opts.destinationAmount ?? 1000n],
        ])
      }
      throw new Error(`unexpected call: ${sel}`)
    }),
  }
  return provider
}

const POOL = getAddress(hexlify(randomBytes(20)))
const OFFRAMP = getAddress(hexlify(randomBytes(20)))
const TOKEN = getAddress(hexlify(randomBytes(20)))
const RECEIVER = getAddress(hexlify(randomBytes(20)))
const SRC_POOL_BYTES = zeroPadValue(getAddress(hexlify(randomBytes(20))), 32)

const baseInput = {
  remoteChainSelector: SOURCE_SELECTOR,
  receiver: RECEIVER,
  sourceDenominatedAmount: 1000n,
  localToken: TOKEN,
  sourcePoolAddress: SRC_POOL_BYTES,
}

describe('simulateReleaseOrMint', () => {
  it('IPoolV2 pool => 2-arg releaseOrMint with encoded finality, from=offRamp', async () => {
    const provider = makeProvider({ isV2: true, destinationAmount: 42n })
    const result = await simulateReleaseOrMint({
      provider: provider as never,
      pool: POOL,
      offRamp: OFFRAMP,
      input: baseInput,
      finality: 1,
    })
    assert.equal(result.poolInterface, 'IPoolV2')
    assert.equal(result.destinationAmount, 42n)
    const simCall = provider.calls.find((c) => c.data?.startsWith(ROM_V2_SEL))!
    assert.ok(simCall, '2-arg releaseOrMint was called')
    assert.equal(simCall.from, OFFRAMP)
    const [decoded, finality] = pool.decodeFunctionData(ROM_V2_FRAG, simCall.data!)
    assert.equal(decoded.remoteChainSelector, SOURCE_SELECTOR)
    assert.equal(decoded.sourceDenominatedAmount, 1000n)
    assert.equal(finality, toBeHex(1, 4)) // depth-1 finality encoded as bytes4
    // no 1-arg call was made
    assert.ok(!provider.calls.some((c) => c.data?.startsWith(ROM_V1_SEL)))
  })

  it('non-IPoolV2, CCIP_POOL_V1 pool => 1-arg releaseOrMint (v1.5/v1.6/oUSDT path)', async () => {
    const provider = makeProvider({ isV2: false, isV1: true })
    const result = await simulateReleaseOrMint({
      provider: provider as never,
      pool: POOL,
      offRamp: OFFRAMP,
      input: baseInput,
    })
    assert.equal(result.poolInterface, 'IPoolV1')
    const simCall = provider.calls.find((c) => c.data?.startsWith(ROM_V1_SEL))!
    assert.ok(simCall, '1-arg releaseOrMint was called')
    assert.equal(simCall.from, OFFRAMP)
    assert.ok(!provider.calls.some((c) => c.data?.startsWith(ROM_V2_SEL)))
  })

  it('pool supporting neither interface => CCIPContractTypeInvalidError', async () => {
    const provider = makeProvider({ isV2: false, isV1: false })
    await assert.rejects(
      () =>
        simulateReleaseOrMint({
          provider: provider as never,
          pool: POOL,
          offRamp: OFFRAMP,
          input: baseInput,
        }),
      CCIPContractTypeInvalidError,
    )
  })

  it('probes reverting (non-ERC165 contract) => "unsupported", same typed error', async () => {
    // a contract revert on the probe is a successful "no" — only this may mean incompatible
    const provider = makeProvider({ isV2: false, probeError: 'call-exception' })
    await assert.rejects(
      () =>
        simulateReleaseOrMint({
          provider: provider as never,
          pool: POOL,
          offRamp: OFFRAMP,
          input: baseInput,
        }),
      CCIPContractTypeInvalidError,
    )
  })

  it('transport failure during the probes => raw error propagates (NOT "incompatible pool")', async () => {
    const provider = makeProvider({ isV2: false, probeError: 'transport' })
    await assert.rejects(
      () =>
        simulateReleaseOrMint({
          provider: provider as never,
          pool: POOL,
          offRamp: OFFRAMP,
          input: baseInput,
        }),
      (err: Error) => {
        assert.ok(!(err instanceof CCIPContractTypeInvalidError))
        assert.match(err.message, /could not detect network/)
        return true
      },
    )
  })

  it('poolInterface hint skips the ERC165 probes', async () => {
    // probes would fail loudly if attempted; the hint (e.g. from a memoized typeAndVersion)
    // dispatches directly
    const provider = makeProvider({ isV2: false, probeError: 'transport', destinationAmount: 7n })
    const result = await simulateReleaseOrMint({
      provider: provider as never,
      pool: POOL,
      offRamp: OFFRAMP,
      input: baseInput,
      poolInterface: 'IPoolV1',
    })
    assert.equal(result.poolInterface, 'IPoolV1')
    assert.ok(!provider.calls.some((c) => c.data?.startsWith(SUPPORTS_SEL)))
  })

  it('propagates the raw revert (classifiable by the caller)', async () => {
    const revert = encodeErr('InsufficientLiquidity()')
    const provider = makeProvider({ isV2: true, revert })
    await assert.rejects(
      () =>
        simulateReleaseOrMint({
          provider: provider as never,
          pool: POOL,
          offRamp: OFFRAMP,
          input: baseInput,
        }),
      (err: Error & { data?: string }) => {
        assert.equal(err.data, revert)
        // the raw revert is parseable by the caller with the SDK's standard parse
        assert.equal(parseWithFragment(err.data ?? '0x')?.[0].name, 'InsufficientLiquidity')
        return true
      },
    )
  })
})

describe('simulateLockOrBurn', () => {
  it('IPoolV1 pool => 1-arg lockOrBurn from=onRamp, returns destPoolData', async () => {
    const destPoolData = abi.encode(['uint256'], [18n])
    const destTokenAddress = zeroPadValue(TOKEN, 32)
    const calls: Call[] = []
    const provider = {
      call: mock.fn(async (tx: Call) => {
        const sel = (tx.data ?? '0x').slice(0, 10)
        const [id] = pool.decodeFunctionData('supportsInterface', tx.data!)
        return pool.encodeFunctionResult('supportsInterface', [
          sel === SUPPORTS_SEL && id === CCIP_POOL_V1_INTERFACE_ID,
        ])
      }),
      send: mock.fn(async (_method: string, [tx]: [Call]) => {
        calls.push(tx)
        assert.equal((tx.data ?? '0x').slice(0, 10), LOB_V1_SEL)
        return pool.encodeFunctionResult(LOB_V1_FRAG, [[destTokenAddress, destPoolData]])
      }),
    }
    const result = await simulateLockOrBurn({
      provider: provider as never,
      pool: POOL,
      onRamp: OFFRAMP,
      input: {
        receiver: zeroPadValue(RECEIVER, 32),
        remoteChainSelector: DEST_SELECTOR,
        originalSender: RECEIVER,
        amount: 1000n,
        localToken: TOKEN,
      },
    })
    assert.equal(result.poolInterface, 'IPoolV1')
    assert.equal(result.destPoolData, destPoolData)
    assert.equal(result.destTokenAddress, destTokenAddress)
    assert.equal(calls[0]!.from, OFFRAMP)
  })

  it('IPoolV2 pool => 3-arg lockOrBurn(input, bytes4, bytes) returning (out, uint256)', async () => {
    const lobV2Frag = 'lockOrBurn((bytes,uint64,address,uint256,address),bytes4,bytes)'
    const lobV2Sel = pool.getFunction(lobV2Frag)!.selector
    const destPoolData = abi.encode(['uint256'], [6n])
    const destTokenAddress = zeroPadValue(TOKEN, 32)
    const calls: Call[] = []
    const provider = {
      call: mock.fn(async (tx: Call) => {
        const [id] = pool.decodeFunctionData('supportsInterface', tx.data!)
        return pool.encodeFunctionResult('supportsInterface', [id === IPOOL_V2_INTERFACE_ID])
      }),
      send: mock.fn(async (_method: string, [tx]: [Call]) => {
        calls.push(tx)
        assert.equal((tx.data ?? '0x').slice(0, 10), lobV2Sel, 'must use the 3-arg v2 fragment')
        // decodes the 3 args; the empty tokenArgs is the 3rd
        const [, , tokenArgs] = pool.decodeFunctionData(lobV2Frag, tx.data!)
        assert.equal(tokenArgs, '0x')
        // return shape is (LockOrBurnOutV1, uint256 destTokenAmount)
        return pool.encodeFunctionResult(lobV2Frag, [[destTokenAddress, destPoolData], 900n])
      }),
    }
    const result = await simulateLockOrBurn({
      provider: provider as never,
      pool: POOL,
      onRamp: OFFRAMP,
      finality: 1,
      input: {
        receiver: zeroPadValue(RECEIVER, 32),
        remoteChainSelector: DEST_SELECTOR,
        originalSender: RECEIVER,
        amount: 1000n,
        localToken: TOKEN,
      },
    })
    assert.equal(result.poolInterface, 'IPoolV2')
    assert.equal(result.destPoolData, destPoolData)
    assert.equal(result.destTokenAddress, destTokenAddress)
    // the 2nd return value is the post-fee amount the OnRamp emits — must be surfaced
    assert.equal(result.destTokenAmount, 900n)
  })

  it('IPoolV2: caller tokenArgs are passed as the 3rd lockOrBurn argument', async () => {
    const lobV2Frag = 'lockOrBurn((bytes,uint64,address,uint256,address),bytes4,bytes)'
    const provider = {
      call: mock.fn(async (tx: Call) => {
        const [id] = pool.decodeFunctionData('supportsInterface', tx.data!)
        return pool.encodeFunctionResult('supportsInterface', [id === IPOOL_V2_INTERFACE_ID])
      }),
      send: mock.fn(async (_method: string, [tx]: [Call]) => {
        const [, , tokenArgs] = pool.decodeFunctionData(lobV2Frag, tx.data!)
        assert.equal(tokenArgs, '0x12345678')
        return pool.encodeFunctionResult(lobV2Frag, [
          [zeroPadValue(TOKEN, 32), abi.encode(['uint256'], [18n])],
          1000n,
        ])
      }),
    }
    const result = await simulateLockOrBurn({
      provider: provider as never,
      pool: POOL,
      onRamp: OFFRAMP,
      tokenArgs: '0x12345678',
      input: {
        receiver: zeroPadValue(RECEIVER, 32),
        remoteChainSelector: DEST_SELECTOR,
        originalSender: RECEIVER,
        amount: 1000n,
        localToken: TOKEN,
      },
    })
    assert.equal(result.destTokenAmount, 1000n)
  })

  it('IPoolV1: destTokenAmount = input amount (legacy overload never deducts); tokenArgs rejected', async () => {
    const provider = {
      call: mock.fn(async (tx: Call) => {
        const [id] = pool.decodeFunctionData('supportsInterface', tx.data!)
        return pool.encodeFunctionResult('supportsInterface', [id === CCIP_POOL_V1_INTERFACE_ID])
      }),
      send: mock.fn(async (_method: string, [tx]: [Call]) => {
        assert.equal((tx.data ?? '0x').slice(0, 10), LOB_V1_SEL)
        return pool.encodeFunctionResult(LOB_V1_FRAG, [
          [zeroPadValue(TOKEN, 32), abi.encode(['uint256'], [18n])],
        ])
      }),
    }
    const input = {
      receiver: zeroPadValue(RECEIVER, 32),
      remoteChainSelector: DEST_SELECTOR,
      originalSender: RECEIVER,
      amount: 1000n,
      localToken: TOKEN,
    }
    const result = await simulateLockOrBurn({
      provider: provider as never,
      pool: POOL,
      onRamp: OFFRAMP,
      input,
    })
    assert.equal(result.destTokenAmount, 1000n)
    // mirroring OnRamp's TokenArgsNotSupportedOnPoolV1: non-empty tokenArgs cannot reach a v1 pool
    await assert.rejects(
      () =>
        simulateLockOrBurn({
          provider: provider as never,
          pool: POOL,
          onRamp: OFFRAMP,
          tokenArgs: '0x1234',
          input,
        }),
      CCIPArgumentInvalidError,
    )
  })
})

// EVMChain.simulateLockOrBurn — dispatch must follow the ONRAMP version (live-found defect:
// v1.5 OnRamps always call the 1-arg lockOrBurn, even on migrated 2.0.0 proxy pools whose
// IPoolV2 path would reject the legacy mechanism)
describe('EVMChain.simulateLockOrBurn — OnRamp-version dispatch', () => {
  it('v1.5 OnRamp + 2.0 proxy pool => 1-arg lockOrBurn, never IPoolV2', async () => {
    const ONRAMP = getAddress(hexlify(randomBytes(20)))
    const lobV2Frag = 'lockOrBurn((bytes,uint64,address,uint256,address),bytes4,bytes)'
    const lobV2Sel = pool.getFunction(lobV2Frag)!.selector
    const sendCalls: Call[] = []
    const provider = {
      call: mock.fn(async () => {
        throw Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' })
      }),
      send: mock.fn(async (_method: string, [tx]: [Call]) => {
        sendCalls.push(tx)
        assert.equal((tx.data ?? '0x').slice(0, 10), LOB_V1_SEL)
        return pool.encodeFunctionResult(LOB_V1_FRAG, [
          [zeroPadValue(TOKEN, 32), '0x' + 'f3567d18' + '00'.repeat(60)],
        ])
      }),
    }
    const chain = Object.create(EVMChain.prototype) as EVMChain
    Object.assign(chain, {
      provider,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      network: {
        name: 'ethereum-testnet-sepolia',
        chainSelector: SOURCE_SELECTOR,
        family: ChainFamily.EVM,
        networkType: NetworkType.Testnet,
      },
      getTokenAdminRegistryFor: mock.fn(async () => getAddress(hexlify(randomBytes(20)))),
      getRegistryTokenConfig: mock.fn(async () => ({ tokenPool: POOL })),
      typeAndVersion: mock.fn(async (address: string) =>
        address === ONRAMP
          ? (['EVM2EVMOnRamp', '1.5.0', 'EVM2EVMOnRamp 1.5.0'] as const)
          : (['USDCTokenPoolProxy', '2.0.0', 'USDCTokenPoolProxy 2.0.0'] as const),
      ),
    })
    const result = await chain.simulateLockOrBurn({
      onRamp: ONRAMP,
      destChainSelector: DEST_SELECTOR,
      token: TOKEN,
      amount: 1000n,
      originalSender: RECEIVER,
      receiver: RECEIVER,
    })
    assert.equal(result.destTokenAmount, 1000n) // 1-arg overload: amount passthrough
    assert.ok(sendCalls.length >= 1)
    assert.ok(!sendCalls.some((c) => c.data?.startsWith(lobV2Sel)))
  })

  function makeSourceEvmChain(revert: string) {
    const ONRAMP = getAddress(hexlify(randomBytes(20)))
    const chain = Object.create(EVMChain.prototype) as EVMChain
    Object.assign(chain, {
      provider: {
        call: mock.fn(async () => {
          throw Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' })
        }),
        send: mock.fn(async () => {
          throw Object.assign(new Error('execution reverted'), { data: revert })
        }),
      },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      network: {
        name: 'ethereum-testnet-sepolia',
        chainSelector: SOURCE_SELECTOR,
        family: ChainFamily.EVM,
        networkType: NetworkType.Testnet,
      },
      getTokenAdminRegistryFor: mock.fn(async () => getAddress(hexlify(randomBytes(20)))),
      getRegistryTokenConfig: mock.fn(async () => ({ tokenPool: POOL })),
      typeAndVersion: mock.fn(async (address: string) =>
        address === ONRAMP
          ? (['EVM2EVMOnRamp', '1.5.0', 'EVM2EVMOnRamp 1.5.0'] as const)
          : (['BurnMintTokenPool', '1.5.1', 'BurnMintTokenPool 1.5.1'] as const),
      ),
    })
    return { chain, ONRAMP }
  }
  const lobOpts = (chain: EVMChain, onRamp: string) => ({
    onRamp,
    destChainSelector: DEST_SELECTOR,
    token: TOKEN,
    amount: 1000n,
    originalSender: RECEIVER,
    receiver: RECEIVER,
  })

  it('genuine source-gate revert => typed CCIPSourcePoolRevertError with raw revert', async () => {
    const revert = interfaces.Custom.encodeErrorResult('SenderNotAllowed', [
      DEST_SELECTOR,
      RECEIVER,
    ])
    const { chain, ONRAMP } = makeSourceEvmChain(revert)
    await assert.rejects(
      () => chain.simulateLockOrBurn(lobOpts(chain, ONRAMP)),
      (err: CCIPError) => {
        assert.ok(err instanceof CCIPSourcePoolRevertError, String(err))
        assert.equal(err.context['revert'], revert)
        return true
      },
    )
  })

  it('balance/allowance reverts (state-override artifacts) rethrow RAW for best-effort fallback', async () => {
    const revert = interfaces.Custom.encodeErrorResult('ERC20InsufficientBalance', [
      POOL,
      0n,
      1000n,
    ])
    const { chain, ONRAMP } = makeSourceEvmChain(revert)
    await assert.rejects(
      () => chain.simulateLockOrBurn(lobOpts(chain, ONRAMP)),
      (err: Error) => {
        assert.ok(!(err instanceof CCIPSourcePoolRevertError), 'artifact must not block')
        return true
      },
    )
  })
})

// ============================================================================
// 3) EVMChain.checkExecute wiring — mandatory sim, typed throw per class, unrecognized-revert
//    block, transient RPC error, data-only/no-receiver short-circuits
// ============================================================================
function makeChain(opts: {
  isV2?: boolean
  isV1?: boolean
  revert?: string
  rpcError?: boolean
  probeError?: 'call-exception' | 'transport'
  remotePoolsRpcError?: boolean
  remotePoolsRevert?: string
  noPool?: boolean
  poolTypeAndVersion?: string
  /** OffRamp typeAndVersion — defaults to the same generation as the pool */
  offRampTypeAndVersion?: string
  remotePools?: string[]
  /** OffRamp source-chain config for the lane gates (default: gate no-op, 1.2/1.5-like shape) */
  offRampConfig?: { isEnabled?: boolean; onRamps: string[] }
  /** pool/lockbox token balance seen by the base LockRelease liquidity check */
  balance?: bigint
  inboundRateLimiterState?: { tokens: bigint; capacity: bigint; rate: bigint }
  /** make getTokenPoolRemote throw this typed SDK error (F9: must pass through untouched) */
  remotePoolsTypedError?: Error
}) {
  const provider = makeProvider({
    isV2: opts.isV2 ?? true,
    isV1: opts.isV1,
    revert: opts.revert,
    rpcError: opts.rpcError,
    probeError: opts.probeError,
  })
  const tokenPool = opts.noPool ? undefined : POOL
  const warn = mock.fn()
  const chain = Object.create(EVMChain.prototype) as EVMChain
  Object.assign(chain, {
    provider,
    logger: { debug() {}, info() {}, warn, error() {} },
    network: {
      name: 'avalanche-fuji',
      chainId: 43113,
      chainSelector: DEST_SELECTOR,
      family: ChainFamily.EVM,
      networkType: NetworkType.Testnet,
    },
    // mirrors EVMChain.typeAndVersion's [type, version, full] return, keyed by address (the
    // OffRamp's version drives dispatch; the pool's drives classification); only mocked when the
    // test declares one — otherwise checkExecute falls back to the ERC165 probes
    ...((opts.poolTypeAndVersion != null || opts.offRampTypeAndVersion != null) && {
      typeAndVersion: mock.fn(async (address: string) => {
        const tnv =
          address === OFFRAMP
            ? (opts.offRampTypeAndVersion ?? opts.poolTypeAndVersion!)
            : (opts.poolTypeAndVersion ?? opts.offRampTypeAndVersion!)
        const sep = tnv.lastIndexOf(' ')
        return [tnv.slice(0, sep), tnv.slice(sep + 1), tnv] as const
      }),
    }),
    getTokenAdminRegistryFor: mock.fn(async () => getAddress(hexlify(randomBytes(20)))),
    getRegistryTokenConfig: mock.fn(async () => ({ tokenPool })),
    getTokenPoolConfig: mock.fn(async () => ({
      typeAndVersion: opts.poolTypeAndVersion ?? 'BurnMintTokenPool 2.0.0',
      lockBox: undefined,
    })),
    getTokenPoolRemote: mock.fn(async () => {
      if (opts.remotePoolsTypedError) throw opts.remotePoolsTypedError
      // an RPC/transport failure has no revert data attached
      if (opts.remotePoolsRpcError) throw new Error('could not detect network')
      // an on-chain revert carries revert data
      if (opts.remotePoolsRevert)
        throw Object.assign(new Error('execution reverted'), { data: opts.remotePoolsRevert })
      return {
        remoteToken: TOKEN,
        remotePools: opts.remotePools ?? [SRC_POOL_BYTES],
        inboundRateLimiterState: opts.inboundRateLimiterState,
        outboundRateLimiterState: undefined,
      }
    }),
    getOffRampConfig: mock.fn(async () => opts.offRampConfig ?? { onRamps: [] }),
    getTokenInfo: mock.fn(async () => ({ decimals: 18, symbol: 'TEST', name: 'Test' })),
    getBalance: mock.fn(async () => opts.balance ?? 10n ** 24n),
  })
  return { chain, provider, warn }
}

const MESSAGE = {
  sourceChainSelector: SOURCE_SELECTOR,
  receiver: RECEIVER,
  sender: getAddress(hexlify(randomBytes(20))),
  tokenAmounts: [{ token: TOKEN, amount: 1000n }] as const,
}

describe('EVMChain.checkExecute — dest-liquidity guard', () => {
  beforeEach(() => mock.restoreAll())
  after(() => mock.restoreAll())

  it('healthy pool => passes and ran the releaseOrMint simulation', async () => {
    const { chain, provider } = makeChain({})
    assert.equal(await chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }), true)
    assert.ok(provider.calls.some((c) => c.data?.startsWith(ROM_V2_SEL)))
  })

  it('any revert => one CCIPDestExecutionRevertError carrying the raw revert, isTransient per cause', async () => {
    const routing = [
      { revert: encodeErr('InsufficientLiquidity()'), transient: true },
      {
        revert: encodeErr('TokenRateLimitReached(uint256,uint256,address)', [60n, 1n, TOKEN]),
        transient: true,
      },
      { revert: encodeErr('CursedByRMN()'), transient: true },
      { revert: encodeErr('ChainNotAllowed(uint64)', [SOURCE_SELECTOR]), transient: false },
      { revert: encodeErr('InvalidSourcePoolAddress(bytes)', [SRC_POOL_BYTES]), transient: false },
      { revert: encodeErr('InvalidToken(address)', [TOKEN]), transient: false },
      {
        revert: encodeErr('AccessControlUnauthorizedAccount(address,bytes32)', [
          POOL,
          hexlify(randomBytes(32)),
        ]),
        transient: false,
      },
      // unrecognized revert still blocks (a revert is a revert), non-transient
      { revert: '0xdeadbeef', transient: false },
    ] as const
    for (const c of routing) {
      const { chain } = makeChain({ revert: c.revert })
      await assert.rejects(
        () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
        (err: CCIPError) => {
          assert.ok(err instanceof CCIPDestExecutionRevertError, c.revert.slice(0, 10))
          assert.equal(err.context['revert'], c.revert, c.revert.slice(0, 10)) // raw revert, caller parses
          assert.equal(err.isTransient, c.transient, c.revert.slice(0, 10))
          return true
        },
      )
    }
  })

  it('the sim is mandatory, not opt-out — a token message always runs it and blocks on revert', async () => {
    // there is no `skip`/`warn` escape: whenever a message carries tokens the dest releaseOrMint
    // simulation runs and a revert blocks the send.
    const { chain, provider } = makeChain({ revert: encodeErr('InsufficientLiquidity()') })
    await assert.rejects(
      () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      CCIPDestExecutionRevertError,
    )
    assert.ok(
      provider.calls.some((c) => c.data?.startsWith(ROM_V2_SEL)),
      'the releaseOrMint simulation ran',
    )
  })

  it('unrecognized revert => still BLOCKS (a revert means it will not execute), non-transient', async () => {
    // the block does not depend on recognizing the error: a revert is a revert.
    const { chain } = makeChain({ revert: '0xdeadbeef' })
    await assert.rejects(
      () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      (err: CCIPError) => {
        assert.ok(err instanceof CCIPDestExecutionRevertError)
        assert.equal(err.isTransient, false)
        assert.equal(err.context['revert'], '0xdeadbeef') // raw selector carried for diagnosis
        return true
      },
    )
  })

  it('no revert data (RPC/transport failure) => transient error to retry, not a block or a pass', async () => {
    const { chain } = makeChain({ rpcError: true })
    await assert.rejects(
      () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      (err: CCIPError) => {
        assert.ok(err instanceof CCIPDestSimulationUnavailableError)
        assert.equal(err.isTransient, true)
        return true
      },
    )
  })

  it('RPC failure reading remote-pool config => transient error, not a false ZeroHash misconfig block', async () => {
    const { chain } = makeChain({ remotePoolsRpcError: true })
    await assert.rejects(
      () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      (err: CCIPError) => {
        assert.ok(err instanceof CCIPDestSimulationUnavailableError)
        assert.equal(err.isTransient, true)
        return true
      },
    )
  })

  it('pool compatible with neither interface => HARD block (NotACompatiblePool equivalent)', async () => {
    const { chain } = makeChain({ isV2: false, isV1: false })
    await assert.rejects(
      () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      CCIPContractTypeInvalidError,
    )
  })

  it('data-only message (no tokenAmounts) => guard short-circuits', async () => {
    const { chain, provider } = makeChain({})
    assert.equal(
      await chain.checkExecute({
        offRamp: OFFRAMP,
        message: { sourceChainSelector: SOURCE_SELECTOR, receiver: RECEIVER, tokenAmounts: [] },
      }),
      true,
    )
    assert.equal(provider.calls.length, 0)
  })

  it('no receiver in message => guard skipped (input not constructible)', async () => {
    const { chain, provider } = makeChain({})
    assert.equal(
      await chain.checkExecute({
        offRamp: OFFRAMP,
        message: { sourceChainSelector: SOURCE_SELECTOR, tokenAmounts: MESSAGE.tokenAmounts },
      }),
      true,
    )
    assert.ok(!provider.calls.some((c) => c.data?.startsWith(ROM_V2_SEL)))
  })

  it('token with no pool in the registry => BLOCKS (cannot be released on dest), not skipped', async () => {
    const { chain, provider } = makeChain({ noPool: true })
    await assert.rejects(
      () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      CCIPTokenNotInRegistryError,
    )
    assert.ok(!provider.calls.some((c) => c.data?.startsWith(ROM_V2_SEL)))
  })

  it('remote-pool read reverts on-chain => BLOCKS directly with the revert, no sim, non-transient', async () => {
    // the registered pool cannot resolve its source pools => unusable => block now (don't feed a
    // placeholder into the sim just to fail an extra eth_call).
    const { chain, provider } = makeChain({ remotePoolsRevert: '0xdeadbeef' })
    await assert.rejects(
      () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      (err: CCIPError) => {
        assert.ok(err instanceof CCIPDestExecutionRevertError)
        assert.equal(err.isTransient, false)
        assert.equal(err.context['revert'], '0xdeadbeef') // carries the actual read revert
        return true
      },
    )
    assert.ok(!provider.calls.some((c) => c.data?.startsWith(ROM_V2_SEL)))
  })

  it('unwired lane (no remote source pool) => fail-fast blocks with InvalidSourcePoolAddress, no sim', async () => {
    // read succeeds but returns zero remote pools => genuinely unwired => block now, one fewer
    // eth_call, carrying a synthetic InvalidSourcePoolAddress revert for a uniform error shape.
    const { chain, provider } = makeChain({ remotePools: [] })
    await assert.rejects(
      () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      (err: CCIPError) => {
        assert.ok(err instanceof CCIPDestExecutionRevertError)
        assert.equal(err.isTransient, false)
        assert.equal(
          parseWithFragment(String(err.context['revert']))?.[0].name,
          'InvalidSourcePoolAddress',
        )
        return true
      },
    )
    // fail-fast: the releaseOrMint simulation never ran
    assert.ok(!provider.calls.some((c) => c.data?.startsWith(ROM_V2_SEL)))
  })

  it('no explicit extraData => simulates with the source-decimals default', async () => {
    // when the caller has not supplied source pool data (the wrapper normally obtains it via
    // simulateLockOrBurn), checkExecute declares the amount in the dest token's own decimals — the
    // identity conversion, correct for every base TokenPool — and still runs the simulation.
    // A pool identifying as 1.5.1 predates IPoolV2, so it dispatches 1-arg without ERC165 probes.
    const { chain, provider } = makeChain({ poolTypeAndVersion: 'LockReleaseTokenPool 1.5.1' })
    assert.equal(await chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }), true)
    assert.ok(provider.calls.some((c) => c.data?.startsWith(ROM_V1_SEL)))
    assert.ok(!provider.calls.some((c) => c.data?.startsWith(SUPPORTS_SEL)))
  })

  it('uses message tokenAmounts extraData as sourcePoolData when present', async () => {
    const { chain, provider } = makeChain({})
    const extraData = abi.encode(['uint256'], [6n]) // source token decimals
    await chain.checkExecute({
      offRamp: OFFRAMP,
      message: {
        ...MESSAGE,
        tokenAmounts: [
          {
            sourcePoolAddress: SRC_POOL_BYTES,
            destTokenAddress: TOKEN,
            amount: 1000n,
            extraData,
          },
        ],
      },
    })
    const simCall = provider.calls.find((c) => c.data?.startsWith(ROM_V2_SEL))!
    const [decoded] = pool.decodeFunctionData(ROM_V2_FRAG, simCall.data!)
    assert.equal(decoded.sourcePoolData, extraData)
    assert.equal(decoded.sourcePoolAddress, SRC_POOL_BYTES)
  })

  it('the generic layer rescales for its own comparisons, never for the simulation', async () => {
    // a 2.0.0 pool debits its bucket in local units, so 1000n at 6 source decimals is compared
    // as 1e15 — over this bucket, deferred, then discarded when the sim passes
    const { chain, provider } = makeChain({
      inboundRateLimiterState: { tokens: 10n ** 14n, capacity: 10n ** 18n, rate: 1n },
    })
    await chain.checkExecute({
      offRamp: OFFRAMP,
      message: {
        ...MESSAGE,
        tokenAmounts: [
          {
            sourcePoolAddress: SRC_POOL_BYTES,
            destTokenAddress: TOKEN,
            amount: 1000n,
            extraData: abi.encode(['uint256'], [6n]), // source 6 decimals, dest mock is 18
          },
        ],
      },
    })
    const simCall = provider.calls.find((c) => c.data?.startsWith(ROM_V2_SEL))
    assert.ok(simCall, 'the releaseOrMint simulation ran')
    const [decoded] = pool.decodeFunctionData(ROM_V2_FRAG, simCall.data!)
    assert.equal(decoded.sourceDenominatedAmount, 1000n) // not 1000 * 10**12
  })

  // ==========================================================================
  // attestation-consuming pools (USDC/CCTP v1.x, Lombard v1.x)
  // ==========================================================================

  const USDC_LOCK_RELEASE_FLAG = '0xfa7c07de' // bytes4(keccak256('NO_CCTP_USE_LOCK_RELEASE'))

  it('USDC/CCTP v1 pool pre-send => unavailable (attestation-required), NOT a block', async () => {
    // pre-send there is no CCTP attestation; simulating the pool with empty offchainTokenData
    // would revert on decode and false-block a valid transfer. The check must report itself
    // unavailable instead — non-transient, since retrying pre-send can never help.
    for (const tnv of [
      'USDCTokenPool 1.5.1', // also what deployed 1.5.1 Hybrid pools report
      'USDCTokenPool 1.6.2',
      'USDCTokenPoolCCTPV2 1.6.4',
      'USDCTokenPoolProxy 1.6.4',
      'HybridLockReleaseUSDCTokenPool 1.6.2',
      'LombardTokenPoolV2 1.6.1',
      'LombardTokenPool 1.6.1',
    ]) {
      const { chain, provider } = makeChain({ poolTypeAndVersion: tnv, isV1: true, isV2: false })
      await assert.rejects(
        () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
        (err: CCIPError) => {
          assert.ok(err instanceof CCIPDestSimulationUnavailableError, tnv)
          assert.equal(err.reason, 'attestation-required', tnv)
          assert.equal(err.isTransient, false, tnv)
          return true
        },
        tnv,
      )
      // the simulation never ran — unavailability is a classification, not a revert
      assert.ok(!provider.calls.some((c) => c.data?.startsWith(ROM_V1_SEL)), tnv)
    }
  })

  it('v2.0 pools never need offchainTokenData => simulation runs normally', async () => {
    // the 2.0 OffRamp hardcodes offchainTokenData "" — CCTP/Lombard 2.0 pool legs are no-ops
    // (minting is verifier-side), so pre-send simulation is valid for them
    for (const tnv of [
      'USDCTokenPoolProxy 2.0.0',
      'LombardTokenPool 2.0.0',
      'CCTPThroughCCVTokenPool 2.0.0',
      'SiloedUSDCTokenPool 2.0.0',
    ]) {
      const { chain, provider } = makeChain({ poolTypeAndVersion: tnv })
      assert.equal(await chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }), true, tnv)
      assert.ok(
        provider.calls.some((c) => c.data?.startsWith(ROM_V2_SEL)),
        tnv,
      )
    }
  })

  it('USDC hybrid lock-release branch (LOCK_RELEASE_FLAG sourcePoolData) => simulates normally', async () => {
    // the hybrid pool releases from local liquidity — no attestation involved — when the source
    // pool flagged the transfer as lock-release; the flag, not the type string, discriminates
    const { chain, provider } = makeChain({
      poolTypeAndVersion: 'USDCTokenPool 1.5.1',
      isV1: true,
      isV2: false,
    })
    const extraData = abi.encode(['bytes4'], [USDC_LOCK_RELEASE_FLAG])
    assert.equal(
      await chain.checkExecute({
        offRamp: OFFRAMP,
        message: {
          ...MESSAGE,
          tokenAmounts: [
            {
              sourcePoolAddress: SRC_POOL_BYTES,
              destTokenAddress: TOKEN,
              amount: 1000n,
              extraData,
            },
          ],
        },
      }),
      true,
    )
    const simCall = provider.calls.find((c) => c.data?.startsWith(ROM_V1_SEL))!
    assert.ok(simCall, 'the releaseOrMint simulation ran')
    const [decoded] = pool.decodeFunctionData(ROM_V1_FRAG, simCall.data!)
    assert.equal(decoded.sourcePoolData, extraData)
  })

  it('post-send offchainTokenData (manual-exec) => attestation pools simulate with the real data', async () => {
    const { chain, provider } = makeChain({
      poolTypeAndVersion: 'USDCTokenPool 1.5.1',
      isV1: true,
      isV2: false,
    })
    const usdcData = { _tag: 'usdc', message: '0x1234', attestation: '0xabcd' } as const
    assert.equal(
      await chain.checkExecute({
        offRamp: OFFRAMP,
        message: { ...MESSAGE, offchainTokenData: [usdcData] },
      }),
      true,
    )
    const simCall = provider.calls.find((c) => c.data?.startsWith(ROM_V1_SEL))!
    assert.ok(simCall, 'the releaseOrMint simulation ran')
    const [decoded] = pool.decodeFunctionData(ROM_V1_FRAG, simCall.data!)
    assert.equal(
      decoded.offchainTokenData,
      abi.encode(['tuple(bytes message, bytes attestation)'], [usdcData]),
    )
  })

  it('generic rate-limit verdict defers to the simulation', async () => {
    // the sim consumes the pool's own rate limit with correctly-converted local amounts, so it
    // decides; the generic read is only a fallback
    const { chain, provider } = makeChain({
      inboundRateLimiterState: { tokens: 10n, capacity: 100n, rate: 1n }, // < amount 1000n
    })
    assert.equal(await chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }), true)
    assert.ok(provider.calls.some((c) => c.data?.startsWith(ROM_V2_SEL)))
    // without a receiver (no simulation possible) the typed verdict is kept
    const { chain: chain2 } = makeChain({
      inboundRateLimiterState: { tokens: 10n, capacity: 100n, rate: 1n },
    })
    await assert.rejects(
      () =>
        chain2.checkExecute({
          offRamp: OFFRAMP,
          message: { sourceChainSelector: SOURCE_SELECTOR, tokenAmounts: MESSAGE.tokenAmounts },
        }),
      CCIPRateLimitExceededError,
    )
  })

  it('a deferred definitive verdict is never downgraded to "inconclusive"', async () => {
    // deferred rate-limit verdict + sim transport failure => the typed verdict is re-raised
    const { chain } = makeChain({
      inboundRateLimiterState: { tokens: 10n, capacity: 100n, rate: 1n },
      rpcError: true,
    })
    await assert.rejects(
      () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      CCIPRateLimitExceededError,
    )
    // deferred balance verdict + attestation-consuming pool => the typed verdict is re-raised
    const { chain: chain2 } = makeChain({
      poolTypeAndVersion: 'USDCTokenPool 1.5.1',
      isV1: true,
      isV2: false,
      balance: 0n, // USDCTokenPool doesn't include 'LockRelease', so force via rate limiter
      inboundRateLimiterState: { tokens: 10n, capacity: 100n, rate: 1n },
    })
    await assert.rejects(
      () => chain2.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      CCIPRateLimitExceededError,
    )
  })

  it('zero/empty tokenReceiver never overrides the receiver (OnRamp fallback rule)', async () => {
    const { chain, provider } = makeChain({})
    await chain.checkExecute({
      offRamp: OFFRAMP,
      message: {
        ...MESSAGE,
        tokenReceiver: '0x',
        tokenAmounts: [
          {
            sourcePoolAddress: SRC_POOL_BYTES,
            destTokenAddress: TOKEN,
            amount: 1000n,
            tokenReceiver: zeroPadValue('0x', 20), // zero address on the emitted message
          },
        ],
      },
    })
    const simCall = provider.calls.find((c) => c.data?.startsWith(ROM_V2_SEL))!
    const [decoded] = pool.decodeFunctionData(ROM_V2_FRAG, simCall.data!)
    assert.equal(decoded.receiver, RECEIVER)
  })

  it('LockRelease balance heuristic defers to the simulation (AndProxy pools hold liquidity on previousPool)', async () => {
    // live-found: the generic heuristic reads the registry pool's balance, but deployed
    // *AndProxy pools release through their previousPool — the simulation is the oracle
    const { chain, provider } = makeChain({
      poolTypeAndVersion: 'LockReleaseTokenPoolAndProxy 1.5.0',
      balance: 0n, // heuristic would block; sim passes => transfer IS releasable
    })
    assert.equal(await chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }), true)
    assert.ok(provider.calls.some((c) => c.data?.startsWith(ROM_V1_SEL)))
    // ...but with no receiver (no simulation possible) the heuristic verdict is kept
    const { chain: chain2 } = makeChain({
      poolTypeAndVersion: 'LockReleaseTokenPoolAndProxy 1.5.0',
      balance: 0n,
    })
    await assert.rejects(
      () =>
        chain2.checkExecute({
          offRamp: OFFRAMP,
          message: { sourceChainSelector: SOURCE_SELECTOR, tokenAmounts: MESSAGE.tokenAmounts },
        }),
      CCIPInsufficientBalanceError,
    )
  })

  it('typed SDK config errors pass through untouched — never "transient unavailable" (F9)', async () => {
    const typedError = new CCIPTokenPoolChainConfigNotFoundError(POOL, POOL, 'avalanche-fuji')
    const { chain } = makeChain({ remotePoolsTypedError: typedError })
    await assert.rejects(
      () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      (err: unknown) => {
        assert.equal(err, typedError) // the exact typed error, not wrapped, not transient
        return true
      },
    )
  })

  it('OffRamp lane gates: disabled source lane => typed block before any simulation', async () => {
    const { chain, provider } = makeChain({
      offRampConfig: { isEnabled: false, onRamps: [] },
    })
    await assert.rejects(
      () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      (err: CCIPError) => {
        assert.ok(err instanceof CCIPSourceChainUnsupportedError)
        assert.equal(err.context['reason'], 'SourceChainNotEnabled')
        return true
      },
    )
    assert.equal(provider.calls.length, 0)
  })

  it('OffRamp lane gates: sending OnRamp not allowed => typed block', async () => {
    const allowed = getAddress(hexlify(randomBytes(20)))
    const other = getAddress(hexlify(randomBytes(20)))
    const { chain } = makeChain({ offRampConfig: { isEnabled: true, onRamps: [allowed] } })
    await assert.rejects(
      () =>
        chain.checkExecute({
          offRamp: OFFRAMP,
          message: { ...MESSAGE, onRampAddress: other },
        }),
      (err: CCIPError) => {
        assert.ok(err instanceof CCIPSourceChainUnsupportedError)
        assert.equal(err.context['reason'], 'InvalidOnRamp')
        return true
      },
    )
    // matching OnRamp (case-insensitive) => gate passes, sim runs
    const { chain: okChain } = makeChain({
      offRampConfig: { isEnabled: true, onRamps: [allowed] },
    })
    assert.equal(
      await okChain.checkExecute({
        offRamp: OFFRAMP,
        message: { ...MESSAGE, onRampAddress: allowed.toLowerCase() },
      }),
      true,
    )
  })

  it('OffRamp lane gates: 1.2/1.5 config shape (no isEnabled) => gate no-ops', async () => {
    const { chain } = makeChain({ offRampConfig: { onRamps: [] } })
    assert.equal(await chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }), true)
  })

  it('v1.x OffRamp + migrated 2.0 USDC proxy pool => attestation-required, and 1-arg dispatch with real data', async () => {
    // live-found defect: dispatch/classification must follow the OFFRAMP version — a 2.0.0 proxy
    // behind a v1.5 OffRamp executes its legacy 1-arg path, which consumes the CCTP attestation
    const opts = {
      poolTypeAndVersion: 'USDCTokenPoolProxy 2.0.0',
      offRampTypeAndVersion: 'EVM2EVMOffRamp 1.5.0',
      isV1: true,
      isV2: true,
    } as const
    const { chain } = makeChain(opts)
    await assert.rejects(
      () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      (err: CCIPError) => {
        assert.ok(err instanceof CCIPDestSimulationUnavailableError)
        assert.equal(err.reason, 'attestation-required')
        return true
      },
    )
    // with the real attestation (post-send) the sim runs — through the 1-arg overload the v1.5
    // OffRamp will actually call, NOT the pool's IPoolV2
    const { chain: chain2, provider } = makeChain(opts)
    assert.equal(
      await chain2.checkExecute({
        offRamp: OFFRAMP,
        message: {
          ...MESSAGE,
          offchainTokenData: [{ _tag: 'usdc', message: '0x12', attestation: '0x34' } as const],
        },
      }),
      true,
    )
    assert.ok(provider.calls.some((c) => c.data?.startsWith(ROM_V1_SEL)))
    assert.ok(!provider.calls.some((c) => c.data?.startsWith(ROM_V2_SEL)))
  })

  it('transport failure during the ERC165 probes => unavailable (transport), not "incompatible pool"', async () => {
    // no typeAndVersion knob: checkExecute falls back to probing, and the probe's RPC failure
    // must NOT read as "supports neither interface" (a hard CCIPContractTypeInvalidError block)
    const { chain } = makeChain({ probeError: 'transport' })
    await assert.rejects(
      () => chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }),
      (err: CCIPError) => {
        assert.ok(err instanceof CCIPDestSimulationUnavailableError)
        assert.equal(err.reason, 'transport')
        assert.equal(err.isTransient, true)
        return true
      },
    )
  })
})

// ============================================================================
// 4) estimateReceiveExecution wrapper — source lockOrBurn enrichment
// ============================================================================
describe('estimateReceiveExecution wrapper — source pool data enrichment', () => {
  beforeEach(() => mock.restoreAll())
  after(() => mock.restoreAll())

  const ONRAMP = getAddress(hexlify(randomBytes(20)))
  const SRC_TOKEN = getAddress(hexlify(randomBytes(20)))
  const SRC_POOL = getAddress(hexlify(randomBytes(20)))
  const DEST_POOL_DATA = abi.encode(['uint256'], [6n])

  function makeSourceChain(opts: {
    lockOrBurnFails?: boolean
    lockOrBurnError?: Error
    destTokenAmount?: bigint
  }) {
    const chain = Object.create(EVMChain.prototype) as EVMChain
    const simulateLockOrBurnMock = mock.fn(
      async (_opts: Parameters<NonNullable<EVMChain['simulateLockOrBurn']>>[0]) => {
        if (opts.lockOrBurnError) throw opts.lockOrBurnError
        if (opts.lockOrBurnFails) throw new Error('lockOrBurn simulation failed')
        return {
          sourcePoolAddress: SRC_POOL,
          destTokenAddress: zeroPadValue(TOKEN, 32),
          destPoolData: DEST_POOL_DATA,
          destTokenAmount: opts.destTokenAmount ?? 5000n,
        }
      },
    )
    Object.assign(chain, {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      network: {
        name: 'ethereum-testnet-sepolia',
        chainSelector: SOURCE_SELECTOR,
        family: ChainFamily.EVM,
        networkType: NetworkType.Testnet,
      },
      simulateLockOrBurn: simulateLockOrBurnMock,
      // sourceToDestTokenAddresses path
      getTokenAdminRegistryFor: mock.fn(async () => getAddress(hexlify(randomBytes(20)))),
      getRegistryTokenConfig: mock.fn(async () => ({ tokenPool: SRC_POOL })),
      getTokenPoolRemotes: mock.fn(async () => ({
        [networkInfo(DEST_SELECTOR).name]: { remoteToken: TOKEN, remotePools: [SRC_POOL] },
      })),
      getTokenInfo: mock.fn(async () => ({ decimals: 18, symbol: 'SRC', name: 'Src' })),
    })
    return { chain, simulateLockOrBurnMock }
  }

  function makeDestChain() {
    const checkExecuteMock = mock.fn(async (_opts: unknown) => true as const)
    const estimateMock = mock.fn(async (_opts: unknown) => 42_000)
    const chain = Object.create(EVMChain.prototype) as EVMChain
    Object.assign(chain, {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      network: {
        name: 'avalanche-fuji',
        chainSelector: DEST_SELECTOR,
        family: ChainFamily.EVM,
        networkType: NetworkType.Testnet,
      },
      checkExecute: checkExecuteMock,
      estimateReceiveExecution: estimateMock,
      getTokenInfo: mock.fn(async () => ({ decimals: 18, symbol: 'DST', name: 'Dst' })),
    })
    return { chain, checkExecuteMock, estimateMock }
  }

  const message = {
    sender: getAddress(hexlify(randomBytes(20))),
    receiver: RECEIVER,
    data: '0x',
    onRampAddress: ONRAMP,
    offRampAddress: OFFRAMP,
    tokenAmounts: [{ token: SRC_TOKEN, amount: 5000n }],
  }

  it('feeds checkExecute the pool-reported destPoolData paired with the source amount', async () => {
    const { chain: source, simulateLockOrBurnMock } = makeSourceChain({})
    const { chain: dest, checkExecuteMock } = makeDestChain()
    const gas = await estimateReceiveExecution({ source, dest, routerOrRamp: ONRAMP, message })
    assert.equal(gas, 42_000)
    assert.equal(simulateLockOrBurnMock.mock.calls.length, 1)
    const payload = checkExecuteMock.mock.calls[0]!.arguments[0] as {
      message: { tokenAmounts: readonly Record<string, unknown>[] }
    }
    const ta = payload.message.tokenAmounts[0]!
    assert.equal(ta['extraData'], DEST_POOL_DATA)
    assert.equal(ta['amount'], 5000n) // source-denominated, paired with the pool's destPoolData
    assert.equal(ta['sourcePoolAddress'], SRC_POOL)
    assert.equal(ta['destTokenAddress'], TOKEN)
  })

  it('falls back to the plain dest token amount when the lockOrBurn simulation fails', async () => {
    const { chain: source } = makeSourceChain({ lockOrBurnFails: true })
    const { chain: dest, checkExecuteMock } = makeDestChain()
    const gas = await estimateReceiveExecution({ source, dest, routerOrRamp: ONRAMP, message })
    assert.equal(gas, 42_000)
    const payload = checkExecuteMock.mock.calls[0]!.arguments[0] as {
      message: { tokenAmounts: readonly Record<string, unknown>[] }
    }
    const ta = payload.message.tokenAmounts[0]!
    assert.equal(ta['token'], TOKEN)
    assert.equal(ta['extraData'], undefined)
  })

  it('fee-charging IPoolV2 pool => post-fee destTokenAmount flows into both payloads', async () => {
    // the OnRamp writes the pool-returned post-fee amount into the emitted message; the check
    // must see exactly that, and the gas-estimate amount scales by the same ratio
    const { chain: source } = makeSourceChain({ destTokenAmount: 4950n }) // 1% fee on 5000
    const { chain: dest, checkExecuteMock, estimateMock } = makeDestChain()
    await estimateReceiveExecution({ source, dest, routerOrRamp: ONRAMP, message })
    const checkPayload = checkExecuteMock.mock.calls[0]!.arguments[0] as {
      message: { tokenAmounts: readonly Record<string, unknown>[] }
    }
    assert.equal(checkPayload.message.tokenAmounts[0]!['amount'], 4950n)
    const estPayload = estimateMock.mock.calls[0]!.arguments[0] as {
      message: { tokenAmounts: readonly { amount: bigint }[] }
    }
    assert.equal(estPayload.message.tokenAmounts[0]!.amount, 4950n) // same decimals here (18/18)
  })

  it('post-send message (emitted fields) => passed to the check verbatim, no re-simulation', async () => {
    const { chain: source, simulateLockOrBurnMock } = makeSourceChain({})
    const { chain: dest, checkExecuteMock } = makeDestChain()
    const emitted = {
      amount: 5000n,
      sourceTokenAddress: SRC_TOKEN,
      sourcePoolAddress: SRC_POOL,
      destTokenAddress: TOKEN,
      extraData: '0xfa7c07de', // the emitted destPoolData is authoritative, whatever its shape
    }
    await estimateReceiveExecution({
      source,
      dest,
      routerOrRamp: ONRAMP,
      message: { ...message, tokenAmounts: [emitted] },
    })
    // trust emitted fields: never reconstruct the source pool or re-run lockOrBurn post-send
    assert.equal(simulateLockOrBurnMock.mock.calls.length, 0)
    const payload = checkExecuteMock.mock.calls[0]!.arguments[0] as {
      message: { tokenAmounts: readonly Record<string, unknown>[] }
    }
    assert.deepEqual(payload.message.tokenAmounts[0], emitted)
  })

  it('pre-send caller-supplied extraData => kept for the check (skips the simulation)', async () => {
    const { chain: source, simulateLockOrBurnMock } = makeSourceChain({})
    const { chain: dest, checkExecuteMock } = makeDestChain()
    const extraData = abi.encode(['uint256'], [6n])
    await estimateReceiveExecution({
      source,
      dest,
      routerOrRamp: ONRAMP,
      message: { ...message, tokenAmounts: [{ token: SRC_TOKEN, amount: 5000n, extraData }] },
    })
    assert.equal(simulateLockOrBurnMock.mock.calls.length, 0)
    const payload = checkExecuteMock.mock.calls[0]!.arguments[0] as {
      message: { tokenAmounts: readonly Record<string, unknown>[] }
    }
    assert.equal(payload.message.tokenAmounts[0]!['extraData'], extraData)
    assert.equal(payload.message.tokenAmounts[0]!['amount'], 5000n)
  })

  it('genuine source-side revert => CCIPSourcePoolRevertError blocks (ccipSend would revert too)', async () => {
    const { chain: source } = makeSourceChain({
      lockOrBurnError: new CCIPSourcePoolRevertError('SenderNotAllowed (0xd0d2597600)', {
        context: { revert: '0xd0d25976' },
      }),
    })
    const { chain: dest, checkExecuteMock } = makeDestChain()
    await assert.rejects(
      () => estimateReceiveExecution({ source, dest, routerOrRamp: ONRAMP, message }),
      CCIPSourcePoolRevertError,
    )
    assert.equal(checkExecuteMock.mock.calls.length, 0)
  })

  it('threads tokenReceiver and tokenArgs into the source lockOrBurn simulation', async () => {
    const { chain: source, simulateLockOrBurnMock } = makeSourceChain({})
    const { chain: dest } = makeDestChain()
    const tokenReceiver = getAddress(hexlify(randomBytes(20)))
    await estimateReceiveExecution({
      source,
      dest,
      routerOrRamp: ONRAMP,
      message: { ...message, tokenReceiver, tokenArgs: '0x1234' },
    })
    const simArgs = simulateLockOrBurnMock.mock.calls[0]!.arguments[0]
    assert.equal(simArgs.tokenReceiver, tokenReceiver)
    assert.equal(simArgs.tokenArgs, '0x1234')
  })
})

// Because the preflight simulates the destination pool's releaseOrMint, the SDK must be able to
// decode ANY error a standard chainlink-ccip pool can revert with — not only the liquidity/
// rate-limit/authority ones the classifier acts on. These selectors are contributed by the
// specialized pool ABIs (FastTransfer, Lombard, USDC/CCTP, siloed v1.6, advanced hooks, rebasing
// burn) and previously fell through as raw, un-named selectors. If a future ABI trim drops one of
// those interfaces, this test fails loudly rather than silently regressing diagnostics.
describe('native pool error coverage — parseWithFragment resolves specialized pool reverts', () => {
  const cases: readonly [selector: string, name: string][] = [
    ['0x9b91b78c', 'AlreadyFilledOrSettled'],
    ['0xb196a44a', 'AlreadySettled'],
    ['0x4172d660', 'CCVNotSetOnResolver'],
    ['0x46f5f12b', 'ChainNotSiloed'],
    ['0x2532cf45', 'ExecutionError'],
    ['0x6c46a9b5', 'FillerNotAllowlisted'],
    ['0x3f4d6053', 'HashMismatch'],
    ['0x6c2fdacc', 'InsufficientPoolFees'],
    ['0x382c0982', 'InvalidDestChainConfig'],
    ['0x77e48026', 'InvalidDestinationDomain'],
    ['0xa087bd29', 'InvalidDomain'],
    ['0xec4c23ce', 'InvalidEncodedAddress'],
    ['0xcb537aa4', 'InvalidFillId'],
    ['0x68d2f8d6', 'InvalidMessageVersion'],
    ['0xf917ffea', 'InvalidNonce'],
    ['0xb5d1ce28', 'InvalidTokenMessengerVersion'],
    ['0x690a7a40', 'IPoolV1NotSupported'],
    ['0xa90c0d19', 'LiquidityAmountCannotBeZero'],
    ['0x1d56c21d', 'MustSpecifyUnderThresholdCCVsForThresholdCCVs'],
    ['0x02164a2d', 'NegativeMintAmount'],
    ['0x7af97002', 'OutboundImplementationNotFoundForVerifier'],
    ['0xa28cbf38', 'PathNotExist'],
    ['0xf7bb46e6', 'PolicyEngineDetachReverted'],
    ['0x61acdb93', 'QuoteFeeExceedsUserMaxLimit'],
    ['0xbce7b6cd', 'RemoteTokenOrAdapterMismatch'],
    ['0x58dd87c5', 'TransferAmountExceedsMaxFillAmount'],
    ['0xbf969f22', 'UnlockingUSDCFailed'],
    ['0x361106cd', 'ZeroBridge'],
    ['0x5a39e303', 'ZeroLombardChainId'],
    ['0x9533e8c3', 'ZeroVerifierNotAllowed'],
  ]

  for (const [selector, name] of cases) {
    it(`decodes ${name} (${selector})`, () => {
      const parsed = parseWithFragment(selector)
      assert.ok(parsed, `${name} (${selector}) should resolve to a named fragment, got undefined`)
      assert.equal(parsed[0].name, name)
    })
  }
})
