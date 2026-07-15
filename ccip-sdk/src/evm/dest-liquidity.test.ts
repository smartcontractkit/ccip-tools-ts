import assert from 'node:assert/strict'
import { after, beforeEach, describe, it, mock } from 'node:test'

import {
  AbiCoder,
  Interface,
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
  isTransientReleaseOrMintRevert,
  simulateLockOrBurn,
  simulateReleaseOrMint,
} from './simulate.ts'
import {
  type CCIPError,
  CCIPContractTypeInvalidError,
  CCIPDestExecutionRevertError,
  CCIPDestSimulationUnavailableError,
  CCIPTokenNotInRegistryError,
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

  it('flags liquidity / rate-limit / curse reverts as transient (they recover on their own)', () => {
    const transient = [
      encodeErr('InsufficientLiquidity()'),
      encodeErr('InsufficientLiquidity(uint256,uint256)', [1n, 2n]),
      encodeErr('InsufficientBalance(uint256,uint256)', [2n, 1n]),
      encodeErr('ERC20InsufficientBalance(address,uint256,uint256)', [A(), 1n, 2n]),
      encodeErr('TokenMaxCapacityExceeded(uint256,uint256,address)', [1n, 2n, A()]),
      encodeErr('TokenRateLimitReached(uint256,uint256,address)', [1n, 2n, A()]),
      encodeErr('CursedByRMN()'),
    ]
    for (const enc of transient)
      assert.equal(isTransientReleaseOrMintRevert(enc), true, enc.slice(0, 10))
  })

  it('flags authority / config / unknown reverts as non-transient (they need a fix)', () => {
    const permanent = [
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
}) {
  const calls: Call[] = []
  const provider = {
    calls,
    call: mock.fn(async (tx: Call) => {
      calls.push(tx)
      const sel = (tx.data ?? '0x').slice(0, 10)
      if (sel === SUPPORTS_SEL) {
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
  remotePoolsRpcError?: boolean
  remotePoolsRevert?: string
  noPool?: boolean
  poolTypeAndVersion?: string
  remotePools?: string[]
}) {
  const provider = makeProvider({
    isV2: opts.isV2 ?? true,
    isV1: opts.isV1,
    revert: opts.revert,
    rpcError: opts.rpcError,
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
    getTokenAdminRegistryFor: mock.fn(async () => getAddress(hexlify(randomBytes(20)))),
    getRegistryTokenConfig: mock.fn(async () => ({ tokenPool })),
    getTokenPoolConfig: mock.fn(async () => ({
      typeAndVersion: opts.poolTypeAndVersion ?? 'BurnMintTokenPool 2.0.0',
      lockBox: undefined,
    })),
    getTokenPoolRemote: mock.fn(async () => {
      // an RPC/transport failure has no revert data attached
      if (opts.remotePoolsRpcError) throw new Error('could not detect network')
      // an on-chain revert carries revert data
      if (opts.remotePoolsRevert)
        throw Object.assign(new Error('execution reverted'), { data: opts.remotePoolsRevert })
      return {
        remoteToken: TOKEN,
        remotePools: opts.remotePools ?? [SRC_POOL_BYTES],
        inboundRateLimiterState: undefined,
        outboundRateLimiterState: undefined,
      }
    }),
    getTokenInfo: mock.fn(async () => ({ decimals: 18, symbol: 'TEST', name: 'Test' })),
    getBalance: mock.fn(async () => 10n ** 24n),
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
    const { chain, provider } = makeChain({ poolTypeAndVersion: 'LockReleaseTokenPool 1.5.1' })
    assert.equal(await chain.checkExecute({ offRamp: OFFRAMP, message: MESSAGE }), true)
    assert.ok(provider.calls.some((c) => c.data?.startsWith(ROM_V2_SEL)))
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

  function makeSourceChain(opts: { lockOrBurnFails?: boolean }) {
    const chain = Object.create(EVMChain.prototype) as EVMChain
    const simulateLockOrBurnMock = mock.fn(async () => {
      if (opts.lockOrBurnFails) throw new Error('lockOrBurn simulation failed')
      return {
        sourcePoolAddress: SRC_POOL,
        destTokenAddress: zeroPadValue(TOKEN, 32),
        destPoolData: DEST_POOL_DATA,
      }
    })
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
    return { chain, checkExecuteMock }
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
