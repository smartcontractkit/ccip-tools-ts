/**
 * Block-explorer (Etherscan) verification handles for freshly-deployed EVM CCT contracts.
 *
 * A {@link DeployVerification} carries the two things a source-explorer verification call
 * needs that aren't already known from the deploy result: which bundled contract was
 * deployed and its ABI-encoded constructor args (the exact bytes appended to the init code).
 * These are metadata derived from the deploy calldata — computing them never changes the
 * on-chain transaction.
 *
 * @packageDocumentation
 */

import { AbiCoder, ZeroAddress } from 'ethers'

/**
 * Source-explorer verification handle for a freshly-deployed EVM contract.
 *
 * Present on EVM deploy results only; feed it to a contract-verification call as the
 * encoded-constructor-args input.
 */
export interface DeployVerification {
  /** Bundled verification-registry key, e.g. `'CrossChainToken'`. */
  contract: string
  /** ABI-encoded constructor arguments, `0x`-prefixed (the bytes appended to the init code). */
  encodedConstructorArgs: string
}

/**
 * A {@link DeployVerification} handle together with the deployed address it refers to.
 *
 * Used for factory deploys, where several contracts are created in internal CREATE2 calls
 * and each needs its address carried alongside its constructor args.
 */
export interface DeployVerificationTarget extends DeployVerification {
  /** The deployed contract address this verification handle is for. */
  address: string
}

/**
 * Builds a verification handle for a just-deployed contract. The init code is
 * `bytecode || abiEncodedConstructorArgs`, so the encoded args are exactly the bytes after
 * the (known) creation bytecode — recovered here as the single source of truth.
 *
 * @param contract - Bundled verification-registry key for the deployed contract.
 * @param deployData - The full contract-creation calldata (`bytecode || encodedArgs`).
 * @param bytecode - The known creation bytecode prefix of `deployData`.
 * @returns The {@link DeployVerification} handle carrying the recovered constructor args.
 */
export function buildDeployVerification(
  contract: string,
  deployData: string,
  bytecode: string,
): DeployVerification {
  return { contract, encodedConstructorArgs: `0x${deployData.slice(bytecode.length)}` }
}

/** Discriminated input for {@link buildFactoryPoolVerification}; lock-release carries its lockbox. */
export type FactoryPoolVerificationInput =
  | {
      poolType: 'burn-mint'
      token: string
      decimals: number
      rmnProxy: string
      router: string
      poolAddress: string
    }
  | {
      poolType: 'lock-release'
      token: string
      decimals: number
      rmnProxy: string
      router: string
      poolAddress: string
      /** The resolved `ERC20LockBox` the factory bound to the pool. */
      lockBoxAddress: string
    }

/**
 * Reconstructs the pool's (and lock-release lockbox's) verification handles for a factory
 * deploy. The factory appends the pool constructor args itself (token, decimals, zero-hooks,
 * rmnProxy, router, and lockBox for lock-release) using its own immutables, so they are rebuilt
 * here from the factory's static config rather than sliced from a top-level creation tx.
 *
 * @param input - The resolved pool addresses + factory static config (rmnProxy, router).
 * @returns The pool verification target, plus the lockbox target for lock-release pools.
 */
export function buildFactoryPoolVerification(input: FactoryPoolVerificationInput): {
  poolVerification: DeployVerificationTarget
  lockBoxVerification?: DeployVerificationTarget
} {
  const coder = AbiCoder.defaultAbiCoder()
  if (input.poolType === 'burn-mint') {
    return {
      poolVerification: {
        contract: 'BurnMintTokenPool',
        address: input.poolAddress,
        encodedConstructorArgs: coder.encode(
          ['address', 'uint8', 'address', 'address', 'address'],
          [input.token, input.decimals, ZeroAddress, input.rmnProxy, input.router],
        ),
      },
    }
  }
  return {
    poolVerification: {
      contract: 'LockReleaseTokenPool',
      address: input.poolAddress,
      encodedConstructorArgs: coder.encode(
        ['address', 'uint8', 'address', 'address', 'address', 'address'],
        [
          input.token,
          input.decimals,
          ZeroAddress,
          input.rmnProxy,
          input.router,
          input.lockBoxAddress,
        ],
      ),
    },
    lockBoxVerification: {
      contract: 'ERC20LockBox',
      address: input.lockBoxAddress,
      encodedConstructorArgs: coder.encode(['address'], [input.token]),
    },
  }
}
