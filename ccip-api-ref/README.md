# CCIP Tools Reference Documentation

This directory contains the API reference documentation for `@chainlink/ccip-sdk`, `@chainlink/ccip-cli`, and the CCIP REST API, built with [Docusaurus](https://docusaurus.io/).

## Quick Start

```bash
# Install dependencies (from repo root)
npm install

# Start development server (from ccip-api-ref/)
cd ccip-api-ref
npm run dev

# Build for production
npm run build

# Preview production build
npm run serve
```

## Architecture

The documentation uses **multi-instance docs** with independent versioning for CLI and SDK.

```
ccip-api-ref/
├── docs/                  # Landing page (unversioned)
│   └── intro.md
├── docs-cli/              # CLI documentation (versioned independently)
│   ├── index.mdx          # CLI overview
│   ├── configuration.mdx  # Global options and setup
│   └── *.mdx              # Command reference pages
├── docs-sdk/              # SDK API reference (versioned independently)
│   └── (auto-generated)   # TypeDoc generates content here
├── docs-api/              # CCIP REST API reference (versioned independently)
│   └── (auto-generated)   # OpenAPI plugin generates content here
├── sidebars.ts            # Landing page sidebar
├── sidebars-cli.ts        # CLI sidebar configuration
├── sidebars-sdk.ts        # SDK sidebar configuration
├── sidebars-api.ts        # CCIP API sidebar configuration
└── docusaurus.config.ts   # Docusaurus configuration
```

### URL Structure

| URL           | Content               | Versioned |
| ------------- | --------------------- | --------- |
| `/docs/intro` | Getting started guide | No        |
| `/cli/`       | CLI command reference | Yes       |
| `/sdk/`       | SDK API reference     | Yes       |
| `/api/`       | CCIP REST API         | Yes       |

### Content Sources

| Section      | Source                                              | How to Update                        |
| ------------ | --------------------------------------------------- | ------------------------------------ |
| CLI docs     | `docs-cli/*.mdx`                                    | Edit MDX files directly              |
| SDK docs     | TypeDoc from `ccip-sdk/src/`                        | Update JSDoc comments in source code |
| CCIP API     | OpenAPI spec at `api.ccip.chain.link/api-docs.json` | Regenerate from updated spec         |
| Landing page | `docs/intro.md`                                     | Edit markdown directly               |

## Versioning

CLI and SDK documentation are versioned independently. This allows releasing CLI v2.0 while SDK remains at v1.5, for example.

### Current Version

Both packages display the version configured in `docusaurus.config.ts`:

```typescript
versions: {
  current: {
    label: '1.0.0',
    badge: true,
  },
},
```

The `current` version always reflects the latest development state (contents of `docs-cli/`, `docs-sdk/`, and `docs-api/`).

### Current vs Released Versions

| Version                  | Source Location                       | Regenerated on Build?                    |
| ------------------------ | ------------------------------------- | ---------------------------------------- |
| `current` (dev)          | `docs-cli/`, `docs-sdk/`, `docs-api/` | SDK and API: Yes. CLI: No (hand-written) |
| Released (e.g., `1.0.0`) | `versioned_docs/cli-version-1.0.0/`   | No, frozen snapshot                      |

**Key difference:**

- **Current version**: SDK docs are regenerated from `ccip-sdk/src/` and API docs are fetched from the OpenAPI spec on every build. This ensures the development version always reflects the latest source code.
- **Released versions**: The markdown files are **committed to git** as frozen snapshots. They are never regenerated—what you see is exactly what was captured at release time.

This means old versions don't need the original source code or API spec available—they're self-contained markdown snapshots stored in `versioned_docs/`.

### Creating a Release Version

When you release a new version, snapshot the documentation:

```bash
cd ccip-api-ref

# For SDK: Ensure docs are freshly generated first
npm run build  # This regenerates docs-sdk/ from source

# Snapshot CLI docs at version 1.0.0
npx docusaurus docs:version:cli 1.0.0

# Snapshot SDK docs at version 1.0.0
npx docusaurus docs:version:sdk 1.0.0

# Snapshot API docs at version 1.0.0
npx docusaurus docs:version:api 1.0.0
```

This creates:

```
ccip-api-ref/
├── docs-cli/                          # Current (dev) CLI docs
├── docs-sdk/                          # Current (regenerated each build)
├── docs-api/                          # Current (regenerated each build)
│
├── cli_versions.json                  # ["1.0.0"]
├── sdk_versions.json                  # ["1.0.0"]
├── api_versions.json                  # ["1.0.0"]
│
├── versioned_docs/
│   ├── cli-version-1.0.0/             # Frozen snapshot of docs-cli/
│   ├── sdk-version-1.0.0/             # Frozen snapshot of docs-sdk/
│   └── api-version-1.0.0/             # Frozen snapshot of docs-api/
│
└── versioned_sidebars/
    ├── cli-version-1.0.0-sidebars.json
    ├── sdk-version-1.0.0-sidebars.json
    └── api-version-1.0.0-sidebars.json
```

### Version Files

After creating versions, Docusaurus generates:

| File                  | Purpose                           |
| --------------------- | --------------------------------- |
| `cli_versions.json`   | List of CLI versions              |
| `sdk_versions.json`   | List of SDK versions              |
| `api_versions.json`   | List of CCIP API versions         |
| `versioned_docs/`     | Snapshots of docs at each version |
| `versioned_sidebars/` | Sidebar configs for each version  |

### Updating Version Labels

Edit `docusaurus.config.ts` to change how versions display:

```typescript
// CLI plugin configuration
{
  id: 'cli',
  // ...
  versions: {
    current: {
      label: '2.0.0-beta',  // Development version label
      badge: true,
    },
    '1.0.0': {
      label: '1.0.0',       // Released version
      banner: 'none',
    },
  },
},
```

### Removing Old Versions

1. Delete the version folder from `versioned_docs/` (e.g., `versioned_docs/sdk-version-1.0.0/`)
1. Remove the entry from the corresponding versions file (`cli_versions.json`, `sdk_versions.json`, or `api_versions.json`)
1. Delete the corresponding sidebar from `versioned_sidebars/`

## Writing CLI Documentation

CLI docs are manually written markdown files in `docs-cli/`.

### File Structure

Each command has its own file:

```
docs-cli/
├── index.mdx              # CLI overview and installation
├── configuration.mdx      # Global options, RPCs, wallets
├── show.mdx               # show command
├── send.mdx               # send command
├── manual-exec.mdx        # manual-exec command
├── parse.mdx              # parse command
├── supported-tokens.mdx   # get-supported-tokens command
├── token.mdx              # token command
├── lane-latency.mdx       # lane-latency command
└── troubleshooting.mdx    # Troubleshooting guide
```

### Adding a New Command

1. Create `docs-cli/new-command.mdx`
1. Add to `sidebars-cli.ts`:

```typescript
items: ['show', 'send', 'manual-exec', 'parse', 'supported-tokens', 'new-command'],
```

### Documentation Standards

Follow these conventions for CLI documentation:

**Structure each command page with:**

1. Synopsis (command syntax)
1. Description (what it does, when to use it)
1. Arguments table
1. Options tables (grouped by category)
1. Examples (common use cases)
1. Notes (edge cases, tips)

**Tables use consistent columns:**

| Column           | Description                               |
| ---------------- | ----------------------------------------- |
| Argument/Option  | The flag or positional name               |
| Type             | `string`, `number`, `boolean`, `string[]` |
| Required/Default | Whether required, or the default value    |
| Description      | What it does (imperative mood)            |

**Examples are complete and runnable:**

```bash
# Good: Complete command with realistic values
ccip-cli show 0x1234...abcd -r https://eth-sepolia.example.com

# Bad: Placeholder-heavy, not runnable
ccip-cli show <tx-hash> -r <rpc>
```

## SDK Documentation

SDK docs are auto-generated by TypeDoc from JSDoc comments in `ccip-sdk/src/`.

### How It Works

1. TypeDoc reads `ccip-sdk/src/index.ts` and exported symbols
1. Generates markdown files in `docs-sdk/`
1. Docusaurus serves them at `/sdk/`

The `docs-sdk/` folder is gitignored—content regenerates on each build.

### Improving SDK Docs

Edit JSDoc comments in the source code:

````typescript
/**
 * Calculates the merkle proof for manual execution.
 *
 * Use this when a message failed automatic execution and needs
 * to be retried manually via the OffRamp contract.
 *
 * @param request - The original CCIP request
 * @param commit - The commit containing this request
 * @returns Merkle proof array for the manuallyExecute call
 *
 * @example
 * ```typescript
 * const proof = calculateManualExecProof(request, commit)
 * await offRamp.manuallyExecute(report, [proof])
 * ```
 */
export function calculateManualExecProof(request: CCIPRequest, commit: CCIPCommit): string[] {
  // ...
}
````

After editing, rebuild docs to see changes:

```bash
npm run docs:dev
```

### TypeDoc Configuration

TypeDoc settings are in `docusaurus.config.ts`:

```typescript
[
  'docusaurus-plugin-typedoc',
  {
    id: 'typedoc-sdk',
    entryPoints: ['../ccip-sdk/src/index.ts'],
    tsconfig: '../ccip-sdk/tsconfig.json',
    out: 'docs-sdk',
    excludePrivate: true,
    excludeInternal: true,
    excludeExternals: true,
    readme: 'none',
  },
],
```

## CCIP API Documentation

CCIP API docs are auto-generated from the OpenAPI specification at `https://api.ccip.chain.link/api-docs.json`.

### How It Works

1. The `docusaurus-plugin-openapi-docs` fetches the OpenAPI spec
1. Generates interactive API documentation in `docs-api/`
1. Docusaurus serves them at `/api/`

The `docs-api/` folder is gitignored—content regenerates on each build.

### Regenerating API Docs

When the CCIP API spec is updated, regenerate the documentation:

```bash
cd ccip-api-ref

# Clean existing generated docs
npx docusaurus clean-api-docs all

# Generate fresh docs from spec
npx docusaurus gen-api-docs all
```

### OpenAPI Plugin Configuration

The plugin is configured in `docusaurus.config.ts`:

```typescript
[
  'docusaurus-plugin-openapi-docs',
  {
    id: 'openapi',
    docsPluginId: 'api',
    config: {
      ccipApi: {
        specPath: 'https://api.ccip.chain.link/api-docs.json',
        outputDir: 'docs-api',
        sidebarOptions: {
          groupPathsBy: 'tag',
        },
      },
    },
  },
],
```

### Creating a Version Snapshot

When the CCIP API releases a new version:

```bash
cd ccip-api-ref

# Regenerate docs from the new spec
npx docusaurus gen-api-docs all

# Snapshot at version (e.g., 1.1.0)
npx docusaurus docs:version:api 1.1.0
```

Then update `docusaurus.config.ts` with the new version label for `current`.

## Linting and Formatting

```bash
# Check formatting and lint
npm run lint -w ccip-api-ref

# Auto-fix issues
npm run lint:fix -w ccip-api-ref
```

Prettier formats markdown files. ESLint checks TypeScript configuration files.

## Deployment

The docs build to static files in `build/`:

```bash
npm run docs:build
```

Deploy the `ccip-api-ref/build/` directory to any static hosting (Vercel, Netlify, GitHub Pages).

### Vercel Configuration

The included `vercel.json` configures build settings and URL rewrites for hosting under `/ccip/tools/`:

```json
{
  "buildCommand": "npm run gen-api && npm run build",
  "outputDirectory": "build",
  "installCommand": "cd .. && npm ci",
  "framework": "docusaurus-2",
  "rewrites": [
    { "source": "/ccip/tools/:path*/", "destination": "/:path*/" },
    { "source": "/ccip/tools/:path*", "destination": "/:path*" }
  ],
  "redirects": [{ "source": "/", "destination": "/ccip/tools/", "permanent": false }]
}
```

## Troubleshooting

### TypeDoc warnings about "log has multiple declarations"

This warning occurs because multiple interfaces define a `log` property with JSDoc comments. It's cosmetic and doesn't affect the output.

### Sidebar shows wrong structure

Clear the Docusaurus cache:

```bash
rm -rf ccip-api-ref/.docusaurus
npm run docs:dev
```

### Build fails with "document ids do not exist"

The sidebar references docs that don't exist. Check:

1. File exists in the correct folder
1. File has the correct `id` in frontmatter (or uses filename as id)
1. Sidebar uses the correct path (relative to docs folder)

### ESLint error on generated sidebar imports

TypeDoc and OpenAPI generate sidebar files during build. The ESLint config ignores these import patterns. If you see errors, ensure `eslint.config.mjs` includes:

```javascript
{
  files: ['ccip-api-ref/sidebars*.ts'],
  rules: {
    'import/no-unresolved': ['error', { ignore: ['typedoc-sidebar\\.cjs$', '/sidebar$'] }],
    'import/extensions': 'off',
    '@typescript-eslint/no-unsafe-assignment': 'off',
  },
},
```
