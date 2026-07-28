/*
 * Shared types for the CCIP contract-verification module.
 *
 * The model mirrors how forge verify-contract and @nomicfoundation/hardhat-verify
 * talk to the Etherscan V2 API.
 */

/**
 * The canonical Solidity "Standard JSON Input" — exactly what solc consumes and
 * what Etherscan expects for the standard-json `codeformat`.
 *
 * This object is the compilation input the SDK already holds (sources + settings); the same
 * inputs that produced the deployed bytecode must be the ones submitted for verification.
 */
export interface StandardJsonInput {
  /** Source language. */
  language: 'Solidity' | 'Vyper'
  /** Map of source path to its file content. */
  sources: Record<string, { content: string }>
  /** Compiler settings that produced the deployed bytecode. */
  settings: {
    /** Optimizer configuration. */
    optimizer?: { enabled: boolean; runs: number }
    /** Target EVM version. */
    evmVersion?: string
    /** Whether compilation used the IR pipeline. */
    viaIR?: boolean
    /** Metadata settings (bytecode hash mode, literal content, CBOR append). */
    metadata?: {
      bytecodeHash?: 'ipfs' | 'none' | 'bzzr1'
      useLiteralContent?: boolean
      appendCBOR?: boolean
    }
    /** Import remappings. */
    remappings?: string[]
    /** Per-file library link map (file to LibName to address); set when libraries are used. */
    libraries?: Record<string, Record<string, string>>
    /** solc output selection. */
    outputSelection?: Record<string, Record<string, string[]>>
  }
}

/** Constructor arguments may be supplied either as decoded values or as already-encoded hex. */
export type ConstructorArgs =
  | { kind: 'values'; abi: ReadonlyArray<unknown>; values: ReadonlyArray<unknown> }
  /** Pre-ABI-encoded calldata; with or without 0x, with or without the (irrelevant) selector stripped. */
  | { kind: 'encoded'; hex: string }
  | { kind: 'none' }

/** Everything `verifyContract` needs to verify one deployed contract. */
export interface VerifyContractInput {
  /** EVM chain id; selects the explorer via the Etherscan V2 single endpoint. */
  chainId: number
  /** The already-deployed contract address. */
  contractAddress: string
  /** Fully-qualified name as it appears in the standard-json `sources` keys: `path/File.sol:Name`. */
  contractName: string
  /** The bundled standard JSON input (sources + settings that produced the init code). */
  standardJsonInput: StandardJsonInput
  /** Short solc version, e.g. "0.8.26". Resolved to the long `v0.8.26+commit.HASH` form. */
  compilerVersion: string
  /** Constructor arguments — see {@link ConstructorArgs}. */
  constructorArgs: ConstructorArgs
  /** User-provided Etherscan **V2** API key (one key works across all supported chains). */
  apiKey: string

  /** Optional: override the explorer base (e.g. a Blockscout/V1 instance). Defaults to V2. */
  apiUrl?: string
  /**
   * Optional explorer-provider override for chains NOT on Etherscan v2. When set, this takes
   * precedence over chainId/apiKey/apiUrl. Use for Blockscout instances and standalone
   * Etherscan-family explorers (Scrollscan, etc.) that need their own base URL / key.
   */
  verifier?:
    | {
        provider: 'etherscan' | 'blockscout'
        /** Full API base, e.g. "https://base-sepolia.blockscout.com/api" or a standalone etherscan API. */
        apiUrl: string
        /** Optional API key (Blockscout usually needs none; standalone etherscan instances do). */
        apiKey?: string
      }
    | {
        provider: 'sourcify'
        /** Sourcify server base; defaults to https://sourcify.dev/server. No key. */
        apiUrl?: string
      }
  /** Optional creation-tx hash; lets Sourcify also attempt a creation-bytecode match. */
  creationTransactionHash?: string
  /** Optional: SPDX licenseType code (1..14). Cosmetic on Etherscan; omitted by default. */
  licenseType?: number
  /** Optional polling tuning. `confirmAttempts` = extra getsourcecode re-checks after a poll timeout
   * (for slow explorers like Routescan whose checkverifystatus lags). */
  polling?: { intervalMs?: number; timeoutMs?: number; confirmAttempts?: number }
}

/** The outcome of a verification attempt. */
export interface VerifyResult {
  /** Terminal verification status. */
  status: 'verified' | 'already-verified' | 'failed'
  /** The explorer GUID of the submission, when one was issued. */
  guid?: string
  /** Human-readable result message. */
  message: string
  /** Best-effort link to the verified contract page. */
  explorerUrl?: string
}
