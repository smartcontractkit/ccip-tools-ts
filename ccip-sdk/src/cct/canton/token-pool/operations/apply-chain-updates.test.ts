/**
 * Unit tests for the Canton CCT `applyChainUpdates` operation: pool resolution
 * by InstanceAddress alone (real `CantonChain` lookup over a stubbed ACS),
 * remote-address parsing, and rate-limiter validation.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// registers the chain families remote addresses are parsed as
import '../../../../evm/index.ts'
import '../../../../solana/index.ts'
import { hashedRawInstanceAddress } from '../../../../canton/ccv-addresses.ts'
import { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import type { ChainUpdateArg } from '../../daml-types.ts'
import { BURN_MINT_POOL_TEMPLATE_ID, LOCK_RELEASE_POOL_TEMPLATE_ID } from '../shared.ts'
import { type ChainUpdate, ApplyChainUpdates } from './apply-chain-updates.ts'

const POOL_OWNER = `poolOwner::1220${'ab'.repeat(32)}`
const POOL_ADDRESS = `pool-1@${POOL_OWNER}`
const RL_IN = `pool-1-rl-in@${POOL_OWNER}`
const RL_OUT = `pool-1-rl-out@${POOL_OWNER}`

const EVM_SELECTOR = 16015286601757825753n // ethereum-testnet-sepolia
const SOLANA_SELECTOR = 16423721717087811551n // solana-devnet
const EVM_ADDRESS = '0x36e518336a67177cb102726C2DFa3D29B12f4C7b' // checksummed
const EVM_STORED = '00000000000000000000000036e518336a67177cb102726c2dfa3d29b12f4c7b'
const SOLANA_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SOLANA_STORED = '6752055c20b3e9d8746656ddf73855507f87ab6d87523e4c76a7fa36096a99eb'

/** A real `CantonChain` whose ACS holds one pool of `templateId`; records each query's templates. */
function chainWith(templateId = BURN_MINT_POOL_TEMPLATE_ID) {
  const queries: string[][] = []
  type Filter = { identifierFilter: { TemplateFilter: { value: { templateId: string } } } }
  const provider = {
    getLedgerEnd: async () => ({ offset: 1 }),
    getActiveContracts: async (req: {
      eventFormat: { filtersByParty: Record<string, { cumulative: Filter[] }> }
    }) => {
      const [filter] = Object.values(req.eventFormat.filtersByParty)
      queries.push(
        filter!.cumulative.map((c) => c.identifierFilter.TemplateFilter.value.templateId),
      )
      const createdEvent = {
        contractId: '#pool',
        templateId,
        createdEventBlob: 'blob',
        signatories: [POOL_OWNER],
        createArgument: { instanceId: 'pool-1' },
      }
      return [{ contractEntry: { JsActiveContract: { synchronizerId: 'sync', createdEvent } } }]
    },
  }
  const chain = Object.assign(Object.create(CantonChain.prototype), {
    network: { family: ChainFamily.Canton },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    provider,
  }) as CantonChain
  return { chain, queries }
}

/** Generates an update adding one EVM lane, overridden by `update`. */
const generate = (update: Partial<ChainUpdate> = {}) =>
  new ApplyChainUpdates().generate(chainWith().chain, {
    sender: POOL_OWNER,
    poolInstanceAddress: POOL_ADDRESS,
    chainsToAdd: [
      {
        remoteChainSelector: EVM_SELECTOR,
        remotePools: [EVM_ADDRESS],
        remoteTokenAddress: EVM_ADDRESS,
        inboundRateLimiter: RL_IN,
        outboundRateLimiter: RL_OUT,
        ...update,
      },
    ],
  })

function exercise(tx: UnsignedCantonTx) {
  return (
    tx.commands.commands[0] as {
      ExerciseCommand: { templateId: string; choiceArgument: { chainsToAdd: ChainUpdateArg[] } }
    }
  ).ExerciseCommand
}

