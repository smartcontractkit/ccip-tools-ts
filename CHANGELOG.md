# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.8] - 2025-07-16
- fix: aptos messages decoding format (#43)
- `--sender-queue`: set tx' `--gas-limit` (if provided) and `nonce` (#44)

## [0.2.7] - 2025-05-29
- fix: decoding of very old v1.2 messages (#33)

## [0.2.6] - 2025-04-29
- regression: change source addresses for EVMv1.6 calculateManualExecProof (#31)

## [0.2.5] - 2025-04-28
- fix decoding of solana addresses in EVMv1.6 hasher (#30)

## [0.2.4] - 2025-04-25
- fix zero-padding of source addresses on calculateManualExecProof (#29)

## [0.2.3] - 2025-04-24
- fix an edge case for solana hasher (#28)

## [0.2.2] - 2025-04-23
- `--wallet ledger:<n>` supports an integer as wallet index on standard Ethereum derivation path (#24)
- Fixes for Solana leafhasher (#27)

## [0.2.1] - 2025-03-11
- Fix manualExec on old v1.2 lanes or <1.5 TokenPools (legacy sourceTokenData) (#18)

## [0.2.0] - 2025-03-04
- Add `getSupportedTokens` command to discover and validate tokens that can be transferred between chains using CCIP (#11)
- Add support to CCIP v1.6 EVM lanes (#14)
  - Add `decodeMessage` public function, to decode a CCIPMessage from anything (byte-arrays, JSON string, decoded objects)
  - Add `origin` (sender of transaction) field to pretty requests, commits and receipts output.
- Add Ledger hardware wallet (`--wallet ledger`) support (#14)

## [0.1.3] - 2024-12-10
- Allow `parseBytes` command to parse EVMExtraArgs bytearrays, both standalone and in structs (#7)
- Support Lombard attestation for LBTC transfers (#8)

## [0.1.2] - 2024-11-25
- Add public `recursiveParseErrors` function to lib, to return nested/inner ABI errors
- Use it everywhere: `parseBytes` command, thrown exceptions, and `prettyReceipt` output of failed execs
- Supports explicit `--fee-token 0x00...00` for native fees (default if omitted)
- Embeds and shows `--version|-V` in cli, with shortRev commit

## [0.1.1] - 2024-11-08
- Small improvements to inner wrap errors in `parseBytes` command
- Disclaimer in README

## [0.1.0] - 2024-10-31
### Added
- Initial release
- Compatible with CCIP v1.2 - v1.5 lanes
- Initial commands:
  - `show` (default): shows info about a CCIP message
  - `manualExec`: manually executes a CCIP message
  - `send`: sends a CCIP message through provided router
  - `parseData`: utility to parse known EVM errors, calldata and events data
  - `lane`: utility to query and show info and config about a lane
  - `estimateGas`: utility to estimate gasLimit for a message's CCIPReceiver callback
- Run `npx @chainlink/ccip-tools-ts --help` to install with npm and see all options
