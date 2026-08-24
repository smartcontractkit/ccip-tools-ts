/**
 * Unit tests for the Canton CCT `deployTokenPool` operation: deps resolution
 * (explicit overrides vs well-known per-network contracts) against a mocked
 * {@link CantonChain} — no live participant required.
 *
 * @packageDocumentation
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ChainFamily } from '../../../../networks.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CANTON_NETWORKS } from '../../../../canton/networks.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { DeployTokenPool, type GenerateDeployTokenPoolParams } from './deploy-token-pool.ts'

const fp = (hex: string) => '1220' + hex.repeat(32)
const POOL_OWNER = `poolOwner::${fp('ab')}`
const CCIP_OWNER = `ccipOwner::${fp('cd')}`
const OVERRIDE_TAR = `tokenadminregistry-override@ccipOwner::${fp('cd')}`
const OVERRIDE_FEE_QUOTER = `feequoter-override@ccipOwner::${fp('cd')}`
const OVERRIDE_RMN_REMOTE = `rmn_remote-override@rmnOwner::${fp('cd')}`

/**
 * Minimal `CantonChain` mock: `deployTokenPool.generate()` is offline — it
 * only touches `network.chainId` (deps resolution) and `network.family`.
 */
function mockChain(chainId: string): CantonChain {
  return {
    network: { family: ChainFamily.Canton, chainId },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as CantonChain
}

function baseParams(overrides?: Partial<GenerateDeployTokenPoolParams>): GenerateDeployTokenPoolParams {
  return {
    sender: POOL_OWNER,
    poolType: 'burnMint',
    instanceId: 'pool-1',
    poolOwner: POOL_OWNER,
    ccipOwner: CCIP_OWNER,
    instrumentId: { admin: POOL_OWNER, id: 'TESTTOKEN' },
    decimals: 18,
    ...overrides,
  }
}

/** Extract the `{unpack: raw}` deps record from a generated unsigned tx. */
function deployedDeps(tx: UnsignedCantonTx): Record<string, { unpack: string }> {
  const command = tx.commands.commands[0] as {
    CreateCommand: { createArguments: { deps: Record<string, { unpack: string }> } }
  }
  return command.CreateCommand.createArguments.deps
}

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