describe('applyChainUpdates pool resolution', () => {
  const hash = hashedRawInstanceAddress(POOL_ADDRESS)
  const BURN_MINT = 'deadbeef:CCIP.Registry.BurnMintTokenPoolV2:BurnMintTokenPool'
  const LOCK_RELEASE = 'cafebabe:CCIP.Registry.LockReleaseTokenPoolV2:LockReleaseTokenPool'
  for (const [label, templateId, poolInstanceAddress] of [
    ['a burn-mint pool by raw address', BURN_MINT, POOL_ADDRESS],
    ['a lock-release pool by 0x-prefixed hashed address', LOCK_RELEASE, '0x' + hash],
    ['a lock-release pool by bare upper-case hashed address', LOCK_RELEASE, hash.toUpperCase()],
  ] as const) {
    it(`resolves ${label}`, async () => {
      const { chain, queries } = chainWith(templateId)
      const tx = await new ApplyChainUpdates().generate(chain, {
        sender: POOL_OWNER,
        poolInstanceAddress,
        remoteChainSelectorsToRemove: [EVM_SELECTOR],
      })

      // one ACS query over both pool templates; the matched one is exercised
      assert.deepEqual(queries, [[BURN_MINT_POOL_TEMPLATE_ID, LOCK_RELEASE_POOL_TEMPLATE_ID]])
      assert.equal(exercise(tx).templateId, templateId)
    })
  }
})

describe('applyChainUpdates lane params', () => {
  for (const [label, update, stored] of [
    ['a checksummed EVM address', {}, EVM_STORED],
    ['a lower-case unprefixed EVM address', { remotePools: [EVM_STORED.slice(24)] }, EVM_STORED],
    [
      'a Solana base58 pool and hex token',
      {
        remoteChainSelector: SOLANA_SELECTOR,
        remotePools: [SOLANA_ADDRESS],
        remoteTokenAddress: '0x' + SOLANA_STORED,
      },
      SOLANA_STORED,
    ],
  ] as Array<[string, Partial<ChainUpdate>, string]>) {
    it(`stores ${label} as 32-byte bare hex`, async () => {
      const [lane] = exercise(await generate(update)).choiceArgument.chainsToAdd
      assert.deepEqual([lane!.remotePools, lane!.remoteTokenAddress], [[stored], stored])
    })
  }

  const fasterThanFinality = /inboundCustomBlockConfirmationsRateLimiter".*faster than finality/
  for (const [label, update, error] of [
    ['a Solana pool on an EVM lane', { remotePools: [SOLANA_ADDRESS] }, /remotePools\[0\]".*EVM/],
    [
      'an EVM token on a Solana lane',
      { remoteChainSelector: SOLANA_SELECTOR, remotePools: [SOLANA_ADDRESS] },
      /remoteTokenAddress".*SVM/,
    ],
    ['two spellings of one pool', { remotePools: [EVM_ADDRESS, EVM_STORED] }, /\[1\]".*duplicate/],
    ['a hashed rate limiter', { outboundRateLimiter: '0x' + 'ab'.repeat(32) }, /raw instance/],
    [
      'WaitForSafe without a custom limiter',
      { finalityConfig: { type: 'WaitForSafe' } },
      fasterThanFinality,
    ],
    [
      'BlockDepth without a custom limiter',
      { finalityConfig: { type: 'BlockDepth', blockConfirmations: 5 } },
      fasterThanFinality,
    ],
  ] as Array<[string, Partial<ChainUpdate>, RegExp]>) {
    it(`rejects ${label}`, async () => {
      await assert.rejects(generate(update), error)
    })
  }

  for (const [finalityConfig, limiter] of [
    [undefined, undefined],
    [{ type: 'BlockDepth', blockConfirmations: 5 }, `pool-1-rl-in-custom@${POOL_OWNER}`],
  ] as const) {
    it(`encodes the custom limiter for ${finalityConfig?.type ?? 'WaitForFinality'}`, async () => {
      const update = { finalityConfig, inboundCustomBlockConfirmationsRateLimiter: limiter }
      const [lane] = exercise(await generate(update)).choiceArgument.chainsToAdd
      assert.deepEqual(lane!.inboundCustomBlockConfirmationsRateLimiter, { unpack: limiter ?? '' })
    })
  }
})
