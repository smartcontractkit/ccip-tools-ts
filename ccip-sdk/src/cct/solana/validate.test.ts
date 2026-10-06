import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'

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
      assert.throws(() => parseOptionalPublicKey('op', 'authority', value), CCTParamsInvalidError)
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

  describe('existing pool resolution', () => {
    const MINT = PublicKey.unique()
    const CUSTOM = PublicKey.unique()
    const BURN_MINT = new PublicKey(TOKEN_POOL_PROGRAMS['burn-mint'])
    const LOCK_RELEASE = new PublicKey(TOKEN_POOL_PROGRAMS['lock-release'])

    /** Chain holding a pool state for MINT under `programs` only; `type` names a custom program. */
    function poolChain(programs: PublicKey[], type?: string) {
      const states = new Set(programs.map((p) => deriveTokenPoolConfigPda(p, MINT).toBase58()))
      const account = (address: PublicKey) => (states.has(address.toBase58()) ? {} : null)
      const connection = {
        getAccountInfo: mock.fn(async (address: PublicKey) => account(address)),
        getMultipleAccountsInfo: mock.fn(async (addresses: PublicKey[]) => addresses.map(account)),
      }
      // without a `type`, the program does not implement `typeVersion`
      const typeAndVersion = async () => (type ? [type] : Promise.reject(new Error('typeVersion')))
      /** Call counts of `[getAccountInfo, getMultipleAccountsInfo]`. */
      const reads = () => Object.values(connection).map((rpc) => rpc.mock.callCount())
      return { chain: { connection, typeAndVersion } as unknown as SolanaChain, reads, states }
    }

    it('resolves the canonical pool of a mint in one read, then from cache', async () => {
      for (const program of [BURN_MINT, LOCK_RELEASE]) {
        const { chain, reads } = poolChain([program])
        const resolved = await resolveExistingPoolState('op', chain, MINT)

        assert.ok(resolved.poolProgram.equals(program))
        assert.ok(resolved.state.equals(deriveTokenPoolConfigPda(program, MINT)))
        assert.ok((await resolveExistingPoolProgram('op', chain, MINT)).equals(program))
        assert.ok((await resolveExistingPoolProgram('op', chain, MINT, program)).equals(program))
        assert.deepEqual(reads(), [0, 1])
      }
    })

    it('rejects a mint with no canonical pool, or both, on every call', async () => {
      for (const [programs, param] of [
        [[], 'tokenAddress'],
        [[BURN_MINT, LOCK_RELEASE], 'poolProgramAddress'],
      ] as const) {
        const { chain, reads } = poolChain([...programs])
        for (const _ of [1, 2]) {
          await assert.rejects(
            resolveExistingPoolProgram('op', chain, MINT),
            (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
          )
        }
        assert.deepEqual(reads(), [0, 2])
      }
    })

    it('reads only the state under poolProgramAddress', async () => {
      const { chain, reads } = poolChain([CUSTOM])
      await resolveExistingPoolProgram('op', chain, MINT, CUSTOM)
      await resolveExistingPoolProgram('op', chain, MINT, CUSTOM)
      assert.deepEqual(reads(), [1, 0])
      await assert.rejects(
        resolveExistingPoolProgram('op', chain, MINT, LOCK_RELEASE),
        CCIPTokenPoolStateNotFoundError,
      )
    })

    it('drops a cached resolution whose state is gone', async () => {
      const { chain, reads, states } = poolChain([BURN_MINT])
      await resolveExistingPoolProgram('op', chain, MINT)
      states.clear()

      await assert.rejects(
        resolveExistingPoolState('op', chain, MINT),
        CCIPTokenPoolStateNotFoundError,
      )
      await assert.rejects(resolveExistingPoolState('op', chain, MINT), CCTParamsInvalidError)
      assert.deepEqual(reads(), [1, 2])
    })

    it('identifies pool program types', async () => {
      for (const [program, type, expected] of [
        [BURN_MINT, undefined, 'burn-mint'],
        [LOCK_RELEASE, undefined, 'lock-release'],
        [CUSTOM, 'LockReleaseTokenPool', 'lock-release'],
        [CUSTOM, 'BurnMintTokenPool', 'burn-mint'],
        [CUSTOM, 'CustomTokenPool', undefined],
        [CUSTOM, undefined, undefined],
      ] as const) {
        assert.equal(await resolvePoolProgramType(poolChain([], type).chain, program), expected)
      }
    })

    it('rejects burn-mint pools for lock-release operations', async () => {
      // [programs holding a pool state, poolProgramAddress, custom program type, rejected param]
      for (const [programs, override, type, param] of [
        [[BURN_MINT], undefined, undefined, 'tokenAddress'],
        [[BURN_MINT], BURN_MINT, undefined, 'poolProgramAddress'],
        [[CUSTOM], CUSTOM, 'BurnMintTokenPool', 'poolProgramAddress'],
        [[LOCK_RELEASE], undefined, undefined, undefined],
        [[CUSTOM], CUSTOM, undefined, undefined],
      ] as const) {
        const { chain } = poolChain([...programs], type)
        const resolved = resolveExistingLockReleasePoolProgram('op', chain, MINT, override)
        if (param === undefined) assert.ok((await resolved).equals(programs[0]))
        else {
          await assert.rejects(
            resolved,
            (err: unknown) => err instanceof CCTParamsInvalidError && err.context.param === param,
          )
        }
      }
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
