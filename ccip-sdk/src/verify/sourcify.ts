/*
 * Sourcify verification provider — the key-less, registry-less universal verifier.
 *
 * Unlike Etherscan/Blockscout (form-encoded verifysourcecode actions), Sourcify uses a JSON
 * REST API and matches the on-chain bytecode against a recompile of the standard-json. It needs
 * NO API key and NO per-chain explorer URL — just the chainId + the standard-json we already
 * bundle. This is what foundry (crates/verify/src/sourcify.rs) and hardhat
 * (packages/hardhat-verify/src/internal/sourcify.ts) use to cover chains outside Etherscan v2.
 *
 * Sourcify v2 endpoints (base/chainId/address are path params):
 *   verify : POST base/v2/verify/chainId/address     (JSON) -> { verificationId }
 *   poll   : GET  base/v2/verify/verificationId      -> { isJobCompleted, contract, error }
 *   lookup : GET  base/v2/contract/chainId/address   -> { match, ... } or 404
 *
 * Constructor args are NOT sent: Sourcify recompiles and compares bytecode; the (optional)
 * creationTransactionHash only helps it do a creation-bytecode match.
 */
import { defaultFetch } from './etherscan.ts'
import type { StandardJsonInput } from './types.ts'
import { CCIPContractVerificationError } from '../errors/index.ts'

/** Default Sourcify server base URL (key-less, multi-chain). */
export const SOURCIFY_API_URL = 'https://sourcify.dev/server'

/** Arguments for a Sourcify verification submission. */
export interface SourcifyVerifyArgs {
  /** EVM chain id. */
  chainId: number
  /** The deployed contract address. */
  address: string
  /** The standard JSON input (sources + settings) to recompile and match. */
  stdJsonInput: StandardJsonInput
  /** "sourceName:ContractName" — same FQN as Etherscan's contractname. */
  contractIdentifier: string
  /** Full solc version, NO leading "v": e.g. "0.8.26+commit.8a97fa7a". */
  compilerVersion: string
  /** Optional: lets Sourcify also attempt a creation-bytecode match. */
  creationTransactionHash?: string
}

/** The outcome of polling a Sourcify verification job. */
export interface SourcifyJobResult {
  /** Whether the job has finished. */
  done: boolean
  /** "match" | "exact_match" | null — Sourcify's match grade once done. */
  match: string | null
  /** Sourcify error/custom code when the job failed (e.g. "already_verified"). */
  errorCode?: string
}

/** Key-less JSON client for the Sourcify v2 verification API. */
export class SourcifyClient {
  private readonly apiUrl: string
  private readonly fetchImpl: typeof fetch

  /** Builds a Sourcify client with an optional server base URL and fetch impl. */
  constructor(apiUrl: string = SOURCIFY_API_URL, fetchImpl: typeof fetch = defaultFetch) {
    this.apiUrl = apiUrl
    this.fetchImpl = fetchImpl
  }

  /** The server base URL with any trailing slash removed. */
  private base(): string {
    return this.apiUrl.replace(/\/$/, '')
  }

  /** Already has a verified match on Sourcify? */
  async isVerified(chainId: number, address: string): Promise<boolean> {
    const res = await this.fetchImpl(`${this.base()}/v2/contract/${chainId}/${address}`)
    if (res.status === 404) return false
    if (!res.ok) return false
    const body = (await res.json()) as { match?: string | null }
    return body.match != null
  }

  /** Submit a verification job; returns the verificationId (job guid) or 'already-verified'. */
  async verify(
    args: SourcifyVerifyArgs,
  ): Promise<{ verificationId?: string; alreadyVerified?: boolean }> {
    const body: Record<string, unknown> = {
      stdJsonInput: args.stdJsonInput, // NOTE: the object itself, not JSON.stringify'd
      contractIdentifier: args.contractIdentifier,
      compilerVersion: args.compilerVersion,
    }
    if (args.creationTransactionHash) body.creationTransactionHash = args.creationTransactionHash

    const res = await this.fetchImpl(`${this.base()}/v2/verify/${args.chainId}/${args.address}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.status === 409) return { alreadyVerified: true } // already verified
    if (res.status !== 202 && res.status !== 200) {
      const text = await res.text().catch(() => '')
      throw new CCIPContractVerificationError(
        `Sourcify verify failed: HTTP ${res.status} ${text.slice(0, 300)}`,
      )
    }
    const json = (await res.json()) as { verificationId?: string }
    return { verificationId: json.verificationId }
  }

  /** Poll a verification job. */
  async checkStatus(verificationId: string): Promise<SourcifyJobResult> {
    const res = await this.fetchImpl(`${this.base()}/v2/verify/${verificationId}`)
    if (!res.ok) throw new CCIPContractVerificationError(`Sourcify status HTTP ${res.status}`)
    const j = (await res.json()) as {
      isJobCompleted?: boolean
      contract?: { match?: string | null }
      error?: { customCode?: string; message?: string }
    }
    return {
      done: Boolean(j.isJobCompleted),
      match: j.contract?.match ?? null,
      errorCode: j.error?.customCode,
    }
  }
}
