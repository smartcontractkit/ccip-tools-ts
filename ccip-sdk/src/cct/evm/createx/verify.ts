/**
 * Pre-flight check that a chain is running the CreateX everyone reviewed.
 *
 * @remarks CreateX is deployed at the same address on every chain, but that address is not a
 * guarantee of anything by itself — an address is only as trustworthy as the code behind it. This
 * hashes the deployed runtime bytecode and compares it against the published hash, which is the
 * check to run once per chain before the first deployment on it.
 *
 * @packageDocumentation
 */

import { keccak256 } from 'ethers'

import type { EVMChain } from '../../../evm/index.ts'
import {
  CREATEX_ADDRESS,
  CREATEX_RUNTIME_CODE_HASH,
  CREATEX_UNSUPPORTED_CHAIN_IDS,
} from './contracts.ts'

/**
 * Outcome of {@link verifyCreateXDeployment}.
 *
 * - `verified` — the code at {@link CREATEX_ADDRESS} hashes to the published value; safe to deploy.
 * - `mismatch` — something is deployed there, but it is not CreateX. Do not deploy.
 * - `notDeployed` — no code at the address; CreateX has not been deployed to this chain.
 * - `unsupported` — the zkSync family, where CREATE2 addresses derive from a different preimage, so
 *   neither the canonical address nor our own prediction applies.
 */
export type CreateXVerification =
  | { status: 'verified'; address: string; codeHash: string }
  | { status: 'mismatch'; address: string; codeHash: string; expected: string }
  | { status: 'notDeployed'; address: string }
  | { status: 'unsupported'; address: string; chainId: bigint }

/** Hashes the code at {@link CREATEX_ADDRESS} on `chain` and compares it to the published hash. */
export async function verifyCreateXDeployment(chain: EVMChain): Promise<CreateXVerification> {
  const { chainId } = await chain.provider.getNetwork()
  if (CREATEX_UNSUPPORTED_CHAIN_IDS.has(chainId))
    return { status: 'unsupported', address: CREATEX_ADDRESS, chainId }

  const code = await chain.provider.getCode(CREATEX_ADDRESS)
  if (code === '0x') return { status: 'notDeployed', address: CREATEX_ADDRESS }

  const codeHash = keccak256(code)
  return codeHash === CREATEX_RUNTIME_CODE_HASH
    ? { status: 'verified', address: CREATEX_ADDRESS, codeHash }
    : {
        status: 'mismatch',
        address: CREATEX_ADDRESS,
        codeHash,
        expected: CREATEX_RUNTIME_CODE_HASH,
      }
}
