import { type InterfaceAbi, AbiCoder, Interface } from 'ethers'

import type { ConstructorArgs } from './types.ts'

/*
 * Produce the constructor-arguments string Etherscan expects: ABI-encoded calldata,
 * hex, WITHOUT a 0x prefix and WITHOUT any function selector.
 *
 * Foundry (foundry-src crates/verify/src/etherscan/mod.rs constructor_args): for value
 * inputs it ABI-encodes against the constructor and strips the leading 4-byte selector
 * (encoded[8..]); for --constructor-args hex it passes the hex through verbatim.
 *
 * Hardhat (hardhat3-src packages/hardhat-verify/src/internal/constructor-args.ts):
 * Interface.encodeDeploy(args) then strips the 0x. encodeDeploy already omits the
 * selector, which is why no [8..] slice is needed there.
 *
 * We support both shapes the SDK might receive:
 *  - values: decoded args + the constructor ABI, encoded here (the clean path for a
 *    "deploy then verify" SDK, since we already hold the user's params).
 *  - encoded: raw hex (e.g. extracted from init code: creationBytecode || encodedArgs).
 */
/** ABI-encode constructor args into the hex string Etherscan expects (no `0x`, no selector). */
export function encodeConstructorArgs(args: ConstructorArgs): string {
  switch (args.kind) {
    case 'none':
      return ''

    case 'encoded':
      return normalizeEncodedArgs(args.hex)

    case 'values': {
      // `encodeDeploy` encodes the tuple of constructor inputs with NO selector — exactly
      // what Etherscan wants. Using the full Interface gives ethers the constructor's
      // input types (including nested structs/tuples like CrossChainToken's ConstructorParams).
      const iface = new Interface(args.abi as InterfaceAbi)
      const encoded = iface.encodeDeploy(args.values)
      return stripHexPrefix(encoded)
    }
  }
}

/** Encode constructor args from bare parameter types (no ABI) via `AbiCoder`. */
export function encodeConstructorArgsFromTypes(types: string[], values: unknown[]): string {
  return stripHexPrefix(AbiCoder.defaultAbiCoder().encode(types, values))
}

function normalizeEncodedArgs(hex: string): string {
  const h = stripHexPrefix(hex.trim())
  // Defensive: if a full creation calldata or a selector-prefixed blob was passed, the
  // caller is responsible for slicing. We only strip 0x here, matching foundry's
  // `.constructor_arguments()` which trims and strips 0x but does not guess.
  return h
}

function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
}
