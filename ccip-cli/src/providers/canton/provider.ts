import type { EventListener, Provider } from '@canton-network/core-splice-provider'
import type { RequestArgs } from '@canton-network/core-types'
import type {
  LedgerApiParams,
  LedgerApiResult,
  PrepareExecuteAndWaitResult,
  PrepareExecuteParams,
  RpcTypes,
  Wallet,
} from '@canton-network/core-wallet-dapp-rpc-client'
import { type PartyId, parsePartyId } from '@chainlink/ccip-sdk/src/canton/addressCodec.ts'
import type {
  JsExecuteSubmissionAndWaitForTransactionRequest,
  JsPrepareSubmissionRequest,
  JsPrepareSubmissionResponse,
} from '@chainlink/ccip-sdk/src/canton/client/index.ts'
import type { CantonRpcProvider, TransactionSigner } from '@chainlink/ccip-sdk/src/canton/types.ts'
import { CCIPError, CCIPErrorCode, getDataBytes } from '@chainlink/ccip-sdk/src/index.ts'
import axios from 'axios'

// The Canton JSON Ledger API requires HTTP/2. Default to axios's native HTTP/2
// transport; an explicitly provided `fetch` overrides it.
const http2 = axios.create({ httpVersion: 2 })

/** fetch-compatible adapter routing requests through axios's HTTP/2 transport. */
async function http2Fetch(request: Request): Promise<Response> {
  try {
    const response = await http2.request({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      data: request.body ? await request.arrayBuffer() : undefined,
      signal: request.signal,
      responseType: 'arraybuffer',
      // Never throw on non-2xx: errors are classified by response status
      validateStatus: () => true,
    })
    // axios may return AxiosHeaders or a plain object; normalize either into Headers
    const headers = new Headers()
    for (const [key, value] of Object.entries(response.headers)) {
      if (value != null)
        headers.set(key, Array.isArray(value) ? value.map(String).join(', ') : String(value))
    }
    return new Response(response.data, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (error) {
    // Mirror fetch semantics: cancellation surfaces as an AbortError
    if (axios.isCancel(error)) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    throw error
  }
}

interface LedgerJsonRequestOptions {
  method: string
  url: string
  jwt?: string | (() => Promise<string>)
  body?: unknown
  fetchFn?: typeof fetch
}

/** Perform a JSON request against the Canton Ledger API, returning the parsed response body. */
async function ledgerJsonRequest({
  method,
  url,
  jwt,
  body,
  fetchFn,
}: LedgerJsonRequestOptions): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = typeof jwt === 'function' ? await jwt() : jwt
  if (token) headers.Authorization = `Bearer ${token}`
  const hasBody = body !== undefined && method !== 'GET' && method !== 'HEAD'
  if (hasBody) headers['Content-Type'] = 'application/json'

  const request = new Request(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  })

  let response: Response
  try {
    response = await (fetchFn ?? http2Fetch)(request)
  } catch (error) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      `Canton Ledger API ${method} ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error instanceof Error ? error : undefined },
    )
  }

  const text = await response.text()
  if (!response.ok) {
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      `Canton Ledger API ${method} ${url} failed (${response.status}): ${text}`,
    )
  }
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new CCIPError(
      CCIPErrorCode.CANTON_API_ERROR,
      `Canton Ledger API ${method} ${url} returned invalid JSON: ${text.slice(0, 200)}`,
    )
  }
}

/**
 * Node-side Canton provider for the CLI.
 *
 * Unlike the in-browser dApp provider, which proxies `ledgerApi` requests
 * through the validator wallet, this provider talks to the Canton JSON Ledger
 * API directly: `ledgerApi` requests are already in wire format, so the
 * translation layer is a thin HTTP pass-through with JWT authentication.
 */
export class JsonRpcProvider implements CantonRpcProvider {
  // CAIP-2 compliant chain ID, e.g. canton:mainnet
  private readonly chainId: string
  private readonly party: PartyId
  private readonly baseUrl: string
  private readonly jwt: string | (() => Promise<string>)
  private readonly fetchFn: typeof fetch | undefined
  /** Optional external signer (e.g. Ledger). When set, submissions go through the interactive submission API. */
  private readonly signer: TransactionSigner | undefined
  private readonly listeners = new Map<string, EventListener<unknown>[]>()

  private constructor(
    chainId: string,
    baseUrl: string,
    jwt: string | (() => Promise<string>),
    fetchFn: typeof fetch | undefined,
    party: PartyId,
    signer?: TransactionSigner,
  ) {
    this.chainId = chainId
    // Trim a single trailing slash so resource paths join cleanly
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.jwt = jwt
    this.fetchFn = fetchFn
    this.party = party
    this.signer = signer
  }

  async request<M extends keyof RpcTypes>(
    args: RequestArgs<RpcTypes, M>,
  ): Promise<RpcTypes[M]['result']> {
    const methodName: string = args.method
    switch (args.method) {
      case 'ledgerApi':
        return (await this.ledgerApi(
          (args as RequestArgs<RpcTypes, 'ledgerApi'>).params,
        )) as RpcTypes[M]['result']
      case 'prepareExecuteAndWait':
        return (await this.prepareExecuteAndWait(
          (args as RequestArgs<RpcTypes, 'prepareExecuteAndWait'>).params,
        )) as RpcTypes[M]['result']
      case 'getActiveNetwork':
        return { networkId: this.chainId } as RpcTypes[M]['result']
      case 'getPrimaryAccount':
        return (await this.getPrimaryAccount()) as RpcTypes[M]['result']

      // Native provider methods (wallet/session management), not implemented yet.
      case 'listAccounts':
      case 'connect':
      case 'disconnect':
      case 'isConnected':
      case 'prepareExecute':
      case 'signMessage':
      case 'status':
      case 'accountsChanged':
      case 'txChanged':
      case 'messageSignature':
        throw new CCIPError(
          CCIPErrorCode.NOT_IMPLEMENTED,
          `Canton JsonRpcProvider does not implement '${methodName}' yet`,
        )
      default:
        throw new CCIPError(
          CCIPErrorCode.METHOD_UNSUPPORTED,
          `Unknown Canton provider method: ${methodName}`,
        )
    }
  }

  on<E>(event: string, listener: EventListener<E>): Provider<RpcTypes> {
    const existing = this.listeners.get(event) ?? []
    existing.push(listener as EventListener<unknown>)
    this.listeners.set(event, existing)
    return this
  }

  emit<E>(event: string, ...args: E[]): boolean {
    const existing = this.listeners.get(event)
    if (existing == undefined || existing.length === 0) return false
    for (const listener of [...existing]) listener(...args)
    return true
  }

  removeListener<E>(event: string, listenerToRemove: EventListener<E>): Provider<RpcTypes> {
    const existing = this.listeners.get(event)
    if (existing == undefined) return this
    const remaining = existing.filter((listener) => listener !== listenerToRemove)
    if (remaining.length === 0) this.listeners.delete(event)
    else this.listeners.set(event, remaining)
    return this
  }

  static async fromUrl(
    chainId: string,
    url: string,
    jwt: string | (() => Promise<string>),
    fetchFn?: typeof fetch,
    party?: string,
    signer?: TransactionSigner,
  ) {
    const baseUrl = url.replace(/\/$/, '')

    // If no party is provided, get the primary party of the authenticated user
    let partyId: PartyId
    if (party) {
      partyId = parsePartyId(party)
    } else {
      const data = (await ledgerJsonRequest({
        method: 'GET',
        url: `${baseUrl}/v2/authenticated-user`,
        jwt,
        fetchFn,
      })) as { user?: { primaryParty?: string } }
      if (data.user?.primaryParty == undefined || data.user.primaryParty === '') {
        throw new CCIPError(
          CCIPErrorCode.CANTON_API_ERROR,
          `Authenticated user has no primary party set and no party was provided`,
        )
      }
      partyId = parsePartyId(data.user.primaryParty)
    }

    return new JsonRpcProvider(chainId, baseUrl, jwt, fetchFn, partyId, signer)
  }

  getParty(): PartyId {
    return this.party
  }

  /** Translate a `ledgerApi` request into a direct Ledger API HTTP call. */
  private async ledgerApi(params: LedgerApiParams): Promise<LedgerApiResult> {
    let resource = params.resource.startsWith('/') ? params.resource : `/${params.resource}`
    // Substitute `{key}` placeholders when path params are provided
    if (params.path != undefined) {
      for (const [key, value] of Object.entries(params.path)) {
        resource = resource.replaceAll(`{${key}}`, encodeURIComponent(String(value)))
      }
    }

    const url = new URL(`${this.baseUrl}${resource}`)
    if (params.query != undefined) {
      for (const [key, value] of Object.entries(params.query)) {
        if (value === undefined || value === null) continue
        url.searchParams.set(key, String(value))
      }
    }

    return (await ledgerJsonRequest({
      method: params.requestMethod.toUpperCase(),
      url: url.toString(),
      jwt: this.jwt,
      body: params.body,
      fetchFn: this.fetchFn,
    })) as LedgerApiResult
  }

  /**
   * Submit commands and wait for execution.
   *
   * With an external {@link TransactionSigner} configured, the interactive
   * submission API is used: prepare the transaction on the participant, sign
   * the prepared hash externally, then execute with the signatures. Without
   * one, the participant signs with the party's key via JWT-authenticated
   * direct submission.
   */
  private async prepareExecuteAndWait(
    params: PrepareExecuteParams,
  ): Promise<PrepareExecuteAndWaitResult> {
    const commandId =
      params.commandId ?? `ccip-cli-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

    if (this.signer) {
      return (await this.interactiveSubmission(commandId, params)) as PrepareExecuteAndWaitResult
    }

    const response = (await ledgerJsonRequest({
      method: 'POST',
      url: `${this.baseUrl}/v2/commands/submit-and-wait`,
      jwt: this.jwt,
      body: {
        commandId,
        commands: params.commands,
        // The dApp spec defaults actAs to the wallet's primary party
        actAs: params.actAs ?? [this.party],
        readAs: params.readAs,
        disclosedContracts: params.disclosedContracts,
        synchronizerId: params.synchronizerId,
      },
      fetchFn: this.fetchFn,
    })) as { updateId?: string; completionOffset?: number }
    if (response.updateId == undefined) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `Canton submit-and-wait returned no updateId for command ${commandId}`,
      )
    }
    return {
      tx: {
        status: 'executed',
        commandId,
        payload: {
          updateId: response.updateId,
          completionOffset: response.completionOffset ?? 0,
        },
      },
    }
  }

  /**
   * The provider's party as the primary account. The dApp `Wallet` shape's
   * remaining fields are wallet-UI metadata the CLI doesn't need.
   */
  private async getPrimaryAccount(): Promise<Wallet> {
    return {
      primary: true,
      partyId: this.party,
      status: 'allocated',
      hint: '',
      publicKey: '',
      namespace: '',
      networkId: this.chainId,
      signingProviderId: '',
    } as Wallet
  }

  /**
   * Interactive submission with external signing: prepare → sign → execute.
   */
  private async interactiveSubmission(
    commandId: string,
    params: PrepareExecuteParams,
  ): Promise<PrepareExecuteAndWaitResult> {
    // Step 1 — Prepare the transaction on the (preparing) participant node
    const prepareRequest: JsPrepareSubmissionRequest = {
      commandId,
      // The dApp RPC mirrors the Ledger API Command schema loosely (payload as
      // record); the generated type is strict. The wire format is identical.
      commands: params.commands as JsPrepareSubmissionRequest['commands'],
      actAs: params.actAs ?? [this.party],
      readAs: params.readAs,
      disclosedContracts: params.disclosedContracts,
      // must be provided, even if empty
      synchronizerId: params.synchronizerId ?? '',
      hashingSchemeVersion: 'HASHING_SCHEME_VERSION_V3',
      // must be provided, even if empty
      packageIdSelectionPreference: [],
    }
    const prepareResponse = (await ledgerJsonRequest({
      method: 'POST',
      url: `${this.baseUrl}/v2/interactive-submission/prepare`,
      jwt: this.jwt,
      body: prepareRequest,
      fetchFn: this.fetchFn,
    })) as Partial<JsPrepareSubmissionResponse>
    if (!prepareResponse.preparedTransaction || !prepareResponse.preparedTransactionHash) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        'prepareSubmission returned an incomplete response (missing preparedTransaction or hash)',
      )
    }

    // Step 2 — Sign the prepared transaction hash externally
    const hashBytes = getDataBytes(prepareResponse.preparedTransactionHash)
    const partySignatures = await this.signer!.signTxHash(hashBytes)

    // Step 3 — Execute the signed transaction on the (executing) participant node
    const hashingSchemeVersion =
      prepareResponse.hashingSchemeVersion &&
      prepareResponse.hashingSchemeVersion !== 'HASHING_SCHEME_VERSION_UNSPECIFIED'
        ? prepareResponse.hashingSchemeVersion
        : 'HASHING_SCHEME_VERSION_V3'
    const executeRequest: JsExecuteSubmissionAndWaitForTransactionRequest = {
      preparedTransaction: prepareResponse.preparedTransaction,
      partySignatures: {
        signatures: [partySignatures],
      },
      deduplicationPeriod: { Empty: {} },
      hashingSchemeVersion,
      submissionId: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    }
    const { transaction } = (await ledgerJsonRequest({
      method: 'POST',
      url: `${this.baseUrl}/v2/interactive-submission/executeAndWaitForTransaction`,
      jwt: this.jwt,
      body: executeRequest,
      fetchFn: this.fetchFn,
    })) as { transaction?: { updateId?: string; offset?: number } }
    if (transaction?.updateId == undefined) {
      throw new CCIPError(
        CCIPErrorCode.CANTON_API_ERROR,
        `Canton executeAndWaitForTransaction returned no transaction/updateId for command ${commandId}`,
      )
    }
    return {
      tx: {
        status: 'executed',
        commandId,
        payload: {
          updateId: transaction.updateId,
          completionOffset: transaction.offset ?? 0,
        },
      },
    }
  }
}
