/**
 * Unit tests for the Canton CCT `applyChainUpdates` operation: pool resolution
 * by InstanceAddress alone (either pool type), remote-address parsing in the
 * remote chain's own format + on-ledger encoding, and rate-limiter validation —
 * built against an ACS-backed {@link CantonChain} mock (see
 * `acs.test.helpers.ts`), no live participant required.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// registers the EVM and Solana chain families remote addresses are parsed as
import '../../../../evm/index.ts'
import '../../../../solana/index.ts'
import { hashedRawInstanceAddress } from '../../../../canton/ccv-addresses.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { type AcsContract, acsChain, requestedTemplateIds } from '../../acs.test.helpers.ts'
import type { ChainUpdateArg } from '../../daml-types.ts'
import { BURN_MINT_POOL_TEMPLATE_ID, LOCK_RELEASE_POOL_TEMPLATE_ID } from '../shared.ts'
import {
  type ChainUpdate,
  type GenerateApplyChainUpdatesParams,
  ApplyChainUpdates,
} from './apply-chain-updates.ts'

const POOL_OWNER = `poolOwner::1220${'ab'.repeat(32)}`
const POOL_INSTANCE_ID = 'pool-1'
const POOL_ADDRESS = `${POOL_INSTANCE_ID}@${POOL_OWNER}`
const BURN_MINT_CONCRETE = 'deadbeef:CCIP.Registry.BurnMintTokenPoolV2:BurnMintTokenPool'
const LOCK_RELEASE_CONCRETE = 'cafebabe:CCIP.Registry.LockReleaseTokenPoolV2:LockReleaseTokenPool'

const RL_IN = `pool-1-rl-in@${POOL_OWNER}`
const RL_OUT = `pool-1-rl-out@${POOL_OWNER}`
const RL_IN_CUSTOM = `pool-1-rl-in-custom@${POOL_OWNER}`

const EVM_SELECTOR = 16015286601757825753n // ethereum-testnet-sepolia
const SOLANA_SELECTOR = 16423721717087811551n // solana-devnet
/** A 20-byte EVM address, checksummed, and as the pool stores it (the pre-parser encoding). */
const EVM_ADDRESS = '0x36e518336a67177cb102726C2DFa3D29B12f4C7b'
const EVM_STORED = '00000000000000000000000036e518336a67177cb102726c2dfa3d29b12f4c7b'
/** One Solana key, as base58 and as its 32 raw bytes (how the pool stores it). */
const SOLANA_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SOLANA_STORED = '6752055c20b3e9d8746656ddf73855507f87ab6d87523e4c76a7fa36096a99eb'

function pool(templateId: string, contractId = '#pool-cid'): AcsContract {
  return {
    contractId,
    templateId,
    createdEventBlob: 'pool-blob',
    synchronizerId: 'sync-1',
    signatories: [POOL_OWNER],
    createArgument: { instanceId: POOL_INSTANCE_ID, poolOwner: POOL_OWNER },
  }
}

function chainUpdate(overrides: Partial<ChainUpdate> = {}): ChainUpdate {
  return {
    remoteChainSelector: EVM_SELECTOR,
    remotePools: [EVM_ADDRESS],
    remoteTokenAddress: EVM_ADDRESS,
    inboundRateLimiter: RL_IN,
    outboundRateLimiter: RL_OUT,
    ...overrides,
  }
}

function params(
  overrides: Partial<GenerateApplyChainUpdatesParams> = {},
): GenerateApplyChainUpdatesParams {
  return {
    sender: POOL_OWNER,
    poolInstanceAddress: POOL_ADDRESS,
    chainsToAdd: [chainUpdate()],
    ...overrides,
  }
}

/** Extract the `ExerciseCommand` from a generated unsigned tx. */
function exercise(tx: UnsignedCantonTx) {
  const command = tx.commands.commands[0] as {
    ExerciseCommand: {
      templateId: string
      contractId: string
      choice: string
      choiceArgument: { remoteChainSelectorsToRemove: string[]; chainsToAdd: ChainUpdateArg[] }
    }
  }
  return command.ExerciseCommand
}

/** Asserts `promise` rejects with a {@link CCTParamsInvalidError} blaming `param`. */
async function rejectsParam(promise: Promise<unknown>, param: string, reason?: RegExp) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof CCTParamsInvalidError)
    assert.equal(err.context.param, param)
    if (reason) assert.match(String(err.context.reason), reason)
    return true
  })
}

