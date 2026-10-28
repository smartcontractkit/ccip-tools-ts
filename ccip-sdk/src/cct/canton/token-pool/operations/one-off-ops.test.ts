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
import { ApplyTokenTransferFeeConfigUpdates } from './apply-token-transfer-fee-config-updates.ts'
import {
  AddPoolReceiveContextContractValue,
  AddPoolReceiveContextValue,
  ClearPoolReceiveContext,
  RemovePoolReceiveContextValue,
} from './pool-receive-context.ts'
import { SetDynamicConfig } from './set-dynamic-config.ts'
import { SetPoolReceiveMetadata } from './set-pool-receive-metadata.ts'
import { SetObservers } from './set-observers.ts'
import { SetRateLimitConfig } from './set-rate-limit-config.ts'
import { SetRateLimiterObservers } from './set-rate-limiter-observers.ts'
import { SetRateLimiterReferences } from './set-rate-limiter-references.ts'
import { SetTransferTimeout } from './set-transfer-timeout.ts'

const fp = (hex: string) => '1220' + hex.repeat(32)
const POOL_OWNER = `poolOwner::${fp('ab')}`
const RL_ADMIN = `rateAdmin::${fp('cd')}`
const POOL_ADDRESS = `pool-1@${POOL_OWNER}`
const RL_IN = `rl-in@${POOL_OWNER}`
const RL_OUT = `rl-out@${POOL_OWNER}`
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

describe('setRateLimiterReferences', () => {
  const op = new SetRateLimiterReferences()
  const update = {
    remoteChainSelector: 1n,
    inboundRateLimiter: RL_IN,
    outboundRateLimiter: RL_OUT,
  }

  it('encodes per-lane reference updates', async () => {
    const tx = await op.generate(mockChain(), {
      ...POOL,
      ...SENDER,
      rateLimitConfigArgs: [update],
    })
    const cmd = exercise(tx)
    assert.equal(cmd.choice, 'SetRateLimiterReferences')
    assert.deepEqual(cmd.choiceArgument, {
      rateLimitConfigArgs: [
        {
          remoteChainSelector: '1',
          inboundRateLimiter: { unpack: RL_IN },
          inboundCustomBlockConfirmationsRateLimiter: { unpack: '' },
          outboundRateLimiter: { unpack: RL_OUT },
        },
      ],
    })
  })

  it('rejects an empty update list and identical inbound/outbound limiters', async () => {
    await assert.rejects(
      op.generate(mockChain(), { ...POOL, ...SENDER, rateLimitConfigArgs: [] }),
      /at least one update/,
    )
    await assert.rejects(
      op.generate(mockChain(), {
        ...POOL,
        ...SENDER,
        rateLimitConfigArgs: [{ ...update, outboundRateLimiter: RL_IN }],
      }),
      /must be distinct/,
    )
  })
})

describe('setRateLimiterObservers', () => {
  const op = new SetRateLimiterObservers()

  it('exercises SetObservers directly on the limiter contract', async () => {
    const tx = await op.generate(mockChain(), {
      ...SENDER,
      rateLimiterInstanceAddress: RL_IN,
      observers: [RL_ADMIN],
    })
    const cmd = exercise(tx)
    assert.equal(cmd.choice, 'SetObservers')
    assert.deepEqual(cmd.choiceArgument, { observers: [RL_ADMIN] })
    assert.equal(
      (tx.commands.commands[0] as { ExerciseCommand: { contractId: string } }).ExerciseCommand
        .contractId,
      'rl-in-cid',
    )
  })

  it('rejects a sender other than the limiter owner', async () => {
    await assert.rejects(
      op.generate(mockChain(), {
        sender: RL_ADMIN,
        rateLimiterInstanceAddress: RL_IN,
        observers: [RL_ADMIN],
      }),
      /must be the sender/,
    )
  })
})

describe('setTransferTimeout', () => {
  const op = new SetTransferTimeout()

  it('encodes Indefinite and RelativeHours', async () => {
    const indefinite = await op.generate(mockChain(), {
      ...POOL,
      ...SENDER,
      transferTimeout: { type: 'Indefinite' },
    })
    assert.deepEqual(exercise(indefinite).choiceArgument, {
      newTransferTimeout: { tag: 'Indefinite', value: {} },
    })

    const relative = await op.generate(mockChain(), {
      ...POOL,
      ...SENDER,
      transferTimeout: { type: 'RelativeHours', hours: 24 },
    })
    assert.deepEqual(exercise(relative).choiceArgument, {
      newTransferTimeout: { tag: 'RelativeHours', value: '24' },
    })
  })

  it('rejects negative or out-of-Daml-Int RelativeHours', async () => {
    for (const hours of [-1, 1.5, 9223372036854775808n]) {
      await assert.rejects(
        op.generate(mockChain(), {
          ...POOL,
          ...SENDER,
          transferTimeout: { type: 'RelativeHours', hours },
        }),
        /transferTimeout/,
      )
    }
  })
})

