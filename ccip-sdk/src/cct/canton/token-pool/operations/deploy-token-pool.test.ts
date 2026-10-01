/**
 * Unit tests for the Canton CCT `deployTokenPool` operation: validation, deps
 * resolution (explicit overrides vs well-known per-network contracts), the
 * derived params (pool owner, ccipOwner, admin, existing TokenConfig), lane
 * remote-address parsing, and the `CreateAndExerciseCommand` shape built
 * against a mocked {@link CantonChain} — no live participant required.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// registers the EVM and Solana chain families lane remote addresses are parsed as
import '../../../../evm/index.ts'
import '../../../../solana/index.ts'
import { hashedRawInstanceAddress } from '../../../../canton/ccv-addresses.ts'
import { type CantonActiveContract, CantonChain } from '../../../../canton/index.ts'
import { CANTON_NETWORKS } from '../../../../canton/networks.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import {
  TAR_TEMPLATE_ID,
  TOKEN_CONFIG_TEMPLATE_ID,
  deriveTokenConfigInstanceAddress,
} from '../../token-admin-registry/shared.ts'
import { BURN_MINT_POOL_TEMPLATE_ID, RATE_LIMITER_TEMPLATE_ID } from '../shared.ts'
import { type GenerateDeployTokenPoolParams, DeployTokenPool } from './deploy-token-pool.ts'

const fp = (hex: string) => '1220' + hex.repeat(32)
const POOL_OWNER = `poolOwner::${fp('ab')}`
const CCIP_OWNER = `ccipOwner::${fp('cd')}`
const OBSERVER = `observer::${fp('ef')}`
const ADMIN = `admin::${fp('99')}`
const TAR_CID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry:00abc'
const TOKEN_CONFIG_CID = '#token-config-1'
const OVERRIDE_TAR = `tokenadminregistry-override@${CCIP_OWNER}`
const OVERRIDE_FEE_QUOTER = `feequoter-override@${CCIP_OWNER}`
const OVERRIDE_RMN_REMOTE = `rmn_remote-override@rmnOwner::${fp('cd')}`
const INSTRUMENT_ID = { admin: POOL_OWNER, id: 'TESTTOKEN' }

const testNet = CANTON_NETWORKS['canton:TestNet']!

const EVM_SELECTOR = 16015286601757825753n // ethereum-testnet-sepolia
const SOLANA_SELECTOR = 16423721717087811551n // solana-devnet
/** Upper-case (un-checksummed) spelling — stored lower-cased. */
const EVM_POOL = '0x36E518336A67177CB102726C2DFA3D29B12F4C7B'
const EVM_TOKEN = '0x1234567890abcdef1234567890abcdef12345678'
/** One Solana key, as base58 and as its 32 raw bytes. */
const SOLANA_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SOLANA_HEX = '6752055c20b3e9d8746656ddf73855507f87ab6d87523e4c76a7fa36096a99eb'

const LANE_RATE_LIMITER = { instanceId: 'rl-in', isEnabled: true, capacity: 100n, rate: 1n }

/** A `findActiveContractByInstanceAddress` call the mock recorded. */
interface LookupCall {
  templateId: string
  instanceAddress: string
  parties: string[]
}

/**
 * `CantonChain` mock: no EDS disclosure provider (forces the ACS-fallback
 * branch of `resolveTar`). `findActiveContractByInstanceAddress` returns a fake
 * TAR signed by the raw address's owner suffix for the TAR template, and
 * `tokenConfig` (default: none) for the TokenConfig template; every call is
 * recorded in `calls`, every warning in `warnings`.
 */
function mockChain(
  chainId: string,
  opts: { tokenConfig?: CantonActiveContract; overrides?: Record<string, unknown> } = {},
): CantonChain & { calls: LookupCall[]; warnings: string[] } {
  const calls: LookupCall[] = []
  const warnings: string[] = []
  // Real CantonChain instance (private fields make object-literal casts
  // impossible); Object.assign overrides only what the test exercises.
  return Object.assign(Object.create(CantonChain.prototype), {
    network: { family: ChainFamily.Canton, chainId },
    ccipParty: CCIP_OWNER,
    logger: {
      debug: () => {},
      info: () => {},
      warn: (m: string) => warnings.push(m),
      error: () => {},
    },
    edsDisclosureProvider: undefined,
    calls,
    warnings,
    findActiveContractByInstanceAddress: async (
      templateId: string,
      instanceAddress: string,
      parties: string[],
    ) => {
      calls.push({ templateId, instanceAddress, parties })
      if (templateId === TAR_TEMPLATE_ID) {
        return {
          contractId: TAR_CID,
          createdEventBlob: 'blob',
          synchronizerId: 'sync-1',
          templateId: '#pkg-id:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry',
          signatories: [instanceAddress.slice(instanceAddress.indexOf('@') + 1)],
        }
      }
      if (templateId === TOKEN_CONFIG_TEMPLATE_ID) return opts.tokenConfig ?? null
      return null
    },
    ...opts.overrides,
  })
}

