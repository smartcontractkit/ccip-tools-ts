import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type Chain,
  CCIPChainNotFoundError,
  CCIPCommitNotFoundError,
  CCIPTokenDecimalsUnavailableError,
  CCIPUsdcAttestationError,
  ChainFamily,
} from '@chainlink/ccip-sdk/src/index.ts'

import {
  formatCCIPError,
  formatDisplayAddress,
  formatDisplayTxHash,
  parseTokenAmounts,
  prettyFormat,
  yieldResolved,
} from './utils.ts'

describe('formatCCIPError', () => {
  it('should return null for non-CCIPError instances', () => {
    const regularError = new Error('regular error')
    assert.equal(formatCCIPError(regularError), null)
    assert.equal(formatCCIPError('string error'), null)
    assert.equal(formatCCIPError(null), null)
    assert.equal(formatCCIPError(undefined), null)
  })

  it('should format CCIPError with code and message', () => {
    const error = new CCIPChainNotFoundError('12345')
    const formatted = formatCCIPError(error)

    assert.ok(formatted)
    assert.match(formatted, /^error\[CHAIN_NOT_FOUND\]:/)
    assert.match(formatted, /12345/)
  })

  it('should include help section with recovery hint', () => {
    const error = new CCIPChainNotFoundError('12345')
    const formatted = formatCCIPError(error)

    assert.ok(formatted)
    assert.match(formatted, /help:/)
    assert.match(formatted, /Verify the chainId/)
  })

  it('should include note section for transient errors', () => {
    const error = new CCIPCommitNotFoundError(1000, 123n)
    const formatted = formatCCIPError(error)

    assert.ok(formatted)
    assert.match(formatted, /note:/)
    assert.match(formatted, /may resolve on retry/)
  })

  it('should include retry timing for transient errors with retryAfterMs', () => {
    const error = new CCIPUsdcAttestationError('0xhash', { status: 'pending' })
    const formatted = formatCCIPError(error)

    assert.ok(formatted)
    assert.match(formatted, /wait \d+s/)
  })

  it('should not include note section for permanent errors', () => {
    const error = new CCIPChainNotFoundError('12345')
    const formatted = formatCCIPError(error)

    assert.ok(formatted)
    assert.doesNotMatch(formatted, /note:/)
  })

  it('should format error with structured output', () => {
    const error = new CCIPChainNotFoundError('12345')
    const formatted = formatCCIPError(error)

    assert.ok(formatted)
    // Check format: error[CODE]: message
    assert.match(formatted, /^error\[\w+\]:/)
    // Check help: indentation
    assert.match(formatted, /\n {2}help:/)
  })

  it('should include stack trace when verbose is true', () => {
    const error = new CCIPChainNotFoundError('12345')
    const formatted = formatCCIPError(error, true)

    assert.ok(formatted)
    assert.match(formatted, /Stack trace:/)
    assert.match(formatted, /at /)
  })

  it('should not include stack trace when verbose is false', () => {
    const error = new CCIPChainNotFoundError('12345')
    const formatted = formatCCIPError(error, false)

    assert.ok(formatted)
    assert.doesNotMatch(formatted, /Stack trace:/)
  })
})

describe('pretty display formatters', () => {
  const RAW_TON = `0:${'ab'.repeat(32)}`
  const FRIENDLY_TON = formatDisplayAddress(RAW_TON, ChainFamily.TON)
  const COMPOSITE_TON_TX = `${RAW_TON}:12345:${'cd'.repeat(32)}`
  const RAW_EVM = '0x34c5f9b30944cbcb29f518afe4a17ed2e64dee95'

  it('formats TON addresses to friendly form, bare tx hashes, recursively', () => {
    const out = prettyFormat(
      {
        router: RAW_TON,
        feeQuoterConfig: {
          linkToken: RAW_TON,
          maxFeeJuelsPerMsg: 100n,
        },
        onRamps: [RAW_TON],
        symbols: ['SENT'],
        meta: { transactionHash: COMPOSITE_TON_TX, receiptTransactionHash: COMPOSITE_TON_TX },
      },
      ChainFamily.TON,
    ) as Record<string, unknown>

    assert.equal(out.router, FRIENDLY_TON)
    assert.deepEqual(out.onRamps, [FRIENDLY_TON])
    assert.deepEqual(out.symbols, ['SENT'])
    assert.deepEqual(out.feeQuoterConfig, {
      linkToken: FRIENDLY_TON,
      maxFeeJuelsPerMsg: 100n,
    })
    assert.deepEqual(out.meta, {
      transactionHash: 'cd'.repeat(32),
      receiptTransactionHash: 'cd'.repeat(32),
    })
  })

  it('formats remote-family values with the familyFor override', () => {
    // EVM offRampConfig whose `onRamps` holds a TON (source) address
    const out = prettyFormat({ router: RAW_EVM, onRamps: [RAW_TON] }, ChainFamily.EVM, {
      onRamps: ChainFamily.TON,
    }) as Record<string, unknown>

    assert.equal(out.router, RAW_EVM) // EVM has no display formatter
    assert.deepEqual(out.onRamps, [FRIENDLY_TON]) // remote address is a TON address
  })

  it('leaves values without known address/hash keys untouched', () => {
    const out = prettyFormat(
      {
        typeAndVersion: 'OnRamp 1.6.0',
        maxSeqNr: 42n,
        data: COMPOSITE_TON_TX, // data is not a tx-hash key
      },
      ChainFamily.TON,
    ) as Record<string, unknown>

    assert.equal(out.typeAndVersion, 'OnRamp 1.6.0')
    assert.equal(out.maxSeqNr, 42n)
    assert.equal(out.data, COMPOSITE_TON_TX)
  })

  it('formatDisplayTxHash is identity for non-TON hashes', () => {
    assert.equal(formatDisplayTxHash(RAW_EVM, ChainFamily.EVM), RAW_EVM)
    assert.equal(
      formatDisplayTxHash(
        '5uVS6SjKKrvP6khfA9hiRk68pwuNVjZXCJQNxwwp1MXs9cozT3q8dkfAhPPKcGheiBqbKnfZaf8yznxJ7pvrLgMM',
        ChainFamily.Solana,
      ),
      '5uVS6SjKKrvP6khfA9hiRk68pwuNVjZXCJQNxwwp1MXs9cozT3q8dkfAhPPKcGheiBqbKnfZaf8yznxJ7pvrLgMM',
    )
  })
})

