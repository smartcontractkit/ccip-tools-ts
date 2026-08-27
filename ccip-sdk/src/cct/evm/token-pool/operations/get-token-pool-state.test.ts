import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getAddress, makeError, toBeHex } from 'ethers'

import { GetTokenPoolState } from './get-token-pool-state.ts'
import type { EVMChain } from '../../../../evm/index.ts'
import { parseTypeAndVersion } from '../../../../utils.ts'
import {
  CCTContractTypeInvalidError,
  CCTContractVersionUnsupportedError,
  CCTParamsInvalidError,
} from '../../../errors.ts'
import { type TokenPoolFamily, TOKEN_POOL_INTERFACES, TokenPoolVersion } from '../contracts.ts'

const POOL = '0x' + '11'.repeat(20)
const TOKEN = '0x' + '22'.repeat(20)
const ROUTER = '0x' + '33'.repeat(20)
const OWNER = '0x' + '44'.repeat(20)
const RMN_PROXY = '0x' + '55'.repeat(20)
const RATE_LIMIT_ADMIN = '0x' + '66'.repeat(20)
const FEE_ADMIN = '0x' + '77'.repeat(20)
const LOCKBOX = '0x' + '99'.repeat(20)

const CHAINS = [5009297550715157269n, 16015286601757825753n]

/** Getters the op reads, as `functionName -> return values` (ABI-encoded on demand). */
type Reads = Record<string, unknown[]>

/** `getAllowedFinalityConfig` packs the FCR flag above the 16-bit FTF depth, as bytes4. */
const FINALITY_SAFE_FLAG = 1 << 16
const finalityConfig = (allowed: number) => toBeHex(allowed, 4)

/**
 * EVMChain stub: `typeAndVersion` reports `typeAndVersion` (parsed the way the real chain does),
 * and the provider answers `eth_call` from `reads`, keyed by selector off the pool's own
 * Interface. Any getter absent from `reads` reverts.
 */
