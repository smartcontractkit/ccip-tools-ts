/**
 * `getTokenInfo` must read `symbol()`/`decimals()`/`name()` off the token, and a token that does
 * not implement the OPTIONAL ERC-20 `decimals()` view must surface as the typed
 * `CCIPTokenDecimalsUnavailableError`, not a raw provider error. `name()` is equally optional,
 * so its failure is tolerated. `getTokenPoolConfig` must expose the pool's declared decimals
 * (`getTokenDecimals()`) for v1.5.1+ pools, while v1.5.0 pools (which predate it) fall back to
 * the token's own (optional) view and stay readable without it.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { type JsonRpcApiProvider, makeError } from 'ethers'

import { CCIPTokenDecimalsUnavailableError } from '../errors/index.ts'
import { networkInfo } from '../networks.ts'
import { interfaces } from './const.ts'
import { EVMChain } from './index.ts'

const TOKEN = '0x8FE4D867DB59E38E7bA7D98DC14ac1826c79CF9f'

/** `eth_call` responder: answers from `data` by selector, or reverts. */
function stubProvider(
  answers: Record<string, string | Error>,
): JsonRpcApiProvider & { selectors: string[] } {
  const selectors: string[] = []
  return {
    selectors,
    call: async (tx: { to?: string; data?: string }) => {
      const selector = (tx.data ?? '').slice(0, 10)
      selectors.push(selector)
      const answer = answers[selector]
      if (answer === undefined)
        throw makeError('execution reverted', 'CALL_EXCEPTION', {
          action: 'call',
          data: '0x',
          reason: null,
          transaction: { to: tx.to ?? null, data: tx.data ?? '0x' },
          invocation: null,
          revert: null,
        })
      if (answer instanceof Error) throw answer
      return answer
    },
  } as unknown as JsonRpcApiProvider & { selectors: string[] }
}

const token = interfaces.Token
const SYMBOL_SEL = token.getFunction('symbol')!.selector
const DECIMALS_SEL = token.getFunction('decimals')!.selector
const NAME_SEL = token.getFunction('name')!.selector

const symbolResult = token.encodeFunctionResult('symbol', ['NDT'])
const decimalsResult = token.encodeFunctionResult('decimals', [18n])
const nameResult = token.encodeFunctionResult('name', ['No Decimals Test Token'])

describe('EVMChain.getTokenInfo', () => {
  it('reads symbol, decimals and name', async () => {
    const provider = stubProvider({
      [SYMBOL_SEL]: symbolResult,
      [DECIMALS_SEL]: decimalsResult,
      [NAME_SEL]: nameResult,
    })
    const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
    assert.deepEqual(await chain.getTokenInfo(TOKEN), {
      symbol: 'NDT',
      decimals: 18,
      name: 'No Decimals Test Token',
    })
  })

  it('throws the typed error when decimals() is not implemented', async () => {
    const provider = stubProvider({
      [SYMBOL_SEL]: symbolResult,
      [NAME_SEL]: nameResult,
    })
    const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
    await assert.rejects(chain.getTokenInfo(TOKEN), (err: unknown) => {
      assert.ok(err instanceof CCIPTokenDecimalsUnavailableError)
      assert.equal(err.context.token, TOKEN)
      return true
    })
  })

  it('propagates a transport failure instead of reporting missing decimals', async () => {
    // a TIMEOUT (or any non-CALL_EXCEPTION failure) must surface as-is — converting it to
    // TOKEN_DECIMALS_UNAVAILABLE (isTransient: false) would break retry handling
    const timeout = makeError('timeout', 'TIMEOUT', { operation: 'call', reason: 'timeout' })
    const provider = stubProvider({
      [SYMBOL_SEL]: symbolResult,
      [DECIMALS_SEL]: timeout,
    })
    const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
    await assert.rejects(chain.getTokenInfo(TOKEN), (err: unknown) => err === timeout)
  })

  it('throws the typed error on an unusable decimals() return (BAD_DATA)', async () => {
    // the call succeeds but the returned data can't decode as the expected return (e.g. an
    // EOA answering 0x) — a recognized unavailable case, not a transport failure
    const provider = stubProvider({
      [SYMBOL_SEL]: symbolResult,
      [DECIMALS_SEL]: '0x',
    })
    const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
    await assert.rejects(chain.getTokenInfo(TOKEN), (err: unknown) => {
      assert.ok(err instanceof CCIPTokenDecimalsUnavailableError)
      assert.equal(err.context.token, TOKEN)
      return true
    })
  })

  it('tolerates a missing name() (also optional in ERC-20)', async () => {
    const provider = stubProvider({
      [SYMBOL_SEL]: symbolResult,
      [DECIMALS_SEL]: decimalsResult,
    })
    const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
    assert.deepEqual(await chain.getTokenInfo(TOKEN), {
      symbol: 'NDT',
      decimals: 18,
      name: '',
    })
  })
})

