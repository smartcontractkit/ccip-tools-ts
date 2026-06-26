/*
 * High-level verifyContract() — the function the CCIP SDK would expose.
 *
 * Flow (mirrors forge verify-contract and hardhat-verify orchestration):
 *   1. Resolve the long, commit-qualified compiler version.
 *   2. ABI-encode the constructor arguments (no 0x, no selector).
 *   3. (optional) Short-circuit if already verified.
 *   4. POST verifysourcecode and receive a GUID.
 *   5. Poll checkverifystatus until Pass / Fail / Already-Verified or timeout.
 *
 * The SDK already holds the two heavy inputs:
 *   - the standard JSON input (sources + settings used to produce the init code), and
 *   - the constructor params the user supplied at deploy time.
 * So at the call site the user only adds: deployed address, chainId, and their API key.
 */

import { encodeConstructorArgs } from './constructor-args.ts'
import { EtherscanV2Client, defaultFetch } from './etherscan.ts'
import { resolveLongCompilerVersion } from './solc-version.ts'
import { SourcifyClient } from './sourcify.ts'
import type { VerifyContractInput, VerifyResult } from './types.ts'
import { CCIPContractVerificationError } from '../errors/index.ts'

// Status markers returned by checkverifystatus (see Etherscan v2 docs + both clients).
const PENDING = 'Pending in queue'
const SUCCESS = 'Pass - Verified'
const FAIL_PREFIX = 'Fail - Unable to verify'
const ALREADY_VERIFIED_MARKERS = ['Contract source code already verified', 'Already Verified']

