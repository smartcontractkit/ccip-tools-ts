import type {
  DisclosedContract,
  DisclosureProvider,
  EdsDisclosureConfig,
  ExecutionDisclosures,
  SendDisclosures,
} from './types.ts'
import { CCIPError, CCIPErrorCode } from '../../errors/index.ts'

/** Structured Daml template identifier as returned by the EDS. */
interface EdsTemplateID {
  packageId: string
  moduleName: string
  entityName: string
}

/**
 * A single contract as returned by the EDS.
 * `createdEventBlob` is base64-encoded.
 */
interface EdsDisclosedContract {
  contractId: string
  instanceId: string
  templateId: EdsTemplateID
  createdEventBlob: string
  synchronizerId?: string
}

// TODO: Add EdsCCIPExecuteDisclosures interface here once the EDS execute endpoint
// returns globalConfig and rmnRemote fields.

/** EDS `/disclosures/send` response body. */
interface EdsCCIPSendDisclosures {
  environmentId: string
  contracts: {
    router: EdsDisclosedContract | null
    onRamp: EdsDisclosedContract | null
    feeQuoter: EdsDisclosedContract | null
  }
}

/** EDS `/health` response body. */
interface EdsHealthResponse {
  status: string
  ledgerApiConnected: boolean
  environments: string[]
}

/** EDS error response body. */
interface EdsErrorResponse {
  error: string
  code?: string
  details?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an EDS `DisclosedContract` to the SDK's internal `DisclosedContract`.
 * The EDS uses a structured `templateId`; the SDK uses a flat colon-delimited string.
 */
function edsContractToSdk(c: EdsDisclosedContract): DisclosedContract {
  return {
    templateId: `${c.templateId.packageId}:${c.templateId.moduleName}:${c.templateId.entityName}`,
    contractId: c.contractId,
    createdEventBlob: c.createdEventBlob,
    synchronizerId: c.synchronizerId,
  }
}

async function edsGet<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(url, { signal: controller.signal })
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
      const body = (await response.json()) as EdsErrorResponse
      detail = ` [${body.code ?? response.status}] ${body.error}`
    } catch {
      detail = ` HTTP ${response.status}`
    }
    throw new CCIPError(CCIPErrorCode.CANTON_API_ERROR, `EDS${detail} — URL: ${url}`)
  }

  return response.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// EdsDisclosureProvider
// ---------------------------------------------------------------------------

/**
 * Disclosure provider that fetches `createdEventBlob`s from a running EDS instance.
 *
 * This is the recommended approach for deployments where CCIP contracts are owned
 * by a different party than the message executor — the EDS holds credentials
 * allowing it to read those contracts on the user's behalf.
 *
 * @example
 * ```ts
 * const provider = new EdsDisclosureProvider({
 *   edsBaseUrl: 'http://eds.internal:8090',
 *   environmentId: 'testnet',
 * })
 *
 * // Optional: verify connectivity before use
 * await provider.checkHealth()
 *
 * const disclosures = await provider.fetchSendDisclosures()
 * ```
 *
 * @remarks
 * **Placeholder**: `fetchExecutionDisclosures()` currently throws because the EDS
 * execute endpoint does not yet return `globalConfig` or `rmnRemote`. Use
 * `AcsDisclosureProvider` for execution until the EDS is extended.
 */
export class EdsDisclosureProvider implements DisclosureProvider {
  private readonly edsBaseUrl: string
  private readonly environmentId: string
  private readonly timeoutMs: number

  /**
   * Create an `EdsDisclosureProvider` from an EDS connection configuration.
   *
   * @param config - EDS connection configuration.
   */
  constructor(config: EdsDisclosureConfig) {
    this.edsBaseUrl = config.edsBaseUrl.replace(/\/$/, '')
    this.environmentId = config.environmentId
    this.timeoutMs = config.timeoutMs ?? 10_000
  }

  /**
   * Verify that the EDS is reachable and has the configured environment loaded.
   *
   * @throws `CCIPError(CANTON_API_ERROR)` if the EDS is unreachable or the
   *   environment is not listed in the health response.
   */
  async checkHealth(): Promise<void> {
    const url = `${this.edsBaseUrl}/api/v1/health`
    const health = await edsGet<EdsHealthResponse>(url, this.timeoutMs)

    if (health.status !== 'healthy') {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `EDS reports unhealthy status: "${health.status}"`,
      )
    }

    if (!health.environments.includes(this.environmentId)) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `EDS does not have environment "${this.environmentId}" loaded. ` +
          `Available: ${health.environments.join(', ') || '(none)'}`,
      )
    }
  }

  /**
   * Fetch all contracts that must be disclosed for a `ccipExecute` command.
   *
   * @throws Always — the EDS execute endpoint does not yet return `globalConfig`
   *   or `rmnRemote`. This method is a placeholder pending EDS extension.
   *   Use `AcsDisclosureProvider` for execution.
   */
  fetchExecutionDisclosures(_extraCcvAddresses: string[] = []): Promise<ExecutionDisclosures> {
    // TODO: Remove this throw and uncomment mapExecuteDisclosures() once the EDS
    // CCIPExecuteContracts struct is extended with globalConfig and rmnRemote fields.
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      'EdsDisclosureProvider.fetchExecutionDisclosures is not yet available: the EDS execute ' +
        'endpoint does not return "globalConfig" or "rmnRemote". Use AcsDisclosureProvider.',
    )
  }

  /**
   * Fetch all contracts that must be disclosed for a `ccipSend` command.
   *
   * Calls `GET /api/v1/ccip/ENVIRONMENT_ID/disclosures/send`.
   */
  async fetchSendDisclosures(): Promise<SendDisclosures> {
    const url = `${this.edsBaseUrl}/api/v1/ccip/${encodeURIComponent(this.environmentId)}/disclosures/send`
    const eds = await edsGet<EdsCCIPSendDisclosures>(url, this.timeoutMs)
    return this.mapSendDisclosures(eds)
  }

  /** Map the EDS send response to the SDK `SendDisclosures` shape. */
  private mapSendDisclosures(eds: EdsCCIPSendDisclosures): SendDisclosures {
    const { router, onRamp, feeQuoter } = eds.contracts

    if (!router) this.missingContract('router', 'send')
    if (!onRamp) this.missingContract('onRamp', 'send')
    if (!feeQuoter) this.missingContract('feeQuoter', 'send')

    // TypeScript narrows router/onRamp/feeQuoter to non-null after the missingContract() guards above
    // because missingContract() returns `never` — execution only reaches here when all three are set.
    return {
      router: edsContractToSdk(router),
      onRamp: edsContractToSdk(onRamp),
      feeQuoter: edsContractToSdk(feeQuoter),
    }
  }

  /** Throw a descriptive error for a missing contract in an EDS response. */
  private missingContract(field: string, operation: string): never {
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      `EDS returned null for "${field}" in the ${operation} disclosures response ` +
        `(environment "${this.environmentId}"). ` +
        `Verify the EDS environments.yaml configuration contains a "${field}" instance ID.`,
    )
  }
}