describe('applyChainUpdates pool resolution', () => {
  const op = new ApplyChainUpdates()

  for (const [poolType, concrete] of [
    ['burn-mint', BURN_MINT_CONCRETE],
    ['lock-release', LOCK_RELEASE_CONCRETE],
  ] as const) {
    it(`resolves a ${poolType} pool by address alone and exercises its concrete template`, async () => {
      const { chain, requests } = acsChain([pool(concrete)])

      const tx = await op.generate(chain, params())

      assert.equal(requests.length, 1)
      assert.deepEqual(requestedTemplateIds(requests[0]!).sort(), [
        BURN_MINT_POOL_TEMPLATE_ID,
        LOCK_RELEASE_POOL_TEMPLATE_ID,
      ])
      const { templateId, contractId, choice } = exercise(tx)
      assert.equal(templateId, concrete)
      assert.equal(contractId, '#pool-cid')
      assert.equal(choice, 'ApplyChainUpdates')
      assert.deepEqual(tx.commands.actAs, [POOL_OWNER])
      assert.equal(tx.commands.disclosedContracts?.[0]?.templateId, concrete)
    })
  }

  it('resolves the hashed 0x form of the pool address', async () => {
    const { chain } = acsChain([pool(BURN_MINT_CONCRETE)])

    const tx = await op.generate(
      chain,
      params({ poolInstanceAddress: '0x' + hashedRawInstanceAddress(POOL_ADDRESS) }),
    )

    assert.equal(exercise(tx).contractId, '#pool-cid')
  })

  it('throws when the address matches pools of both types', async () => {
    const { chain } = acsChain([pool(BURN_MINT_CONCRETE), pool(LOCK_RELEASE_CONCRETE, '#pool-2')])

    await assert.rejects(op.generate(chain, params()), /multiple active contracts match/)
  })

  it('throws when the pool is not visible to the sender', async () => {
    const { chain } = acsChain([pool(BURN_MINT_CONCRETE)])

    await rejectsParam(
      op.generate(chain, params({ sender: `other::1220${'cd'.repeat(32)}` })),
      'poolInstanceAddress',
      /not active or not visible/,
    )
  })

  it('needs no remote parsing for a removal-only update', async () => {
    const { chain } = acsChain([pool(BURN_MINT_CONCRETE)])

    const tx = await op.generate(
      chain,
      params({ chainsToAdd: undefined, remoteChainSelectorsToRemove: [2n ** 63n] }),
    )

    assert.deepEqual(exercise(tx).choiceArgument, {
      remoteChainSelectorsToRemove: [(2n ** 63n).toString()],
      chainsToAdd: [],
    })
  })
})

