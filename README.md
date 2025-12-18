# ccip-tools-ts

## Typescript SDK and CLI to interact with CCIP (monorepo).

This tool can be used to query and interact with [CCIP](https://ccip.chain.link) contracts deployed
in supported blockchains, through its publicly accessible data and methods.

> [!IMPORTANT]
> This tool is provided under an MIT license and is for convenience and illustration purposes only.

## Architecture

```
┌╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶┐
╷  ccip-tools-ts                                                      ╷
╷  ┌──────────────────────────┐        ┌──────────────────────────┐   ╷
╷  │                          │        │                          │   ╷
╷  │  @chainlink/ccip-sdk     │◀───────│  @chainlink/ccip-cli     │   ╷
╷  │                          │        │                          │   ╷
╷  └──────────────────────────┘        └──────────────────────────┘   ╷
└╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶╶┘
```

ccip-tools-ts (this monorepo) is constituted of 2 packages:

### [@chainlink/ccip-sdk](./ccip-sdk)

The SDK provides a set of importable utilities, types, functions and classes to interact with the
CCIP protocol, supporting multiple chain families (currently, EVM, Solana and Aptos) through a
unified interface.

It aims to be agnostic of the environment (NodeJS, Web, etc), uses specific
blockchain libraries internally, but tries to not expose details of them on its public APIs.

It depends minimally on centralized services, and should work with any compatible RPC or Provider,
even public/rate-limited ones (when possible).

It doesn't hardcode CCIP deployed contracts, and includes algorithms to discover the related
addresses only from the common entrypoints, usually a transaction hash or Router address.

### [@chainlink/ccip-cli](./ccip-cli)

The CLI imports and uses the SDK, and serves also as demo on how to instantiate and use many
features exposed by it.

It reads a list of RPCs URLs from a file, command-line option or environment variables, and
discovers the required networks from them.

## Tooling and Development

> [!NOTE]
> NodeJS version v20+ is required. For development of the packages, v24+ is required.
> When running from local folder, it'll try to execute the [src](./src/index.ts) script directly,
> without an explicit transpilation step. NodeJS v24+ can run `.ts` files directly, while older
> versions are run with [tsx](https://tsx.is/).  
> `npm test` will only work with V24+

Both packages are written in [TypeScript](https://www.typescriptlang.org/), transpiled to modern
JavaScript using `tsc`, and all of transpiled, types and sources are published to npm.
The idea is to make it easy for modern TS codebases to import them, and bundle with their preferred
bundler and to their preferred target version. They don't aim for minimal bundle size directly, and
instead expect consumers to optimize their tree-shaken bundles.

The codebase is also restricted to syntax compatible with [NodeJS type stripping](https://nodejs.org/api/typescript.html#type-stripping),
allowing the sources to be consumed directly by NodeJS v23+, without an explicit transpilation phase.

Example:

```sh
node ./ccip-cli/src/index.ts --help
```

Tests are written for NodeJS native runner (`node --test`), and don't require external packages.

CLI contains mostly e2e tests, and SDK, unit and integration. They all can be run and have
aggregated coverage collected and reported by running in repo root:

```sh
npm run test
```

Check the respective package's README for more details.
