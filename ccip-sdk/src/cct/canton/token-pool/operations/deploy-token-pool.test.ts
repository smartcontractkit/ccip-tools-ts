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

// registers the chain families lane remote addresses are parsed as
import '../../../../evm/index.ts'
import '../../../../solana/index.ts'
import { hashedRawInstanceAddress } from '../../../../canton/ccv-addresses.ts'
import { type CantonActiveContract, CantonChain } from '../../../../canton/index.ts'
import { CANTON_NETWORKS } from '../../../../canton/networks.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { ChainFamily } from '../../../../networks.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import {
  TOKEN_CONFIG_TEMPLATE_ID,
  deriveTokenConfigInstanceAddress,
} from '../../token-admin-registry/shared.ts'
import { BURN_MINT_POOL_TEMPLATE_ID, RATE_LIMITER_TEMPLATE_ID } from '../shared.ts'
import { type GenerateDeployTokenPoolParams, DeployTokenPool } from './deploy-token-pool.ts'

const fp = (hex: string) => '1220' + hex.repeat(32)
const POOL_OWNER = `poolOwner::${fp('ab')}`
const CCIP_OWNER = `ccipOwner::${fp('cd')}`
const OBSERVER = `observer::${fp('ef')}`
const TAR_CID = '#ccip-core-v2:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry:00abc'
const OVERRIDE_TAR = `tokenadminregistry-override@ccipOwner::${fp('cd')}`
const OVERRIDE_FEE_QUOTER = `feequoter-override@ccipOwner::${fp('cd')}`
const OVERRIDE_RMN_REMOTE = `rmn_remote-override@rmnOwner::${fp('cd')}`
const TOKEN_CONFIG_CID = '#token-config-1'
/** Where the TestNet TokenConfig of the `baseParams` instrument lives. */
const TOKEN_CONFIG_ADDRESS = deriveTokenConfigInstanceAddress(
  { admin: POOL_OWNER, id: 'TESTTOKEN' },
  CANTON_NETWORKS['canton:TestNet']!.ccipOwner,
)

const LANE_RATE_LIMITER = { instanceId: 'rl-in', isEnabled: true, capacity: 100n, rate: 1n }

/**
 * `CantonChain` mock: no EDS disclosure provider (forces the ACS-fallback
 * branch of `resolveTar`), `findActiveContractByInstanceAddress` returns
 * `tokenConfig` at {@link TOKEN_CONFIG_ADDRESS}, else a fake TAR signed by the
 * requested raw address's owner.
 */
function mockChain(
  chainId: string,
  overrides: Record<string, unknown> = {},
  tokenConfig: CantonActiveContract | null = null,
): CantonChain {
  // Real CantonChain instance (private fields make object-literal casts
  // impossible); Object.assign overrides only what the test exercises.
  return Object.assign(Object.create(CantonChain.prototype), {
    network: { family: ChainFamily.Canton, chainId },
    ccipParty: CCIP_OWNER,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    edsDisclosureProvider: undefined,
    findActiveContractByInstanceAddress: async (templateId: string, address: string) =>
      templateId === TOKEN_CONFIG_TEMPLATE_ID
        ? address === TOKEN_CONFIG_ADDRESS
          ? tokenConfig
          : null
        : {
            contractId: TAR_CID,
            createdEventBlob: 'blob',
            synchronizerId: 'sync-1',
            templateId: '#pkg-id:CCIP.CoreV2.TokenAdminRegistry:TokenAdminRegistry',
            signatories: [address.split('@')[1]],
          },
    ...overrides,
  })
}