describe('applyChainUpdates remote addresses', () => {
  const op = new ApplyChainUpdates()
  const generate = (update: Partial<ChainUpdate>) =>
    op.generate(
      acsChain([pool(BURN_MINT_CONCRETE)]).chain,
      params({ chainsToAdd: [chainUpdate(update)] }),
    )
  const lane = async (update: Partial<ChainUpdate>) =>
    exercise(await generate(update)).choiceArgument.chainsToAdd[0]!

  it('stores already-valid lower-case hex exactly as before (32-byte padded bare hex)', async () => {
    for (const spelling of [EVM_STORED.slice(24), '0x' + EVM_STORED.slice(24), EVM_STORED]) {
      const { remotePools, remoteTokenAddress } = await lane({
        remotePools: [spelling],
        remoteTokenAddress: spelling,
      })
      assert.deepEqual(remotePools, [EVM_STORED])
      assert.equal(remoteTokenAddress, EVM_STORED)
    }
  })

  it('accepts EVM addresses checksummed, upper-case or unprefixed, stored lower-cased', async () => {
    for (const spelling of [
      EVM_ADDRESS,
      '0x' + EVM_ADDRESS.slice(2).toUpperCase(),
      EVM_ADDRESS.slice(2).toLowerCase(),
    ]) {
      const { remotePools, remoteTokenAddress } = await lane({
        remotePools: [spelling],
        remoteTokenAddress: spelling,
      })
      assert.deepEqual(remotePools, [EVM_STORED])
      assert.equal(remoteTokenAddress, EVM_STORED)
    }
  })

  it('rejects a mixed-case EVM address with a bad checksum', async () => {
    await rejectsParam(
      generate({ remoteTokenAddress: EVM_ADDRESS.replace('C2DF', 'c2df') }),
      'chainsToAdd[0].remoteTokenAddress',
      /valid EVM address/,
    )
  })

  it('accepts a Solana remote as base58 or hex, stored as its 32 key bytes', async () => {
    const { remotePools, remoteTokenAddress, remoteChainSelector } = await lane({
      remoteChainSelector: SOLANA_SELECTOR,
      remotePools: [SOLANA_ADDRESS],
      remoteTokenAddress: '0x' + SOLANA_STORED,
    })
    assert.equal(remoteChainSelector, SOLANA_SELECTOR.toString())
    assert.deepEqual(remotePools, [SOLANA_STORED])
    assert.equal(remoteTokenAddress, SOLANA_STORED)
  })

  it('rejects a Solana pool on an EVM lane, blaming chainsToAdd[i].remotePools[j]', async () => {
    await rejectsParam(
      generate({ remotePools: [EVM_ADDRESS, SOLANA_ADDRESS] }),
      'chainsToAdd[0].remotePools[1]',
      /valid EVM address/,
    )
  })

  it('rejects an EVM token on a Solana lane, blaming chainsToAdd[i].remoteTokenAddress', async () => {
    await rejectsParam(
      generate({
        remoteChainSelector: SOLANA_SELECTOR,
        remotePools: [SOLANA_ADDRESS],
        remoteTokenAddress: EVM_ADDRESS,
      }),
      'chainsToAdd[0].remoteTokenAddress',
      /valid SVM address/,
    )
  })

  it('rejects duplicate remote pools, compared by canonical spelling', async () => {
    await rejectsParam(
      generate({ remotePools: [EVM_ADDRESS, EVM_STORED] }),
      'chainsToAdd[0].remotePools[1]',
      /duplicate/,
    )
  })

  it('rejects a remote address for an unknown chain selector', async () => {
    await rejectsParam(
      generate({ remoteChainSelector: 2n ** 63n }),
      'chainsToAdd[0].remoteTokenAddress',
      /not a known chain selector/,
    )
  })

  it('rejects the zero address', async () => {
    await rejectsParam(
      generate({ remotePools: ['0x' + '00'.repeat(20)] }),
      'chainsToAdd[0].remotePools[0]',
      /zero address/,
    )
  })
})

describe('applyChainUpdates rate limiters', () => {
  const op = new ApplyChainUpdates()
  const generate = (update: Partial<ChainUpdate>) =>
    op.generate(
      acsChain([pool(BURN_MINT_CONCRETE)]).chain,
      params({ chainsToAdd: [chainUpdate(update)] }),
    )

  for (const finalityConfig of [
    { type: 'WaitForSafe' },
    { type: 'BlockDepth', blockConfirmations: 5 },
  ] as const) {
    it(`requires the custom-block-confirmations limiter for ${finalityConfig.type} finality`, async () => {
      await rejectsParam(
        generate({ finalityConfig }),
        'chainsToAdd[0].inboundCustomBlockConfirmationsRateLimiter',
        /faster than finality/,
      )
    })
  }

  it('encodes the custom-block-confirmations limiter when finality is faster', async () => {
    const tx = await generate({
      finalityConfig: { type: 'BlockDepth', blockConfirmations: 5 },
      inboundCustomBlockConfirmationsRateLimiter: RL_IN_CUSTOM,
    })
    const lane = exercise(tx).choiceArgument.chainsToAdd[0]!
    assert.deepEqual(lane.finalityConfig, { tag: 'BlockDepth', value: '5' })
    assert.deepEqual(lane.inboundCustomBlockConfirmationsRateLimiter, { unpack: RL_IN_CUSTOM })
  })

  it('lets WaitForFinality omit the custom limiter, stored empty', async () => {
    const lane = exercise(await generate({})).choiceArgument.chainsToAdd[0]!
    assert.deepEqual(lane.finalityConfig, { tag: 'WaitForFinality', value: {} })
    assert.deepEqual(lane.inboundCustomBlockConfirmationsRateLimiter, { unpack: '' })
  })

  it('rejects a rate limiter that is not a raw instance address', async () => {
    await rejectsParam(
      generate({ outboundRateLimiter: '0x' + 'ab'.repeat(32) }),
      'chainsToAdd[0].outboundRateLimiter',
      /raw instance address/,
    )
    await rejectsParam(
      generate({ inboundCustomBlockConfirmationsRateLimiter: 'rl@not-a-party' }),
      'chainsToAdd[0].inboundCustomBlockConfirmationsRateLimiter',
    )
  })

  it('rejects identical inbound and outbound limiters', async () => {
    await rejectsParam(
      generate({ outboundRateLimiter: RL_IN }),
      'chainsToAdd[0].outboundRateLimiter',
      /distinct/,
    )
  })
})
