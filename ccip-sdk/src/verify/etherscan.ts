/*
 * Low-level Etherscan V2 API client for contract verification.
 *
 * V2 model (confirmed in BOTH references):
 *  - Single endpoint for every chain: https://api.etherscan.io/v2/api
 *  - The target chain is selected by the `chainid` query parameter.
 *  - One API key works across all 60+ supported chains.
 *    foundry-src: foundry-block-explorers test asserts
 *      https://api.etherscan.io/v2/api?chainid=11155111
 *    hardhat3-src: packages/hardhat-verify/src/internal/etherscan.ts
 *      ETHERSCAN_API_URL = "https://api.etherscan.io/v2/api", chainid passed per call.
 *
 * Transport:
 *  - verifysourcecode  -> POST, body application/x-www-form-urlencoded
 *  - checkverifystatus -> GET (foundry POSTs it; both are accepted)
 *  - module/action/chainid/apikey go in the query string; the large fields
 *    (sourceCode, contractaddress, ...) go in the POST body.
 *
 * We use the built-in fetch (Node >= 18). The real ccip-sdk uses axios; swapping the
 * transport is mechanical — only request() below would change.
 */

import { CCIPContractVerificationError } from '../errors/index.ts'

/** The single Etherscan V2 API endpoint; the target chain is selected via `chainid`. */
export const ETHERSCAN_V2_API_URL = 'https://api.etherscan.io/v2/api'

/** Default `fetch` wrapper that always invokes the global `fetch` with the correct receiver. */
export const defaultFetch: typeof fetch = (...args) => fetch(...args)

/** Envelope returned by every Etherscan action; `status` is the string "0" or "1". */
export interface EtherscanResponse {
  /** "0" (failure) or "1" (success). */
  status: string
  /** Short status message, e.g. "OK" or "NOTOK". */
  message: string
  /** Action payload: a GUID, a status string, or a JSON array (depending on the action). */
  result: string
}

/** Body of a `verifysourcecode` submission. */
export interface VerifySourceCodeBody {
  /** Source encoding; "solidity-standard-json-input" for the standard-json flow. */
  codeformat: 'solidity-standard-json-input' | 'solidity-single-file' | 'vyper-json'
  /** The stringified standard JSON input (or flattened source for single-file). */
  sourceCode: string
  /** The deployed contract address. */
  contractaddress: string
  /** Fully-qualified name `path/File.sol:Name`. */
  contractname: string
  /** Long form, e.g. "v0.8.26+commit.8a97fa7a". */
  compilerversion: string
  /** ABI-encoded constructor args, hex, no `0x`, no selector. */
  constructorArguments?: string
  /** Optional SPDX license code (1..14). */
  licenseType?: number
  /** Single-file path only: whether the optimizer was enabled ("0" or "1"). */
  optimizationUsed?: '0' | '1'
  /** Single-file path only: optimizer runs. */
  runs?: number
  /** Single-file path only: target EVM version. */
  evmversion?: string
}

/*
 * Which explorer family we're talking to. Both speak the same Etherscan-style
 * verifysourcecode/checkverifystatus actions, but differ in URL/auth:
 *  - 'etherscan'  : V2 single endpoint, chainid + apikey required.
 *  - 'blockscout' : per-chain {base}/api endpoint, NO chainid, apikey optional/unused.
 */
/** Which Etherscan-compatible explorer family a client talks to. */
export type ExplorerProvider = 'etherscan' | 'blockscout'

/** Low-level Etherscan V2 (and Blockscout) client for the verify/status actions. */
export class EtherscanV2Client {
  private readonly chainId: number
  private readonly apiKey: string
  private readonly apiUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly provider: ExplorerProvider

  /** Builds a client for one chain/explorer, with optional URL, fetch impl, and provider. */
  constructor(
    chainId: number,
    apiKey: string,
    apiUrl: string = ETHERSCAN_V2_API_URL,
    fetchImpl: typeof fetch = defaultFetch,
    provider: ExplorerProvider = 'etherscan',
  ) {
    this.chainId = chainId
    this.apiKey = apiKey
    this.apiUrl = apiUrl
    this.fetchImpl = fetchImpl
    this.provider = provider
  }

