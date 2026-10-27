/**
 * Tests for the shared token-pool helpers (address normalization).
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// registers the chain families remote addresses are parsed as
import '../../../evm/index.ts'
import '../../../solana/index.ts'
import '../../../ton/index.ts'
import {
  BURN_MINT_POOL_TEMPLATE_ID,
  buildPoolExercise,
  normalizeRemoteAddress,
  stableCommandId,
} from './shared.ts'

const EVM_SELECTOR = 16015286601757825753n // ethereum-testnet-sepolia
const SOLANA_SELECTOR = 16423721717087811551n // solana-devnet
const TON_SELECTOR = 1399300952838017768n // ton-testnet
const SOLANA_KEY = '1d913a42a72f8eba8c670355ca3ed14257bc3a1135e264fad3522acf95a36a36'
const SOLANA_KEY_BASE58 = '2zRGGYoHBNXpyJwBX6F3M3cMVmAfrcXKsSF1vt5UbXKj'

describe('normalizeRemoteAddress', () => {
  it('strips 0x and left-pads a 20-byte EVM address to 32 bytes', () => {
    assert.equal(
      normalizeRemoteAddress('0x36e518336a67177cb102726c2dfa3d29b12f4c7b', EVM_SELECTOR),
      '00000000000000000000000036e518336a67177cb102726c2dfa3d29b12f4c7b',
    )
  })

  it('pads a bare (no-prefix) 20-byte address the same way', () => {
    assert.equal(
      normalizeRemoteAddress('36e518336a67177cb102726c2dfa3d29b12f4c7b', EVM_SELECTOR),
      '00000000000000000000000036e518336a67177cb102726c2dfa3d29b12f4c7b',
    )
  })

  it('stores a Solana key, as bare or 0x hex or base58, as its 32 bytes in bare hex', () => {
    for (const value of [SOLANA_KEY, '0x' + SOLANA_KEY, SOLANA_KEY_BASE58]) {
      assert.equal(normalizeRemoteAddress(value, SOLANA_SELECTOR), SOLANA_KEY)
    }
  })

  for (const [label, value, selector, reason] of [
    ['a Solana key on an EVM lane', SOLANA_KEY_BASE58, EVM_SELECTOR, /valid EVM address/],
    ['an EVM address on a Solana lane', '0x' + '36'.repeat(20), SOLANA_SELECTOR, /valid SVM/],
    ['an address over the 32 bytes a pool stores', `0:${SOLANA_KEY}`, TON_SELECTOR, /36 bytes/],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.throws(() => normalizeRemoteAddress(value, selector), reason)
    })
  }
})

const POOL_CONTRACT = {
  contractId: '00abc123',
  createdEventBlob: 'blob',
  synchronizerId: 'sync-1',
}

const EXERCISE_COMMAND = {
  ExerciseCommand: {
    templateId: BURN_MINT_POOL_TEMPLATE_ID,
    contractId: '00abc123',
    choice: 'ApplyChainUpdates',
    choiceArgument: { remoteChainSelectorsToRemove: ['1'], chainsToAdd: [] },
  },
}

describe('stableCommandId', () => {
  it('is deterministic for the same logical operation', () => {
    const a = stableCommandId('cct-op', [EXERCISE_COMMAND], ['party::1220ab'])
    const b = stableCommandId('cct-op', [EXERCISE_COMMAND], ['party::1220ab'])
    assert.equal(a, b)
    assert.match(a, /^cct-op-[0-9a-f]{32}$/)
  })

  it('is independent of disclosure blobs (payload content only)', () => {
    const a = stableCommandId('cct-op', [EXERCISE_COMMAND], ['party::1220ab'])
    // builders hash only the commands array, never disclosedContracts
    const withDisclosure = buildPoolExercise({
      choice: 'ApplyChainUpdates',
      templateId: BURN_MINT_POOL_TEMPLATE_ID,
      poolContract: { ...POOL_CONTRACT, createdEventBlob: 'other-blob' },
      choiceArgument: { remoteChainSelectorsToRemove: ['1'], chainsToAdd: [] },
      actAs: ['party::1220ab'],
      commandIdPrefix: 'cct-op',
    })
    assert.equal(withDisclosure.commandId, a)
  })

  it('differs across prefixes, commands, and actAs', () => {
    const base = stableCommandId('cct-op', [EXERCISE_COMMAND], ['party::1220ab'])
    assert.notEqual(stableCommandId('cct-other', [EXERCISE_COMMAND], ['party::1220ab']), base)
    assert.notEqual(stableCommandId('cct-op', [], ['party::1220ab']), base)
    assert.notEqual(stableCommandId('cct-op', [EXERCISE_COMMAND], ['party::1220ef']), base)
  })

  it('tolerates bigint values in the payload', () => {
    const withBigint = {
      ExerciseCommand: { ...EXERCISE_COMMAND.ExerciseCommand, choiceArgument: { amount: 1n } },
    }
    assert.doesNotThrow(() => stableCommandId('cct-op', [withBigint], ['party::1220ab']))
  })
})

describe('buildPoolExercise commandId', () => {
  const input = {
    choice: 'ApplyChainUpdates',
    templateId: BURN_MINT_POOL_TEMPLATE_ID,
    poolContract: POOL_CONTRACT,
    choiceArgument: { remoteChainSelectorsToRemove: ['1'], chainsToAdd: [] },
    actAs: ['party::1220ab'],
    commandIdPrefix: 'cct-apply-chain-updates',
  }

  it('derives a deterministic commandId from the command content', () => {
    const first = buildPoolExercise(input)
    const second = buildPoolExercise(input)
    assert.equal(first.commandId, second.commandId)
    assert.match(first.commandId, /^cct-apply-chain-updates-[0-9a-f]{32}$/)
  })

  it('prefers an explicit commandId override', () => {
    const result = buildPoolExercise({ ...input, commandId: 'my-idempotency-key' })
    assert.equal(result.commandId, 'my-idempotency-key')
  })
})
