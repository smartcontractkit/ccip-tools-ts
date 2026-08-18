/**
 * getRequiredCCVs — read the required committee-verifier instance addresses for
 * a token pool + remote chain + direction via the `GetRequiredCCVs` non-consuming
 * read choice. No wallet required.
 *
 * Ported from the Go binding
 * (`burnminttokenpool.BurnMintTokenPool{}.GetRequiredCCVs` /
 * `lockreleasetokenpool.LockReleaseTokenPool{}.GetRequiredCCVs`). The choice
 * returns `[RawInstanceAddress]`; each element's `unpack` field is the raw CCV
 * instance address (hex string).
 *
 * @packageDocumentation
 */

import type { CantonChain } from '../../../../canton/index.ts'
import { decodeDamlRecord, extractFieldValue } from '../../../../canton/index.ts'
import { CantonQuery } from '../../query.ts'
import { CCTParamsInvalidError } from '../../../errors.ts'
import { parseNonEmptyString, parsePartyId } from '../../validate.ts'

/** Transfer direction for `GetRequiredCCVs` (mirrors Daml `TransferDirection`). */
export type TransferDirection = 'Inbound' | 'Outbound'

/** Finality config passed to `GetRequiredCCVs` (mirrors Daml `FinalityConfig`). */
export type FinalityConfig =
  | { type: 'WaitForFinality' }
  | { type: 'WaitForSafe' }
  | { type: 'BlockDepth'; blockConfirmations: number }

/** Parameters for `getRequiredCCVs`. */
export interface GetRequiredCCVsParams {
  /** Pool `InstanceAddress` (`0x<64-hex>` or `"instanceId@poolOwner"`). Resolved via ACS. */
  poolInstanceAddress: string
  /** Pool owner party (for ACS visibility — must be a stakeholder/signatory). */
  poolOwner: string
  /** Pool type (determines the template ID). */
  poolType: 'burnMint' | 'lockRelease'
  /** Acting party (`caller` of the read choice + `actAs`). */
  caller: string
  /** Remote chain selector whose CCV requirements are queried. */
  remoteChainSelector: bigint
  /** Transfer direction (`Inbound` → `inboundCCVs`, `Outbound` → `outboundCCVs`). */
  direction: TransferDirection
  /**
   * Source amount (bytes-hex). The `GetRequiredCCVs` choice accepts this but does
   * not use it for the CCV lookup; pass `0x` when unknown.
   */
  sourceAmount?: string
  /**
   * Finality config (default `WaitForFinality`). Encoded as the Daml variant
   * constructor the choice expects.
   */
  finality?: FinalityConfig
  /** Extra data (bytes-hex); unused by the lookup, default `0x`. */
  extraData?: string
}

/** Result of `getRequiredCCVs`: the required CCV instance addresses. */
export interface GetRequiredCCVsResult {
  /** Raw `unpack` instance addresses of the required committee verifiers. */
  ccvs: string[]
}

/** Parsed params for {@link GetRequiredCCVs.read}. */
interface ParsedGetRequiredCCVs {
  poolInstanceAddress: string
  poolOwner: string
  templateId: string
  caller: string
  remoteChainSelector: string
  direction: TransferDirection
  sourceAmount: string
  finality: Record<string, unknown>
  extraData: string
}

/** Read the required CCVs for a pool. */
export class GetRequiredCCVs extends CantonQuery<
  GetRequiredCCVsParams,
  GetRequiredCCVsResult,
  ParsedGetRequiredCCVs
> {
  readonly name = 'getRequiredCCVs'

  /** Validates inputs and normalizes the pool type into a template ID. */
  protected prepare(p: GetRequiredCCVsParams): ParsedGetRequiredCCVs {
    if (!p.poolInstanceAddress) {
      throw new CCTParamsInvalidError(this.name, 'poolInstanceAddress', 'pool InstanceAddress is required')
    }
    return {
      poolInstanceAddress: p.poolInstanceAddress,
      poolOwner: p.poolOwner,
      templateId:
        p.poolType === 'burnMint'
          ? '#ccip-core-v2:CCIP.BurnMintTokenPoolV2:BurnMintTokenPool'
          : '#ccip-core-v2:CCIP.LockReleaseTokenPoolV2:LockReleaseTokenPool',
      caller: parsePartyId(this.name, 'caller', p.caller),
      remoteChainSelector: p.remoteChainSelector.toString(),
      direction: p.direction,
      sourceAmount: p.sourceAmount ? parseNonEmptyString(this.name, 'sourceAmount', p.sourceAmount) : '0x',
      finality: encodeFinalityConfig(p.finality ?? { type: 'WaitForFinality' }),
      extraData: p.extraData ? parseNonEmptyString(this.name, 'extraData', p.extraData) : '0x',
    }
  }

  /**
   * Resolves the pool by InstanceAddress, then exercises the `GetRequiredCCVs`
   * non-consuming read choice via {@link CantonChain.submitReadChoice} and
   * decodes the returned `[RawInstanceAddress]` into a list of `unpack` strings.
   */
  protected async read(chain: CantonChain, p: ParsedGetRequiredCCVs): Promise<GetRequiredCCVsResult> {
    const pool = await chain.findActiveContractByInstanceAddress(
      p.templateId,
      p.poolInstanceAddress,
      [p.poolOwner],
    )
    if (!pool) {
      throw new CCTParamsInvalidError(
        this.name,
        'poolInstanceAddress',
        `pool ${p.poolInstanceAddress} is not active or not visible to ${p.poolOwner}`,
      )
    }
    const result = await chain.submitReadChoice(
      p.templateId,
      pool.contractId,
      'GetRequiredCCVs',
      {
        remoteChainSelector: p.remoteChainSelector,
        sourceAmount: p.sourceAmount,
        finality: p.finality,
        extraData: p.extraData,
        direction: { [p.direction]: {} },
        context: { values: {} },
        caller: p.caller,
      },
      p.caller,
    )

    const ccvs = decodeRawInstanceAddressList(result)
    return { ccvs }
  }
}

/**
 * Encode a {@link FinalityConfig} into the Daml variant the choice expects.
 * `WaitForFinality`/`WaitForSafe` are nullary constructors; `BlockDepth` carries
 * an `Int`. The JSON API represents variants as `{ Constructor: { ...fields } }`.
 */
function encodeFinalityConfig(fc: FinalityConfig): Record<string, unknown> {
  switch (fc.type) {
    case 'WaitForFinality':
      return { WaitForFinality: {} }
    case 'WaitForSafe':
      return { WaitForSafe: {} }
    case 'BlockDepth':
      return { BlockDepth: { blockConfirmations: fc.blockConfirmations } }
  }
}

/**
 * Decode the `GetRequiredCCVs` exercise result (a `[RawInstanceAddress]`) into a
 * list of `unpack` strings. Handles both the gRPC `{ Sum: { Record: { fields } } }`
 * form and the bare `{ unpack: "0x..." }` form for each list element.
 */
function decodeRawInstanceAddressList(result: unknown): string[] {
  if (!Array.isArray(result)) return []
  const out: string[] = []
  for (const element of result as unknown[]) {
    const fields = decodeDamlRecord(element)
    const unpack = extractFieldValue(fields['unpack'])
    if (typeof unpack === 'string' && unpack.length > 0) out.push(unpack)
  }
  return out
}
