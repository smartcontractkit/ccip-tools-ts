---
id: ccip-tools-contributing
title: Contributing
sidebar_label: Contributing
sidebar_position: 0
edit_url: https://github.com/smartcontractkit/ccip-tools-ts/edit/main/CONTRIBUTING.md
---

# Contributing to CCIP Tools

Thank you for your interest in contributing!

:::tip Canonical Source
The full contributing guide is maintained in the repository root:

**[View CONTRIBUTING.md on GitHub →](https://github.com/smartcontractkit/ccip-tools-ts/blob/main/CONTRIBUTING.md)**
:::

## Quick Reference

### Setup

```bash
git clone https://github.com/smartcontractkit/ccip-tools-ts
cd ccip-tools-ts
npm ci
```

### Quality Gates

```bash
npm run lint        # Prettier + ESLint
npm run typecheck   # TypeScript validation
npm run test        # All tests with coverage
npm run build       # Full build
```

### Key Resources

| Resource | Description |
|----------|-------------|
| [CONTRIBUTING.md](https://github.com/smartcontractkit/ccip-tools-ts/blob/main/CONTRIBUTING.md) | Full contributing guide |
| [Adding New Chain](./adding-new-chain) | Implement a new blockchain |
| [GitHub Issues](https://github.com/smartcontractkit/ccip-tools-ts/issues) | Bug reports & feature requests |
| [Pull Requests](https://github.com/smartcontractkit/ccip-tools-ts/pulls) | Open PRs |

## Adding New Chain Support

For implementing a new blockchain family, see the dedicated guide:

**[Adding New Chain Support →](../adding-new-chain)**