describe('EVMChain.getTokenPoolConfig decimals', () => {
  const pool = interfaces.TokenPool_v2_0
  const legacyPool = interfaces.TokenPool_v1_6
  const GET_TOKEN_DECIMALS_SEL = pool.getFunction('getTokenDecimals')!.selector
  const GET_TOKEN_SEL = pool.getFunction('getToken')!.selector
  const GET_DYNAMIC_CONFIG_SEL = pool.getFunction('getDynamicConfig')!.selector
  const TYPE_AND_VERSION_SEL = pool.getFunction('typeAndVersion')!.selector
  const GET_ROUTER_SEL = legacyPool.getFunction('getRouter')!.selector
  const tokenDecimalsResult = pool.encodeFunctionResult('getTokenDecimals', [18n])
  const poolTokenResult = pool.encodeFunctionResult('getToken', [TOKEN])
  const dynamicConfigResult = pool.encodeFunctionResult('getDynamicConfig', [
    '0x' + '44'.repeat(20),
    '0x' + '55'.repeat(20),
    '0x' + '66'.repeat(20),
  ])
  const typeAndVersionResult = pool.encodeFunctionResult('typeAndVersion', [
    'BurnMintTokenPool 1.5.0',
  ])
  const routerResult = legacyPool.encodeFunctionResult('getRouter', ['0x' + '44'.repeat(20)])

  it("exposes the pool's declared decimals (v2.0 pool)", async () => {
    const provider = stubProvider({
      [TYPE_AND_VERSION_SEL]: pool.encodeFunctionResult('typeAndVersion', [
        'BurnMintTokenPool 2.0.0',
      ]),
      [GET_TOKEN_SEL]: poolTokenResult,
      [GET_DYNAMIC_CONFIG_SEL]: dynamicConfigResult,
      [GET_TOKEN_DECIMALS_SEL]: tokenDecimalsResult,
    })
    const chain = new EVMChain(provider, networkInfo('avalanche-testnet-fuji'))
    const { decimals } = await chain.getTokenPoolConfig(
      '0x22812538c457249dedb47bb99c3faffc791e45f7',
    )
    assert.equal(decimals, 18)
  })

  it('v1.5.0 pools stay readable without getTokenDecimals (decimals undefined)', async () => {
    const provider = stubProvider({
      [TYPE_AND_VERSION_SEL]: typeAndVersionResult,
      [GET_TOKEN_SEL]: poolTokenResult,
      [GET_ROUTER_SEL]: routerResult,
    })
    const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
    // the best-effort getTokenDecimals reverts (v1.5.0 predates it) — the pool config stays
    // readable, with no decimals declared; the token-view fallback happens in
    // resolveTokenDecimals, not here
    const { token, decimals } = await chain.getTokenPoolConfig('0x' + '33'.repeat(20))
    assert.equal(token, TOKEN)
    assert.equal(decimals, undefined)
  })

  it('propagates a transport failure on getTokenDecimals instead of swallowing it', async () => {
    // a TIMEOUT on the pool's getTokenDecimals must surface — swallowing it would yield
    // `decimals: undefined` and silently trigger the family-default fallback downstream
    const timeout = makeError('timeout', 'TIMEOUT', { operation: 'call', reason: 'timeout' })
    const provider = stubProvider({
      [TYPE_AND_VERSION_SEL]: typeAndVersionResult,
      [GET_TOKEN_SEL]: poolTokenResult,
      [GET_ROUTER_SEL]: routerResult,
      [GET_TOKEN_DECIMALS_SEL]: timeout,
    })
    const chain = new EVMChain(provider, networkInfo('ethereum-testnet-sepolia'))
    await assert.rejects(
      chain.getTokenPoolConfig('0x' + '33'.repeat(20)),
      (err: unknown) => err === timeout,
    )
  })
})
