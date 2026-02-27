import type { DisclosedContract } from './types.ts'
import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'

/**
 * Configuration for the EDS-based disclosure provider.
 * Requires only the EDS base URL — no direct ledger access needed.
 */
interface EdsDisclosureConfig {
  /** Base URL of the running EDS instance, e.g. `http://eds-host:8090` */
  edsBaseUrl: string
  /** Optional request timeout in milliseconds (default: 10_000) */
  timeoutMs?: number
}

/**
 * The context returned by the EDS for a send or execute request.
 *
 * Corresponds to `ChoiceContext` in the EDS OpenAPI spec.
 * - `choiceContextData` must be included as additional data when exercising the Canton choice.
 * - `disclosedContracts` must be attached to the Canton command submission.
 */
interface EdsChoiceContext {
  /** Additional opaque data required when exercising the Canton choice. */
  choiceContextData: unknown
  /** Contracts that must be explicitly disclosed in the command submission. */
  disclosedContracts: DisclosedContract[]
}

/**
 * Result of a `fetchPerPartyRouterFactoryDisclosures()` call.
 *
 * Corresponds to `CCIPPerPartyRouterFactoryResponse` in the EDS OpenAPI spec.
 */
interface EdsPerPartyRouterFactoryResult {
  /** The Contract ID of the PerPartyRouterFactory. */
  perPartyRouterFactoryId: string
  /** Disclosures for all contracts required to instantiate a PerPartyRouter. */
  disclosedContracts: DisclosedContract[]
}

/**
 * A single disclosed contract as returned by the EDS API.
 * `templateId` is already a flat colon-delimited string (`"<pkgId>:Module:Entity"`).
 */
interface EdsApiDisclosedContract {
  templateId: string
  contractId: string
  createdEventBlob: string
  synchronizerId: string
}

/** `ChoiceContext` object returned from send/execute endpoints. */
interface EdsApiChoiceContext {
  choiceContextData: unknown
  disclosedContracts: EdsApiDisclosedContract[]
}

/** Response body of `POST /ccip/v1/message/send`. */
interface EdsCCIPSendResponse {
  choiceContext: EdsApiChoiceContext
}

/** Response body of `POST /ccip/v1/message/execute`. */
interface EdsCCIPExecuteResponse {
  choiceContext: EdsApiChoiceContext
}

/** Response body of `POST /ccip/v1/perPartyRouter/factory`. */
interface EdsPerPartyRouterFactoryResponse {
  perPartyRouterFactoryId: string
  disclosedContracts: EdsApiDisclosedContract[]
}

/** EDS error response body. */
interface EdsErrorResponse {
  error: string
  details?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function edsContractToSdk(c: EdsApiDisclosedContract): DisclosedContract {
  return {
    templateId: c.templateId,
    contractId: c.contractId,
    createdEventBlob: c.createdEventBlob,
    synchronizerId: c.synchronizerId,
  }
}

function rawContextToSdk(raw: EdsApiChoiceContext): EdsChoiceContext {
  return {
    choiceContextData: raw.choiceContextData,
    disclosedContracts: raw.disclosedContracts.map(edsContractToSdk),
  }
}

async function edsPost<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      `EDS request failed for ${url}: ${msg}. Ensure the EDS is running and reachable.`,
      { cause: err instanceof Error ? err : undefined },
    )
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    let detail = ''
    try {
      const errBody = (await response.json()) as EdsErrorResponse
      detail = ` ${errBody.error}${errBody.details ? `: ${errBody.details}` : ''}`
    } catch {
      detail = ` HTTP ${response.status}`
    }
    throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, `EDS${detail} — URL: ${url}`)
  }

  return response.json() as Promise<T>
}

/**
 * Disclosure provider that fetches explicit disclosures from a running EDS instance
 * using the CCIP Explicit Disclosure API
 */
export class EdsDisclosureProvider {
  private readonly edsBaseUrl: string
  private readonly timeoutMs: number

  /**
   * Create an `EdsDisclosureProvider` from an EDS connection configuration.
   *
   * @param config - EDS connection configuration.
   */
  constructor(config: EdsDisclosureConfig) {
    this.edsBaseUrl = config.edsBaseUrl.replace(/\/$/, '')
    this.timeoutMs = config.timeoutMs ?? 10_000
  }

  /**
   * Fetch the explicit disclosures required to send a CCIP message to Canton.
   *
   * Calls `POST /ccip/v1/message/send`.
   *
   * @param destChain - Destination chain selector (integer).
   * @returns `EdsChoiceContext` containing the `choiceContextData` and all
   *   `disclosedContracts` that must be attached to the Canton command submission.
   */
  async fetchSendDisclosures(destChain: number): Promise<EdsChoiceContext> {
    const url = `${this.edsBaseUrl}/ccip/v1/message/send`
    const resp = await edsPost<EdsCCIPSendResponse>(url, { destChain }, this.timeoutMs)
    return rawContextToSdk(resp.choiceContext)
  }

  /**
   * Fetch the explicit disclosures required to execute a CCIP message on Canton.
   *
   * Calls `POST /ccip/v1/message/execute`.
   *
   * @param sourceChain - Source chain selector (integer).
   * @returns `EdsChoiceContext` containing the `choiceContextData` and all
   *   `disclosedContracts` that must be attached to the Canton command submission.
   */
  async fetchExecutionDisclosures(sourceChain: number): Promise<EdsChoiceContext> {
    const url = `${this.edsBaseUrl}/ccip/v1/message/execute`
    const resp = await edsPost<EdsCCIPExecuteResponse>(url, { sourceChain }, this.timeoutMs)
    return rawContextToSdk(resp.choiceContext)
  }

  /**
   * Fetch the explicit disclosures required to instantiate a PerPartyRouter
   * using the PerPartyRouterFactory.
   *
   * Calls `POST /ccip/v1/perPartyRouter/factory`.
   *
   * @param partyID - The Daml party ID of the caller.
   * @returns `EdsPerPartyRouterFactoryResult` containing the factory contract ID
   *   and all `disclosedContracts` needed to instantiate a PerPartyRouter.
   */
  async fetchPerPartyRouterFactoryDisclosures(
    partyID: string,
  ): Promise<EdsPerPartyRouterFactoryResult> {
    const url = `${this.edsBaseUrl}/ccip/v1/perPartyRouter/factory`
    const resp = await edsPost<EdsPerPartyRouterFactoryResponse>(url, { partyID }, this.timeoutMs)
    return {
      perPartyRouterFactoryId: resp.perPartyRouterFactoryId,
      disclosedContracts: resp.disclosedContracts.map(edsContractToSdk),
    }
  }
}
