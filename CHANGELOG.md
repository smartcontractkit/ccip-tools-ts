# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- SDK: `Chain.getBalance()` method for querying native and token balances (EVM, Solana, Aptos)
- SDK: Solana `resolveATA()` utility for ATA derivation with automatic SPL Token vs Token-2022 detection
- CLI: `token <network> <holder> [token]` command for balance queries
- SDK: fix EVM estimate gas for token transfers with balance slot!=0 (e.g. USDC)

## [0.94.0] - 2026-01-14 - Pre-release

- SDK: Browser compatibility - explicit `buffer` dependency and imports for cross-platform support
- CI: Added `publint` and `@arethetypeswrong/cli` validation for package exports
- ESLint: `import/no-nodejs-modules` rule prevents Node.js-only imports in SDK
- Docs: Cross-Platform Portability guidelines in CONTRIBUTING.md
- SDK: Populate default extraArgs for getFee, sendMessage methods, requiring minimal parameters to use these methods

## [0.93.0] - 2025-12-31 - Pre-release

- SDK: `CCIPAPIClient` and `Chain.getLaneLatency()` for querying lane delivery times via CCIP API
- CLI: `lane-latency <source> <dest>` command; `--no-api` flag for decentralized mode
- SDK: `MessageStatus` enum for message lifecycle tracking
- CLI: `show --wait` displays status progression during message tracking
- SDK: Rename `fetch*` to `get*` for message methods (`getMessagesInTx`, `getMessageById`, `getMessagesForSender`)
- SDK: Viem adapter via `@chainlink/ccip-sdk/viem` - use `fromViemClient()` and `viemWallet()` for viem users
- SDK: `getCCIPExplorerUrl()` and `getCCIPExplorerLinks()` for CCIP Explorer URL generation
- CLI: `send` and `show` commands now display CCIP Explorer links for visual transaction tracking
- SDK: Added `sideEffects: false` to package.json for improved tree-shaking support
- SDK: **Breaking**: Rename `fetch*` to `get*` for message methods (`getMessagesInTx`, `getMessageById`, `getMessagesForSender`, `getAllMessagesInBatch`, `getOffchainTokenData`, `getCommitReport`, `getExecutionReceipts`)
- SDK: **Breaking**: Convert methods with >2 arguments (besides opts/ctx) to single destructured object argument (`getFee`, `generateUnsignedSendMessage`, `sendMessage`, `generateUnsignedExecuteReport`, `executeReport`, `getCommitReport`, `getExecutionReceipts`, `waitFinalized`)
- SDK: simplify `getExecutionReceipts` filters (accept `messageId` and `sourceChainSelector`, instead of whole `request`)
- SDK: `executeReport` resolves to `CCIPExecution`, instead of generic `ChainTransaction`
- SDK: rename `getAllMessagesInBatch` to `getMessagesInBatch` (for consistency with other method names)
- SDK: migrate TONChain to TonClient (from TonClient4) and TON HTTP V2 endpoints (more common)
- CLI: implement Ledger hardwallet support for TON

## [0.92.0] - 2025-12-20 - Pre-release

- SDK: `Chain.getLogs` can receive `watch` boolean or cancel promise, to enter continuous logs fetching
- SDK: `Chain.waitFinality` method to receive a `log` and wait for its tx to finalize
- SDK: `Chain.isTxHash` static method to typeguard chain-specific txHash string format
- SDK: `isSupportedTxHash` function exported to check any supported chain
- CLI: `show --wait` and `send --wait` waits for finality, commit and first execution of pending requests
- CLI: RPC endpoint url racer now triggers chain-families on-demand
- CLI: `--rpcs`/`-r` now can split CSV strings
- CLI: if `--wallet` is omitted and `--rpcs-file=['./.env]` has a `USER_KEY=` or `PRIVATE_KEY=` variable, it will be used as wallet
- SDK: `CCIPMessage` loses `header`; properties now are merged to `message` root (e.g. `message.messageId`)

## [0.91.0] - 2025-12-08 - Pre-release

- `Chain.sendMessage` now calls `getFee` by itself, if not provided; it also returns a `CCIPRequest`
- Fix USDC/CCTP attestation fetching in Solana
- `CCIPRequest` loses `timestamp` property, available in `tx.timestamp` instead
- Rename `Chain.listFeeTokens` to `getFeeTokens`, fix for v1.5 lanes
- Move `fetchCCIPRequestsInTx` function to `Chain.fetchRequestsInTx` method
- Move `fetchCCIPRequestById` function to `Chain.fetchRequestById` method; it now can optionally receive OnRamp address to narrow search, required in non-EVM chains (which can't scan the all addresses at once); cli's `show --id-from-source` receives `<address>@<network>` onramp address format in these cases
- Move `fetchAllMessagesInBatch` function to `Chain.fetchAllMessagesInBatch` method
- `getWallet` static and cached methods are removed; `wallet` compatible signer instance should be passed directly as option to the read-write methods, `sendMessage` and `executeReport`
- Chains now expose `generateUnsignedSendMessage` and `generateUnsignedExecuteReport`, which expose raw/unsigned tx data for `sendMessage` and `executeReport` respectively, in case one needs to sign and broadcast manually
- All methods which logs now may receive a `{ logger }` context object, to inject a logger other than `console`
- Remove some more node-isms from SDK

## [0.90.0] - 2025-11-28 - Pre-release

- Major overhaul of the tool, split into [ccip-sdk](./ccip-sdk) and [ccip-cli](./ccip-cli) packages
- SDK now exposes Chain family specific classes, with initial full support to EVM, Solana and Aptos
- NodeJS specific bits moved out of SDK and into the CLI, SDK now is environment agnostic
- CLI implements Ledger support for all 3 chains
- See each package's README for more details

## [0.2.9] - 2025-08-20

- aptos: improved some utilities for Aptos chain family (#50)
- fix: `manualExec --sender-queue` for large queues (#51)

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
