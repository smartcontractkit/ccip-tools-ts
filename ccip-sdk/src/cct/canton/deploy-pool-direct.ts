/**
 * Deploy a `BurnMintTokenPool` / `LockReleaseTokenPool` directly — a bare
 * contract `create`, bypassing the CCIPFactory. Like the factory create, this
 * is pure local construction (no chain, no ACS reads, no disclosed contracts):
 * the pool template's only signatory is `poolOwner`, so the creating party
 * authorizes it alone.
 *
 * On-ledger constraints (`ensure` on the template): `instrumentId.admin` must
 * equal `poolOwner`, `instanceId` must be a valid instance ID, `decimals` must
 * be a valid token decimals value.
 *
 * Bypassing the factory skips its bookkeeping (`usedInstanceIds` /
 * `deployedContracts` indexes) — fine for issuer-owned test pools; nothing
 * downstream (TAR registration, chain config, transfers) reads the factory.
 *
 * @packageDocumentation
 */

import { ChainFamily } from '../../networks.ts'
import type { UnsignedCantonTx } from '../../canton/types.ts'
import type { JsCommands } from '../../canton/client/index.ts'
import {
  BURN_MINT_POOL_TEMPLATE_ID,
  buildPoolCreateArguments,
  LOCK_RELEASE_POOL_TEMPLATE_ID,
  type PoolCreateArgsInput,
} from './token-pool/shared.ts'

/** Inputs to {@link deployTokenPoolDirect}. */
export interface DeployTokenPoolDirectParams extends PoolCreateArgsInput {
  /** Pool type to deploy. */
  poolType: 'burnMint' | 'lockRelease'
}

/**
 * Build an unsigned pool create tx owned by `poolOwner`. No connected chain
 * needed — a bare create has no input contracts, so there is nothing to
 * resolve or disclose (the EVM-style offline `generate`).
 *
 * @returns an {@link UnsignedCantonTx} with a `CreateCommand` for the pool.
 */
export function deployTokenPoolDirect(params: DeployTokenPoolDirectParams): UnsignedCantonTx {
  const { poolType, poolOwner } = params
  const templateId =
    poolType === 'burnMint' ? BURN_MINT_POOL_TEMPLATE_ID : LOCK_RELEASE_POOL_TEMPLATE_ID

  const commands: JsCommands = {
    commands: [
      {
        CreateCommand: {
          templateId,
          createArguments: buildPoolCreateArguments(params),
        },
      },
    ],
    commandId: `cct-deploy-pool-direct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actAs: [poolOwner],
    // Bare create — the contract is new, nothing to disclose.
    disclosedContracts: [],
  }

  return { family: ChainFamily.Canton, commands }
}