/** A TokenConfig contract; `admin` set means the instrument already completed admin setup. */
function tokenConfig(admin?: string): CantonActiveContract {
  return {
    contractId: TOKEN_CONFIG_CID,
    templateId: '#pkg-id:CCIP.CoreV2.TokenAdminRegistry:TokenConfig',
    createdEventBlob: 'token-config-blob',
    synchronizerId: 'sync-1',
    signatories: [testNet.ccipOwner],
    // natural JSON (JSON Ledger API): Optional Party is a bare string or null
    createArgument: { admin: admin ?? null, pendingAdmin: ADMIN },
  }
}

function baseParams(
  overrides?: Partial<GenerateDeployTokenPoolParams>,
): GenerateDeployTokenPoolParams {
  return {
    sender: POOL_OWNER,
    poolType: 'burnMint',
    instanceId: 'pool-1',
    instrumentId: INSTRUMENT_ID,
    decimals: 18,
    observers: [OBSERVER],
    lanes: [],
    ...overrides,
  }
}

/** A complete lane spec with the given remotes. */
function lane(remoteChainSelector: bigint, remotePools: string[], remoteTokenAddress: string) {
  return {
    remoteChainSelector,
    remotePools,
    remoteTokenAddress,
    inbound: LANE_RATE_LIMITER,
    outbound: { ...LANE_RATE_LIMITER, instanceId: 'rl-out' },
    inboundCustomFinality: { ...LANE_RATE_LIMITER, instanceId: 'rl-in-custom' },
  }
}

/** Extract the `CreateAndExerciseCommand` from a generated unsigned tx. */
function createAndExercise(tx: UnsignedCantonTx) {
  const command = tx.commands.commands[0] as {
    CreateAndExerciseCommand: {
      templateId: string
      createArguments: Record<string, unknown>
      choice: string
      choiceArgument: Record<string, unknown>
    }
  }
  return command.CreateAndExerciseCommand
}