describe('setPoolReceiveMetadata', () => {
  const op = new SetPoolReceiveMetadata()

  it('encodes the metadata labels', async () => {
    const tx = await op.generate(mockChain(LOCK_RELEASE_POOL_TEMPLATE_ID), {
      ...POOL,
      ...SENDER,
      metadata: { 'cip-112/receiver.id': 'ccip-public' },
    })
    assert.equal(exercise(tx).choice, 'SetPoolReceiveMetadata')
    assert.deepEqual(exercise(tx).choiceArgument, {
      metadata: { values: { 'cip-112/receiver.id': 'ccip-public' } },
    })
  })

  it('rejects burn-mint pools and empty metadata', async () => {
    await assert.rejects(
      op.generate(mockChain(), {
        ...POOL,
        ...SENDER,
        metadata: { 'cip-112/receiver.id': 'ccip-public' },
      }),
      /lock-release/,
    )
    await assert.rejects(
      op.generate(mockChain(LOCK_RELEASE_POOL_TEMPLATE_ID), { ...POOL, ...SENDER, metadata: {} }),
      /metadata/,
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

describe('setDynamicConfig', () => {
  const op = new SetDynamicConfig()

  it('sets and clears the rate-limit admin', async () => {
    const set = await op.generate(mockChain(), { ...POOL, ...SENDER, rateLimitAdmin: RL_ADMIN })
    assert.deepEqual(exercise(set).choiceArgument, { rateLimitAdmin: RL_ADMIN })

    const cleared = await op.generate(mockChain(), { ...POOL, ...SENDER, rateLimitAdmin: null })
    assert.deepEqual(exercise(cleared).choiceArgument, { rateLimitAdmin: null })
  })
})

describe('applyTokenTransferFeeConfigUpdates', () => {
  const op = new ApplyTokenTransferFeeConfigUpdates()
  const config = {
    destChainSelector: 1n,
    destGasOverhead: 100_000,
    destBytesOverhead: 32,
    feeUSDCents: 50n,
    feeBps: 5n,
  }

  it('encodes updates (always enabled) and disable selectors', async () => {
    const tx = await op.generate(mockChain(), {
      ...POOL,
      ...SENDER,
      tokenTransferFeeConfigArgs: [config],
      disableTokenTransferFeeConfigArgs: [2n],
    })
    assert.deepEqual(exercise(tx).choiceArgument, {
      tokenTransferFeeConfigArgs: [
        {
          destChainSelector: '1',
          isEnabled: true,
          destGasOverhead: '100000',
          destBytesOverhead: '32',
          feeUSDCents: '50',
          feeBps: '5',
        },
      ],
      disableTokenTransferFeeConfigArgs: ['2'],
    })
  })

  it('rejects empty params and negative fees', async () => {
    await assert.rejects(op.generate(mockChain(), { ...POOL, ...SENDER }), /at least one of/)
    await assert.rejects(
      op.generate(mockChain(), {
        ...POOL,
        ...SENDER,
        tokenTransferFeeConfigArgs: [{ ...config, feeBps: -1n }],
      }),
      /non-negative/,
    )
  })
})

describe('pool receive-context ops', () => {
  it('encodes scalar values as AnyValue variants', async () => {
    const op = new AddPoolReceiveContextValue()
    const cases = [
      ['text', { tag: 'AV_Text', value: 'text' }],
      [7n, { tag: 'AV_Int', value: '7' }],
      [7, { tag: 'AV_Int', value: '7' }],
      [1.5, { tag: 'AV_Decimal', value: '1.5' }],
      [true, { tag: 'AV_Bool', value: true }],
    ] as const
    for (const [value, expected] of cases) {
      const tx = await op.generate(mockChain(), { ...POOL, ...SENDER, contextKey: 'k', value })
      assert.equal(exercise(tx).choice, 'AddPoolReceiveContextNonContractValue')
      assert.deepEqual(exercise(tx).choiceArgument, { contextKey: 'k', value: expected })
    }
  })

  it('passes the contract ID through for contract values', async () => {
    const tx = await new AddPoolReceiveContextContractValue().generate(mockChain(), {
      ...POOL,
      ...SENDER,
      contextKey: 'preapproval',
      referredContract: '00cafe',
    })
    assert.equal(exercise(tx).choice, 'AddPoolReceiveContextContractValue')
    assert.deepEqual(exercise(tx).choiceArgument, {
      contextKey: 'preapproval',
      referredContract: '00cafe',
    })
  })

  it('removes and clears entries', async () => {
    const removed = await new RemovePoolReceiveContextValue().generate(mockChain(), {
      ...POOL,
      ...SENDER,
      contextKey: 'k',
    })
    assert.equal(exercise(removed).choice, 'RemovePoolReceiveContextValue')
    assert.deepEqual(removed.commands.disclosedContracts?.length, 1)

    const cleared = await new ClearPoolReceiveContext().generate(mockChain(), {
      ...POOL,
      ...SENDER,
    })
    assert.equal(exercise(cleared).choice, 'ClearPoolReceiveContext')
    assert.deepEqual(exercise(cleared).choiceArgument, {})
  })

  it('requires a context key', async () => {
    await assert.rejects(
      new RemovePoolReceiveContextValue().generate(mockChain(), {
        ...POOL,
        ...SENDER,
        contextKey: '',
      }),
      /contextKey/,
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
      { ExercisedEvent: { choice: 'SetTransferTimeout', exerciseResult: 'new-pool-cid' } },
    ])
    const result = await new SetTransferTimeout().execute(chain, {
      ...POOL,
      transferTimeout: { type: 'Indefinite' },
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
