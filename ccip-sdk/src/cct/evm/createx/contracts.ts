/**
 * CreateX contract layer: the canonical factory address, the cached {@link Interface} for the two
 * deploy functions we use, and the published runtime-bytecode hash used to verify an on-chain
 * deployment before trusting it. Mirrors `lockbox/contracts.ts`.
 *
 * @remarks CreateX itself is AGPL-3.0-only while this package is MIT, so nothing here is vendored
 * from that repository. The ABI fragment below is hand-written from the two function signatures and
 * one event we call — an interface description, not a copy of their source or build artifacts.
 *
 * @see https://github.com/pcaversaccio/createx
 *
 * @packageDocumentation
 */

import { Interface } from 'ethers'

/** CreateX's canonical address, identical on every chain it is deployed to. */
export const CREATEX_ADDRESS = '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed'

/**
 * keccak256 of CreateX's deployed runtime bytecode, as published by the project. A chain whose
 * {@link CREATEX_ADDRESS} code hashes to anything else is not running the reviewed contract.
 */
export const CREATEX_RUNTIME_CODE_HASH =
  '0xbd8a7ea8cfca7b4e5f5041d7d4b17bc317c5ce42cfbc42066a00cf26b43eb53f'

/**
 * Chains where {@link CREATEX_ADDRESS} does not apply. ZK Stack chains derive CREATE2 addresses
 * from a different preimage, so both the canonical factory address and our own prediction are
 * wrong there — and wrong in a way that looks plausible.
 *
 * @remarks Not exhaustive, and deliberately not presented as such: new ZK Stack chains appear
 * faster than a hardcoded list can track. This turns the common cases into a clear `unsupported`
 * instead of a confusing `notDeployed`, but a chain's absence from this set is not evidence that
 * CreateX works on it. Confirm any new chain against the deployment list before first use.
 */
export const CREATEX_UNSUPPORTED_CHAIN_IDS: ReadonlySet<bigint> = new Set([
  324n, // zkSync Era
  300n, // zkSync Sepolia
  2741n, // Abstract
  11124n, // Abstract Sepolia
  232n, // Lens
  50104n, // Sophon
  543210n, // Zero
])

/** Hand-written fragment covering only the surface we call. */
export const CREATEX_INTERFACE = new Interface([
  'function deployCreate2(bytes32 salt, bytes initCode) payable returns (address newContract)',
  'function deployCreate2AndInit(bytes32 salt, bytes initCode, bytes data, (uint256,uint256) values, address refundAddress) payable returns (address newContract)',
  'function computeCreate2Address(bytes32 salt, bytes32 initCodeHash, address deployer) pure returns (address computedAddress)',
  'event ContractCreation(address indexed newContract, bytes32 indexed salt)',
])