describe('yieldResolved', () => {
  it('throws if a promise rejects while the generator is paused after a yield', async () => {
    const err = new Error('late failure')
    let rejectLater!: (err: Error) => void
    const lateReject = new Promise<number>((_, reject) => {
      rejectLater = reject
    })

    const gen = yieldResolved([Promise.resolve(1), lateReject])
    assert.deepEqual(await gen.next(), { value: 1, done: false })

    rejectLater(err)
    await new Promise((resolve) => setTimeout(resolve, 0))

    await assert.rejects(gen.next(), err)
  })
})

describe('parseTokenAmounts', () => {
  const TOKEN = '0x8FE4D867DB59E38E7bA7D98DC14ac1826c79CF9f'
  const ROUTER = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
  const POOL = '0x8Cd7D9088e82eE838a730f0F29A97ECd211E9E97'

  /** Chain stub whose getTokenInfo reports the given decimals (or throws), and whose pool
   * (resolved via the router's registry) declares the given pool decimals (or none). */
  const stubChain = (decimals: number | Error, poolDecimals?: number) =>
    ({
      network: { family: ChainFamily.EVM },
      getTokenInfo: (_token: string) =>
        decimals instanceof Error
          ? Promise.reject(decimals)
          : Promise.resolve({ decimals, symbol: 'TKN', name: 'Token' }),
      ...(poolDecimals != null && {
        getTokenPoolConfig: (_pool: string) => Promise.resolve({ decimals: poolDecimals }),
        getTokenAdminRegistryFor: (_addr: string) => Promise.resolve('0x' + '11'.repeat(20)),
        getRegistryTokenConfig: (_registry: string, token: string) =>
          token === TOKEN
            ? Promise.resolve({ tokenPool: POOL })
            : Promise.reject(new Error('not registered')),
      }),
    }) as unknown as Chain

  it('reads decimals from the token on-chain', async () => {
    const [ta] = await parseTokenAmounts(stubChain(18), [`${TOKEN}=0.001`])
    assert.ok(ta)
    assert.equal(ta.token, TOKEN)
    assert.equal(ta.amount, 1000000000000000n)
  })

  it('falls back to the source pool when the token has no decimals()', async () => {
    // token view missing → pool's declared decimals (18) — no user input needed
    const chain = stubChain(new CCIPTokenDecimalsUnavailableError(TOKEN), 18)
    const [ta] = await parseTokenAmounts(chain, [`${TOKEN}=0.001`], ROUTER)
    assert.ok(ta)
    assert.equal(ta.amount, 1000000000000000n)
  })

  it('falls back to the family default when neither token nor pool can declare', async () => {
    // no router → no pool resolution; the EVM family default (18) is the last resort
    const chain = stubChain(new CCIPTokenDecimalsUnavailableError(TOKEN))
    const [ta] = await parseTokenAmounts(chain, [`${TOKEN}=0.001`])
    assert.ok(ta)
    assert.equal(ta.amount, 1000000000000000n)
  })

  it('falls back to the family default when the pool cannot declare either (v1.5.0)', async () => {
    // pool present but predates getTokenDecimals — the family default (18) still applies
    const chain = stubChain(new CCIPTokenDecimalsUnavailableError(TOKEN))
    const [ta] = await parseTokenAmounts(chain, [`${TOKEN}=0.001`], ROUTER)
    assert.ok(ta)
    assert.equal(ta.amount, 1000000000000000n)
  })
})
