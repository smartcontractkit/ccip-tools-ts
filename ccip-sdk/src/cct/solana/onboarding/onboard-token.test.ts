import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Keypair, PublicKey } from '@solana/web3.js'

import '../../../evm/index.ts'
import { CCTParamsInvalidError } from '../../errors.ts'
import {
  deriveTokenPoolConfigPda,
  deriveTokenPoolSignerPda,
  resolveTokenPoolProgram,
} from '../programs/token-pool.ts'
import {
  type GenerateOnboardTokenParams,
  type TokenOnboardingRemoteChain,
  type TokenOnboardingState,
  parseOnboardTokenParams,
  planTokenOnboarding,
} from './onboard-token.ts'

const MINT = Keypair.generate().publicKey
const AUTHORITY = Keypair.generate().publicKey
const OTHER = Keypair.generate().publicKey
const POOL_SIGNER = deriveTokenPoolSignerPda(resolveTokenPoolProgram('burn-mint'), MINT)
const BURN_MINT_POOL = deriveTokenPoolConfigPda(resolveTokenPoolProgram('burn-mint'), MINT)
const LOCK_RELEASE_POOL = deriveTokenPoolConfigPda(resolveTokenPoolProgram('lock-release'), MINT)
const ROUTER = Keypair.generate().publicKey
const LOOKUP_TABLE = Keypair.generate().publicKey
const SEPOLIA = 16015286601757825753n
const FUJI = 14767482510784806043n
const EVM_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678'

const remote = (
  remoteChainSelector: bigint,
  extra: Partial<TokenOnboardingRemoteChain> = {},
): TokenOnboardingRemoteChain => ({
  remoteChainSelector,
  remoteTokenAddress: EVM_ADDRESS,
  remotePoolAddresses: [EVM_ADDRESS],
  remoteTokenDecimals: 18,
  inboundRateLimiterConfig: { enabled: false },
  outboundRateLimiterConfig: { enabled: true, capacity: 1_000n, rate: 10n },
  ...extra,
})

const params = (extra: Partial<GenerateOnboardTokenParams> = {}): GenerateOnboardTokenParams => ({
  tokenAddress: MINT.toBase58(),
  poolType: 'burn-mint',
  remoteChains: [remote(SEPOLIA)],
  payer: AUTHORITY.toBase58(),
  ...extra,
})

const configured = { chainConfig: true, chainConfigV2: true, fastFinalityRateLimit: true }
const missing = { chainConfig: false, chainConfigV2: false, fastFinalityRateLimit: false }

/** The registry of an onboarded burn-mint token. */
const REGISTRY: NonNullable<TokenOnboardingState['registry']> = {
  administrator: AUTHORITY,
  lookupTable: LOOKUP_TABLE,
  tokenPool: BURN_MINT_POOL,
  latestLayout: true,
  interfaceVersion: 2,
  accountResolution: 'Standard',
}

/** State of a token whose onboarding finished, with `overrides` applied. */
const onboarded = (overrides: Partial<TokenOnboardingState> = {}): TokenOnboardingState => ({
  mintAuthority: POOL_SIGNER,
  router: ROUTER,
  pool: { owner: AUTHORITY },
  registry: REGISTRY,
  remotes: new Map([[SEPOLIA, configured]]),
  ...overrides,
})

/** State of a token with no pool, whose program allows self-served pools, with `overrides`. */
const fresh = (overrides: Partial<TokenOnboardingState> = {}): TokenOnboardingState => ({
  mintAuthority: AUTHORITY,
  router: ROUTER,
  poolDeployment: { selfServedAllowed: true },
  remotes: new Map([[SEPOLIA, missing]]),
  ...overrides,
})

const plan = (state: TokenOnboardingState, extra: Partial<GenerateOnboardTokenParams> = {}) =>
  planTokenOnboarding(parseOnboardTokenParams(params(extra)), state)

const names = (steps: { name: string }[]) => steps.map(({ name }) => name)

