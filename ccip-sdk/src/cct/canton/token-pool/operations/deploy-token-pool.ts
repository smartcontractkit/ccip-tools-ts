/**
 * deployTokenPool — atomically deploy a `BurnMintTokenPool` or
 * `LockReleaseTokenPool` (registry-pools family, `CCIP.Registry.*`) AND wire
 * it up (TAR registration + lane rate limiters) via the `Initialize` choice,
 * in a single `CreateAndExerciseCommand`.
 *
 * Deploy-then-separately-initialize is deliberately NOT supported:
 * `Initialize` exists specifically so the pool never exists on-ledger without
 * also being registered with the TAR and having its lanes' rate limiters in
 * place. Mirrors the Go E2E pattern (`submitCreateAndExercise` +
 * `BurnMintTokenPool.Initialize`).
 *
 * Unlike a bare `create` (no input contracts, fully offline), this needs an
 * ACS/EDS read to resolve + disclose the TAR contract `Initialize` exercises
 * internally — so `generate()` is NOT fully offline.
 *
 * `Initialize`'s controller is `poolOwner, admin` — BOTH parties must
 * authorize (Daml's multi-controller semantics require every listed party's
 * signature), so both go into `actAs` (deduplicated when they're the same
 * party, e.g. self-issued tokens where `admin == poolOwner`).
 *
 * `existingTokenConfigCid` (third-party-admin tokens with an already-accepted
 * TokenConfig) is intentionally not exposed yet — v1 assumes
 * `instrumentId.admin == poolOwner == admin`, matching the Go E2E tests; a
 * fresh `ProposeAdministrator` + `AcceptAdminRole` happens inline.
 *
 * On-ledger `ensure` constraints: `instrumentId.admin == poolOwner`, valid
 * `instanceId`, valid token `decimals`, non-empty `observers`.
 *
 * `edsConfig` is intentionally NOT returned — it is assembled separately by
 * the EDS-standup pipeline from the pool's instance address.
 *
 * @packageDocumentation
 */

import type { JsCommands } from '../../../../canton/client/index.ts'
import type { CantonChain } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import type { TransferTimeout } from '../../encoding.ts'
import {
  type CantonExecuteParams,
  type CantonGenerateParams,
  CantonOperation,
} from '../../operation.ts'
import { TAR_TEMPLATE_ID, resolveTar } from '../../token-admin-registry/shared.ts'
import type { CantonDeployResult } from '../../types.ts'
import { parseInstrumentId, parsePartyId } from '../../validate.ts'
import {
  type LaneDeploySpec,
  type PoolFactoryDeps,
  type PoolReceiveContext,
  BURN_MINT_POOL_TEMPLATE_ID,
  LOCK_RELEASE_POOL_TEMPLATE_ID,
  buildInitializeChoiceArgument,
  buildPoolCreateArguments,
  resolvePoolFactoryDeps,
} from '../shared.ts'

/** Pool type to deploy. */
export type PoolType = 'burnMint' | 'lockRelease'

export type {
  LaneDeploySpec,
  PoolFactoryDeps,
  PoolReceiveContext,
  RateLimiterDeploySpec,
} from '../shared.ts'

/** Parameters shared by `deployTokenPool` generation and execution. */
export interface DeployTokenPoolParams {
  /** Pool type to deploy. */
  poolType: PoolType
  /** Pool instance ID (unique per pool; used to derive the pool instance address). */
  instanceId: string
  /** Pool owner party ID (`hint::1220…`) — must equal `instrumentId.admin`. */
  poolOwner: string
  /** CCIP owner party ID (the protocol-level owner). */
  ccipOwner: string
  /** Instrument to bridge (`{ admin, id }` or `"admin::1220…::id"`). */
  instrumentId: { admin: string; id: string } | string
  /** Token decimals. */
  decimals: number
  /**
   * Observer parties for EDS auto-detection. Mandatory — the on-ledger
   * `ensure` clause rejects an empty list.
   */
  observers: string[]
  /** Optional rate-limit admin party. */
  rateLimitAdmin?: string
  /**
   * Factory deps overrides (TAR, FeeQuoter, RMNRemote raw instance
   * addresses). Any field left unset falls back to the well-known contracts
   * registered for the connected network — end users on a known network
   * omit `deps` entirely; overrides are for devnet / testing.
   */
  deps?: Partial<PoolFactoryDeps>
  /** Pool receive-context choice-context. */
  poolReceiveContext?: PoolReceiveContext
  /** Transfer timeout (Daml variant; defaults to `RelativeHours 24`, matching Go). */
  transferTimeout?: TransferTimeout
  /**
   * TAR `InstanceAddress` (`0x<64-hex>` or `"instanceId@ccipOwner"`).
   * Resolved via the EDS disclosure service (preferred) or the ACS.
   */
  tokenAdminRegistryInstanceAddress: string
  /**
   * Token admin party — jointly authorizes `Initialize` with `poolOwner`, and
   * must equal the TAR's `ccipOwner` or `instrumentId.admin` for the internal
   * `ProposeAdministrator` call to succeed (its `isOwner || isAdmin` check).
   */
  admin: string
  /** Remote-chain lanes to wire up atomically with the pool (may be empty). */
  lanes: LaneDeploySpec[]
}

/** Parsed `deployTokenPool` params. */
type ParsedDeployTokenPoolParams = Omit<
  CantonGenerateParams<DeployTokenPoolParams>,
  'instrumentId'
> & {
  instrumentId: { admin: string; id: string }
}

