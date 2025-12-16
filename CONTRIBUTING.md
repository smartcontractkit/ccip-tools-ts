# Contributing

For project overview and architecture, see [README.md](README.md).

## Prerequisites

- Node.js v24+
- npm

## Quick Start

```bash
npm ci          # Install dependencies
npm test        # Run all tests
npm run check   # Lint + typecheck
```

## Quality Gates

Run before submitting a PR:

```bash
npm run lint        # Prettier + ESLint
npm run typecheck   # TypeScript validation
npm run test        # All tests with coverage
npm run build       # Full build
```

CI runs: `npm ci` → `npm run check` → `npm test`

## Error Handling

The SDK defines specialized `CCIPError` classes in `ccip-sdk/src/errors/`. Never throw generic `Error`.

```
CCIPError (base)
├── code: CCIPErrorCode         # Machine-readable
├── message: string             # Human-readable
├── context: Record<...>        # Structured data
├── isTransient: boolean        # Retry hint
├── retryAfterMs?: number       # Retry delay
└── recovery?: string           # Actionable fix
```

| Scenario             | Error Class                    |
| -------------------- | ------------------------------ |
| Chain not found      | `CCIPChainNotFoundError`       |
| Invalid input        | `CCIPArgumentInvalidError`     |
| Transaction pending  | `CCIPTransactionNotFoundError` |
| Message not in batch | `CCIPMessageNotInBatchError`   |
| HTTP/RPC failure     | `CCIPHttpError`                |
| Not implemented      | `CCIPNotImplementedError`      |

To add a new error type:

1. `codes.ts` - Define the error code
1. `specialized.ts` - Create the error class
1. `recovery.ts` - Add recovery hints (actionable fix suggestions)
1. `index.ts` - Export the new class

ESLint enforces `CCIPError` usage. Generic `throw new Error()` fails linting.

## Pull Requests

1. Run quality gates locally
1. Write tests for new functionality
1. Update CHANGELOG.md
1. Keep commits focused and atomic

## Adding New Chain Support

See **[docs/adding-new-chain.md](docs/adding-new-chain.md)** for the complete guide.

## Project Structure

```
ccip-tools-ts/
├── ccip-sdk/     # Chain-agnostic SDK
│   └── src/
│       ├── chain.ts    # Base Chain class
│       ├── types.ts    # Core types
│       └── {chainFamily}/    # Chain family implementations
└── ccip-cli/     # CLI wrapper
    └── src/
        └── providers/  # Wallet loaders
```
