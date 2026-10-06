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
 * internally, and an ACS read for the instrument's existing `TokenConfig` — so
 * `generate()` is NOT fully offline.
 *
 * Derived params: `poolOwner` is `instrumentId.admin`; the TAR is
 * `deps.tokenAdminRegistry` and `ccipOwner` its signatory; `admin` defaults to
 * `poolOwner`; a TokenConfig still awaiting an admin (third-party-admin flow)
 * is passed as `existingTokenConfigCid`, else `null`.
 *
 * `Initialize`'s controller is `poolOwner, admin` — BOTH parties must
 * authorize (Daml's multi-controller semantics require every listed party's
 * signature), so both go into `actAs` (deduplicated when they're the same
 * party, e.g. self-issued tokens where `admin == poolOwner`).
 *
 * On-ledger `ensure` constraints: `instrumentId.admin == poolOwner`, valid
 * `instanceId`, valid token `decimals`, non-empty `observers`.
 *
 * `edsConfig` is intentionally NOT returned — it is assembled separately by
 * the EDS-standup pipeline from the pool's instance address.
 *
 * @packageDocumentation
 */

import { hashedRawInstanceAddress } from '../../../../canton/ccv-addresses.ts'
import type { JsCommands } from '../../../../canton/client/index.ts'
import { type CantonChain, decodeDamlRecord } from '../../../../canton/index.ts'
import type { UnsignedCantonTx } from '../../../../canton/types.ts'
import { CCTParamsInvalidError, CCTTxFailedError } from '../../../errors.ts'
import type { TransferTimeout } from '../../encoding.ts'
import {
  type CantonExecuteParams,
  type CantonGenerateParams,
  CantonOperation,
  extractCreatedContractIds,
} from '../../operation.ts'
import {
  TAR_TEMPLATE_ID,
  TOKEN_CONFIG_TEMPLATE_ID,
  decodeOptionalParty,
  deriveTokenConfigInstanceAddress,
  resolveTar,
} from '../../token-admin-registry/shared.ts'
import type { CantonDeployResult } from '../../types.ts'
import { parseInstrumentId, parsePartyId, parseRawInstanceAddress } from '../../validate.ts'
import {
  type LaneDeploySpec,
  type PoolFactoryDeps,
  type PoolReceiveContext,
  type PoolType,
  POOL_TEMPLATE_IDS,
  RATE_LIMITER_TEMPLATE_ID,
  buildInitializeChoiceArgument,
  buildPoolCreateArguments,
  parseLaneRemoteAddresses,
  resolvePoolFactoryDeps,
} from '../shared.ts'

export type {
  LaneDeploySpec,
  PoolFactoryDeps,
  PoolReceiveContext,
  PoolType,
  RateLimiterDeploySpec,
} from '../shared.ts'

/** Parameters shared by `deployTokenPool` generation and execution. */
export interface DeployTokenPoolParams {
  /** Pool type to deploy. */
  poolType: PoolType
  /** Pool instance ID (unique per pool; used to derive the pool instance address). */
  instanceId: string
  /** Instrument to bridge (`{ admin, id }` or `"admin::1220…::id"`); `admin` is the pool owner. */
  instrumentId: { admin: string; id: string } | string
  /**
   * The token's decimals ON CANTON (10 for Token Standard instruments) — NOT
   * the remote chain's decimals. The pool converts between this and the remote
   * side's decimals (carried in the message). Getting this wrong silently
   * mis-scales every transfer (e.g. 18 here for a 10-decimal Canton token
   * mints 10^8× the intended amount on inbound).
   */
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
   * `tokenAdminRegistry` is also the TAR `Initialize` registers with.
   */
  deps?: Partial<PoolFactoryDeps>
  /** Pool receive-context choice-context. */
  poolReceiveContext?: PoolReceiveContext
  /** Transfer timeout (Daml variant; defaults to `RelativeHours 24`, matching Go). */
  transferTimeout?: TransferTimeout
  /**
   * Token admin party — jointly authorizes `Initialize` with `poolOwner`, and
   * must equal the TAR's `ccipOwner` or `instrumentId.admin` for the internal
   * `ProposeAdministrator` call to succeed (its `isOwner || isAdmin` check).
   * Defaults to `instrumentId.admin`.
   */
  admin?: string
  /** Remote-chain lanes to wire up atomically with the pool (may be empty). */
  lanes: LaneDeploySpec[]
}