function baseParams(
  overrides?: Partial<GenerateDeployTokenPoolParams>,
): GenerateDeployTokenPoolParams {
  return {
    sender: POOL_OWNER,
    poolType: 'burnMint',
    instanceId: 'pool-1',
    instrumentId: { admin: POOL_OWNER, id: 'TESTTOKEN' },
    decimals: 18,
    observers: [OBSERVER],
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

  it('rejects a deps override that is not a raw instance address', async () => {
    await assert.rejects(
      () =>
        op.generate(
          mockChain('canton:TestNet'),
          baseParams({ deps: { tokenAdminRegistry: '0x' + 'ab'.repeat(32) } }),
        ),
      (err: unknown) => {
        assert.ok(err instanceof CCTParamsInvalidError)
        assert.match(err.message, /deps\.tokenAdminRegistry/)
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
    assert.equal(createArguments.poolOwner, POOL_OWNER) // instrumentId.admin
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

  for (const [label, deps, ccipOwner] of [
    ["the network's well-known TAR", undefined, testNet.ccipOwner],
    ['an overridden TAR dep', { tokenAdminRegistry: OVERRIDE_TAR }, CCIP_OWNER],
  ] as const) {
    it(`registers with ${label}, taking its signatory as ccipOwner`, async () => {
      const tx = await op.generate(mockChain('canton:TestNet'), baseParams({ deps }))
      assert.equal(createAndExercise(tx).createArguments.ccipOwner, ccipOwner)
    })
  }

  // Natural JSON (JSON Ledger API): `admin` is a bare party string, or `null` when unset.
  const tokenConfig = (admin: string | null): CantonActiveContract => ({
    contractId: TOKEN_CONFIG_CID,
    templateId: TOKEN_CONFIG_TEMPLATE_ID,
    createdEventBlob: 'token-config-blob',
    synchronizerId: 'sync-1',
    signatories: [testNet.ccipOwner],
    createArgument: { admin },
  })
  for (const [label, existing, existingTokenConfigCid] of [
    ['no TokenConfig yet', null, null],
    ['a TokenConfig awaiting an admin', tokenConfig(null), TOKEN_CONFIG_CID],
    ['a TokenConfig that already has an admin', tokenConfig(POOL_OWNER), null],
  ] as const) {
    it(`resolves existingTokenConfigCid for ${label}`, async () => {
      const tx = await op.generate(mockChain('canton:TestNet', {}, existing), baseParams())
      assert.equal(
        createAndExercise(tx).choiceArgument.existingTokenConfigCid,
        existingTokenConfigCid,
      )
      assert.deepEqual(
        tx.commands.disclosedContracts?.map((c) => c.contractId),
        existingTokenConfigCid ? [TAR_CID, TOKEN_CONFIG_CID] : [TAR_CID],
      )
    })
  }
})

describe('deployTokenPool lane remote addresses', () => {
  const op = new DeployTokenPool()
  const EVM_SELECTOR = 16015286601757825753n // ethereum-testnet-sepolia
  const SOLANA_SELECTOR = 16423721717087811551n // solana-devnet
  const EVM_ADDRESS = '0x36E518336A67177CB102726C2DFA3D29B12F4C7B'
  /** One Solana key, as base58 and as its 32 raw bytes. */
  const SOLANA_ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
  const SOLANA_HEX = '6752055c20b3e9d8746656ddf73855507f87ab6d87523e4c76a7fa36096a99eb'
  const lane = (remoteChainSelector: bigint, remote: string) => ({
    remoteChainSelector,
    remotePools: [remote],
    remoteTokenAddress: remote,
    inbound: LANE_RATE_LIMITER,
    outbound: LANE_RATE_LIMITER,
    inboundCustomFinality: LANE_RATE_LIMITER,
  })

  it('parses EVM and Solana remotes in their own format, stored as 32-byte bare hex', async () => {
    const tx = await op.generate(
      mockChain('canton:TestNet'),
      baseParams({
        lanes: [lane(EVM_SELECTOR, EVM_ADDRESS), lane(SOLANA_SELECTOR, SOLANA_ADDRESS)],
      }),
    )
    const lanes = createAndExercise(tx).choiceArgument.lanes as Array<Record<string, unknown>>
    const evmStored = '0'.repeat(24) + EVM_ADDRESS.slice(2).toLowerCase()
    assert.deepEqual(
      lanes.map((l) => [l.remotePools, l.remoteTokenAddress]),
      [
        [[evmStored], evmStored],
        [[SOLANA_HEX], SOLANA_HEX],
      ],
    )
  })

  it('rejects a remote not in the lane family format, blaming its path', async () => {
    await assert.rejects(
      op.generate(
        mockChain('canton:TestNet'),
        baseParams({ lanes: [lane(EVM_SELECTOR, SOLANA_ADDRESS)] }),
      ),
      /"lanes\[0\]\.remoteTokenAddress": must be a valid EVM address/,
    )
  })
})

function mockChainWithSubmit(events: unknown[]): CantonChain {
  return mockChain('canton:TestNet', {
    provider: {
      submitAndWaitForTransaction: async () => ({
        transaction: { updateId: 'update-1', events },
      }),
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