/** Verify an already-deployed contract on Etherscan/Blockscout/Sourcify and await the outcome. */
export async function verifyContract(
  input: VerifyContractInput,
  deps: {
    fetchImpl?: typeof fetch
    allowNetworkForSolcList?: boolean
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<VerifyResult> {
  const fetchImpl = deps.fetchImpl ?? defaultFetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  // Sourcify is a structurally different API (JSON, bytecode-match, no key) — handle it separately.
  if (input.verifier?.provider === 'sourcify') {
    return verifyOnSourcify(input, fetchImpl, sleep)
  }

  // A `verifier` override (Blockscout / standalone explorer) wins over the default v2 setup.
  const client = input.verifier
    ? new EtherscanV2Client(
        input.chainId,
        input.verifier.apiKey ?? '',
        input.verifier.apiUrl,
        fetchImpl,
        input.verifier.provider,
      )
    : new EtherscanV2Client(input.chainId, input.apiKey, input.apiUrl, fetchImpl, 'etherscan')

  // 1. compiler version: "0.8.26" -> "v0.8.26+commit.8a97fa7a"
  const compilerversion = await resolveLongCompilerVersion(input.compilerVersion, {
    fetchImpl,
    allowNetwork: deps.allowNetworkForSolcList,
  })

  // 2. constructor args -> hex (no 0x, no selector)
  const constructorArguments = encodeConstructorArgs(input.constructorArgs)

  // 3. (optional) skip if already verified
  if (await client.isVerified(input.contractAddress)) {
    return {
      status: 'already-verified',
      message: 'Contract source code already verified',
      explorerUrl: undefined,
    }
  }

  // 4. submit
  let guid: string
  try {
    guid = await client.verifySourceCode({
      codeformat: 'solidity-standard-json-input',
      sourceCode: JSON.stringify(input.standardJsonInput),
      contractaddress: input.contractAddress,
      contractname: input.contractName,
      compilerversion,
      constructorArguments: constructorArguments || undefined,
      licenseType: input.licenseType,
    })
  } catch (err) {
    if (err instanceof CCIPContractVerificationError && isAlreadyVerified(err.message)) {
      return { status: 'already-verified', message: err.message }
    }
    throw err
  }

  // 5. poll
  const intervalMs = input.polling?.intervalMs ?? 3_000
  const timeoutMs = input.polling?.timeoutMs ?? 120_000
  const deadline = Date.now() + timeoutMs

  // Etherscan needs a moment before the GUID is queryable (hardhat sleeps ~0.5s first).
  await sleep(Math.min(1_000, intervalMs))

  for (;;) {
    const res = await client.checkVerifyStatus(guid)
    const result = res.result

    if (result === PENDING) {
      if (Date.now() > deadline) {
        // Some explorers (e.g. Routescan/Snowtrace) finish verifying but lag on checkverifystatus,
        // sometimes by minutes. Confirm the real outcome via getsourcecode, retrying a few times.
        for (let i = 0; i < (input.polling?.confirmAttempts ?? 4); i++) {
          if (await client.isVerified(input.contractAddress)) {
            return {
              status: 'verified',
              guid,
              message: 'Verified (confirmed via getsourcecode after status lag)',
            }
          }
          await sleep(intervalMs)
        }
        return {
          status: 'failed',
          guid,
          message: `Timed out after ${timeoutMs}ms while pending (explorer may still finish; re-check getsourcecode)`,
        }
      }
      await sleep(intervalMs)
      continue
    }
    if (result === SUCCESS) {
      return { status: 'verified', guid, message: result }
    }
    if (isAlreadyVerified(result)) {
      return { status: 'already-verified', guid, message: result }
    }
    if (result.startsWith(FAIL_PREFIX)) {
      return { status: 'failed', guid, message: result }
    }
    // status "0" with some other message => hard failure.
    if (res.status === '0') {
      return { status: 'failed', guid, message: result || res.message }
    }
    // Unknown but ok-ish; treat as terminal success-ish to avoid infinite loops.
    return { status: 'verified', guid, message: result }
  }
}

function isAlreadyVerified(msg: string): boolean {
  return ALREADY_VERIFIED_MARKERS.some((m) => msg.startsWith(m))
}

/* Sourcify flow: JSON submit, then poll by verificationId until matched. No key, no chainid. */
async function verifyOnSourcify(
  input: VerifyContractInput,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<VerifyResult> {
  const apiUrl = input.verifier?.provider === 'sourcify' ? input.verifier.apiUrl : undefined
  const client = new SourcifyClient(apiUrl, fetchImpl)

  if (await client.isVerified(input.chainId, input.contractAddress)) {
    return { status: 'already-verified', message: 'Already verified on Sourcify' }
  }

  // Sourcify wants the bare solc version (no leading "v") and the standard-json object itself.
  const compilerVersion = (await resolveLongCompilerVersion(input.compilerVersion)).replace(
    /^v/,
    '',
  )

  const submit = await client.verify({
    chainId: input.chainId,
    address: input.contractAddress,
    stdJsonInput: input.standardJsonInput,
    contractIdentifier: input.contractName,
    compilerVersion,
    creationTransactionHash: input.creationTransactionHash,
  })
  if (submit.alreadyVerified)
    return { status: 'already-verified', message: 'Already verified on Sourcify' }
  const guid = submit.verificationId
  if (!guid) return { status: 'failed', message: 'Sourcify returned no verificationId' }

  const intervalMs = input.polling?.intervalMs ?? 3_000
  const timeoutMs = input.polling?.timeoutMs ?? 120_000
  const deadline = Date.now() + timeoutMs
  await sleep(Math.min(1_000, intervalMs))

  for (;;) {
    const st = await client.checkStatus(guid)
    if (!st.done) {
      if (Date.now() > deadline)
        return { status: 'failed', guid, message: `Sourcify timed out after ${timeoutMs}ms` }
      await sleep(intervalMs)
      continue
    }
    if (st.errorCode === 'already_verified')
      return { status: 'already-verified', guid, message: 'Already verified on Sourcify' }
    if (st.match) return { status: 'verified', guid, message: `Sourcify: ${st.match}` } // "match" | "exact_match"
    return { status: 'failed', guid, message: st.errorCode ?? 'Sourcify: no match' }
  }
}