  /** Submit a verification request; returns the GUID to poll. Throws on hard errors. */
  async verifySourceCode(body: VerifySourceCodeBody): Promise<string> {
    // Etherscan historically misspells the field as `constructorArguements`. Foundry sends
    // BOTH spellings (the misspelled one for Etherscan, the correct one for Blockscout).
    // We do the same for maximum compatibility.
    const form: Record<string, string> = {
      codeformat: body.codeformat,
      sourceCode: body.sourceCode,
      contractaddress: body.contractaddress,
      contractname: body.contractname,
      compilerversion: body.compilerversion,
    }
    if (body.constructorArguments) {
      form.constructorArguements = body.constructorArguments // Etherscan (sic)
      form.constructorArguments = body.constructorArguments // Blockscout
    }
    if (body.licenseType != null) form.licenseType = String(body.licenseType)
    if (body.optimizationUsed != null) form.optimizationUsed = body.optimizationUsed
    if (body.runs != null) form.runs = String(body.runs)
    if (body.evmversion) form.evmversion = body.evmversion

    const res = await this.post('verifysourcecode', form)
    if (res.status !== '1') {
      // On failure Etherscan puts a generic "NOTOK" in `message` and the ACTUAL reason in
      // `result` (e.g. "Unable to locate ContractCode at 0x…", "Invalid API Key",
      // "Missing/unsupported chainid"). Surface the detailed one.
      throw new CCIPContractVerificationError(res.result || res.message, {
        context: { result: res.result },
      })
    }
    return res.result // GUID
  }

  /** Poll a verification GUID. Returns the raw envelope; caller interprets `result`. */
  async checkVerifyStatus(guid: string): Promise<EtherscanResponse> {
    return this.get('checkverifystatus', { guid })
  }

  /** Whether the address already has verified source (skip work if so). */
  async isVerified(address: string): Promise<boolean> {
    const res = await this.get('getsourcecode', { address })
    if (res.status !== '1') return false
    // result is a JSON array string; SourceCode non-empty => verified.
    try {
      const parsed = JSON.parse(res.result) as Array<{ SourceCode?: string }>
      return Boolean(parsed[0]?.SourceCode)
    } catch {
      return false
    }
  }

  // --- transport ---------------------------------------------------------------

  /** Build the action URL with the right query params for the configured provider. */
  private query(action: string): string {
    const u = new URL(this.apiUrl)
    u.searchParams.set('module', 'contract')
    u.searchParams.set('action', action)
    if (this.provider === 'etherscan') {
      // V2 needs chainid + apikey on every call.
      u.searchParams.set('chainid', String(this.chainId))
      u.searchParams.set('apikey', this.apiKey)
    } else {
      // Blockscout: instance is single-chain (no chainid). apikey only if the instance wants one.
      if (this.apiKey) u.searchParams.set('apikey', this.apiKey)
    }
    return u.toString()
  }

  /** POST a form-encoded body to the given action and parse the envelope. */
  private async post(action: string, form: Record<string, string>): Promise<EtherscanResponse> {
    const res = await this.fetchImpl(this.query(action), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    })
    return this.parse(res)
  }

  /** GET the given action with query params appended and parse the envelope. */
  private async get(action: string, params: Record<string, string>): Promise<EtherscanResponse> {
    const u = new URL(this.query(action))
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    const res = await this.fetchImpl(u.toString(), { method: 'GET' })
    return this.parse(res)
  }

  /** Parse an HTTP response into an Etherscan envelope, throwing on a non-OK status. */
  private async parse(res: Response): Promise<EtherscanResponse> {
    if (!res.ok)
      throw new CCIPContractVerificationError(`Etherscan HTTP ${res.status} ${res.statusText}`)
    const json = (await res.json()) as EtherscanResponse
    return json
  }
}
