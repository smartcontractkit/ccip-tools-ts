/*
 * Runtime registry over the BUNDLED verification artifacts.
 *
 * Option 1 architecture: an offline bundler (`scripts/build-fixtures.ts`) runs once per CCIP
 * release and emits, into the published SDK package:
 *   - manifest.json                 (name to { contractName, compilerVersion, files })
 *   - Name.standard-input.json      (sources + settings; produced WITHOUT forge/hardhat)
 *   - Name.abi.json                 (for ABI-encoding constructor args)
 *   - Name.bin                      (init/creation bytecode the SDK already has, for deploy)
 *
 * At runtime the SDK does NO generation — it loads the manifest and reads the pinned files.
 * `verifyDeployedContract()` below is the full "deploy-then-verify" call the CLI would expose.
 */
/* eslint-disable import-x/no-nodejs-modules -- Node.js-only: reads pre-built fixtures shipped with the package */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
/* eslint-enable import-x/no-nodejs-modules */

import type { DeployableContract } from './index.ts'
import type { ConstructorArgs, StandardJsonInput, VerifyResult } from './types.ts'
import { verifyContract } from './verify.ts'
import {
  CCIPContractVerificationFailedError,
  CCIPUnknownVerificationContractError,
} from '../errors/index.ts'

/** One row of the bundled `manifest.json`: how to locate a contract's verification artifacts. */
export interface ManifestEntry {
  /** Fully-qualified Solidity name `path/File.sol:Name`. */
  contractName: string
  /** Long, commit-qualified solc version, e.g. `v0.8.26+commit.8a97fa7a`. */
  compilerVersion: string
  /** Filename of the bundled standard-json input, relative to the fixtures dir. */
  standardInput: string
  /** Filename of the bundled ABI json, relative to the fixtures dir. */
  abi: string
  /** Optional filename of the bundled init/creation bytecode. */
  initCode?: string
}

// Bundled with the package; resolved relative to this module, not the cwd.
const FIXTURES_DIR = fileURLToPath(new URL('./fixtures', import.meta.url))

const manifest = JSON.parse(
  readFileSync(path.join(FIXTURES_DIR, 'manifest.json'), 'utf8'),
) as Record<string, ManifestEntry>

/** The kind of verification API a chain exposes, as recorded in the bundled `verifiers.json`. */
export type VerifierProvider =
  | 'etherscan-v2'
  | 'blockscout'
  | 'etherscan-standalone'
  | 'sourcify'
  | 'unknown'

/** One row of the bundled `verifiers.json`: how to verify on a given CCIP chain. */
export interface VerifierEntry {
  /** Human-readable chain key, e.g. `ethereum-testnet-sepolia`. */
  key: string
  /** EVM chain id. */
  chainId: number
  /** Explorer base URL, or `null` if the chain has no known explorer. */
  explorer: string | null
  /** Which verification API family this chain uses. */
  provider: VerifierProvider
  /** Optional explorer API base URL (for Blockscout / standalone Etherscan instances). */
  apiUrl?: string
  /** Whether the explorer requires an API key. */
  needsApiKey?: boolean
  /** Optional free-form note. */
  note?: string
}

const verifiers = JSON.parse(
  readFileSync(path.join(FIXTURES_DIR, 'verifiers.json'), 'utf8'),
) as Record<string, VerifierEntry>

/** How to verify on a given CCIP testnet chainId (or undefined if not a known CCIP testnet). */
export function resolveVerifier(chainId: number): VerifierEntry | undefined {
  return verifiers[String(chainId)]
}

/** The manifest keys of every contract the SDK ships verification artifacts for. */
export function listDeployableContracts(): string[] {
  return Object.keys(manifest)
}

/** A fully-loaded verification artifact: the sources/settings and ABI for one contract. */
export interface VerificationArtifact {
  /** Fully-qualified Solidity name `path/File.sol:Name`. */
  contractName: string
  /** Long, commit-qualified solc version. */
  compilerVersion: string
  /** The standard JSON input (sources + settings) that produced the deployed bytecode. */
  standardJsonInput: StandardJsonInput
  /** The contract ABI, used to encode constructor arguments. */
  abi: unknown[]
}