describe('planTokenOnboarding (cct/solana)', () => {
  it('plans every step for a fresh burn-mint token', () => {
    const steps = plan(fresh(), {
      remoteChains: [
        remote(SEPOLIA, {
          fastFinalityRateLimits: { inbound: { enabled: false }, outbound: { enabled: false } },
        }),
      ],
    })
    assert.deepEqual(steps, [
      { name: 'deployTokenPool' },
      { name: 'registerAdmin' },
      { name: 'acceptAdmin' },
      { name: 'setPool' },
      { name: 'applyChainUpdates', remoteChainSelectors: [SEPOLIA] },
      { name: 'initChainConfigV2', remoteChainSelectors: [SEPOLIA] },
      { name: 'initFastFinalityRateLimit', remoteChainSelectors: [SEPOLIA] },
      { name: 'setPoolInterfaceImplementation' },
      { name: 'createTokenMultisig' },
      { name: 'setTokenAuthority' },
    ])
  })

  it('keeps the mint authority of a lock-release token', () => {
    const steps = plan(fresh(), { poolType: 'lock-release' })
    assert.deepEqual(names(steps), [
      'deployTokenPool',
      'registerAdmin',
      'acceptAdmin',
      'setPool',
      'applyChainUpdates',
      'initChainConfigV2',
      'setPoolInterfaceImplementation',
    ])
  })

  it('plans nothing for an onboarded token', () => {
    assert.deepEqual(plan(onboarded()), [])
    // a lock-release token's mint authority stays with anyone once the pool is registered
    const lockRelease = onboarded({
      mintAuthority: OTHER,
      registry: { ...REGISTRY, tokenPool: LOCK_RELEASE_POOL },
    })
    assert.deepEqual(plan(lockRelease, { poolType: 'lock-release' }), [])
  })

  it('resumes after the admin was proposed', () => {
    const state = onboarded({
      mintAuthority: AUTHORITY,
      registry: {
        administrator: PublicKey.default,
        pendingAdministrator: AUTHORITY,
        latestLayout: true,
        interfaceVersion: 1,
        accountResolution: 'NoResolution',
      },
      remotes: new Map([[SEPOLIA, missing]]),
    })
    assert.deepEqual(names(plan(state)), [
      'acceptAdmin',
      'setPool',
      'applyChainUpdates',
      'initChainConfigV2',
      'setPoolInterfaceImplementation',
      'createTokenMultisig',
      'setTokenAuthority',
    ])
  })

  it('configures only the remote chains and lane configs the pool lacks', () => {
    const state = onboarded({
      remotes: new Map([
        [SEPOLIA, { ...configured, chainConfigV2: false }],
        [FUJI, missing],
      ]),
    })
    const steps = plan(state, {
      remoteChains: [
        remote(SEPOLIA),
        remote(FUJI, {
          fastFinalityRateLimits: { inbound: { enabled: false }, outbound: { enabled: false } },
        }),
      ],
    })
    assert.deepEqual(steps, [
      { name: 'applyChainUpdates', remoteChainSelectors: [FUJI] },
      { name: 'initChainConfigV2', remoteChainSelectors: [SEPOLIA, FUJI] },
      { name: 'initFastFinalityRateLimit', remoteChainSelectors: [FUJI] },
    ])
  })

  it('sets the 2.0 interface again for a different account resolution', () => {
    assert.deepEqual(
      names(plan(onboarded(), { accountResolution: 'WithoutExtendedLookupTable' })),
      ['setPoolInterfaceImplementation'],
    )
    const v1 = onboarded({ registry: { ...REGISTRY, interfaceVersion: 1 } })
    assert.deepEqual(names(plan(v1)), ['setPoolInterfaceImplementation'])
    // omitted, a 2.0 registry keeps its own resolution
    const custom = onboarded({
      registry: { ...REGISTRY, accountResolution: 'WithoutExtendedLookupTable' },
    })
    assert.deepEqual(plan(custom), [])
  })

  it('requires the mint authority while the pool is not deployed, registered and minting', () => {
    for (const state of [
      fresh({ mintAuthority: OTHER }),
      onboarded({ mintAuthority: OTHER, registry: undefined }),
      onboarded({ mintAuthority: OTHER }),
      onboarded({ mintAuthority: null }),
    ]) {
      assert.throws(
        () => plan(state),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'authority' &&
          /mint authority/.test(err.message),
      )
    }
  })

  it('creates the lookup table in its own step with a lookup table payer', () => {
    const lookupTablePayer = OTHER.toBase58()
    assert.deepEqual(names(plan(fresh(), { lookupTablePayer })).slice(0, 5), [
      'deployTokenPool',
      'registerAdmin',
      'acceptAdmin',
      'createLookupTable',
      'setPool',
    ])
    // once the table it created is passed back, only setPool remains for it
    const registered = onboarded({
      mintAuthority: AUTHORITY,
      registry: { ...REGISTRY, lookupTable: undefined, tokenPool: undefined, interfaceVersion: 1 },
      poolLookupTable: { found: true, authority: AUTHORITY, contents: 'empty' },
    })
    assert.deepEqual(
      names(
        plan(registered, { lookupTablePayer, poolLookupTableAddress: LOOKUP_TABLE.toBase58() }),
      ),
      ['setPool', 'setPoolInterfaceImplementation', 'createTokenMultisig', 'setTokenAuthority'],
    )
  })

  it('requires a given lookup table that setPool can fill or use', () => {
    const withTable = (poolLookupTable: TokenOnboardingState['poolLookupTable']) =>
      onboarded({
        registry: { ...REGISTRY, lookupTable: undefined, tokenPool: undefined },
        ...(poolLookupTable && { poolLookupTable }),
      })
    const given = { poolLookupTableAddress: LOOKUP_TABLE.toBase58() }
    for (const [table, reason] of [
      [{ found: false }, /does not exist/],
      [{ found: true, authority: AUTHORITY, contents: 'other' }, /must be empty or start with/],
      [{ found: true, authority: OTHER, contents: 'empty' }, /must have the authority/],
      [{ found: true, contents: 'empty' }, /none \(frozen\)/],
    ] as const) {
      assert.throws(
        () => plan(withTable(table), given),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'poolLookupTableAddress' &&
          reason.test(err.message),
      )
    }
    // a table holding the CCIP addresses needs no authority; neither does an unread one
    assert.deepEqual(names(plan(withTable({ found: true, contents: 'ccip' }), given)), ['setPool'])
    assert.deepEqual(names(plan(withTable(undefined), given)), ['setPool'])
  })

  it('hands a burn-mint mint authority to a multisig the pool mints through', () => {
    const MULTISIG = Keypair.generate().publicKey
    const handover = (extra: Partial<TokenOnboardingState>) =>
      names(plan(onboarded({ mintAuthority: AUTHORITY, ...extra })))
    assert.deepEqual(handover({}), ['createTokenMultisig', 'setTokenAuthority'])
    // created earlier, by an interrupted onboarding
    const created = { address: MULTISIG, exists: true, poolSignerCanMint: true }
    assert.deepEqual(handover({ mintMultisig: created }), ['setTokenAuthority'])
    assert.throws(
      () =>
        plan(
          onboarded({
            mintAuthority: AUTHORITY,
            mintMultisig: { ...created, poolSignerCanMint: false },
          }),
        ),
      /cannot mint through it alone/,
    )
    // done: the multisig, any multisig the pool mints through alone, or the pool signer itself
    for (const state of [
      { mintAuthority: MULTISIG, mintMultisig: created, poolMintsThroughMintAuthority: true },
      { mintAuthority: OTHER, poolMintsThroughMintAuthority: true },
      { mintAuthority: POOL_SIGNER },
    ])
      assert.deepEqual(plan(onboarded(state)), [])
    // another multisig the pool cannot mint through alone needs the mint authority back
    assert.throws(
      () => plan(onboarded({ mintAuthority: OTHER, poolMintsThroughMintAuthority: false })),
      /mint authority/,
    )
  })

  it('requires the pool owner and token administrator', () => {
    assert.throws(() => plan(onboarded({ pool: { owner: OTHER } })), /must be the pool owner/)
    // the registry under the program's Router is read before the pool is deployed
    for (const state of [onboarded(), fresh()])
      assert.throws(
        () => plan({ ...state, registry: { ...REGISTRY, administrator: OTHER } }),
        /must be the token administrator/,
      )
  })

  it('sets the pool of a registry that points at another pool', () => {
    const OTHER_POOL = Keypair.generate().publicKey
    const repointed = onboarded({ registry: { ...REGISTRY, tokenPool: OTHER_POOL } })
    assert.deepEqual(names(plan(repointed)), ['setPool'])
    // a lookup table without a pool in it, or one that is gone, names no pool
    const unresolved = onboarded({ registry: { ...REGISTRY, tokenPool: undefined } })
    assert.deepEqual(names(plan(unresolved)), ['setPool'])
    // the given lookup table is then checked as for a registry without one
    assert.throws(
      () =>
        plan(
          { ...repointed, poolLookupTable: { found: false } },
          { poolLookupTableAddress: LOOKUP_TABLE.toBase58() },
        ),
      /does not exist/,
    )
  })

  it("upgrades a registry an older Router created, before the Router's other instructions", () => {
    const proposed = onboarded({
      mintAuthority: POOL_SIGNER,
      registry: {
        ...REGISTRY,
        administrator: PublicKey.default,
        pendingAdministrator: AUTHORITY,
        latestLayout: false,
        interfaceVersion: 1,
      },
    })
    assert.deepEqual(names(plan(proposed)), [
      'upgradeTokenAdminRegistry',
      'acceptAdmin',
      'setPoolInterfaceImplementation',
    ])
  })

  it('requires the upgrade authority to deploy a pool of a program without self-serve', () => {
    const closed = (upgradeAuthority?: PublicKey) =>
      fresh({
        poolDeployment: { selfServedAllowed: false, ...(upgradeAuthority && { upgradeAuthority }) },
      })
    for (const state of [closed(OTHER), closed()])
      assert.throws(
        () => plan(state),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'authority' &&
          /upgrade authority/.test(err.message),
      )
    assert.equal(plan(closed(AUTHORITY))[0]?.name, 'deployTokenPool')
  })
})

