import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { MINT_SIZE, MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'

import {
  CCIPTokenAccountNotFoundError,
  CCIPTokenPoolStateNotFoundError,
} from '../../errors/index.ts'
import type { SolanaChain } from '../../solana/index.ts'
import {
  CCTParamsInvalidError,
  CCTTokenAccountMintMismatchError,
  CCTTxFailedError,
} from '../errors.ts'
import { TOKEN_POOL_PROGRAMS, deriveTokenPoolConfigPda } from './programs/token-pool.ts'
import {
  parseOptionalPublicKey,
  parsePublicKey,
  resolveExistingLockReleasePoolProgram,
  resolveExistingPoolConfig,
  resolveExistingPoolProgram,
  resolveExistingPoolState,
  resolveExistingTokenAccount,
  resolvePoolProgramType,
  validateAuthorityMatchesWallet,
  validateBigInt,
  validateDelegation,
  validateInteger,
  validateNonEmptyString,
  validateOptionalPublicKey,
  validatePoolType,
  validatePublicKey,
  validatePublicKeys,
  validateUniqueChainSelectors,
  validateUniquePublicKeys,
  validateWritableIndexes,
} from './validate.ts'

const MINT = new PublicKey(Uint8Array.from({ length: 32 }, () => 2))
const BURN_MINT = new PublicKey(TOKEN_POOL_PROGRAMS['burn-mint'])
const LOCK_RELEASE = new PublicKey(TOKEN_POOL_PROGRAMS['lock-release'])
const CUSTOM = new PublicKey(Uint8Array.from({ length: 32 }, () => 9))

function poolStateData(): Buffer {
  const key = PublicKey.default.toBuffer()
  return Buffer.concat([
    BorshAccountsCoder.accountDiscriminator('State'),
    Buffer.from([1]),
    TOKEN_PROGRAM_ID.toBuffer(),
    MINT.toBuffer(),
    Buffer.from([6]),
    ...Array.from({ length: 8 }, () => key),
    Buffer.from([0, 1]),
    Buffer.alloc(4),
    key,
  ])
}

/**
 * Stub chain whose token pool state for {@link MINT} exists only under `programs`, counting RPC
 * reads. `typeAndVersion` rejects unless `type` is given, like a program without `typeVersion`.
 */
function poolChain(programs: PublicKey[], type?: string) {
  const states = new Map(
    programs.map((program) => [
      deriveTokenPoolConfigPda(program, MINT).toBase58(),
      { owner: program, data: poolStateData() },
    ]),
  )
  const calls = { getAccountInfo: 0, getMultipleAccountsInfo: 0, typeAndVersion: 0 }
  const chain = {
    connection: {
      getAccountInfo: async (address: PublicKey) => {
        calls.getAccountInfo++
        return states.get(address.toBase58()) ?? null
      },
      getMultipleAccountsInfo: async (addresses: PublicKey[]) => {
        calls.getMultipleAccountsInfo++
        return addresses.map((address) => states.get(address.toBase58()) ?? null)
      },
    },
    typeAndVersion: async () => {
      calls.typeAndVersion++
      if (type === undefined) throw new Error('typeVersion not implemented')
      return [type, '1.6.0', `${type} 1.6.0`]
    },
  } as unknown as SolanaChain
  return { chain, calls, states }
}

function mintData() {
  const data = Buffer.alloc(MINT_SIZE)
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority: PublicKey.default,
      supply: 0n,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  )
  return data
}

