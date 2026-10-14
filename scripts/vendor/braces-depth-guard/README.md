# braces-depth-guard (vendored `braces` fork)

Upstream [`braces@3.0.3`](https://github.com/micromatch/braces) (MIT, Jon Schlinkert)
plus a nesting-depth guard. `index.js`, `lib/`, and `LICENSE` are byte-for-byte upstream
except for the guard described below.

## Why this exists

GHSA-vfj7-8cjw-p6xm (high): `braces <= 3.0.3` allows stack-exhaustion DoS through deeply
nested brace patterns. `3.0.3` is still the newest upstream release, so no version pin
can clear the finding — it fans out through `micromatch` and `chokidar@3` into the
Docusaurus, tailwindcss, fast-glob/globby and webpack-dev-server subtrees. The exposure
is build-time only: no path from the published `@chainlink/ccip-sdk` /
`@chainlink/ccip-cli` graphs reaches `braces`.

## Why a vendored copy and not a fork package

`@dieub/braces-depth-guard` (a guard-only backport, published 2026-10-03) inspired this
patch, but its versions are all prerelease-style (`3.0.3-pn.x`). `npm audit` accepts
those (npm's semver excludes prereleases unless the range asks for them), but the CI
Dependency Review workflow (`actions/dependency-review-action`, org preset
`vulnerability-high`) compares versions naively: `3.0.3-pn.0` <= `3.0.3` matches both
braces advisories, so every fork release trips the gate. The replacement has to carry a
version naively greater than `3.0.3`; a vendored copy lets us own that version instead of
waiting on a third-party maintainer.

## The patch

Guard-only, ~20 lines, applied on top of pristine 3.0.3:

- `lib/constants.js`: `MAX_DEPTH: 100`
- `lib/parse.js`: brace-nesting counter; patterns nested deeper than `maxDepth` throw
  `SyntaxError` instead of exhausting the stack
- `lib/compile.js` / `lib/expand.js`: AST-walk depth tracking; excessive depth throws
  `RangeError`
- `options.maxDepth` may lower the cap (never raise it past `MAX_DEPTH`)

Pattern behavior below the cap is unchanged. Verified against upstream's own test suite:
852 passing / 42 failing — the identical result as pristine 3.0.3 on current Node (the
42 are pre-existing bash-version drift in `test/bash-spec.js`, not regressions). The
guard trips at depth 101 with a clean `SyntaxError`.

`version: 3.0.4` is synthetic: it makes both `npm audit` and Dependency Review treat the
package as newer than the vulnerable range.

## When can this go away, and how do I check?

The override in the root `package.json` (`"braces": "file:scripts/vendor/braces-depth-guard"`)
is deleted as soon as upstream ships a patched release. Check in this order:

1. Is the advisory patched? Open https://github.com/advisories/GHSA-vfj7-8cjw-p6xm and
   check whether the affected range now names a fixed version.
2. Is the fixed release real and ripe? `npm view braces version time --json` — the fixed
   version must exist, be stable (non-prerelease), and be at least 7 days old.
3. Does the fix actually contain the depth cap? `npm pack braces@<version>`, extract, and
   confirm `lib/parse.js` (or its replacement) rejects deep nesting — e.g.
   `node -e "require('<dir>'); require('<dir>')('{'.repeat(150)+'x'+'}'.repeat(150))"`
   must throw instead of hanging. Also run upstream's own `mocha` suite from the repo.
4. Do the dependents pick it up? `npm why braces` — `micromatch@4` asks for
   `braces ~3.0.2` and `chokidar@3` for `^3.0.2`. If the fixed release is outside those
   ranges, either a `micromatch`/`chokidar` update landed that widens them, or the
   override changes to `"braces": "<fixed-version>"` instead of being removed.
5. Delete `scripts/vendor/braces-depth-guard/`, remove the override, `npm install`, and
   confirm `npm audit` stays at the same count and `npm ls` reports no `invalid` nodes.
