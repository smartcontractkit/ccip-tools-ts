/**
 * Unit tests for the Canton CCT `setDynamicConfig` operation.
 *
 * Verifies the `generate()` command shape (choice name, template ID, choice
 * argument, `actAs`, disclosed contract) against a mocked {@link CantonChain} —
 * no live participant required. The mock stubs
 * `findActiveContractByInstanceAddress` so the disclosure-blob fetch path runs
 * without a ledger. Mirrors the Solana `*.test.ts` idiom (`node:test` + `as
 * unknown as CantonChain`).
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ChainFamily } from '../../../../networks.ts'
import type { CantonActiveContract, CantonChain } from '../../../../canton/index.ts'
import { CantonTokenManager } from '../../index.ts'

const POOL_CID = '#ccip-core-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool:00deadbeef'
const POOL_OWNER = 'participant::1220c250c250c250c250c250c250c250c250c250c250c250c250c250c250c'
const POOL_INSTANCE_ADDRESS = '0x' + 'ab'.repeat(32) // keccak256 hash form
const RATE_LIMIT_ADMIN = 'rladmin::1220a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
const BLOB = 'base64-created-event-blob=='
const SYNCHRONIZER_ID = 'canton::global::domain-1'

/** A fake active contract returned by the mocked ACS fetch. */
function fakePoolContract(): CantonActiveContract {
  return {
    contractId: POOL_CID,
    templateId: '#ccip-core-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool',
    createdEventBlob: BLOB,
    synchronizerId: SYNCHRONIZER_ID,
    signatories: [POOL_OWNER],
    createArgument: {},
  }
}

/**
 * Minimal `CantonChain` mock: just the surface `setDynamicConfig.generate()`
 * touches — `network.family` and `findActiveContractByInstanceAddress`.
 */
function mockChain(): CantonChain {
  return {
    network: { family: ChainFamily.Canton },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    async findActiveContractByInstanceAddress(
      _templateId: string,
      instanceAddress: string,
    ): Promise<CantonActiveContract | null> {
      return instanceAddress === POOL_INSTANCE_ADDRESS ? fakePoolContract() : null
    },
  } as unknown as CantonChain
}

describe('CantonTokenManager.setDynamicConfig (generate)', () => {
  it('builds a SetDynamicConfig exercise command with a real disclosure blob', async () => {
    const manager = CantonTokenManager.fromChain(mockChain())
    const unsigned = await manager.generateUnsignedSetDynamicConfig({
      poolInstanceAddress: POOL_INSTANCE_ADDRESS,
      poolType: 'burnMint',
      rateLimitAdmin: RATE_LIMIT_ADMIN,
      sender: POOL_OWNER,
    })

    // UnsignedCantonTx = { family, commands }
    assert.equal(unsigned.family, ChainFamily.Canton)

    const cmd = unsigned.commands.commands[0] as {
      ExerciseCommand: { templateId: string; contractId: string; choice: string; choiceArgument: Record<string, unknown> }
    }
    assert.ok(cmd?.ExerciseCommand, 'expected an ExerciseCommand')
    assert.equal(cmd.ExerciseCommand.choice, 'SetDynamicConfig')
    assert.equal(
      cmd.ExerciseCommand.templateId,
      '#ccip-core-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool',
    )
    assert.equal(cmd.ExerciseCommand.contractId, POOL_CID)
    assert.deepEqual(cmd.ExerciseCommand.choiceArgument, { rateLimitAdmin: RATE_LIMIT_ADMIN })

    // actAs is the pool owner / sender
    assert.deepEqual(unsigned.commands.actAs, [POOL_OWNER])

    // The disclosed contract carries the real blob + synchronizer fetched from the ACS
    const disclosed = unsigned.commands.disclosedContracts as Array<Record<string, unknown>>
    assert.equal(disclosed.length, 1)
    assert.equal(disclosed[0]!.contractId, POOL_CID)
    assert.equal(disclosed[0]!.createdEventBlob, BLOB)
    assert.equal(disclosed[0]!.synchronizerId, SYNCHRONIZER_ID)
  })

  it('omits rateLimitAdmin from the choice argument when not provided (Daml None → clear)', async () => {
    const manager = CantonTokenManager.fromChain(mockChain())
    const unsigned = await manager.generateUnsignedSetDynamicConfig({
      poolInstanceAddress: POOL_INSTANCE_ADDRESS,
      poolType: 'burnMint',
      sender: POOL_OWNER,
    })

    const cmd = unsigned.commands.commands[0] as {
      ExerciseCommand: { choiceArgument: Record<string, unknown> }
    }
    assert.deepEqual(cmd.ExerciseCommand.choiceArgument, {})
  })

  it('uses the LockRelease template ID when poolType is lockRelease', async () => {
    const manager = CantonTokenManager.fromChain(mockChain())
    const unsigned = await manager.generateUnsignedSetDynamicConfig({
      poolInstanceAddress: POOL_INSTANCE_ADDRESS,
      poolType: 'lockRelease',
      sender: POOL_OWNER,
    })

    const cmd = unsigned.commands.commands[0] as {
      ExerciseCommand: { templateId: string }
    }
    assert.equal(
      cmd.ExerciseCommand.templateId,
      '#ccip-core-v2:CCIP.LockReleaseTokenPoolV2:LockReleaseTokenPool',
    )
  })
})
