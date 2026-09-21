/**
 * Unit tests for the Canton CCT `deployTokenPool` operation: validation, deps
 * resolution (explicit overrides vs well-known per-network contracts), and the
 * `CreateAndExerciseCommand` shape built against a mocked {@link CantonChain} —
 * no live participant required.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { hashedRawInstanceAddress } from '../../../../canton/ccv-addresses.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import { CANTON_NETWORKS } from '../../../../canton/networks.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import { TOKEN_CONFIG_TEMPLATE_ID } from '../../token-admin-registry/shared.ts'
import { BURN_MINT_POOL_TEMPLATE_ID, RATE_LIMITER_TEMPLATE_ID } from '../shared.ts'
import { type GenerateDeployTokenPoolParams, DeployTokenPool } from './deploy-token-pool.ts'

const fp = (hex: string) => '1220' + hex.repeat(32)
const POOL_OWNER = `poolOwner::${fp('ab')}`
const CCIP_OWNER = `ccipOwner::${fp('cd')}`
const OBSERVER = `observer::${fp('ef')}`
const TAR_INSTANCE_ADDRESS = `tar-instance@ccipOwner::${fp('cd')}`
const TAR_CID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry:00abc'
const OVERRIDE_TAR = `tokenadminregistry-override@ccipOwner::${fp('cd')}`
const OVERRIDE_FEE_QUOTER = `feequoter-override@ccipOwner::${fp('cd')}`
const OVERRIDE_RMN_REMOTE = `rmn_remote-override@rmnOwner::${fp('cd')}`

const LANE_RATE_LIMITER = { instanceId: 'rl-in', isEnabled: true, capacity: 100n, rate: 1n }

/**
 * `CantonChain` mock: no EDS disclosure provider (forces the ACS-fallback
 * branch of `resolveTar`), `findActiveContractByInstanceAddress` returns a
 * fake TAR contract regardless of the requested InstanceAddress.
 */
function mockChain(chainId: string): CantonChain {
  return {
    network: { family: ChainFamily.Canton, chainId },
    ccipParty: CCIP_OWNER,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    edsDisclosureProvider: undefined,
    findActiveContractByInstanceAddress: async () => ({
      contractId: TAR_CID,
      createdEventBlob: 'blob',
      synchronizerId: 'sync-1',
      templateId: '#pkg-id:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry',
      signatories: [CCIP_OWNER],
    }),
  } as unknown as CantonChain
}

function baseParams(
  overrides?: Partial<GenerateDeployTokenPoolParams>,
): GenerateDeployTokenPoolParams {
  return {
    sender: POOL_OWNER,
    poolType: 'burnMint',
    instanceId: 'pool-1',
    poolOwner: POOL_OWNER,
    ccipOwner: CCIP_OWNER,
    instrumentId: { admin: POOL_OWNER, id: 'TESTTOKEN' },
    decimals: 18,
    observers: [OBSERVER],
    tokenAdminRegistryInstanceAddress: TAR_INSTANCE_ADDRESS,
    admin: POOL_OWNER,
    lanes: [],
    ...overrides,
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

  it('rejects a missing tokenAdminRegistryInstanceAddress', async () => {
    await assert.rejects(
      () =>
        op.generate(
          mockChain('canton:TestNet'),
          baseParams({ tokenAdminRegistryInstanceAddress: '' }),
        ),
      (err: unknown) => {
        assert.ok(err instanceof CCTParamsInvalidError)
        assert.match(err.message, /tokenAdminRegistryInstanceAddress/)
        return true
      },
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
    assert.equal(choiceArgument.admin, POOL_OWNER)
    assert.equal(choiceArgument.existingTokenConfigCid, null)
  })

  it('deduplicates actAs when poolOwner and admin are the same party', async () => {
    const tx = await op.generate(mockChain('canton:TestNet'), baseParams())
    assert.deepEqual(tx.commands.actAs, [POOL_OWNER])
  })

  it('includes both parties in actAs when admin differs from poolOwner', async () => {
    const ADMIN = `admin::${fp('99')}`
    const tx = await op.generate(mockChain('canton:TestNet'), baseParams({ admin: ADMIN }))
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

describe('deployTokenPool deps resolution', () => {
  const op = new DeployTokenPool()
  const testNet = CANTON_NETWORKS['canton:TestNet']!

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
  const chain = mockChain('canton:TestNet')
  return {
    // oxlint-disable-next-line typescript/no-misused-spread
    ...chain,
    provider: {
      submitAndWaitForTransaction: async () => ({
        transaction: { updateId: 'update-1', events },
      }),
    },
  } as unknown as CantonChain
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