/** Parameters for unsigned `deployTokenPool` generation. */
export type GenerateDeployTokenPoolParams = CantonGenerateParams<DeployTokenPoolParams>

/** Unsigned `deployTokenPool` result. */
export type GenerateDeployTokenPoolResult = UnsignedCantonTx

/** Parameters for executing `deployTokenPool`. */
export type ExecuteDeployTokenPoolParams = CantonExecuteParams<DeployTokenPoolParams>

/** Result of executing `deployTokenPool`. */
export type ExecuteDeployTokenPoolResult = CantonDeployResult

/** `deployTokenPool` operation (atomic `CreateAndExercise` + `Initialize`). */
export class DeployTokenPool extends CantonOperation<
  DeployTokenPoolParams,
  ParsedDeployTokenPoolParams
> {
  readonly name = 'deployTokenPool'

  /** Validates party IDs, instrument ID, instance ID, decimals, observers, and lanes. */
  protected override validate(p: GenerateDeployTokenPoolParams): void {
    if (p.poolType !== 'burnMint' && p.poolType !== 'lockRelease') {
      throw new CCTParamsInvalidError(
        this.name,
        'poolType',
        `expected "burnMint" or "lockRelease", got "${String(p.poolType)}"`,
      )
    }
    if (!p.instanceId) {
      throw new CCTParamsInvalidError(this.name, 'instanceId', 'pool instance ID is required')
    }
    parsePartyId(this.name, 'poolOwner', p.poolOwner)
    parsePartyId(this.name, 'ccipOwner', p.ccipOwner)
    parseInstrumentId(this.name, 'instrumentId', p.instrumentId)
    if (!Number.isInteger(p.decimals) || p.decimals < 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'decimals',
        `expected a non-negative integer, got ${p.decimals}`,
      )
    }
    if (!p.observers || p.observers.length === 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'observers',
        'at least one observer is required (the on-ledger ensure clause rejects an empty list)',
      )
    }
    p.observers.forEach((o, i) => parsePartyId(this.name, `observers[${i}]`, o))
    if (p.rateLimitAdmin) parsePartyId(this.name, 'rateLimitAdmin', p.rateLimitAdmin)
    if (!p.tokenAdminRegistryInstanceAddress) {
      throw new CCTParamsInvalidError(
        this.name,
        'tokenAdminRegistryInstanceAddress',
        'TAR InstanceAddress is required',
      )
    }
    parsePartyId(this.name, 'admin', p.admin)
    for (const [i, l] of (p.lanes ?? []).entries()) {
      if (!l.remoteChainSelector) {
        throw new CCTParamsInvalidError(
          this.name,
          `lanes[${i}].remoteChainSelector`,
          'remote chain selector is required',
        )
      }
      if (!l.remoteTokenAddress) {
        throw new CCTParamsInvalidError(
          this.name,
          `lanes[${i}].remoteTokenAddress`,
          'remote token address is required',
        )
      }
      if (!l.inbound || !l.outbound || !l.inboundCustomFinality) {
        throw new CCTParamsInvalidError(
          this.name,
          `lanes[${i}]`,
          'inbound, outbound, and inboundCustomFinality rate-limiter specs are all required',
        )
      }
    }
    // deps are NOT validated here: unset fields fall back to the well-known
    // per-network contracts at build time (see resolvePoolFactoryDeps).
  }

  /** Parses the instrument ID. */
  protected override parse(p: GenerateDeployTokenPoolParams): ParsedDeployTokenPoolParams {
    return {
      ...p,
      instrumentId: parseInstrumentId(this.name, 'instrumentId', p.instrumentId),
    }
  }

  /**
   * Resolves + discloses the TAR, then builds a single `CreateAndExercise`
   * command: create the pool, then exercise `Initialize` on it.
   */
  protected async buildCommands(
    chain: CantonChain,
    p: ParsedDeployTokenPoolParams,
  ): Promise<JsCommands> {
    const templateId =
      p.poolType === 'burnMint' ? BURN_MINT_POOL_TEMPLATE_ID : LOCK_RELEASE_POOL_TEMPLATE_ID

    // Explicit deps win; missing fields resolve from the connected network's
    // well-known contracts (throws if the network has none registered).
    const deps = resolvePoolFactoryDeps(this.name, chain, p.deps)

    // Disclosure-service-first resolution — no ccipOwner visibility required
    // on the sender's participant.
    const { tarContract } = await resolveTar(chain, p.sender, p.tokenAdminRegistryInstanceAddress)

    const createArguments = buildPoolCreateArguments({ ...p, deps })
    const choiceArgument = buildInitializeChoiceArgument({
      tokenAdminRegistryCid: tarContract.contractId,
      admin: p.admin,
      lanes: p.lanes ?? [],
    })

    return {
      commands: [
        {
          CreateAndExerciseCommand: {
            templateId,
            createArguments,
            choice: 'Initialize',
            choiceArgument,
          },
        },
      ],
      commandId: `cct-deploy-${p.poolType}-pool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      // Initialize's controller is `poolOwner, admin` — both must authorize;
      // dedup covers the common case where they're the same party.
      actAs: [...new Set([p.poolOwner, p.admin])],
      disclosedContracts: [
        {
          templateId: tarContract.templateId ?? TAR_TEMPLATE_ID,
          contractId: tarContract.contractId,
          createdEventBlob: tarContract.createdEventBlob,
          synchronizerId: tarContract.synchronizerId,
        },
      ],
    }
  }
}
