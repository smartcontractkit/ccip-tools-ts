/**
 * Deploy a `CCIPFactory` owned by the acting party — a bare contract `create`
 * (not an exercise on an existing contract), so any party can deploy a factory
 * it then owns. Mirrors Go `contract.NewDeploy` for `factorybindings.CCIPFactory`.
 *
 * The `CCIPFactory` template's `signatory owner` makes the creating party the
 * owner/signatory — no pre-existing authority required. After deploy, that
 * party is the `owner` controller of `DeployBurnMintTokenPool` /
 * `DeployLockReleaseTokenPool` and the other factory deploy choices, so it can
 * deploy pools / TAR / FeeQuoter / RMNRemote through this factory.
 *
 * This is the simplest real **write** a party can do without MCMS: create a
 * factory you own, then exercise its deploy choices. Returned as an
 * {@link UnsignedCantonTx} ready for `submitViaGateway` (or direct submit).
 *
 * @packageDocumentation
 */

import { ChainFamily } from '../../networks.ts'
import type { UnsignedCantonTx } from '../../canton/types.ts'
import type { JsCommands } from '../../canton/client/index.ts'
import { FACTORY_TEMPLATE_ID } from './token-pool/shared.ts'

/** Inputs to {@link deployCCIPFactory}. */
export interface DeployCCIPFactoryParams {
  /** Factory instance ID (unique; used to derive the factory's InstanceAddress). */
  instanceId: string
  /** Acting party — becomes the factory `owner` (signatory) + `actAs`. */
  owner: string
  /**
   * MCMS controller party (the factory's `mcmsParty` observer). For a
   * non-MCMS test factory, set this to `owner` (your party) so governance
   * stays with you. Set to the real MCMS party when wiring into MCMS governance.
   */
  mcmsParty: string
}

/**
 * Build an unsigned `CCIPFactory` create tx owned by `owner`. No connected
 * chain needed — a factory create has no disclosed contracts (the contract is
 * new; there's nothing to disclose). Pure local construction, like EVM
 * `generateUnsignedTx`.
 *
 * @returns an {@link UnsignedCantonTx} with a `CreateCommand` for the factory.
 */
export function deployCCIPFactory(params: DeployCCIPFactoryParams): UnsignedCantonTx {
  const { instanceId, owner, mcmsParty } = params

  const commands: JsCommands = {
    commands: [
      {
        CreateCommand: {
          templateId: FACTORY_TEMPLATE_ID,
          // JSON Ledger API value encoding (per Canton Daml-LF JSON spec):
          // Party/Text/Bool are bare JSON values; Records are bare objects;
          // Lists are bare arrays. `Map Text Bool` / `Map Text (ContractId ())`
          // compile to Daml-LF GenMap, which this Canton participant encodes as
          // a JSON array of entries (hence `Expected ujson.Arr` on `{}`) — use
          // `[]` for an empty Map. (Go's `{"_type":"genmap","value":{}}` form is
          // the gRPC encoding, not the JSON Ledger API encoding the gateway uses.)
          createArguments: {
            instanceId, // bare Text
            owner, // bare Party (JSON string)
            mcmsParty, // bare Party (JSON string)
            usedInstanceIds: [], // empty Map (GenMap) — JSON array form
            deployedContracts: [], // empty Map (GenMap) — JSON array form
            perPartyRouterFactoryDeployed: false, // bare Bool
          },
        },
      },
    ],
    commandId: `cct-deploy-factory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actAs: [owner],
    // Factory create has no disclosed contracts — the contract is new.
    disclosedContracts: [],
  }

  return { family: ChainFamily.Canton, commands }
}