/** Load the bundled artifact for a known contract (e.g. "CrossChainToken"). */
export function getVerificationArtifact(
  name: DeployableContract | (string & {}),
): VerificationArtifact {
  const entry = manifest[name]
  if (!entry) {
    throw new CCIPUnknownVerificationContractError(name, listDeployableContracts())
  }
  return {
    contractName: entry.contractName,
    compilerVersion: entry.compilerVersion,
    standardJsonInput: JSON.parse(
      readFileSync(path.join(FIXTURES_DIR, entry.standardInput), 'utf8'),
    ) as StandardJsonInput,
    abi: JSON.parse(readFileSync(path.join(FIXTURES_DIR, entry.abi), 'utf8')) as unknown[],
  }
}

/**
 * The high-level SDK/CLI entry point. The caller only supplies what's truly per-deployment:
 * which contract, where it landed, the chain, the API key, and the constructor params they
 * already passed to deploy. Everything else (sources, settings, compiler version, FQN) comes
 * from the bundle.
 */
export async function verifyDeployedContract(
  params: {
    // a key from the manifest, e.g. "CrossChainToken"

    contract: DeployableContract | (string & {})
    chainId: number
    contractAddress: string
    apiKey: string
    /** constructor values (encoded against the bundled ABI) or pre-encoded hex. */
    constructorValues?: ReadonlyArray<unknown>
    constructorArgs?: ConstructorArgs
    apiUrl?: string
    /** Force a specific verifier; otherwise auto-resolved from the bundled verifier map. */
    verifier?:
      | { provider: 'etherscan' | 'blockscout'; apiUrl: string; apiKey?: string }
      | { provider: 'sourcify'; apiUrl?: string }
    /** If true (default), chains with no known Etherscan/Blockscout API fall back to Sourcify. */
    fallbackToSourcify?: boolean
  },
  deps: Parameters<typeof verifyContract>[1] = {},
): Promise<VerifyResult> {
  const art = getVerificationArtifact(params.contract)

  const constructorArgs: ConstructorArgs =
    params.constructorArgs ??
    (params.constructorValues
      ? { kind: 'values', abi: art.abi, values: params.constructorValues }
      : { kind: 'none' })

  // Auto-route to the right verifier for this chain unless the caller forced one.
  const fallbackToSourcify = params.fallbackToSourcify ?? true
  let verifier = params.verifier
  if (!verifier && !params.apiUrl) {
    const v = resolveVerifier(params.chainId)
    if (v?.provider === 'blockscout' && v.apiUrl) {
      verifier = { provider: 'blockscout', apiUrl: v.apiUrl }
    } else if (v?.provider === 'sourcify') {
      verifier = { provider: 'sourcify' } // key-less, no per-chain URL
    } else if (v?.provider === 'etherscan-standalone' && v.apiUrl) {
      // standalone explorer: same Etherscan protocol but its own base + its own API key
      verifier = { provider: 'etherscan', apiUrl: v.apiUrl, apiKey: params.apiKey }
    } else if (v && v.provider === 'unknown') {
      // No Etherscan/Blockscout API — Sourcify needs neither a key nor a per-chain URL.
      if (fallbackToSourcify) verifier = { provider: 'sourcify' }
      else
        throw new CCIPContractVerificationFailedError(
          `no known verification API for chain ${params.chainId} (${v.key}, ${v.explorer ?? 'no explorer'}). Pass an explicit { verifier }.`,
        )
    }
    // etherscan-v2 (or unknown chain) -> fall through to the default v2 endpoint
  }

  return verifyContract(
    {
      chainId: params.chainId,
      contractAddress: params.contractAddress,
      contractName: art.contractName,
      standardJsonInput: art.standardJsonInput,
      compilerVersion: art.compilerVersion,
      constructorArgs,
      apiKey: params.apiKey,
      apiUrl: params.apiUrl,
      verifier,
    },
    deps,
  )
}