describe('parseOnboardTokenParams (cct/solana)', () => {
  it('defaults the pool program and authority', () => {
    const parsed = parseOnboardTokenParams(params({ poolType: 'lock-release' }))
    assert.ok(parsed.poolProgram.equals(resolveTokenPoolProgram('lock-release')))
    assert.ok(parsed.authority.equals(AUTHORITY))
  })

  it('validates every remote chain before any RPC, blaming its param', () => {
    const cases: [Partial<TokenOnboardingRemoteChain>, string][] = [
      [{ remoteTokenAddress: 'not-an-address' }, 'remoteChains[1].remoteTokenAddress'],
      [{ remotePoolAddresses: [] }, 'remoteChains[1].remotePoolAddresses'],
      [{ remoteTokenDecimals: 256 }, 'remoteChains[1].remoteTokenDecimals'],
      [
        { outboundRateLimiterConfig: { enabled: true, capacity: 1n, rate: 2n } },
        'remoteChains[1].outboundRateLimiterConfig.rate',
      ],
      [
        { ccvConfig: { thresholdOutboundCCVs: [MINT.toBase58()] } },
        'remoteChains[1].ccvConfig.outboundCCVs',
      ],
      [
        {
          fastFinalityRateLimits: {
            inbound: { enabled: false, capacity: 1n },
            outbound: { enabled: false },
          },
        },
        'remoteChains[1].fastFinalityRateLimits.inbound',
      ],
    ]
    for (const [extra, param] of cases) {
      assert.throws(
        () =>
          parseOnboardTokenParams(params({ remoteChains: [remote(FUJI), remote(SEPOLIA, extra)] })),
        (err: unknown) => {
          assert.ok(err instanceof CCTParamsInvalidError)
          assert.equal(err.context.param, param)
          return true
        },
      )
    }
  })

  it('rejects duplicate remote chains and unknown account resolutions', () => {
    assert.throws(
      () => parseOnboardTokenParams(params({ remoteChains: [remote(SEPOLIA), remote(SEPOLIA)] })),
      CCTParamsInvalidError,
    )
    assert.throws(
      () =>
        parseOnboardTokenParams(
          params({ accountResolution: 'Everything' as unknown as 'Standard' }),
        ),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.param === 'accountResolution',
    )
  })
})