describe('Validate (cct/solana)', () => {
  it('parses valid public keys', () => {
    const key = parsePublicKey('op', 'payer', PublicKey.default.toBase58())
    assert.ok(key.equals(PublicKey.default))
  })

  it('accepts valid public keys', () => {
    assert.doesNotThrow(() => validatePublicKey('op', 'payer', PublicKey.default.toBase58()))
  })

  it('accepts omitted and valid optional public keys', () => {
    assert.doesNotThrow(() => validateOptionalPublicKey('op', 'authority', undefined))
    assert.doesNotThrow(() =>
      validateOptionalPublicKey('op', 'authority', PublicKey.default.toBase58()),
    )
  })

  it('rejects invalid optional public keys', () => {
    for (const value of [null, '']) {
      assert.throws(
        () => validateOptionalPublicKey('op', 'authority', value),
        (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
      )
    }
  })

  it('rejects non-string public keys', () => {
    assert.throws(
      () => validatePublicKey('op', 'payer', 123),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'op' &&
        err.context.param === 'payer',
    )
  })

  it('rejects invalid public key strings', () => {
    assert.throws(
      () => validatePublicKey('op', 'payer', 'nope'),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'op' &&
        err.context.param === 'payer',
    )
  })

  it('validates public key arrays', () => {
    assert.doesNotThrow(() => validatePublicKeys('op', 'signers', []))
    assert.doesNotThrow(() => validatePublicKeys('op', 'signers', [PublicKey.default.toBase58()]))
    assert.throws(
      () => validatePublicKeys('op', 'signers', ['nope']),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'signers[0]',
    )
    assert.throws(
      () => validatePublicKeys('op', 'signers', 'nope'),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'signers',
    )
  })

  it('validates non-empty strings', () => {
    assert.doesNotThrow(() => validateNonEmptyString('op', 'seed', 'abc'))
    assert.throws(
      () => validateNonEmptyString('op', 'seed', '   '),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'seed',
    )
  })

  it('validates the executing authority', () => {
    const authority = PublicKey.default

    assert.doesNotThrow(() => validateAuthorityMatchesWallet('op', authority, authority))
    assert.throws(
      () =>
        validateAuthorityMatchesWallet(
          'op',
          authority,
          new PublicKey(Uint8Array.from({ length: 32 }, () => 1)),
        ),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'authority',
    )
  })

  it('validates pool types', () => {
    assert.doesNotThrow(() => validatePoolType('op', 'poolType', 'burn-mint'))
    assert.doesNotThrow(() => validatePoolType('op', 'poolType', 'lock-release'))
    assert.throws(
      () => validatePoolType('op', 'poolType', 'nope'),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'poolType',
    )
  })

  it('parses optional public keys', () => {
    assert.equal(parseOptionalPublicKey('op', 'poolProgramAddress', undefined), undefined)
    assert.ok(parseOptionalPublicKey('op', 'poolProgramAddress', CUSTOM.toBase58())?.equals(CUSTOM))
    for (const value of [null, '', 'nope']) {
      assert.throws(
        () => parseOptionalPublicKey('op', 'poolProgramAddress', value),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError && err.context.param === 'poolProgramAddress',
      )
    }
  })

  describe('existing pool resolution', () => {
    it('resolves the only canonical pool for a mint in one read', async () => {
      for (const program of [BURN_MINT, LOCK_RELEASE]) {
        const { chain, calls } = poolChain([program])
        const resolved = await resolveExistingPoolState('op', chain, MINT)

        assert.ok(resolved.poolProgram.equals(program))
        assert.ok(resolved.state.equals(deriveTokenPoolConfigPda(program, MINT)))
        assert.ok(resolved.account.owner.equals(program))
        assert.deepEqual(calls, {
          getAccountInfo: 0,
          getMultipleAccountsInfo: 1,
          typeAndVersion: 0,
        })
      }
    })

    it('rejects a mint with both canonical pools', async () => {
      const { chain } = poolChain([BURN_MINT, LOCK_RELEASE])

      await assert.rejects(
        resolveExistingPoolProgram('op', chain, MINT),
        (err: unknown) =>
          err instanceof CCTParamsInvalidError &&
          err.context.param === 'poolProgramAddress' &&
          /both canonical burn-mint and lock-release/.test(err.message),
      )
    })

    it('rejects a mint without a canonical pool and does not cache the miss', async () => {
      const { chain, calls, states } = poolChain([])
      const rejectsNoPool = (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.param === 'tokenAddress' &&
        /no canonical burn-mint or lock-release token pool/.test(err.message)

      await assert.rejects(resolveExistingPoolProgram('op', chain, MINT), rejectsNoPool)
      // A confirmed custom program is never used for canonical resolution.
      states.set(deriveTokenPoolConfigPda(CUSTOM, MINT).toBase58(), {
        owner: CUSTOM,
        data: poolStateData(),
      })
      await resolveExistingPoolProgram('op', chain, MINT, CUSTOM)
      await assert.rejects(resolveExistingPoolProgram('op', chain, MINT), rejectsNoPool)
      assert.equal(calls.getMultipleAccountsInfo, 2)
    })

    it('reads only the state of an overriding pool program', async () => {
      const { chain, calls } = poolChain([CUSTOM])
      const resolved = await resolveExistingPoolState('op', chain, MINT, CUSTOM)

      assert.ok(resolved.poolProgram.equals(CUSTOM))
      assert.deepEqual(calls, { getAccountInfo: 1, getMultipleAccountsInfo: 0, typeAndVersion: 0 })
    })

    it('rejects an overriding pool program without state for the mint', async () => {
      const { chain } = poolChain([BURN_MINT])

      await assert.rejects(
        resolveExistingPoolProgram('op', chain, MINT, CUSTOM),
        (err: unknown) =>
          err instanceof CCIPTokenPoolStateNotFoundError &&
          err.context.tokenPool === deriveTokenPoolConfigPda(CUSTOM, MINT).toBase58() &&
          err.context.mint === MINT.toBase58() &&
          err.context.poolProgram === CUSTOM.toBase58(),
      )
    })

    it('caches resolutions per chain and mint', async () => {
      const { chain, calls } = poolChain([LOCK_RELEASE])

      assert.ok((await resolveExistingPoolProgram('op', chain, MINT)).equals(LOCK_RELEASE))
      assert.ok((await resolveExistingPoolProgram('op', chain, MINT)).equals(LOCK_RELEASE))
      // The resolved program, passed back as an override, is confirmed without another read.
      assert.ok(
        (await resolveExistingPoolProgram('op', chain, MINT, LOCK_RELEASE)).equals(LOCK_RELEASE),
      )
      assert.deepEqual(calls, { getAccountInfo: 0, getMultipleAccountsInfo: 1, typeAndVersion: 0 })

      // A state read reuses the resolution and reads the resolved PDA only.
      await resolveExistingPoolState('op', chain, MINT)
      assert.deepEqual(calls, { getAccountInfo: 1, getMultipleAccountsInfo: 1, typeAndVersion: 0 })

      const other = poolChain([LOCK_RELEASE])
      await resolveExistingPoolProgram('op', other.chain, MINT)
      assert.equal(other.calls.getMultipleAccountsInfo, 1)
    })

    it('caches confirmed overriding pool programs', async () => {
      const { chain, calls } = poolChain([CUSTOM])

      await resolveExistingPoolProgram('op', chain, MINT, CUSTOM)
      await resolveExistingPoolProgram('op', chain, MINT, CUSTOM)
      assert.deepEqual(calls, { getAccountInfo: 1, getMultipleAccountsInfo: 0, typeAndVersion: 0 })
    })

    it('drops a cached resolution whose state is gone', async () => {
      const { chain, calls, states } = poolChain([BURN_MINT])
      await resolveExistingPoolProgram('op', chain, MINT)
      states.clear()
      states.set(deriveTokenPoolConfigPda(LOCK_RELEASE, MINT).toBase58(), {
        owner: LOCK_RELEASE,
        data: poolStateData(),
      })

      await assert.rejects(
        resolveExistingPoolState('op', chain, MINT),
        CCIPTokenPoolStateNotFoundError,
      )
      assert.ok((await resolveExistingPoolProgram('op', chain, MINT)).equals(LOCK_RELEASE))
      assert.equal(calls.getMultipleAccountsInfo, 2)
    })

    it('decodes the resolved pool state', async () => {
      const { chain } = poolChain([BURN_MINT])
      const { poolProgram, version, config } = await resolveExistingPoolConfig('op', chain, MINT)

      assert.ok(poolProgram.equals(BURN_MINT))
      assert.equal(version, 1)
      assert.ok(config.mint.equals(MINT))
      assert.equal(config.decimals, 6)
    })

    it('identifies pool program types', async () => {
      const canonical = poolChain([])
      assert.equal(await resolvePoolProgramType(canonical.chain, BURN_MINT), 'burn-mint')
      assert.equal(await resolvePoolProgramType(canonical.chain, LOCK_RELEASE), 'lock-release')
      assert.equal(canonical.calls.typeAndVersion, 0)

      const cases: [string | undefined, string | undefined][] = [
        ['LockReleaseTokenPool', 'lock-release'],
        ['lockreleaseTokenPool', 'lock-release'],
        ['BurnMintTokenPool', 'burn-mint'],
        ['burnmintTokenPool', 'burn-mint'],
        ['CustomTokenPool', undefined],
        [undefined, undefined],
      ]
      for (const [type, expected] of cases) {
        assert.equal(await resolvePoolProgramType(poolChain([], type).chain, CUSTOM), expected)
      }
    })

    it('rejects burn-mint pools for lock-release operations', async () => {
      const rejects = (param: string) => (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.param === param

      await assert.rejects(
        resolveExistingLockReleasePoolProgram('op', poolChain([BURN_MINT]).chain, MINT),
        rejects('tokenAddress'),
      )
      await assert.rejects(
        resolveExistingLockReleasePoolProgram('op', poolChain([BURN_MINT]).chain, MINT, BURN_MINT),
        rejects('poolProgramAddress'),
      )
      await assert.rejects(
        resolveExistingLockReleasePoolProgram(
          'op',
          poolChain([CUSTOM], 'BurnMintTokenPool').chain,
          MINT,
          CUSTOM,
        ),
        rejects('poolProgramAddress'),
      )

      assert.ok(
        (
          await resolveExistingLockReleasePoolProgram('op', poolChain([LOCK_RELEASE]).chain, MINT)
        ).equals(LOCK_RELEASE),
      )
      // A custom program of unknown type is accepted; it must match the lock-release layout.
      assert.ok(
        (
          await resolveExistingLockReleasePoolProgram('op', poolChain([CUSTOM]).chain, MINT, CUSTOM)
        ).equals(CUSTOM),
      )
    })
  })

  it('validates integers', () => {
    assert.doesNotThrow(() => validateInteger('op', 'threshold', 1))
    assert.doesNotThrow(() => validateInteger('op', 'decimals', 255, 0, 255))
    assert.throws(
      () => validateInteger('op', 'decimals', 256, 0, 255),
      (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === 'decimals',
    )
    assert.throws(() => validateInteger('op', 'threshold', 0, 1), CCTParamsInvalidError)
    assert.throws(() => validateInteger('op', 'limit', 2, undefined, 1), CCTParamsInvalidError)
    assert.throws(() => validateInteger('op', 'integer', 1.5), CCTParamsInvalidError)
  })

  it('validates bigint bounds with useful errors', () => {
    assert.doesNotThrow(() => validateBigInt('op', 'selector', 0n, 0n))
    assert.throws(
      () => validateBigInt('op', 'selector', -1n, 0n),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.reason === 'must be a bigint >= 0',
    )
    assert.throws(
      () => validateBigInt('op', 'selector', 2n, undefined, 1n),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.reason === 'must be a bigint <= 1',
    )
  })

  it('rejects duplicate public keys', () => {
    const address = PublicKey.default
    assert.throws(
      () => validateUniquePublicKeys('op', 'addresses', [address, address]),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.param === 'addresses[1]',
    )
  })

  it('rejects duplicate chain selectors', () => {
    assert.doesNotThrow(() => validateUniqueChainSelectors('op', 'selectors', [1n, 2n]))
    assert.throws(
      () => validateUniqueChainSelectors('op', 'selectors', [1n, 1n]),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError && err.context.param === 'selectors[1]',
    )
  })

  it('validates token delegation', () => {
    const tokenAccount = PublicKey.default
    const delegate = new PublicKey(Uint8Array.from({ length: 32 }, () => 1))
    const otherDelegate = new PublicKey(Uint8Array.from({ length: 32 }, () => 2))

    assert.doesNotThrow(() =>
      validateDelegation(
        'op',
        tokenAccount,
        { delegate, delegatedAmount: 2n } as never,
        delegate,
        2n,
      ),
    )
    for (const account of [
      { delegate: null, delegatedAmount: 2n },
      { delegate: otherDelegate, delegatedAmount: 2n },
      { delegate, delegatedAmount: 1n },
    ]) {
      assert.throws(
        () => validateDelegation('op', tokenAccount, account as never, delegate, 2n),
        (err: unknown) => err instanceof CCTTxFailedError,
      )
    }
  })

  it('maps missing token accounts and preserves other lookup errors', async () => {
    const mint = new PublicKey(Uint8Array.from({ length: 32 }, () => 1))
    const holder = new PublicKey(Uint8Array.from({ length: 32 }, () => 2))
    const tokenAccount = new PublicKey(Uint8Array.from({ length: 32 }, () => 3))
    const connection = {
      getAccountInfo: async (address: PublicKey) =>
        address.equals(mint) ? { owner: TOKEN_PROGRAM_ID, data: mintData() } : null,
    }

    await assert.rejects(
      () => resolveExistingTokenAccount(connection as never, mint, holder, tokenAccount),
      (err: unknown) => err instanceof CCIPTokenAccountNotFoundError,
    )

    const invalidConnection = {
      getAccountInfo: async (address: PublicKey) =>
        address.equals(mint)
          ? { owner: TOKEN_PROGRAM_ID, data: mintData() }
          : { owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(0) },
    }
    await assert.rejects(() =>
      resolveExistingTokenAccount(invalidConnection as never, mint, holder, tokenAccount),
    )
  })

  it('rejects an explicit token account whose decoded mint differs', async () => {
    const mint = new PublicKey(Uint8Array.from({ length: 32 }, () => 1))
    const holder = new PublicKey(Uint8Array.from({ length: 32 }, () => 2))
    const tokenAccount = new PublicKey(Uint8Array.from({ length: 32 }, () => 3))
    const resolvedMint = new PublicKey(Uint8Array.from({ length: 32 }, () => 4))
    const data = Buffer.alloc(165)
    resolvedMint.toBuffer().copy(data)
    const connection = {
      getAccountInfo: async (address: PublicKey) =>
        address.equals(mint)
          ? { owner: TOKEN_PROGRAM_ID, data: mintData() }
          : { owner: TOKEN_PROGRAM_ID, data },
    }

    await assert.rejects(
      () => resolveExistingTokenAccount(connection as never, mint, holder, tokenAccount),
      (err: unknown) =>
        err instanceof CCTTokenAccountMintMismatchError &&
        err.context.requestedMint === mint.toBase58() &&
        err.context.resolvedMint === resolvedMint.toBase58(),
    )
  })

  it('accepts omitted and valid writable indexes', () => {
    assert.doesNotThrow(() => validateWritableIndexes('op', 'writableIndexes', undefined))
    assert.doesNotThrow(() => validateWritableIndexes('op', 'writableIndexes', [0, 3, 255]))
  })

  it('rejects empty writable indexes', () => {
    assert.throws(
      () => validateWritableIndexes('op', 'writableIndexes', []),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'op' &&
        err.context.param === 'writableIndexes',
    )
  })

  it('rejects writable indexes outside byte range', () => {
    assert.throws(
      () => validateWritableIndexes('op', 'writableIndexes', [256]),
      (err: unknown) =>
        err instanceof CCTParamsInvalidError &&
        err.context.operation === 'op' &&
        err.context.param === 'writableIndexes[0]',
    )
  })
})
