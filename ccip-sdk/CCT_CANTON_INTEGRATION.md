# CCT Canton SDK — integration notes for DA

The CCIP Canton token-pool deploy/configure SDK (`@chainlink/ccip-sdk`,
`CantonTokenManager`) lets an issuer deploy and configure a burn-mint (or
lock-release) token pool on Canton. The SDK **composes unsigned transactions**;
the DA app's wallet **signs and submits** them. This document describes
that seam and what each side owns.

## The seam: we compose, DA signs + sends

Every write operation is exposed as a `generateUnsigned<Op>(params)` method that
returns an `UnsignedCantonTx` — a self-contained, pre-resolved unsigned
transaction. The DA app hands `unsigned.commands` to its wallet connection
(which does CIP-103 `prepareExecute` → human Approve → signing driver →
execute). The SDK never sees the wallet, the token, the signing driver, or the
approval.

```ts
import { CantonTokenManager } from '@chainlink/ccip-sdk'

const manager = CantonTokenManager.fromChain(chain) // chain wired with DA's ledger access

// Compose — no signing, no submit. Resolves contracts (ACS + EDS), builds
// disclosed contracts with createdEventBlob + concrete package-ID templateIds,
// encodes choice args in the Canton JSON Ledger API natural-JSON form.
const unsigned = await manager.generateUnsignedDeployTokenPool({
  poolType: 'burnMint',
  instanceId: 'mytoken-pool-001',
  poolOwner: party,        // the issuer's Canton party
  ccipOwner,               // the protocol operator party (network constant)
  instrumentId: { admin: party, id: 'MYTOKEN' },
  decimals: 10,
  sender: party,
})

// unsigned = { family: 'CANTON', commands: { commands, actAs, disclosedContracts, commandId } }
// → DA app hands `unsigned.commands` to its wallet to prepareExecute → sign → execute.
```

The returned `unsigned.commands` is a `JsCommands` — `commands` (one
`CreateCommand` or `ExerciseCommand`), `actAs`, `disclosedContracts` (with
`createdEventBlob` + `synchronizerId` + concrete package-ID `templateId`),
`commandId`. Nothing for the submitter to resolve; the disclosed contracts
are pre-fetched so the participant can reconstruct them during interactive
submission.

## The 7-step flow (in order)

Each step is one `generateUnsigned<Op>` → one wallet approval. Order matters
(steps depend on prior on-ledger state):

| # | Step | SDK call | On-ledger effect |
|---|---|---|---|
| 1 | register-admin | `generateUnsignedRegisterAdmin` | `ProposeAdministrator` — creates TokenConfig, sets `pendingAdmin` |
| 2 | accept-admin | `generateUnsignedAcceptAdmin` | `AcceptAdminRole` — sets `admin = owner`, clears `pendingAdmin` |
| 3 | deploy-pool | `generateUnsignedDeployTokenPool` | creates the BurnMint/LockRelease pool |
| 4 | deploy-rl-in | `generateUnsignedDeployRateLimiter` | creates the inbound rate limiter |
| 5 | deploy-rl-out | `generateUnsignedDeployRateLimiter` | creates the outbound rate limiter |
| 6 | set-pool | `generateUnsignedSetPool` | `SetPool` — registers the pool in the TAR's TokenConfig |
| 7 | apply-chain-updates | `generateUnsignedApplyChainUpdates` | wires the remote chain (remote pools, token, rate limiters, CCVs, finality) |

Why 7 separate approvals (not batched): the interactive-submission `prepare`
step the wallet uses rejects multi-command submissions ("Preparing multiple
commands is currently not supported"), so each command is its own
prepare → sign → execute. Additionally, steps 1→2 are sequenced by a CID
dependency (`accept-admin` needs the TokenConfig CID that `register-admin`
creates, and CIDs are assigned at execution time). Steps 3→4→5→6→7 are
sequenced by on-ledger state (each reads/writes contracts the prior step
created).

`deploy-pool-e2e.ts` in `ccip-sdk/scripts/` is the **reference flow** — it
drives all 7 steps through a wallet gateway with an interactive menu, honest
on-ledger confirmation polls, and a `dump-pool-state.ts` verifier. DA reads
it to see the ordering + call patterns, then adapts the wallet/submit half
to the DA app's own wallet connection.

## What DA owns vs. what we own

| | We (CCIP SDK) own | DA owns |
|---|---|---|
| Compose unsigned tx | ✅ `generateUnsigned<Op>` | — |
| Resolve contracts (ACS + EDS) | ✅ inside `generateUnsigned` | — |
| Encode choice args (natural JSON) | ✅ | — |
| Sign + submit | — | ✅ their wallet (`prepareExecute` → sign → execute) |
| Wallet gateway / signing driver | — | ✅ their infrastructure |
| Token / session lifecycle | — | ✅ their wallet SDK |
| Network constants (ccipOwner, TAR, FeeQuoter, RMNRemote addresses) | `networks.ts` (we provide CV1; DA adds their network) | or DA passes via env overrides |
| Ledger read access for the configure-step reads | — | ⚠️ DA's wallet must have read rights over their issuer party (see below) |

## Prerequisite: the configure steps read the issuer's contracts

Steps 6 (set-pool) and 7 (apply-chain-updates) — and 2 (accept-admin) — read
contracts signed by ccipOwner or observed by the issuer party (TokenConfig,
the pool). The SDK's `generateUnsigned<Op>` does these ACS reads during
composition, so the caller's ledger connection must have **read rights**
(`CanReadAs`) over the issuer's party. In our testnet flow we granted
`CanReadAs(own party)` to the submitting user; DA's equivalent is that their
wallet/ledger connection can read their issuer party's contracts. This is a
participant-auth setup on DA's side, not an SDK concern — but without it, the
configure-step composition fails (the reads return nothing).

## What's portable as-is

- `@chainlink/ccip-sdk` `cct/canton/*` — the `CantonTokenManager` + all ops,
  encoders, ACS/EDS resolution, natural-JSON decoders. No Chainlink-specific
  assumptions; any Canton party on any network can use it.
- The 7-step ordering + call patterns (in `deploy-pool-e2e.ts`).

## What DA adapts

- The **wallet/submit half** — replace `submitViaGateway` / `ensureGatewaySession` /
  `createGatewayLedgerFetch` with the DA app's wallet SDK connection. The SDK
  core never touches these; they're script-only.
- **`networks.ts`** — add DA's network's well-known contract addresses
  (ccipOwner, TAR, FeeQuoter, RMNRemote, EDS URL, ledger URL), or pass them
  via `TAR_RAW` / `FEE_QUOTER_RAW` / `RMN_REMOTE_RAW` env overrides.
- The **read-rights setup** on their participant (above).

## Open question (for Matteo / Judy)

The signing seam is settled (DA handles `prepareExecute`; we hand them an
unsigned tx). The remaining question is the **integration surface**: does the
DA Registry app embed `@chainlink/ccip-sdk` and call `generateUnsigned<Op>`
directly, or does it want CCIP pool-deploy behind a service that returns
unsigned txs for the DA app's existing request/submit machinery to relay?
The `RegistrarServiceRequest` pattern hints DA may have a service-request
model. Either way, the SDK surface is the same (`generateUnsigned<Op>`); it's
about how DA's code consumes it.