function stubChain({
  typeAndVersion = 'BurnMintTokenPool 2.0.0',
  family = 'BurnMint',
  version = TokenPoolVersion.V2_0_0,
  reads = {},
  tokenDecimals = 18,
}: {
  typeAndVersion?: string
  family?: TokenPoolFamily
  /** ABI the stub encodes results with — must match the version `typeAndVersion` reports. */
  version?: TokenPoolVersion
  reads?: Reads
  /** Decimals `getTokenInfo` reports, which pre-v2.0.0 pools read instead of a pool getter. */
  tokenDecimals?: number
} = {}): EVMChain {
  const iface = TOKEN_POOL_INTERFACES[family][version]
  const responses = new Map(
    Object.entries(reads).map(([fn, values]) => [
      iface.getFunction(fn)!.selector,
      iface.encodeFunctionResult(fn, values),
    ]),
  )
  return {
    provider: {
      call: async ({ data }: { data: string }) => {
        const encoded = responses.get(data.slice(0, 10))
        if (!encoded)
          throw makeError('execution reverted', 'CALL_EXCEPTION', {
            action: 'call',
            data: '0x',
            reason: null,
            transaction: { to: null, data },
            invocation: null,
            revert: null,
          })
        return encoded
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    typeAndVersion: () => Promise.resolve(parseTypeAndVersion(typeAndVersion)),
    getTokenInfo: () => Promise.resolve({ decimals: tokenDecimals, symbol: 'TKN', name: 'Token' }),
  } as unknown as EVMChain
}

const READS: Reads = {
  getToken: [TOKEN],
  owner: [OWNER],
  getRmnProxy: [RMN_PROXY],
  getTokenDecimals: [18],
  getSupportedChains: [CHAINS],
  getDynamicConfig: [ROUTER, RATE_LIMIT_ADMIN, FEE_ADMIN],
  getAllowedFinalityConfig: [finalityConfig(10)],
}

/** Pre-v2.0.0 getters: router and the rate-limit role stand alone, and there is no fee admin. */
const LEGACY_READS: Reads = {
  getToken: [TOKEN],
  owner: [OWNER],
  getRouter: [ROUTER],
  getRmnProxy: [RMN_PROXY],
  getRateLimitAdmin: [RATE_LIMIT_ADMIN],
  getSupportedChains: [CHAINS],
}

describe('GetTokenPoolState (cct/evm token-pool query)', () => {
  it('reads a burn-mint pool: token, roles, lanes and allowed finality', async () => {
    const state = await new GetTokenPoolState().query(stubChain({ reads: READS }), {
      poolAddress: POOL,
    })

    assert.deepEqual(state, {
      poolAddress: POOL,
      version: '2.0.0',
      type: 'BurnMintTokenPool',
      token: TOKEN,
      tokenDecimals: 18,
      router: ROUTER,
      owner: OWNER,
      rmnProxy: RMN_PROXY,
      rateLimitAdmin: RATE_LIMIT_ADMIN,
      feeAdmin: FEE_ADMIN,
      supportedChains: CHAINS,
      finalityDepth: 10,
      finalitySafe: false,
    })
  })

  it('reads the lockbox of a lock-release pool', async () => {
    const chain = stubChain({
      typeAndVersion: 'LockReleaseTokenPool 2.0.0',
      family: 'LockRelease',
      reads: { ...READS, getLockBox: [LOCKBOX] },
    })

    const state = await new GetTokenPoolState().query(chain, { poolAddress: POOL })

    // narrowing on `version` then `type` is what exposes lockBox — no optional field to check
    assert.ok(state.version === '2.0.0' && state.type === 'LockReleaseTokenPool')
    assert.equal(state.lockBox, LOCKBOX)
  })

  it('reads a v2.0.0 siloed pool, reporting every field but the lockbox', async () => {
    // no no-arg getter in `reads`: a siloed pool declares getLockBox(uint64) instead
    const chain = stubChain({
      typeAndVersion: 'SiloedLockReleaseTokenPool 2.0.0',
      family: 'LockRelease',
      reads: READS,
    })

    const state = await new GetTokenPoolState().query(chain, { poolAddress: POOL })

    assert.deepEqual(state, {
      poolAddress: POOL,
      version: '2.0.0',
      type: 'SiloedLockReleaseTokenPool',
      token: TOKEN,
      tokenDecimals: 18,
      router: ROUTER,
      owner: OWNER,
      rmnProxy: RMN_PROXY,
      rateLimitAdmin: RATE_LIMIT_ADMIN,
      feeAdmin: FEE_ADMIN,
      supportedChains: CHAINS,
      finalityDepth: 10,
      finalitySafe: false,
    })
    // per-lane escrow: no single lockbox, so the field is absent rather than zeroed
    assert.ok(!('lockBox' in state))
  })

  it('never calls getLockBox() on a siloed pool, whose escrow is keyed per remote chain', async () => {
    const noArgLockBox =
      TOKEN_POOL_INTERFACES.LockRelease[TokenPoolVersion.V2_0_0].getFunction(
        'getLockBox()',
      )!.selector
    const seen: string[] = []
    const chain = stubChain({
      typeAndVersion: 'SiloedLockReleaseTokenPool 2.0.0',
      family: 'LockRelease',
      reads: READS,
    })
    const provider = chain.provider as unknown as {
      call: (tx: { data: string }) => Promise<string>
    }
    const { call } = provider
    provider.call = (tx) => {
      seen.push(tx.data.slice(0, 10))
      return call(tx)
    }

    await new GetTokenPoolState().query(chain, { poolAddress: POOL })

    assert.ok(!seen.includes(noArgLockBox), 'getLockBox() is not implemented by a siloed pool')
  })

  it('reads router and both admin roles from the single getDynamicConfig call', async () => {
    let calls = 0
    const chain = stubChain({ reads: READS })
    const provider = chain.provider as unknown as {
      call: (tx: { data: string }) => Promise<string>
    }
    const { call } = provider
    provider.call = (tx) => {
      calls++
      return call(tx)
    }

    const state = await new GetTokenPoolState().query(chain, { poolAddress: POOL })

    assert.equal(state.router, ROUTER)
    assert.equal(state.rateLimitAdmin, RATE_LIMIT_ADMIN)
    assert.ok(state.version === '2.0.0')
    assert.equal(state.feeAdmin, FEE_ADMIN)
    assert.equal(calls, Object.keys(READS).length, 'one call per getter, none duplicated')
  })

  it('decodes the FCR flag packed above the finality depth', async () => {
    const chain = stubChain({
      reads: { ...READS, getAllowedFinalityConfig: [finalityConfig(FINALITY_SAFE_FLAG)] },
    })

    const state = await new GetTokenPoolState().query(chain, { poolAddress: POOL })

    assert.ok(state.version === '2.0.0')
    assert.equal(state.finalitySafe, true)
    assert.equal(state.finalityDepth, 0)
  })

  describe('pre-v2.0.0 pools', () => {
    it('reads a v1.5.1 burn-mint pool through the getters that version has', async () => {
      const chain = stubChain({
        typeAndVersion: 'BurnMintTokenPool 1.5.1',
        version: TokenPoolVersion.V1_5_1,
        reads: LEGACY_READS,
      })

      const state = await new GetTokenPoolState().query(chain, { poolAddress: POOL })

      // no feeAdmin, finality window, or lockbox: none of them exist before v2.0.0
      assert.deepEqual(state, {
        poolAddress: POOL,
        version: '1.5.1',
        type: 'BurnMintTokenPool',
        token: TOKEN,
        tokenDecimals: 18,
        router: ROUTER,
        owner: OWNER,
        rmnProxy: RMN_PROXY,
        rateLimitAdmin: RATE_LIMIT_ADMIN,
        supportedChains: CHAINS,
      })
    })

    it('reads a v1.6.1 lock-release pool, which has no lockbox to report', async () => {
      const chain = stubChain({
        typeAndVersion: 'LockReleaseTokenPool 1.6.1',
        family: 'LockRelease',
        version: TokenPoolVersion.V1_6_1,
        reads: LEGACY_READS,
      })

      const state = await new GetTokenPoolState().query(chain, { poolAddress: POOL })

      assert.equal(state.version, '1.6.1')
      assert.equal(state.type, 'LockReleaseTokenPool')
      // `lockBox` arrives with v2.0.0; narrowing on version is what keeps it off this arm
      assert.ok(!('lockBox' in state))
    })

    it('reads a siloed pool at a legacy version through the legacy reader', async () => {
      // The legacy reader only calls getters TokenPool itself declares, so it serves any type.
      const chain = stubChain({
        typeAndVersion: 'SiloedLockReleaseTokenPool 1.6.1',
        family: 'LockRelease',
        version: TokenPoolVersion.V1_6_1,
        reads: LEGACY_READS,
      })

      const state = await new GetTokenPoolState().query(chain, { poolAddress: POOL })

      assert.equal(state.type, 'SiloedLockReleaseTokenPool')
      assert.equal(state.version, '1.6.1')
    })

    it('takes decimals from the token at v1.5.0, which has no getTokenDecimals', async () => {
      const chain = stubChain({
        typeAndVersion: 'BurnMintTokenPool 1.5.0',
        version: TokenPoolVersion.V1_5_0,
        reads: LEGACY_READS,
        tokenDecimals: 6,
      })

      const state = await new GetTokenPoolState().query(chain, { poolAddress: POOL })

      assert.equal(state.tokenDecimals, 6)
    })

    it('rejects a v1.5.0 AndProxy pool, whose type name is not in the supported set', async () => {
      const chain = stubChain({
        typeAndVersion: 'BurnMintTokenPoolAndProxy 1.5.0',
        version: TokenPoolVersion.V1_5_0,
        reads: LEGACY_READS,
      })

      await assert.rejects(
        () => new GetTokenPoolState().query(chain, { poolAddress: POOL }),
        (err: unknown) => err instanceof CCTContractTypeInvalidError,
      )
    })
  })

  it('checksums the returned pool address', async () => {
    const lowercase = '0x' + 'ab'.repeat(20)

    const state = await new GetTokenPoolState().query(stubChain({ reads: READS }), {
      poolAddress: lowercase,
    })

    assert.equal(state.poolAddress, getAddress(lowercase))
  })

  describe('validation', () => {
    it('rejects an invalid pool address before any RPC', async () => {
      let probed = false
      const chain = stubChain({ reads: READS })
      chain.typeAndVersion = () => {
        probed = true
        return Promise.resolve(parseTypeAndVersion('BurnMintTokenPool 2.0.0'))
      }

      await assert.rejects(
        () => new GetTokenPoolState().query(chain, { poolAddress: 'nope' }),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.operation === 'getTokenPoolState' &&
          err.context.param === 'poolAddress',
      )
      assert.equal(probed, false, 'validation fails before the typeAndVersion probe')
    })

    it('rejects a pool type outside the supported CCT set', async () => {
      const chain = stubChain({ typeAndVersion: 'USDCTokenPoolProxy 2.0.0', reads: READS })

      await assert.rejects(
        () => new GetTokenPoolState().query(chain, { poolAddress: POOL }),
        (err: unknown) => err instanceof CCTContractTypeInvalidError,
      )
    })

    it('rejects a supported pool type reporting a version the SDK does not know', async () => {
      const chain = stubChain({ typeAndVersion: 'BurnMintTokenPool 9.9.9', reads: READS })

      await assert.rejects(
        () => new GetTokenPoolState().query(chain, { poolAddress: POOL }),
        (err: unknown) =>
          err instanceof CCTContractVersionUnsupportedError &&
          err.context.contractType === 'BurnMintTokenPool' &&
          err.context.version === '9.9.9',
      )
    })
  })
})
