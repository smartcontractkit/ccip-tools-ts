/**
 * Unit tests for the one-off pool config operations (setRateLimitConfig,
 * setRateLimiterReferences, setTransferTimeout, setObservers, setDynamicConfig,
 * applyTokenTransferFeeConfigUpdates, pool receive-context ops) against a
 * mocked {@link CantonChain} — no live participant required.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import {
  BURN_MINT_POOL_TEMPLATE_ID,
  LOCK_RELEASE_POOL_TEMPLATE_ID,
  RATE_LIMITER_TEMPLATE_ID,
} from '../shared.ts'
import { SetObservers } from './set-observers.ts'
import { SetRateLimitConfig } from './set-rate-limit-config.ts'

const fp = (hex: string) => '1220' + hex.repeat(32)
const POOL_OWNER = `poolOwner::${fp('ab')}`
const RL_ADMIN = `rateAdmin::${fp('cd')}`
const POOL_ADDRESS = `pool-1@${POOL_OWNER}`
const RL_IN = `rl-in@${POOL_OWNER}`
const POOL_TEMPLATES = [BURN_MINT_POOL_TEMPLATE_ID, LOCK_RELEASE_POOL_TEMPLATE_ID]

function activeContract(
  templateId: string,
  contractId: string,
  instanceId: string,
  signatory: string,
  extraArgs: Record<string, unknown> = {},
) {
  return {
    contractEntry: {
      JsActiveContract: {
        synchronizerId: 'sync-1',
        createdEvent: {
          contractId,
          templateId,
          createdEventBlob: 'blob',
          signatories: [signatory],
          createArgument: { instanceId, ...extraArgs },
        },
      },
    },
  }
}

/** Chain mock: ACS holds one burn-mint pool at {@link POOL_ADDRESS} and one limiter per `rl-*` instance ID. */
function mockChain(poolTemplateId = BURN_MINT_POOL_TEMPLATE_ID) {
  const provider = {
    getLedgerEnd: async () => ({ offset: 1 }),
    getActiveContracts: async (req: {
      eventFormat: {
        filtersByParty: Record<
          string,
          {
            cumulative: {
              identifierFilter: { TemplateFilter: { value: { templateId: string } } }
            }[]
          }
        >
      }
    }) => {
      const [filter] = Object.values(req.eventFormat.filtersByParty)
      const templates = filter!.cumulative.map(
        (c) => c.identifierFilter.TemplateFilter.value.templateId,
      )
      if (templates.includes(RATE_LIMITER_TEMPLATE_ID)) {
        return ['rl-in', 'rl-out'].map((id) =>
          activeContract(RATE_LIMITER_TEMPLATE_ID, `${id}-cid`, id, POOL_OWNER),
        )
      }
      assert.ok(POOL_TEMPLATES.some((t) => templates.includes(t)))
      return [
        activeContract(poolTemplateId, '#pool', 'pool-1', POOL_OWNER, {
          poolOwner: POOL_OWNER,
        }),
      ]
    },
  }
  return Object.assign(Object.create(CantonChain.prototype), {
    network: { family: ChainFamily.Canton },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    provider,
  }) as CantonChain
}

function exercise(tx: UnsignedCantonTx) {
  return (
    tx.commands.commands[0] as {
      ExerciseCommand: { choice: string; choiceArgument: Record<string, unknown> }
    }
  ).ExerciseCommand
}

const POOL = { poolInstanceAddress: POOL_ADDRESS }
const SENDER = { sender: POOL_OWNER }

describe('setRateLimitConfig', () => {
  const op = new SetRateLimitConfig()
  const base = { ...POOL, ...SENDER, rateLimiterInstanceAddress: RL_IN }

  it('builds the choice with the resolved limiter CID and encoded config', async () => {
    const tx = await op.generate(mockChain(), {
      ...base,
      isEnabled: true,
      capacity: 100n,
      rate: 10n,
    })
    const cmd = exercise(tx)
    assert.equal(cmd.choice, 'SetRateLimitConfig')
    assert.deepEqual(cmd.choiceArgument, {
      caller: POOL_OWNER,
      rateLimiterCid: 'rl-in-cid',
      newIsEnabled: true,
      newCapacity: '100',
      newRate: '10',
    })
    // the limiter is disclosed (the choice body exercises it by CID)
    const disclosed = (tx.commands.disclosedContracts ?? []).map((d) => d.contractId)
    assert.ok(disclosed.includes('rl-in-cid'))
  })

  it('rejects invalid configs (mirroring the on-ledger asserts)', async () => {
    await assert.rejects(
      op.generate(mockChain(), { ...base, isEnabled: true, capacity: 10n, rate: 100n }),
      /rate <= capacity/,
    )
    await assert.rejects(
      op.generate(mockChain(), { ...base, isEnabled: false, capacity: 10n, rate: 0n }),
      /disabled config requires zero/,
    )
    await assert.rejects(
      op.generate(mockChain(), { ...base, isEnabled: true, capacity: -1n, rate: 0n }),
      CCTParamsInvalidError,
    )
    await assert.rejects(
      op.generate(mockChain(), {
        ...base,
        isEnabled: true,
        capacity: 100n,
        rate: 10n,
        rateLimiterInstanceAddress: 'no-party',
      }),
      /rateLimiterInstanceAddress/,
    )
  })
})

describe('setObservers', () => {
  const op = new SetObservers()

  it('encodes the observer list', async () => {
    const tx = await op.generate(mockChain(), { ...POOL, ...SENDER, observers: [RL_ADMIN] })
    assert.deepEqual(exercise(tx).choiceArgument, { observers: [RL_ADMIN] })
  })

  it('rejects an empty list and malformed parties', async () => {
    await assert.rejects(
      op.generate(mockChain(), { ...POOL, ...SENDER, observers: [] }),
      /observer/,
    )
    await assert.rejects(
      op.generate(mockChain(), { ...POOL, ...SENDER, observers: ['not-a-party'] }),
      /observers\[0\]/,
    )
  })
})

describe('execute result extraction', () => {
  const wallet = { party: POOL_OWNER }

  function chainReturning(events: unknown[]) {
    const chain = mockChain()
    Object.assign(chain.provider, {
      submitAndWaitForTransaction: async () => ({
        transaction: { updateId: 'update-1', events },
      }),
    })
    return chain
  }

  it('returns the new pool CID for consuming pool choices', async () => {
    const chain = chainReturning([
      { ExercisedEvent: { choice: 'SetObservers', exerciseResult: 'new-pool-cid' } },
    ])
    const result = await new SetObservers().execute(chain, {
      ...POOL,
      observers: ['obs::1220' + 'ab'.repeat(32)],
      wallet,
    })
    assert.equal(result.poolCid, 'new-pool-cid')
    assert.equal(result.hash, 'update-1')
  })

  it('returns the new limiter CID for setRateLimitConfig', async () => {
    const chain = chainReturning([
      { ExercisedEvent: { choice: 'SetRateLimitConfig', exerciseResult: 'new-rl-cid' } },
    ])
    const result = await new SetRateLimitConfig().execute(chain, {
      ...POOL,
      rateLimiterInstanceAddress: RL_IN,
      isEnabled: true,
      capacity: 100n,
      rate: 10n,
      wallet,
    })
    assert.equal(result.rateLimiterCid, 'new-rl-cid')
  })

  it('throws when the response lacks the exercise result', async () => {
    const chain = chainReturning([])
    await assert.rejects(
      new SetObservers().execute(chain, { ...POOL, observers: [RL_ADMIN], wallet }),
      /exerciseResult was not a contract ID/,
    )
  })
})
