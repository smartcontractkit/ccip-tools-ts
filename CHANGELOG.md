# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