/** Extract the `{unpack: raw}` deps record from a generated unsigned tx. */
function deployedDeps(tx: UnsignedCantonTx): Record<string, { unpack: string }> {
  return createAndExercise(tx).createArguments.deps as Record<string, { unpack: string }>
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

describe('deployTokenPool validation', () => {
  const op = new DeployTokenPool()

  it('rejects an empty observers list', async () => {
    await assert.rejects(
      () => op.generate(mockChain('canton:TestNet'), baseParams({ observers: [] })),
      (err: unknown) => {
        assert.ok(err instanceof CCTParamsInvalidError)
        assert.match(err.message, /observers/)
        return true
      },
    )
  })

  it('rejects a deps override that is not a raw instance address', async () => {
    await rejectsParam(
      op.generate(
        mockChain('canton:TestNet'),
        baseParams({ deps: { tokenAdminRegistry: '0x' + 'ab'.repeat(32) } }),
      ),
      'deps.tokenAdminRegistry',
      /raw instance address/,
    )
    await rejectsParam(
      op.generate(
        mockChain('canton:TestNet'),
        baseParams({ deps: { feeQuoter: 'feequoter@not-a-party' } }),
      ),
      'deps.feeQuoter',
    )
  })

  it('rejects an invalid admin party', async () => {
    await rejectsParam(
      op.generate(mockChain('canton:TestNet'), baseParams({ admin: 'admin' })),
      'admin',
    )
  })

  it('rejects a lane missing a rate-limiter spec', async () => {
    await assert.rejects(
      () =>
        op.generate(
          mockChain('canton:TestNet'),
          baseParams({
            lanes: [
              {
                remoteChainSelector: 1n,
                remotePools: [],
                remoteTokenAddress: '0xdead',
                inbound: LANE_RATE_LIMITER,
                outbound: LANE_RATE_LIMITER,
              } as never,
            ],
          }),
        ),
      (err: unknown) => {
        assert.ok(err instanceof CCTParamsInvalidError)
        assert.match(err.message, /inboundCustomFinality/)
        return true
      },
    )
  })
})

describe('deployTokenPool command building', () => {
  const op = new DeployTokenPool()

  it('builds a CreateAndExerciseCommand against the registry template with Initialize', async () => {
    const tx = await op.generate(mockChain('canton:TestNet'), baseParams())
    const { templateId, createArguments, choice, choiceArgument } = createAndExercise(tx)

    assert.match(templateId, /ccip-registry-burn-mint-token-pool/)
    assert.equal(choice, 'Initialize')
    assert.deepEqual(createArguments.observers, [OBSERVER])
    assert.equal(choiceArgument.tokenAdminRegistryCid, TAR_CID)
    assert.equal(choiceArgument.existingTokenConfigCid, null)
  })

  it('derives the pool owner from instrumentId.admin', async () => {
    const tx = await op.generate(
      mockChain('canton:TestNet'),
      baseParams({ instrumentId: `${POOL_OWNER}::TESTTOKEN` }),
    )
    const { createArguments } = createAndExercise(tx)
    assert.equal(createArguments.poolOwner, POOL_OWNER)
    assert.deepEqual(createArguments.instrumentId, INSTRUMENT_ID)
  })

  it('defaults admin to the pool owner, deduplicating actAs', async () => {
    const tx = await op.generate(mockChain('canton:TestNet'), baseParams())
    assert.equal(createAndExercise(tx).choiceArgument.admin, POOL_OWNER)
    assert.deepEqual(tx.commands.actAs, [POOL_OWNER])
  })

  it('includes both parties in actAs when admin differs from the pool owner', async () => {
    const tx = await op.generate(mockChain('canton:TestNet'), baseParams({ admin: ADMIN }))
    assert.equal(createAndExercise(tx).choiceArgument.admin, ADMIN)
    assert.deepEqual(tx.commands.actAs, [POOL_OWNER, ADMIN])
  })

  it('discloses the resolved TAR contract', async () => {
    const tx = await op.generate(mockChain('canton:TestNet'), baseParams())
    assert.equal(tx.commands.disclosedContracts?.length, 1)
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    assert.equal(tx.commands.disclosedContracts?.[0]?.contractId, TAR_CID)
  })

  it('selects the lock-release template for poolType "lockRelease"', async () => {
    const tx = await op.generate(
      mockChain('canton:TestNet'),
      baseParams({ poolType: 'lockRelease' }),
    )
    assert.match(createAndExercise(tx).templateId, /ccip-registry-lock-release-token-pool/)
  })
})

describe('deployTokenPool TAR + ccipOwner derivation', () => {
  const op = new DeployTokenPool()

  it("resolves the network's well-known TAR and takes its owner as ccipOwner", async () => {
    const chain = mockChain('canton:TestNet')
    const tx = await op.generate(chain, baseParams())

    const tarLookup = chain.calls.find((c) => c.templateId === TAR_TEMPLATE_ID)
    assert.equal(tarLookup?.instanceAddress, testNet.tokenAdminRegistry)
    assert.equal(createAndExercise(tx).createArguments.ccipOwner, testNet.ccipOwner)
  })

  it('resolves an overridden TAR dep, which is also the TAR Initialize registers with', async () => {
    const chain = mockChain('canton:TestNet')
    const tx = await op.generate(chain, baseParams({ deps: { tokenAdminRegistry: OVERRIDE_TAR } }))

    const tarLookup = chain.calls.find((c) => c.templateId === TAR_TEMPLATE_ID)
    assert.equal(tarLookup?.instanceAddress, OVERRIDE_TAR)
    assert.deepEqual(deployedDeps(tx).tokenAdminRegistry, { unpack: OVERRIDE_TAR })
    assert.equal(createAndExercise(tx).createArguments.ccipOwner, CCIP_OWNER)
  })
})

describe('deployTokenPool existing TokenConfig derivation', () => {
  const op = new DeployTokenPool()
  const tokenConfigAddress = deriveTokenConfigInstanceAddress(INSTRUMENT_ID, testNet.ccipOwner)

  it("looks up the instrument's TokenConfig at the derived address, as the authorizing parties", async () => {
    const chain = mockChain('canton:TestNet')
    await op.generate(chain, baseParams({ admin: ADMIN }))

    const lookup = chain.calls.find((c) => c.templateId === TOKEN_CONFIG_TEMPLATE_ID)
    assert.equal(lookup?.instanceAddress, tokenConfigAddress)
    assert.deepEqual(lookup.parties, [POOL_OWNER, ADMIN])
  })

  it('passes null when the instrument has no TokenConfig yet', async () => {
    const tx = await op.generate(mockChain('canton:TestNet'), baseParams())
    assert.equal(createAndExercise(tx).choiceArgument.existingTokenConfigCid, null)
  })

  it('passes and discloses a TokenConfig still awaiting an admin', async () => {
    const tx = await op.generate(
      mockChain('canton:TestNet', { tokenConfig: tokenConfig() }),
      baseParams({ admin: ADMIN }),
    )
    assert.equal(createAndExercise(tx).choiceArgument.existingTokenConfigCid, TOKEN_CONFIG_CID)
    assert.deepEqual(
      tx.commands.disclosedContracts?.map((c) => c.contractId),
      [TAR_CID, TOKEN_CONFIG_CID],
    )
  })

  it('does not pass a TokenConfig that already has an admin, and warns', async () => {
    const chain = mockChain('canton:TestNet', { tokenConfig: tokenConfig(POOL_OWNER) })
    const tx = await op.generate(chain, baseParams())

    assert.equal(createAndExercise(tx).choiceArgument.existingTokenConfigCid, null)
    assert.equal(tx.commands.disclosedContracts?.length, 1)
    assert.equal(chain.warnings.length, 1)
    assert.match(chain.warnings[0]!, /already has admin/)
  })
})

describe('deployTokenPool lane remote addresses', () => {
  const op = new DeployTokenPool()

  it('parses EVM and Solana remotes in their own format and stores them as 32-byte hex', async () => {
    const tx = await op.generate(
      mockChain('canton:TestNet'),
      baseParams({
        lanes: [
          lane(EVM_SELECTOR, [EVM_POOL], EVM_TOKEN.slice(2)),
          lane(SOLANA_SELECTOR, [SOLANA_ADDRESS], '0x' + SOLANA_HEX),
        ],
      }),
    )
    const lanes = createAndExercise(tx).choiceArgument.lanes as Array<Record<string, unknown>>

    assert.deepEqual(lanes[0]!.remotePools, ['0'.repeat(24) + EVM_POOL.slice(2).toLowerCase()])
    assert.equal(lanes[0]!.remoteTokenAddress, '0'.repeat(24) + EVM_TOKEN.slice(2))
    assert.deepEqual(lanes[1]!.remotePools, [SOLANA_HEX])
    assert.equal(lanes[1]!.remoteTokenAddress, SOLANA_HEX)
  })

  it('rejects a remote pool not in the remote family format, blaming its path', async () => {
    await rejectsParam(
      op.generate(
        mockChain('canton:TestNet'),
        baseParams({ lanes: [lane(EVM_SELECTOR, [SOLANA_ADDRESS], EVM_TOKEN)] }),
      ),
      'lanes[0].remotePools[0]',
      /valid EVM address/,
    )
  })

  it('rejects an invalid remote token address, blaming its path', async () => {
    await rejectsParam(
      op.generate(
        mockChain('canton:TestNet'),
        baseParams({ lanes: [lane(SOLANA_SELECTOR, [SOLANA_ADDRESS], EVM_TOKEN)] }),
      ),
      'lanes[0].remoteTokenAddress',
      /valid SVM address/,
    )
  })
})

describe('deployTokenPool deps resolution', () => {
  const op = new DeployTokenPool()

  it('defaults all deps to the well-known contracts of the connected network', async () => {
    const tx = await op.generate(mockChain('canton:TestNet'), baseParams())
    const deps = deployedDeps(tx)
    assert.deepEqual(deps.tokenAdminRegistry, { unpack: testNet.tokenAdminRegistry })
    assert.deepEqual(deps.feeQuoter, { unpack: testNet.feeQuoter })
    assert.deepEqual(deps.rmnRemote, { unpack: testNet.rmnRemote })
  })

  it('uses explicit deps verbatim, even on a known network', async () => {
    const tx = await op.generate(
      mockChain('canton:TestNet'),
      baseParams({
        deps: {
          tokenAdminRegistry: OVERRIDE_TAR,
          feeQuoter: OVERRIDE_FEE_QUOTER,
          rmnRemote: OVERRIDE_RMN_REMOTE,
        },
      }),
    )
    const deps = deployedDeps(tx)
    assert.deepEqual(deps.tokenAdminRegistry, { unpack: OVERRIDE_TAR })
    assert.deepEqual(deps.feeQuoter, { unpack: OVERRIDE_FEE_QUOTER })
    assert.deepEqual(deps.rmnRemote, { unpack: OVERRIDE_RMN_REMOTE })
  })

  it('merges partial overrides with network defaults per field', async () => {
    const tx = await op.generate(
      mockChain('canton:TestNet'),
      baseParams({ deps: { tokenAdminRegistry: OVERRIDE_TAR } }),
    )
    const deps = deployedDeps(tx)
    assert.deepEqual(deps.tokenAdminRegistry, { unpack: OVERRIDE_TAR })
    assert.deepEqual(deps.feeQuoter, { unpack: testNet.feeQuoter })
    assert.deepEqual(deps.rmnRemote, { unpack: testNet.rmnRemote })
  })

  it('accepts full explicit deps on a network with no registered contracts', async () => {
    const tx = await op.generate(
      mockChain('canton:LocalNet'),
      baseParams({
        deps: {
          tokenAdminRegistry: OVERRIDE_TAR,
          feeQuoter: OVERRIDE_FEE_QUOTER,
          rmnRemote: OVERRIDE_RMN_REMOTE,
        },
      }),
    )
    assert.deepEqual(deployedDeps(tx).tokenAdminRegistry, { unpack: OVERRIDE_TAR })
  })

  it('throws a clear error when deps are missing on an unregistered network', async () => {
    await assert.rejects(
      () => op.generate(mockChain('canton:LocalNet'), baseParams()),
      (err: unknown) => {
        assert.ok(err instanceof CCTParamsInvalidError)
        assert.match(err.message, /canton:LocalNet/)
        assert.match(err.message, /tokenAdminRegistry, feeQuoter, rmnRemote/)
        return true
      },
    )
  })

  it('reports only the unresolved fields in the error', async () => {
    await assert.rejects(
      () =>
        op.generate(
          mockChain('canton:LocalNet'),
          baseParams({ deps: { tokenAdminRegistry: OVERRIDE_TAR } }),
        ),
      (err: unknown) => {
        assert.ok(err instanceof CCTParamsInvalidError)
        assert.match(err.message, /feeQuoter, rmnRemote/)
        assert.doesNotMatch(err.message, /missing tokenAdminRegistry/)
        return true
      },
    )
  })
})

function mockChainWithSubmit(events: unknown[]): CantonChain {
  return mockChain('canton:TestNet', {
    overrides: {
      provider: {
        submitAndWaitForTransaction: async () => ({
          transaction: { updateId: 'update-1', events },
        }),
      },
    },
  })
}

/** Real ledger events echo the concrete package-id form, never the symbolic `#<pkg-name>:…` one. */
function concreteTemplateId(symbolicTemplateId: string, packageId: string): string {
  return `#${packageId}:${symbolicTemplateId.split(':').slice(1).join(':')}`
}

describe('deployTokenPool execute result parsing', () => {
  const op = new DeployTokenPool()
  const wallet = { party: POOL_OWNER }

  it('extracts poolCid, rateLimiterCids, tokenConfigCid, and poolInstanceAddress', async () => {
    const chain = mockChainWithSubmit([
      {
        CreatedEvent: {
          templateId: concreteTemplateId(BURN_MINT_POOL_TEMPLATE_ID, 'deadbeef'),
          contractId: 'pool-cid-1',
        },
      },
      {
        CreatedEvent: {
          templateId: concreteTemplateId(RATE_LIMITER_TEMPLATE_ID, 'deadbeef'),
          contractId: 'rl-cid-1',
        },
      },
      {
        CreatedEvent: {
          templateId: concreteTemplateId(RATE_LIMITER_TEMPLATE_ID, 'deadbeef'),
          contractId: 'rl-cid-2',
        },
      },
      {
        CreatedEvent: {
          templateId: concreteTemplateId(TOKEN_CONFIG_TEMPLATE_ID, 'cafebabe'),
          contractId: 'token-config-cid-1',
        },
      },
    ])

    const result = await op.execute(chain, { ...baseParams(), wallet })

    assert.equal(result.poolCid, 'pool-cid-1')
    assert.deepEqual(result.rateLimiterCids, ['rl-cid-1', 'rl-cid-2'])
    assert.equal(result.tokenConfigCid, 'token-config-cid-1')
    // the pool owner is instrumentId.admin
    assert.equal(result.poolInstanceAddress, hashedRawInstanceAddress(`pool-1@${POOL_OWNER}`))
  })

  it('throws when the response has no created pool contract', async () => {
    const chain = mockChainWithSubmit([])

    await assert.rejects(
      () => op.execute(chain, { ...baseParams(), wallet }),
      (err: unknown) => {
        assert.ok(err instanceof CCTTxFailedError)
        return true
      },
    )
  })
})
