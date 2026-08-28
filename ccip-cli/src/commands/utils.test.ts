import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CCIPChainNotFoundError,
  CCIPCommitNotFoundError,
  CCIPUsdcAttestationError,
  ChainFamily,
} from '@chainlink/ccip-sdk/src/index.ts'

import {
  formatCCIPError,
  formatDisplayAddress,
  formatDisplayTxHash,
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