/** Parsed `deployTokenPool` params. */
type ParsedDeployTokenPoolParams = Omit<
  CantonGenerateParams<DeployTokenPoolParams>,
  'instrumentId' | 'admin'
> & {
  instrumentId: { admin: string; id: string }
  /** Pool owner — `instrumentId.admin`. */
  poolOwner: string
  admin: string
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

  /** Validates party IDs, instrument ID, instance ID, decimals, observers, deps, and lanes. */
  protected override validate(p: GenerateDeployTokenPoolParams): void {
    // oxlint-disable-next-line typescript/no-unnecessary-condition
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
    parseInstrumentId(this.name, 'instrumentId', p.instrumentId)
    if (!Number.isInteger(p.decimals) || p.decimals < 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'decimals',
        `expected a non-negative integer, got ${p.decimals}`,
      )
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!p.observers || p.observers.length === 0) {
      throw new CCTParamsInvalidError(
        this.name,
        'observers',
        'at least one observer is required (the on-ledger ensure clause rejects an empty list)',
      )
    }
    p.observers.forEach((o, i) => parsePartyId(this.name, `observers[${i}]`, o))
    if (p.rateLimitAdmin) parsePartyId(this.name, 'rateLimitAdmin', p.rateLimitAdmin)
    if (p.admin !== undefined) parsePartyId(this.name, 'admin', p.admin)
    // Unset deps fall back to the well-known per-network contracts at build
    // time (see resolvePoolFactoryDeps); overrides must be raw addresses, as
    // the pool stores them verbatim.
    for (const key of ['tokenAdminRegistry', 'feeQuoter', 'rmnRemote'] as const) {
      const dep = p.deps?.[key]
      if (dep !== undefined) parseRawInstanceAddress(this.name, `deps.${key}`, dep)
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition
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
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (!l.inbound || !l.outbound || !l.inboundCustomFinality) {
        throw new CCTParamsInvalidError(
          this.name,
          `lanes[${i}]`,
          'inbound, outbound, and inboundCustomFinality rate-limiter specs are all required',
        )
      }
    }
  }

  /**
   * Parses the instrument ID (deriving `poolOwner` and the default `admin`) and
   * lane remote addresses.
   */
  protected override parse(p: GenerateDeployTokenPoolParams): ParsedDeployTokenPoolParams {
    const instrumentId = parseInstrumentId(this.name, 'instrumentId', p.instrumentId)
    return {
      ...p,
      instrumentId,
      poolOwner: instrumentId.admin,
      admin: p.admin ?? instrumentId.admin,
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      lanes: (p.lanes ?? []).map((l, i) => parseLaneRemoteAddresses(this.name, `lanes[${i}]`, l)),
    }
  }

  /**
   * Resolves + discloses the TAR (and a TokenConfig awaiting an admin), then
   * builds a single `CreateAndExercise` command: create the pool, then exercise
   * `Initialize` on it.
   */
  protected async buildCommands(
    chain: CantonChain,
    p: ParsedDeployTokenPoolParams,
  ): Promise<JsCommands> {
    // Explicit deps win; missing fields resolve from the connected network's
    // well-known contracts (throws if the network has none registered).
    const deps = resolvePoolFactoryDeps(this.name, chain, p.deps)
    const actAs = [...new Set([p.poolOwner, p.admin])]

    // The pool's TAR dep is also the TAR Initialize registers with.
    // Disclosure-service-first resolution — no ccipOwner visibility required
    // on the sender's participant.
    const tar = parseRawInstanceAddress(
      this.name,
      'deps.tokenAdminRegistry',
      deps.tokenAdminRegistry,
    )
    const resolved = await resolveTar(chain, p.sender, deps.tokenAdminRegistry)
    const { tarContract } = resolved
    // Prefer the resolved signatory; else the raw address's owner suffix.
    const ccipOwner = resolved.ccipOwner ?? tar.owner

    const disclosedContracts = [
      {
        templateId: tarContract.templateId ?? TAR_TEMPLATE_ID,
        contractId: tarContract.contractId,
        createdEventBlob: tarContract.createdEventBlob,
        synchronizerId: tarContract.synchronizerId,
      },
    ]

    // Third-party-admin flow: a TokenConfig proposed out of band (no admin yet)
    // is passed by CID and disclosed — Initialize's internal ProposeAdministrator
    // fetches it, and the sender is not a signatory on it. One that already has
    // an admin would be rejected on-ledger, so it is not passed.
    const tokenConfigAddress = deriveTokenConfigInstanceAddress(p.instrumentId, ccipOwner)
    const tokenConfig = await chain.findActiveContractByInstanceAddress(
      TOKEN_CONFIG_TEMPLATE_ID,
      tokenConfigAddress,
      [...new Set([p.sender, ...actAs])],
    )
    let existingTokenConfigCid: string | undefined
    if (tokenConfig) {
      const currentAdmin = decodeOptionalParty(
        decodeDamlRecord(tokenConfig.createArgument)['admin'],
      )
      if (currentAdmin === undefined) {
        existingTokenConfigCid = tokenConfig.contractId
        disclosedContracts.push({
          // oxlint-disable-next-line typescript/no-unnecessary-condition
          templateId: tokenConfig.templateId ?? TOKEN_CONFIG_TEMPLATE_ID,
          contractId: tokenConfig.contractId,
          createdEventBlob: tokenConfig.createdEventBlob,
          synchronizerId: tokenConfig.synchronizerId,
        })
      } else {
        chain.logger.warn(
          `${this.name}: TokenConfig ${tokenConfigAddress} already has admin ${currentAdmin}; ` +
            'Initialize will attempt a fresh registration for the instrument',
        )
      }
    }

    const createArguments = buildPoolCreateArguments({ ...p, ccipOwner, deps })
    const choiceArgument = buildInitializeChoiceArgument({
      tokenAdminRegistryCid: tarContract.contractId,
      existingTokenConfigCid,
      admin: p.admin,
      lanes: p.lanes,
    })

    return {
      commands: [
        {
          CreateAndExerciseCommand: {
            templateId: POOL_TEMPLATE_IDS[p.poolType],
            createArguments,
            choice: 'Initialize',
            choiceArgument,
          },
        },
      ],
      commandId: `cct-deploy-${p.poolType}-pool-${crypto.randomUUID()}`,
      // Initialize's controller is `poolOwner, admin` — both must authorize;
      // dedup covers the common case where they're the same party.
      actAs,
      disclosedContracts,
    }
  }

  override async execute(
    chain: CantonChain,
    params: ExecuteDeployTokenPoolParams,
  ): Promise<ExecuteDeployTokenPoolResult> {
    const base = await super.execute(chain, params)

    const templateId = POOL_TEMPLATE_IDS[params.poolType]
    const poolCids = extractCreatedContractIds(base.response, templateId)
    const [poolCid] = poolCids
    if (poolCids.length !== 1 || !poolCid) {
      throw new CCTTxFailedError(
        this.name,
        `expected exactly one created ${templateId}, found ${poolCids.length}`,
        { context: { updateId: base.hash } },
      )
    }

    const { admin: poolOwner } = parseInstrumentId(this.name, 'instrumentId', params.instrumentId)
    return {
      ...base,
      poolCid,
      rateLimiterCids: extractCreatedContractIds(base.response, RATE_LIMITER_TEMPLATE_ID),
      tokenConfigCid: extractCreatedContractIds(base.response, TOKEN_CONFIG_TEMPLATE_ID)[0],
      poolInstanceAddress: hashedRawInstanceAddress(`${params.instanceId}@${poolOwner}`),
    }
  }
}
