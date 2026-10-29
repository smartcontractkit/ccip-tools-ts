---
id: ccip-tools-design-cct-token-groups
title: 'ADR: Declarative token groups'
draft: true
---

# ADR: Declarative token groups (CCT SDK planner and `ccip-cli cct`)

| Field    | Value                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status   | Proposed                                                                                                                                                                       |
| Date     | 2026-10-17                                                                                                                                                                     |
| Authors  | André Matos                                                                                                                                                                    |
| Feedback | [Google Doc](https://docs.google.com/document/d/1p31YPkAQVptE7EAmozGdtRP_Z3xJY9Pbmm58Zgljf54/edit). Reviewers comment there. This file follows the Google Doc.                 |
| Branch   | `cli/cct2`                                                                                                                                                                     |
| New code | `ccip-sdk/src/cct/group/`, `ccip-cli/src/commands/cct.ts`, `ccip-cli/src/cct/`                                                                                                 |
| Related  | DAPP-11608 (CLI epic), DAPP-11597, DAPP-11601, DAPP-11602, DAPP-11785 (TMEM), DAPP-11565 (CreateX spike), DAPP-10824 (reviewable artifacts), CCIP-14259 (token group identity) |

## 1. Summary

This document proposes a declarative model for one cross-chain token on many networks. The model is a _token group spec_.

A user writes a small YAML file. The file gives the member networks and the metadata of a new token on the home member. The SDK reads each chain and finds the current state. The SDK compares that state with the spec. The SDK then makes a reviewable artifact with the unsigned transactions that remove the difference.

The CLI has one command: `ccip-cli cct <file>`. On a terminal, it opens a session that shows the live status and the plan at once. A missing file starts a wizard. Without a terminal, flags do the same steps. The CLI signs locally only when the signer holds the power: `owner` is omitted or equals the signer. For any other owner, it exports artifacts and Safe or Squads files. After each step, the SDK reads the chains again. A run with nothing to do is the proof that the group is functional.

The file holds intent, not state. The SDK finds deployed contracts on-chain or predicts their addresses. The CLI writes back only a small set of anchor values.

## 2. Goals

- Require minimal input: the member networks, and the name and symbol of a new token.
- Supply safe defaults. Let a user override each default at root, network, or lane level.
- Discover all other facts on-chain: router-linked contracts, lanes, deployed contracts, versions, and roles.
- Make a plan from the difference between the desired state and the observed state.
- Make an empty plan after the group converges. A second run must change nothing.
- Support the common ownership patterns with one field. An EOA deploys and configures, then a multisig takes over. Or a multisig owns the group from the start, and the CLI only exports artifacts. A clean run proves that the deployer keeps no power.
- Validate the projected final state before the plan is shown. A plan must lead to a functional group.
- Emit plans in the `reviewable-artifacts` format. TMEM can then simulate, review, and export them.
- Keep the engine in the SDK. The CLI and TMEM use the same engine.
- Build EVM and Solana first. Keep the model ready for Canton.

## 3. Non-goals

- Store no progress, journal, or database. The chains are the state.
- Do not edit artifacts. A user edits the spec and plans again.
- Do not deploy custom pool contracts. The planner reconciles a custom pool only through a known pool interface.
- Do not deploy, configure, or hand off a multi-token pool from a token group file (Section 9.7).
- Do not migrate pools (v1 to v2) in the first release. Section 16 schedules pool replacement.
- Do not send test transfers. A user can run `ccip-cli send` for an end-to-end test.

## 4. Terms

| Term            | Meaning                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token group     | One logical token on many networks. Pools link the members through lanes. This is the meaning of the CCIP API `TokenGroup`. It is not a policy (earlier: "group") of the multi-token pool design (Section 9.7). |
| Member          | One network in the group. A member has a token, a pool, a registry entry, and optional hooks and lockbox.                                                                                                       |
| Home            | The member with `home: true` (default: the first member). Discovery starts there. New tokens on other members inherit its metadata.                                                                             |
| Lane            | A pool link between two members. A lane is functional only when both pools have the link.                                                                                                                       |
| Mechanism       | What a pool does on a lane: lock (and later release) or burn (and later mint). `pool.type` sets it.                                                                                                             |
| Pot             | Locked tokens that back one set of claimants. A pot can span several pools, silos, or lockboxes on different chains, for example the hubs of a shared-hubs group. Members that mint against a pot claim on it.  |
| Hub             | In the topology survey (Section 8.12): a member that locks toward a member that mints. The spec has no hub field: `pool.type` sets the mechanism, and `remotes` sets the connectivity.                          |
| Shape           | The combination of mechanisms and connectivity, for example "hub-and-spoke" or "burn/mint mesh". Section 8.12 lists the shapes.                                                                                 |
| Spec            | The YAML file. It states desired values.                                                                                                                                                                        |
| Resolved spec   | The spec, plus defaults, plus discovered chain facts. Every field has a value.                                                                                                                                  |
| Observation     | The on-chain facts that the SDK reads for each member.                                                                                                                                                          |
| Projected state | The observation plus the effects of all planned operations.                                                                                                                                                     |
| Anchor          | An address that the planner cannot discover or predict. The CLI writes it into the spec.                                                                                                                        |
| Artifact        | A reviewable transaction batch in the `reviewable-artifacts` v1.0 schema.                                                                                                                                       |
| Account         | The actor that signs a group of operations: EOA, Safe, Squads vault, or timelock.                                                                                                                               |
| Signer          | A wallet that the CLI can use to sign. `--wallet` supplies it.                                                                                                                                                  |

## 5. Research findings

### 5.1 Sources

| Source                                                                                                               | Finding                                                                                                                                                                                                                           | Effect on this design                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| CCT SDK, EVM ([`cct/evm/index.ts`](../../ccip-sdk/src/cct/evm/index.ts))                                             | Reads and writes tokens, registry entries, pools 1.5.0 to 2.0.0, lockboxes, and hooks. It deploys only 2.0.0 contracts. It accepts only known pool versions; another version throws.                                              | The EVM adapter uses these operations. Deploys are 2.0.0 only. Other pool versions need a common-interface path (Section 8.9). |
| CCT SDK, EVM `generate()`                                                                                            | About 36 operations read `typeAndVersion`, owner, and current state before they encode.                                                                                                                                           | The planner cannot call `generate()` for a contract that does not exist yet. It needs pure encoders (Section 11.3).            |
| CCT SDK, Solana ([`cct/solana/index.ts`](../../ccip-sdk/src/cct/solana/index.ts))                                    | Deploys tokens and pools on canonical programs. Configures registry, lanes, rate limits, and allowlists. It has no fast-finality writes.                                                                                          | The Solana adapter is in the first scope. Fast-finality knobs are EVM only for now.                                            |
| CCT SDK, Canton ([`cct/canton/index.ts`](../../ccip-sdk/src/cct/canton/index.ts))                                    | Deploys a pool with lanes and applies chain updates. It has no registry, ownership, or rate-limiter writes.                                                                                                                       | The model has a Canton block. The adapter comes later.                                                                         |
| Core SDK ([`chain.ts`](../../ccip-sdk/src/chain.ts), [`networks.ts`](../../ccip-sdk/src/networks.ts))                | `networkInfo` maps names to selectors. `getTokenAdminRegistryFor`, `getTokenPoolRemotes`, and `getOnRampForRouter` exist. There is no router directory. `CCIPAPIClient` cannot list chains or lanes.                              | The resolver needs a chain directory. The SDK needs a lane-existence helper.                                                   |
| Core SDK simulation (`simulateLockOrBurn`, `simulateReleaseOrMint`)                                                  | The SDK calls `lockOrBurn` with a balance override, and `releaseOrMint` from the OffRamp, without a transaction.                                                                                                                  | Simulation checks per lane direction (`TG-SIM`, `TG-GAS`).                                                                     |
| CLI ([`ccip-cli/src/index.ts`](../../ccip-cli/src/index.ts))                                                         | yargs `commandDir`. `search.ts` shows the nested command pattern. Wallet loaders exist per family. No YAML writer, no schema library, no Safe export.                                                                             | New `cct` command directory. Add a YAML document writer and exporters.                                                         |
| Spike `spike/DAPP-11565-deploy-via-createx`                                                                          | Adds CreateX deterministic deploys and a Safe Transaction Builder batch writer. It is not merged.                                                                                                                                 | Deterministic EVM addresses for all deployable contracts (Section 9.4).                                                        |
| Token Manager (TM)                                                                                                   | Stores drafts with progress per step. Deploys through TokenPoolFactory. Lanes default to a mesh of supported lanes. Rate limits are disabled at deploy. EVM only. No health check after deploy.                                   | Mesh default. No stored progress. Add a validity contract.                                                                     |
| Token Manager Expert Mode (TMEM)                                                                                     | One operation per form, no group model. It migrates to the SDK `cct` module (DAPP-11602). Safe export is single chain and has no deploys.                                                                                         | Use the SDK operation names in the artifact. TMEM can then map operations one to one.                                          |
| `reviewable-artifacts` schema (DAPP-10824)                                                                           | Artifact v1.0 schema: accounts, groups with `executionMode`, operations with `dependsOn`, `source`, and `payload`. An EVM payload needs `to`. A Solana payload is one instruction. A declarative `PlanSpec` is planned for v1.1.  | The plan output format (Section 11.5). Schema extensions are needed (Section 15).                                              |
| DAPP-11608 (CLI epic) and its stories                                                                                | Prepare mode and broadcast mode. Byte-identical prepared transactions. Offline artifact validation. Refusal of stale artifacts. Safe batches that compose. `check` and `roles` reports. Workflows that skip completed steps.      | The `cct` command satisfies these requirements (Section 13.8).                                                                 |
| DAPP-11785, DAPP-11601                                                                                               | TMEM plans token group discovery and a plan builder.                                                                                                                                                                              | The SDK discovery and planner can serve both.                                                                                  |
| CCIP API `TokenGroup`                                                                                                | `groupId` (UUID), members, and directed connections. CCIP-14259 stabilizes group identity.                                                                                                                                        | Optional discovery hint. On-chain reads stay the authority.                                                                    |
| CLD changesets `token_expansion_cross_family`, `configure-tokens-for-transfers` (chainlink-ccip `deployment/tokens`) | Per-chain YAML. Human-unit rate limits. An omitted value keeps the on-chain value. Inbound limits get 110% of the counterpart outbound. Both directions are required.                                                             | Field names, units, and omission semantics.                                                                                    |
| `docs-cct-foundry` (`docs/config-schema.md`)                                                                         | Chain facts sync from the CCIP REST API (`GET /chains/{selector}`). An absent field is undeclared. A `doctor` command checks that lanes are reciprocal.                                                                           | Chain directory source. Reciprocal lane checks.                                                                                |
| Chainlink docs (token issuer guide, rate limits, FTF, hooks, SVM pages)                                              | Canonical step order. Rate-limit rules per version. Solana lookup-table layout and mint-authority rules.                                                                                                                          | Step order (Section 11.2) and validity checks (Section 12).                                                                    |
| [CCIP 2.0 invariants](https://github.com/smartcontractkit/chainlink-ccip/tree/main/chains/evm/contracts/invariants)  | Each end of a lane computes its own CCV set and its own finality permission. A required CCV that the source does not request blocks the execution. A `destPoolData` larger than `destBytesOverhead` reverts the send.             | Pairing checks (Section 12).                                                                                                   |
| CCT migration runbooks                                                                                               | Validators: pool deployed, ownership, roles, lockbox, registry, reverse propagation, remote chains, rate limits, fees, rate-limit admin.                                                                                          | Validity checks (Section 12).                                                                                                  |
| Team design discussions                                                                                              | Agreed direction: a strict, lean schema with derived addresses. "Hardcode the minimum, auto-discover the maximum, duck-type." No remote addresses in the schema. Hub and mesh both have users. Other teams own some remote pools. | Design rules (Section 8.1). Star through `remotes` lists. Per-account groups for remote owners.                                |
| Survey of deployed token groups (not authoritative)                                                                  | Eight shapes. Burn/mint mesh and hub-and-spoke cover most groups. A shape comes from the pool mechanism per lane plus the connectivity. Pots must cover the supply that is minted against them.                                   | Two independent axes in the spec. Coverage table (Section 8.12). Backing and stranded-hub checks (Section 12).                 |
| Support cases and incident reviews                                                                                   | Frequent failures: per-token gas or bytes too low, remote pool mismatch, rate limits in the wrong unit, missing mint role, wrong migration order, and Solana Token-2022 transfer hooks.                                           | Simulation, pairing, and lifecycle checks (Sections 9.6 and 12).                                                               |

### 5.2 Constraints that shape the design

1. Some pool values are immutable after deploy: token, local decimals, RMN proxy, and lockbox. The hooks allowlist-enabled flag is also immutable. The planner must validate them before a deploy.
2. Rate-limit and fee calls revert with `NonExistentChain` until `applyChainUpdates` adds the remote chain.
3. Both ends of a lane must be configured before `setPool` activates a pool. Otherwise messages fail on the destination.
4. Rate-limit bounds differ per version. Section 8.6 lists them.
5. A change of remote token requires a chain removal and a new chain addition.
6. EVM pool and token pending owners have no getter. The registry pending administrator is readable.
7. `RegistryModuleOwnerCustom` is not discoverable through a direct call. It comes from a directory or from registry logs.
8. Solana `init_chain_remote_config` needs the remote token decimals. The Solana lookup table must hold exactly 10 accounts in a fixed order.
9. A Solana burn-mint pool needs the pool signer as mint authority, or as a multisig member that meets the threshold.
10. A Safe cannot do a plain `CREATE`. An artifact EVM payload needs a `to` address. A factory call (CreateX) solves both.
11. Old remote pools must stay until all in-flight messages execute.
12. On Solana, registration through the owner path needs the mint authority as signer. A multisig or the pool signer cannot sign it, so registration comes first.
13. In 2.0, each end of a lane computes its own CCV set and its own finality permission. One end can accept a transfer that the other end refuses.
14. A rate-limit bucket never holds more than its capacity. A transfer larger than the inbound capacity of the destination never executes.
15. Pools before 1.5.1 do not convert decimals.
16. Solana, Aptos, and Sui token amounts are `u64`.
17. On 1.5.0, 1.5.1, and 1.6.0 pools, and on Solana, a `0`/`0` bucket is disabled: it means no limit.

## 6. Decisions

| Topic                 | Decision                                                                                                                                                                                                                                                                                                               | Reason                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chain families        | Model EVM, Solana, and Canton. Build EVM and Solana adapters first. Members on other families are unmanaged (Section 9.5).                                                                                                                                                                                             | The SDK can deploy and configure on EVM and Solana. Canton lacks write operations.                                                                                   |
| Topology              | Two independent axes. Mechanism: `pool.type` per member (default burn-mint). Connectivity: by default, every pair of members with CCIP lanes in both directions (a mesh). The `remotes` field of a member can list its only remotes or exclude some. An exclusion on either end removes the pair. No `topology` field. | TM uses a mesh. Customers ask for a mesh. Some issuers prefer a star for security: each spoke lists the hubs. The two axes express all common shapes (Section 8.12). |
| Omitted fields        | `strict: false` (default): an omitted field keeps the on-chain value of an existing resource. `strict: true`: an omitted field always means the default.                                                                                                                                                               | Safe import of existing groups. A full desired state is still possible.                                                                                              |
| Rate limits           | Local pool view. `{capacity, rate}` sets both directions. `inbound` and `outbound` override. Lane wins over member, member over root.                                                                                                                                                                                  | It matches the requested model. No surprise values. Optional headroom and warnings cover the docs guidance.                                                          |
| State                 | No state file. The planner discovers from anchors and predicts deterministic addresses. The CLI writes back anchors only.                                                                                                                                                                                              | The chains are the source of truth. A rerun resumes without a journal.                                                                                               |
| EVM deploys           | CreateX CREATE3 with permissioned salts. The salt has no network, so a contract has the same address on each EVM chain. Fallback: direct deploy, then anchor write-back.                                                                                                                                               | Predictable addresses, Safe-compatible deploys, and every contract type. Same-address tokens fit the connection policies of multi-token pools.                       |
| Group key             | No group name field. The home token symbol keys the deterministic addresses. An optional `salt` separates two groups with the same symbol and deployer.                                                                                                                                                                | Less input. The chain keeps the symbol fixed. A file name is not stable, and TM/TMEM have no file.                                                                   |
| Family keys           | Keys of one family only go flat in the member of that family. No `families` or `defaults` level: shared settings go at the root.                                                                                                                                                                                       | A group has at most one Solana member and one Canton member. Less nesting.                                                                                           |
| Token                 | Per member. A `token` object holds deploy metadata until the deploy; the CLI then replaces it with the address. Other members inherit the home metadata and override single fields. A member without `token` gets its token from pool links or a prediction.                                                           | The chain holds the metadata after the deploy, so the file cannot disagree with it. Less input.                                                                      |
| Plan output           | `reviewable-artifacts` v1.0.                                                                                                                                                                                                                                                                                           | TMEM can simulate and export the plan. One review format for CLI and UI.                                                                                             |
| CLI shape             | One command: `ccip-cli cct <file>`. A session on a TTY; the same steps through flags otherwise. No validate or verify step: a clean run is the verification.                                                                                                                                                           | One entry point and always-current status. The flags keep CI, agents, and multisig signers working (Section 13.8).                                                   |
| Session edits         | Each menu edit writes the file at once. The session watches the file for hand edits.                                                                                                                                                                                                                                   | The file always matches the screen.                                                                                                                                  |
| Missing file          | On a TTY: confirm, then a create-or-import wizard. Without a TTY: create or import flags, else an error.                                                                                                                                                                                                               | Typo safety, and scripts still work.                                                                                                                                 |
| Run without `--apply` | Read only. Print status and plan. Exit 0, 1, 2, or 3 (Section 13.6).                                                                                                                                                                                                                                                   | Safe default. It is also a CI drift check.                                                                                                                           |
| Ownership             | Signer rule: the CLI signs locally only for powers that the signer holds. `owner` omitted or equal to the signer: the signer deploys and signs. Another `owner` (default kind: Safe or Squads): the owner deploys and signs through artifacts; the signer only transfers powers that it still holds (Section 11.7).    | No signer acts for an owner that it is not. A hand-off is a one-line edit. A clean run proves that the deployer keeps no power.                                      |
| Units                 | Whole-token decimal strings. The planner scales them with the local decimals.                                                                                                                                                                                                                                          | Human review. CLD uses the same units.                                                                                                                               |
| Interfaces            | Detect by probing (duck typing): token burn signature, registration method, pool type and version, and account kind. Trust `typeAndVersion`. A pool with an unknown type or version is `custom`: the planner uses each common pool function that answers, and assumes its usual effect.                                | Less input. No guessed method names. No bytecode checks.                                                                                                             |
| Remote addresses      | Never in the spec. The planner discovers or predicts them.                                                                                                                                                                                                                                                             | A user cannot paste a wrong router or pool into a lane.                                                                                                              |
| Validity              | A clean run also passes pairing checks across the two ends of each lane, and simulation checks of each lane direction.                                                                                                                                                                                                 | Each end can be valid alone while transfers between them fail.                                                                                                       |
| Lifecycle             | `drain` stops transfers into a member and keeps transfers out of it. The removal of a member with supply needs `--allow-destructive`. Destructive operations wait until no message is in flight.                                                                                                                       | A one-step removal strands holders and in-flight messages.                                                                                                           |
| Multi-token pools     | A token group file uses a multi-token pool but never deploys or owns it. Token settings become records in its config manager, or references to its policies.                                                                                                                                                           | The pool and its config manager also serve other tokens and other files.                                                                                             |

## 7. Architecture

### 7.1 Pipeline

```text
spec.yaml ─parse──────────▶ TokenGroupSpec                (pure; no I/O)
          ─resolve────────▶ ResolvedTokenGroup            (defaults, chain facts, predicted addresses)
          ─observe────────▶ ObservedTokenGroup            (RPC reads per member)
          ─reconcile──────▶ PlannedOperation[]            (dependsOn graph, required account per operation)
          ─project, check─▶ ValidityReport                (must pass, or the plan stops)
          ─encode, group──▶ Artifact                      (reviewable-tx-batch v1.0)

CLI apply: review ▶ run local-signer groups ▶ export other groups ▶ observe again ▶ repeat
```

### 7.2 Package layout

```text
ccip-sdk/src/cct/group/
  spec.ts           types, parser, inheritance, defaults (no I/O)
  schema.ts         JSON Schema for editors and other languages
  resolve.ts        chain facts, lane selection, predictions
  discover.ts       group discovery from anchors
  observe.ts        family-neutral observation types
  plan.ts           reconcile, order, project
  check.ts          validity contract (pure)
  artifact.ts       reviewable-artifact types and mapping
  adapters/evm.ts   adapters/solana.ts   adapters/canton.ts
ccip-cli/src/commands/cct.ts                `cct [file]`: mode dispatch; imperative ops stay subcommands
ccip-cli/src/cct/steps.ts                   step functions shared by the session and the flags
ccip-cli/src/cct/{session.ts, wizard.ts, board.ts, edits.ts, review.ts, watch.ts}
ccip-cli/src/cct/{yaml-document.ts, wallets.ts, exporters/safe.ts, exporters/squads.ts}
```

The SDK exposes the module as a new subpath, `@chainlink/ccip-sdk/cct/group`. The module has no YAML, file system, or wallet dependency.

### 7.3 Family adapter contract

```ts
interface TokenGroupAdapter<F extends ChainFamily> {
  readonly family: F
  /** Router-linked contracts, registry module, CreateX, and lane support. */
  resolveChainFacts(chain: Chain<F>, member: MemberIntent): Promise<ChainFacts>
  /** Deterministic addresses for resources that the plan can deploy. */
  predict(member: ResolvedMember, deployer: string): PredictedAddresses
  /** On-chain facts for one member, read at one block. */
  observe(chain: Chain<F>, member: ResolvedMember): Promise<ObservedMember>
  /** Operations that move one member from observed to desired. */
  reconcile(desired: ResolvedMember, observed: ObservedMember, ctx: PlanContext): PlannedOperation[]
  /** Payloads: live through the SDK operation, or pure for a predicted contract. */
  encode(op: PlannedOperation, ctx: PlanContext): Promise<Payload[] | null>
}
```

### 7.4 Reuse by TM and TMEM

- TMEM token group discovery (DAPP-11785) can call `discoverTokenGroup(anchor)`. It returns a spec with all members.
- The TMEM plan builder (DAPP-11601) can call `planTokenGroup(spec)`. It returns an artifact that the TMEM kit validates, simulates, and exports.
- TMEM moves its forms to SDK operations (DAPP-11602). The artifact uses the same operation names in `source.operation`. The TMEM adapter maps them one to one.
- A UI can hold the spec as JSON. The JSON Schema drives form validation.

## 8. Data model

### 8.1 Design rules

- Hardcode the minimum. Discover the maximum. Detect interfaces by probing.
- The spec never holds remote addresses, router-linked addresses, or versions of contracts that the planner does not deploy.
- One file describes one token group.
- The file holds token metadata only until the deploy. The chain holds it after the deploy.
- Network keys are SDK network names, for example `ethereum-testnet-sepolia-base-1`.
- Amounts are decimal strings in whole tokens, for example `"1000"` or `"0.25"`.
- `null` means "disabled" or "none". An omitted field follows Section 8.5.

### 8.2 Minimal file

```yaml
version: 1
networks:
  ethereum-testnet-sepolia: # home: the first member
    token: { name: Acme Token, symbol: ACME }
  ethereum-testnet-sepolia-base-1: {}
  ethereum-testnet-sepolia-arbitrum-1: {}
```

The planner resolves this file to the desired state below:

- Each member gets a new `CrossChainToken` 2.0.0 with 18 decimals and no supply cap.
- Each member gets a new `BurnMintTokenPool` 2.0.0. The pool gets the mint and burn roles.
- The signer becomes the token owner, the pool owner, and the registry administrator.
- The members link in a mesh where CCIP lanes exist. Rate limits are disabled.
- Each registry points to the new pool of its member.

The create wizard writes `rateLimits: null` into new files. The choice is then visible in review.

### 8.3 Write-back of anchors

After the first deploy, the CLI updates the file:

```yaml
version: 1
deployers:
  evm: '0x5c1f…' # written at apply: CreateX salts depend on it
networks:
  ethereum-testnet-sepolia:
    token: '0x9a3b…' # ACME
  ethereum-testnet-sepolia-base-1: {}
  ethereum-testnet-sepolia-arbitrum-1: {}
```

Rules:

- The CLI writes an anchor only after a confirmed transaction and a matching on-chain read.
- The CLI keeps comments, key order, and style. It uses the `yaml` Document API.
- After a deploy, the CLI replaces the `token` object of the member with the token address. It keeps the symbol as a comment.
- The CLI writes only these anchors: `deployers.<family>` (only when the signer deploys), token addresses in place of `token` objects, and addresses from fallback deploys.
- The CLI removes a `false` member entry after it verifies that the member is disconnected.
- `--no-write` stops all write-back. The CLI then prints the anchors.

### 8.4 Override levels

The most specific level wins:

1. Lane: `networks.<A>.remotes.<B>`
2. Member: `networks.<A>`
3. Root: the shared settings at the top of the file, for example `owner`, `pool`, and `rateLimits`
4. Built-in defaults (Section 8.8)

Objects merge by key. Arrays and scalars replace the value. `null` replaces the value.

Token metadata follows the home member. A `token` object on another member overrides single fields, for example `name: Wrapped Acme`. The home token gives the other `name`, `symbol`, and `decimals` values: its object before the deploy, and the chain after it. `maxSupply` and `preMint` do not inherit.

Family rules:

- The family of a network name selects the member type: EVM, Solana, or Canton.
- Keys of one family only go flat in the member of that family, for example `tokenProgram` on `solana-mainnet`. A group has at most one Solana member and one Canton member, so these keys need no shared level.
- A root key applies to each member that supports it. For example, a root `fees` value applies to EVM 2.0 members only.
- A root value that a supporting member cannot use is an error. Example: a root EVM `owner`, and a Solana member without its own `owner`. The error names the member and the field to set.
- Address anchors are valid on a member only: `token`, `pool.address`, `pool.hooks.address`, and `pool.lockbox.address`.

### 8.5 Omitted fields and strict mode

| Case                                                     | `strict: false` (default)                                | `strict: true`                                          |
| -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| Field omitted, resource is new                           | Built-in default                                         | Built-in default                                        |
| Field omitted, resource exists                           | Keep the on-chain value. The plan shows it as unmanaged. | Built-in default. The plan changes the on-chain value.  |
| Actor omitted (`owner`, administrators), resource exists | Keep the on-chain holder. Exception: Section 11.8.       | Same. The signer default applies to new resources only. |
| Field is `null`                                          | Disable or clear                                         | Disable or clear                                        |
| On-chain lane, remote pool, or member not in the spec    | Keep it. The report shows it as extra.                   | Remove it. The operation is destructive.                |
| Member set to `false`, or lane excluded (Section 9.2)    | Disconnect it. The operation is destructive.             | Disconnect it. The operation is destructive.            |
| Member with `drain: true`                                | Pause the lanes into it. Keep the lanes out of it.       | Same                                                    |
| Token or chain paused on-chain                           | Keep it. The report shows it.                            | Same. The planner never unpauses.                       |

The CLI refuses destructive operations without a typed confirmation or `--allow-destructive`. A plan marks each destructive operation in its summary.

### 8.6 Rate limits

```yaml
rateLimits: { capacity: '100000', rate: '10' } # both directions
rateLimits: # per direction
  outbound: { capacity: '100000', rate: '10' }
  inbound: null
rateLimits: null # disabled
rateLimits: { capacity: '0', rate: '0' } # paused
```

Rules:

- Values refer to the local pool. `outbound` limits transfers from this member to the remote member. `inbound` limits transfers from the remote member into this member.
- `capacity` is in whole tokens. `rate` is in whole tokens per second. The planner scales both with the local decimals.
- The shorthand `{capacity, rate}` sets both directions. The root `rateLimitHeadroom` (default `"0%"`) increases the inbound value of a shorthand only.
- `fastRateLimits` has the same shape. It applies to fast-finality transfers on EVM 2.0 pools. `null` makes the fast bucket use the default bucket.
- The planner rejects a value with more fraction digits than the local decimals.
- The planner rejects an enabled value that scales to zero, unless it is an explicit `0`/`0` pause.
- A `0`/`0` pause on a 1.5.0, 1.5.1, or 1.6.0 pool, or on Solana, becomes the smallest valid bucket: capacity 2 and rate 1 in base units. On those pools, a disabled bucket means no limit.
- The unit of the inbound bucket depends on the pool version. A pool that limits inbound amounts before the decimal conversion gets the value in remote decimals (Section 15).

Bounds per pool version:

| Pool                    | Enabled bucket                     | Disabled bucket | Amount type |
| ----------------------- | ---------------------------------- | --------------- | ----------- |
| EVM 1.5.0, 1.5.1, 1.6.0 | `0 < rate < capacity`              | `0`/`0`         | `uint128`   |
| EVM 1.6.1, 2.0.0        | `rate <= capacity`; `0`/`0` pauses | `0`/`0`         | `uint128`   |
| Solana                  | `0 < rate < capacity`              | `0`/`0`         | `u64`       |
| Canton                  | Set at deploy; read later          | Not applicable  | Decimal     |

Lane checks:

- `TG-RL-CAP`: the inbound capacity on B is not less than the outbound capacity on A. A transfer larger than the inbound capacity never executes, so this check fails the plan. A disabled bucket counts as no limit.
- `TG-RL-ASYM` (warning): the inbound rate on B is less than the outbound rate on A, or the inbound capacity has less margin than the docs advise (5% to 10%).
- The same checks apply to the fast buckets.
- `TG-RL-NONE` (warning): a mainnet lane has no rate limits.

### 8.7 Schema

```ts
/** SDK network name, for example `ethereum-testnet-sepolia` (see `networkInfo`). */
type NetworkName = string
/** Address in the native format of the network that holds it. */
type Address = string
/** Decimal text in whole tokens, for example "1000" or "0.25". */
type Amount = string
/** Percent text, for example "10%". */
type Percent = string
type Family = 'evm' | 'solana' | 'canton'
/** `selector:<decimal>`, for a chain without a network name. It takes only `false` (Section 9.6). */
type ChainSelectorKey = `selector:${string}`

/** The root also holds the shared settings (Section 8.4). */
interface TokenGroupSpec extends MemberSettings {
  version: 1
  /** Default `false`. See Section 8.5. */
  strict?: boolean
  /** Inbound increase for the rate-limit shorthand. Default "0%". */
  rateLimitHeadroom?: Percent
  /** One entry per member. `null`: a member without overrides. `false`: disconnect. The family of the network name selects the member type. */
  networks: Record<NetworkName | ChainSelectorKey, MemberSpec | null | false>
  /** Written by the CLI when the signer deploys. The deployer per family, for deterministic addresses. An external `owner` is its own deployer. */
  deployers?: Partial<Record<Family, Address>>
  /** Default: none. Extra input for the group key (Section 9.4). Set it only for a second group with the same symbol and deployer. Do not change it after a deploy. */
  salt?: string
}

/** Metadata for a new token. The CLI replaces the object with the token address after the deploy. */
interface TokenSpec {
  /** Required on the home member. Default elsewhere: the home value. */
  name?: string
  /** Required on the home member. Default elsewhere: the home value. */
  symbol?: string
  /** Default: 18 on the home member, else the home value. A Solana member uses at most 9. `TG-DEC-RANGE` checks the supply. */
  decimals?: number
  /** Default `null`: no cap. Solana does not enforce a cap. Not inherited. */
  maxSupply?: Amount | null
  /** Default: none. `to` defaults to the owner. Not inherited. */
  preMint?: { amount: Amount; to?: Address }
}

/** Settings for the root and for each member. */
interface MemberSettings {
  /** Final holder of the token, pool, registry, hooks, and lockbox roles. Default: the signer, for new resources only. Another value is an external account: it deploys and signs through artifacts, or receives a hand-off (Section 11.7). */
  owner?: Actor
  /** Registry administrator, if it is not `owner`. */
  registryAdmin?: Actor
  /** Token owner or default admin, if it is not `owner`. */
  tokenOwner?: Actor
  pool?: PoolSettings
  rateLimits?: RateLimits
  /** EVM 2.0 only. */
  fastRateLimits?: RateLimits
  /** EVM 2.0 only. Default `null`: FeeQuoter defaults apply. */
  fees?: TransferFees | null
  /** EVM 2.0 only. Default `null`: lane default CCVs. Hooks are deployed if needed. */
  ccvs?: CcvLists | null
}

/** The family of the network name selects the type. A family without an adapter needs `managed: false`. */
type MemberSpec = EvmMemberSpec | SolanaMemberSpec | CantonMemberSpec | UnmanagedMemberSpec

interface MemberBase extends MemberSettings {
  /** One member only. Default: the first member. */
  home?: boolean
  /** Address: an existing or deployed token. Object: deploy a new token. Omitted on a non-home member: the token from pool links, or a new token with the home metadata. */
  token?: Address | TokenSpec
  /** Default: chain directory. */
  router?: Address
  /** Lane selection and per-lane overrides (Section 9.2). List: the only remotes. Map: an entry includes its lane, `false` excludes it, and `'*': false` excludes each remote that the map does not name. */
  remotes?: NetworkName[] | ({ '*'?: false } & Record<NetworkName, LaneSettings | false>)
  /** Default `true`. `false`: the planner reads and links this member, but never changes it (Section 9.5). */
  managed?: boolean
  /** Default `false`. `true`: stop transfers into this member, and keep transfers out of it (Section 9.6). */
  drain?: boolean
}

interface EvmMemberSpec extends MemberBase {
  /** Default: chain directory, then registry logs. */
  registryModule?: Address
  /** `CrossChainToken` only. Default: `owner`. */
  ccipAdmin?: Actor
  /** `CrossChainToken` only. Default: `owner`. */
  burnMintRoleAdmin?: Actor
  /** Default: detect `owner()`, then `getCCIPAdmin()`, then the AccessControl default admin. */
  registration?: 'owner' | 'ccip-admin' | 'access-control'
}

/** The planner deploys the first five types. It only detects the others (Section 8.9). */
type PoolType =
  | 'burn-mint'
  | 'burn-from-mint'
  | 'burn-with-from-mint'
  | 'lock-release'
  | 'siloed-lock-release'
  | 'burn-to-address'
  | 'burn-mint-with-lock-release-flag'
  | 'hybrid'
  | 'usdc-proxy'
  | 'custom'

interface PoolSettings {
  /** Default: `burn-mint` for a new token. Detected for an existing token (Section 8.9). */
  type?: PoolType
  /** Deploy version. Default "2.0.0". An existing pool keeps its version. */
  version?: string
  /** An existing pool that the registry does not point to yet, for example a custom pool or a multi-token pool. The CLI also writes it after a fallback deploy. */
  address?: Address
  /** Multi-token pools only (Section 9.7). An MTTP policy name per record type. A type with a policy takes no values from the spec. */
  policies?: Partial<Record<'connection' | 'chain' | 'rateLimit' | 'fee' | 'security', string>>
  /** Multi-token pools only (Section 9.7). An `ITokenIdentityMetadataProvider`. Default: keep the observed value; none for a new token. */
  identityProvider?: Address | null
  /** 2.0: dynamic config. 1.5 and 1.6: `setRateLimitAdmin`. Default: none. */
  rateLimitAdmin?: Address | null
  /** 2.0 only. Default: none. */
  feeAdmin?: Address | null
  /** Default `null` (off). On 2.0 the allowlist is in the hooks, and its enable flag is immutable. */
  allowlist?: Address[] | null
  /** 2.0 only. Default `null`: fast finality is off. */
  fastFinality?: { blockDepth?: number; waitForSafe?: boolean } | null
  /** 2.0 only. Default `null`, unless `ccvs` or a 2.0 allowlist needs hooks. */
  hooks?: HooksSettings | null
  /** lock-release 2.0. Default: deploy one lockbox and authorize the pool. */
  lockbox?: { address?: Address; authorizedCallers?: Address[] }
  /** lock-release only. */
  liquidity?: { rebalancer?: Address | null; minimum?: Amount }
}

interface HooksSettings {
  /** Default: deploy new hooks. */
  address?: Address
  /** Default "0". */
  thresholdAmount?: Amount
  /** Default `null`. */
  policyEngine?: Address | null
  /** Default: the pool only. */
  authorizedCallers?: Address[]
}

type Bucket = { capacity: Amount; rate: Amount }
type RateLimits = null | Bucket | { inbound?: Bucket | null; outbound?: Bucket | null }

interface LaneSettings {
  rateLimits?: RateLimits
  fastRateLimits?: RateLimits
  fees?: TransferFees | null
  ccvs?: CcvLists | null
  /** siloed-lock-release only. `dedicated`: a silo for this lane. `{ group }`: one silo for all lanes with the same group name. Default `shared`: the catchall lockbox. */
  lockbox?: 'shared' | 'dedicated' | { group: string } | Address
  /** Dedicated or group silos only. The lanes of one group must agree. */
  liquidity?: { rebalancer?: Address | null; minimum?: Amount }
  /** Reserved for pools that choose the mechanism per lane (hybrid pools). Verify only for now. */
  mechanism?: 'lock' | 'burn'
}

interface TransferFees {
  /** Default 90000. */
  destGasOverhead?: number
  /** Default 32. Multi-token pools: default and minimum 192, plus the token identity metadata (Section 9.7). */
  destBytesOverhead?: number
  feeUSDCents?: number
  fastFeeUSDCents?: number
  /** Basis points, less than 10000. */
  transferFeeBps?: number
  fastTransferFeeBps?: number
}

/** `default` means the lane default CCVs (the zero address on-chain). */
interface CcvLists {
  outbound?: Array<Address | 'default'>
  inbound?: Array<Address | 'default'>
  outboundAboveThreshold?: Address[]
  inboundAboveThreshold?: Address[]
}

/** `kind` selects the export format. Default: `safe` on EVM, `squads` on Solana. `eoa`: a key on another machine. */
type Actor = Address | { address: Address; kind?: 'eoa' | 'safe' | 'squads' | 'timelock' }

/** Solana keys are flat in the Solana member. */
interface SolanaMemberSpec extends MemberBase {
  /** Default `spl-token`. */
  tokenProgram?: 'spl-token' | 'token-2022'
  /** Metaplex metadata URI. The name and symbol come from `token`. The update authority follows `owner`. */
  metadataUri?: string
  /** Default `null`. */
  freezeAuthority?: Address | null
  /** Default: multisig of the pool signer and the owner, threshold 1. A new owner gets a new multisig (Section 11.8). */
  mintAuthority?: 'pool-signer' | 'keep' | { multisig: { threshold?: number; signers?: Address[] } }
  /** Default: the canonical program of the pool type. */
  poolProgram?: Address
  /** Default `false`. `true` freezes the lookup table, so the deployer loses its authority (Section 11.8). */
  freezeLookupTable?: boolean
}

interface CantonMemberSpec extends MemberBase {
  instrumentId: string
  instanceId?: string
  observers: string[]
  admin?: string
}

/** Aptos, Sui, TON, and other families without an adapter. */
interface UnmanagedMemberSpec {
  managed: false
  /** Needed only when the core SDK cannot read pools on the family (TON today). */
  token?: Address
  pool?: { address?: Address }
  remotes?: MemberBase['remotes']
}
```

The SDK publishes the same schema as JSON Schema. It generates the schema from its network table: each known network name maps to the member schema of its family. The create wizard adds a `yaml-language-server` comment. Editors then complete and check fields, and offer Solana keys only on a Solana member.

### 8.8 Defaults

| Path                                   | Default                                                    | Note                                                        |
| -------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `strict`                               | `false`                                                    | Section 8.5                                                 |
| `home`                                 | The first member                                           | One member only                                             |
| `managed`                              | `true`                                                     | Section 9.5                                                 |
| `remotes`                              | Every member with CCIP lanes in both directions (a mesh)   | Section 9.2                                                 |
| `rateLimitHeadroom`                    | `"0%"`                                                     | Shorthand inbound only                                      |
| `token.decimals`                       | Home: 18. Other members: the home value; Solana at most 9  | The create wizard writes 9 if the group has a Solana member |
| `token.maxSupply`                      | `null` (no cap)                                            |                                                             |
| `token.preMint`                        | None                                                       | Any member with a `token` object                            |
| `owner`                                | The signer of the member family, for new resources only    | Another value: external signing (Section 11.7)              |
| `registryAdmin`                        | `owner`                                                    |                                                             |
| `tokenOwner`                           | `owner`                                                    | Token owner or default admin                                |
| `drain`                                | `false`                                                    | Section 9.6                                                 |
| `registration`                         | Detected                                                   | `owner`, then `ccip-admin`, then `access-control`           |
| `ccipAdmin`, `burnMintRoleAdmin`       | `owner`                                                    | EVM `CrossChainToken`                                       |
| `pool.type`                            | `burn-mint` (new token); detected (existing token)         | Section 8.9                                                 |
| `pool.version`                         | `2.0.0`                                                    | Only deployable version                                     |
| `pool.rateLimitAdmin`, `pool.feeAdmin` | None                                                       |                                                             |
| `pool.allowlist`                       | `null`                                                     |                                                             |
| `pool.fastFinality`                    | `null` (off)                                               |                                                             |
| `pool.hooks`                           | `null`; deployed when `ccvs` or a 2.0 allowlist needs them |                                                             |
| `pool.lockbox`                         | Deploy one (lock-release 2.0)                              |                                                             |
| `rateLimits`, `fastRateLimits`         | `null`                                                     | `TG-RL-NONE` warning on mainnet                             |
| `fees`                                 | `null`                                                     | FeeQuoter defaults apply                                    |
| `ccvs`                                 | `null`                                                     | Lane default CCVs                                           |
| `null` settings on an MTTP member      | An empty record of the type                                | Section 9.7                                                 |
| `router`                               | Chain directory                                            | Required when no directory entry exists                     |
| `registryModule`                       | Chain directory, then registry logs                        | EVM only                                                    |
| `tokenProgram` (Solana)                | `spl-token`                                                | SDK default                                                 |
| `mintAuthority` (Solana)               | Multisig: pool signer (threshold 1) and owner              | The issuer can mint. A new owner gets a new multisig.       |
| `freezeAuthority` (Solana)             | `null`                                                     |                                                             |
| `freezeLookupTable` (Solana)           | `false`                                                    | Warning while the deployer holds the table authority        |
| EVM deploy method                      | CreateX CREATE3; direct deploy if CreateX is absent        | Section 9.4                                                 |

### 8.9 Pool type selection

| Spec value            | EVM contract                 | Solana program         | Token requirement                   |
| --------------------- | ---------------------------- | ---------------------- | ----------------------------------- |
| `burn-mint`           | `BurnMintTokenPool`          | Canonical burn-mint    | `mint`, `burn(uint256)`             |
| `burn-from-mint`      | `BurnFromMintTokenPool`      | Not applicable         | `mint`, `burnFrom(address,uint256)` |
| `burn-with-from-mint` | `BurnWithFromMintTokenPool`  | Not applicable         | `mint`, `burn(address,uint256)`     |
| `lock-release`        | `LockReleaseTokenPool`       | Canonical lock-release | ERC-20 or SPL transfer              |
| `siloed-lock-release` | `SiloedLockReleaseTokenPool` | Not applicable         | ERC-20 transfer                     |

For an existing token, the planner detects the pool type:

1. Read ERC-165 support for the `CrossChainToken` and `BurnMintERC20` interfaces.
2. If ERC-165 gives no answer, scan the runtime code for the function selectors above.
3. Select the first burn variant that the token supports. Otherwise select `lock-release`.
4. Show the result in the plan as a detected value. A user overrides it with `pool.type`.

The planner never selects a pool from the token symbol.

The planner also detects pool types that it cannot deploy: `burn-to-address`, `burn-mint-with-lock-release-flag`, `hybrid` (a pool that locks on some lanes and burns on others), `usdc-proxy`, and `custom` (any other family). A spec cannot request them for a new pool. The planner manages such a pool only through the common pool interface: lanes, remote pools, rate limits, and admins. It verifies the other settings.

The planner trusts `typeAndVersion`. A pool with an unknown type or version is `custom`. The planner calls each common pool function that answers, and assumes its usual effect. It does not check bytecode.

A 1.5.0 `*AndProxy` pool counts as its base type. Its liquidity stays in its previous pool, so `TG-LIQ` and `TG-BACKING` read that pool.

A custom pool that the registry does not point to yet needs a `pool.address` anchor. The planner then registers and links it like a pool that it deployed.

### 8.10 Complete example

The addresses below are placeholders. The parser rejects them.

```yaml
version: 1
strict: false
rateLimitHeadroom: '10%'
owner: { address: '0xSafe…', kind: safe } # external: the Safe signs through artifacts
rateLimits: { capacity: '500000', rate: '50' }
networks:
  ethereum-mainnet: # home: the first member
    token:
      name: Acme Token
      symbol: ACME
      decimals: 9
      maxSupply: '1000000000'
      preMint: { amount: '250000000', to: '0xTreasury…' }
    pool:
      type: lock-release
      rateLimitAdmin: '0xOps…'
      fastFinality: { blockDepth: 10 }
      liquidity: { minimum: '1000000' }
    fastRateLimits: { capacity: '50000', rate: '5' }
  ethereum-mainnet-base-1:
    pool:
      hooks: { thresholdAmount: '100000' }
    ccvs:
      outboundAboveThreshold: ['0xExtraVerifier…']
      inboundAboveThreshold: ['0xExtraVerifier…']
    fees: { transferFeeBps: 5 }
    remotes:
      solana-mainnet:
        rateLimits:
          outbound: { capacity: '100000', rate: '10' }
          inbound: { capacity: '110000', rate: '11' }
  ethereum-mainnet-arbitrum-1:
    remotes:
      solana-mainnet: false # no lane between these two members
  solana-mainnet:
    owner: 'SquadsVault…' # the root EVM owner does not fit Solana
    token: { name: Wrapped Acme } # the other fields come from the home token
    rateLimits: { capacity: '200000', rate: '20' }
    tokenProgram: token-2022
    metadataUri: 'https://acme.example/metadata.json'
    freezeLookupTable: true
  aptos-mainnet:
    managed: false # read and linked, never changed (Section 9.5)
```

### 8.11 Existing token example

```yaml
version: 1
networks:
  ethereum-mainnet:
    token: '0x…' # WXYZ: an existing token
    pool: { type: lock-release }
  ethereum-mainnet-base-1: {}
  solana-mainnet: {}
```

The planner reads the metadata and the registration method from the home token. It deploys new tokens on the other members with the same name, symbol, and decimals (Solana: at most 9). `ccip-cli cct <file> --from <network>:<token>` creates this kind of file from one token address. The import also writes the observed `owner` values, so a later new member gets the same owner.

### 8.12 Shape coverage

A survey of deployed token groups classifies them into shapes. It is not authoritative, but it shows which shapes occur. The spec expresses a shape with two independent axes:

- Mechanism: `pool.type` per member, or at the root.
- Connectivity: `remotes` lists and exclusions per member (Section 9.2).

The default (all burn-mint, mesh) is the most common shape. Each other common shape needs one or two fields.

| Shape                             | Spec                                                                                                                                                                                           | Status                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Burn/mint mesh                    | Defaults only                                                                                                                                                                                  | M3                       |
| Hub-and-spoke                     | Home `pool: { type: lock-release }`. Spokes keep the default. Spoke-to-spoke lanes stay (mesh), as in the surveyed groups.                                                                     | M3                       |
| Hub-and-spoke, star lanes         | The same, plus `remotes: [<home>]` on each spoke. Spoke-to-spoke value then goes through the home.                                                                                             | M3                       |
| Siloed hub-and-spoke              | Home `pool: { type: siloed-lock-release }`. `remotes.<B>.lockbox: dedicated` makes a silo. Other lanes share the catchall. `lockbox: { group: <name> }` shares one silo between several lanes. | M5                       |
| Shared hubs                       | Two or more members with an existing `token` anchor and `pool: { type: lock-release }`. Optional `remotes: [A, B]` on each spoke.                                                              | M3 (lanes), M5 (backing) |
| Lock/release mesh                 | Root `pool: { type: lock-release }` and an existing `token` anchor on each member.                                                                                                             | M3                       |
| Single chain                      | One member. Members can be added later.                                                                                                                                                        | M3                       |
| Separate hubs, split mesh         | `remotes.<B>: false` exclusions between the parts.                                                                                                                                             | M3                       |
| Hybrid hub, chained hubs          | Detected `pool.type: hybrid`. Lane `mechanism` is reserved. The planner manages only the common pool interface.                                                                                | Common interface only    |
| Proxy routing (USDC)              | Detected `pool.type: usdc-proxy`. Usually a `managed: false` member.                                                                                                                           | Verify only              |
| Multi-token pool (MTTP)           | Each member points `pool.address` to the MTTP. Optional `pool.policies`.                                                                                                                       | M7 (Section 9.7)         |
| Several active pools on one chain | Not possible: the registry holds one active pool per token.                                                                                                                                    | Not applicable           |

The planner shows the resolved shape in the plan summary. It uses the classifier rules of the topology survey: lane style comes from the mechanisms of both ends. This lets a reviewer confirm the shape before signing.

## 9. Resolution and discovery

### 9.1 Chain facts per member

| Fact                 | EVM source                                                              | Solana source                       |
| -------------------- | ----------------------------------------------------------------------- | ----------------------------------- |
| Router               | `router` field, else the chain directory                                | Same (router program)               |
| RMN proxy            | `Router.getArmProxy()` (new SDK read)                                   | Router configuration                |
| Token Admin Registry | `getTokenAdminRegistryFor(router)`                                      | Router program accounts             |
| Registry module      | Directory, then `RegistryModuleAdded` logs, then `registryModule` field | Not applicable                      |
| CreateX              | Code at the canonical CreateX address, with a code-hash check           | Not applicable                      |
| Lane support         | `Router.getOnRamp(dest)` is not zero                                    | Destination chain account exists    |
| Pool program         | Not applicable                                                          | Canonical program, or `poolProgram` |

The chain directory has these candidate sources:

1. The CCIP REST API chain endpoint (`GET /chains/{selector}`). `docs-cct-foundry` uses it.
2. The CCIP Directory data of docs.chain.link.
3. A table bundled with the SDK.

The resolver checks directory data on-chain. For example, the router must return an on-ramp for a known lane. The registry must equal `getTokenAdminRegistryFor(router)`. Staging and test routers are not in the API, so the `router` field stays available.

### 9.2 Lane selection

- The planner selects a set of member pairs. By default, the planner selects every pair with CCIP lanes in both directions (a mesh). It skips a pair without a CCIP lane. The report shows it as information.
- A `remotes` list gives the only remotes of a member, for example `remotes: [ethereum-mainnet]`.
- In the `remotes` map, an entry with settings (also `{}`) includes its lane, and `false` excludes it. The key `'*': false` excludes each remote that the map does not name.
- An exclusion on either end removes the pair. A list on one member therefore also limits the members that it does not name, and the members that are added later.
- An explicit inclusion on one end and an exclusion on the other end is an error (`TG-LANE-CONFLICT`). The error names both entries.
- A remote that is not a member, or that is the member itself, is an error.
- An explicitly included pair without a CCIP lane is an error (`TG-LANE-CCIP`).
- The planner removes the links of an excluded pair from both pools. The removal is destructive (Section 8.5).
- A pool link carries transfers in both directions. To stop one direction, pause its rate limits (`0`/`0`, Section 8.6).

Each selected pair gives two pool links: A lists B, and B lists A.

A star needs one list on each spoke: `remotes: [<hubs>]`. A new member without a list then pairs only with the hubs, because each spoke list excludes it.

Example: every pair except Arbitrum–Solana, with one lane setting.

```yaml
networks:
  ethereum-mainnet: {} # no list: pairs with each member that does not exclude it
  ethereum-mainnet-base-1: {}
  ethereum-mainnet-arbitrum-1:
    remotes: { solana-mainnet: false } # every member except Solana
  solana-mainnet:
    remotes: # only these remotes
      '*': false
      ethereum-mainnet: { rateLimits: { capacity: '1000', rate: '1' } }
      ethereum-mainnet-base-1: {}
```

### 9.3 Group discovery without state

1. Start from the anchors: the home token, and any other anchor tokens.
2. Read the registry on that network. Get the administrator, the pending administrator, and the active pool.
3. Read the pool remotes. Each remote gives a selector, a remote token, and remote pools. On a multi-token pool, read the lanes of the token through the PCM (Section 9.7).
4. Follow each remote token to its network. Go to step 2.
5. Membership follows `remoteToken` links in both directions, not remote pools. A pool upgrade then does not split the group. This follows the CCIP-14259 proposal.
6. For a spec member that discovery does not reach, compute the predicted addresses (Section 9.4). Read the code at those addresses.
7. A reached network that is not in the spec is an extra member (Section 8.5).
8. Optional: read the CCIP API `TokenGroup` as a hint. On-chain reads stay the authority.

A prediction finds a deploy that is not linked yet. An anchor finds a fallback deploy.

### 9.4 Deterministic addresses

Group key:

- The group key is `keccak256("ccip-token-group/v1", symbol, salt ?? "")`. `symbol` is the home token symbol: from its `token` object before the deploy, and from the chain after it. The spec has no group name field.
- The symbol is required. The chain keeps it fixed after the deploy, so the key is stable.
- Each address also includes the deployer. The key therefore only separates groups of one deployer.
- A second group with the same symbol and the same deployer needs `salt`, for example a testnet redeploy.
- The file name does not change the key. A renamed or copied file finds the same contracts. TM and TMEM have no file.
- The deployer is the resolved `owner` when it is external, else the signer (Section 11.7).

EVM, through CreateX:

- CreateX salt: bytes 0–19 are the deployer, byte 20 is `0x00`, and bytes 21–31 come from `keccak256(groupKey, resource)`. The salt has no network.
- The deploy uses CREATE3. The address depends only on the deployer and the salt, not on the init code. So a contract has the same address on each EVM chain, also when constructor arguments such as the router differ.
- Same addresses let a connection policy of a multi-token pool serve the token (Section 9.7). The deployer must have the same address on each chain: an EOA, or a Safe that is deployed at the same address.
- The resource string includes the type and the version, for example `pool:burn-mint:2.0.0`. A new pool type or version therefore gets a new address.
- The CreateX salt is permissioned. Only the deployer can use it, so a third party cannot take the address.
- A contract with `Ownable2Step` gets CreateX as its first owner. The deploy uses `deployCreate3AndInit` with `transferOwnership(deployer)`. The deployer then calls `acceptOwnership`. The spike uses this pattern. A Safe deployer puts the deploy and the accept in one atomic batch.
- Without CreateX, the address can differ per chain. A Safe deploys through the Safe `CreateCall` library with CREATE2, so the address stays predictable on that chain. An EOA uses a direct deploy and an anchor write-back.
- A spec edit that changes the init code does not change a CREATE3 address. A deployed contract that differs from the spec fails `TG-TOKEN` or `TG-POOL`.

Solana:

- Mint: `createWithSeed(deployer, seed, tokenProgram)`. The seed is the first 32 hex characters of the group key. Each symbol then fits the 32-byte seed limit.
- An existing mint needs no seed. It is the `token` anchor.
- Pool config, pool signer, and chain configs: PDAs from the mint and the pool program.
- Mint multisig: the SDK derives its seed from the mint.
- Lookup table: its address depends on a recent slot (one of the last 512 slots). A multisig proposal therefore cannot create it (Section 11.7). Before `setPool`, the planner finds the table by its entries: a search on the mint and pool config entries. This also finds a frozen table.

Canton: the `instanceId` of the Canton member names the pool instance.

### 9.5 Unmanaged members

- `managed: false` marks a member that the planner never deploys or changes. Use it for a family without an adapter (for example Aptos, Sui, or TON), or for a pool that another team runs.
- The planner reads the member through the core SDK. Aptos and Sui pools are readable. A family without pool reads (TON today) needs `token` and `pool.address` anchors.
- The member takes part in lane selection like any member. The planner configures only the managed end of each lane.
- A missing link on the unmanaged end fails `TG-LANE` and names the member. The run waits for it (exit code 2), because only the owner of that member can fix it.
- `setPool` on a managed member does not wait for unmanaged ends. The report shows each one-way lane.
- Strict mode never removes a lane to an unmanaged member. Only an explicit exclusion removes it.

### 9.6 Lifecycle

- `drain: true` stops transfers into a member and keeps transfers out of it. The planner pauses the inbound buckets of the member and the outbound buckets toward it on each remote. Holders can then leave. The status board shows the supply that remains on the member.
- `false` disconnects a member. `TG-DRAIN` fails while the member holds minted supply or locked tokens. `--allow-destructive` overrides it, and the plan shows the amount that stays on the member.
- Before a destructive operation, the planner checks for messages in flight on each affected lane, through the CCIP API. The run waits (exit code 2) until no message is in flight.
- Destructive operations are: lane removal, remote pool removal, remote token change, `setPool` to zero, old-pool removal, and the removal of a token from an MTTP.
- Pool replacement (M5) adds the new pool as a remote pool on each remote, then calls `setPool`, then moves the liquidity or authorizes the new pool on the same lockbox. The old remote pools stay until the in-flight check passes.
- Until its liquidity moves, an old pool is a pot. `TG-OLD-POT` warns, and `TG-BACKING` counts it.
- An exported group with a cross-chain dependency names the groups that must execute first. Review mode refuses a group whose dependencies are not on-chain.
- A pool can link a chain that has no SDK network name, for example a retired chain. The key `selector:<decimal>: false` in `networks` removes these links.
- The planner never unpauses. It reads the pause flags of pools that have them (multi-token pools), and the report names each pause that blocks a lane. Only an unpauser can remove a pause. The run waits (exit code 2) until then.
- On a multi-token pool, `drain` sets an inline rate limit stop (capacity 0, rate 0) in both finality classes. A stop is config, so it needs no pauser and no unpauser. The outbound stops on the remote members come first. The inbound stop on the drained member waits until no message is in flight toward it. When `drain` is removed, the planner writes the resolved limits of the spec again, or removes the inline record when `pool.policies.rateLimit` is set.

### 9.7 Multi-token pools

- A multi-token pool (MTTP) serves many tokens. Its config manager (PCM) holds the config of each token. The planner detects an MTTP through `typeAndVersion` or ERC-165 (`IMultiTokenPool`). It finds the PCM through `getPoolConfigManager()`.
- A token group file never deploys, configures, or hands off an MTTP, its PCM, its stores, or its hooks. They also serve other tokens. A member uses an MTTP through a `pool.address` anchor or through the registry.
- The planner registers the token with `applyTokenConfigUpdates`. The profile holds the decimals, the flavor from `pool.type`, the burn address or lockbox, the finality from `pool.fastFinality`, and `pool.identityProvider`. Each write replaces the whole profile and all five policy names, so the planner copies the observed value of each omitted field. Then it writes the records of each lane. A record holds every value of its type, as the PCM requires.
- Record types: connection (the token address of the remote member), chain (remote pools, `fees.destGasOverhead`, `fees.destBytesOverhead`, and the source-token flags), rate limit (`rateLimits`, `fastRateLimits`), fee (the other `fees` fields), and security (`ccvs` and `pool.hooks.address`).
- A transfer reverts when a record that it reads is missing. So on an MTTP member, a `null` setting writes an empty record: a disabled fee, disabled limits, empty CCV lists, and no hook. `fees: null` disables only the fee record. The chain record stays, with `destGasOverhead` (default 90000) and `destBytesOverhead` (default 192). A chain record with a `destGasOverhead` of 0 or a `destBytesOverhead` below 192 reverts with `InvalidDestOverheads`.
- `pool.policies` names an MTTP policy for a record type. For that type, the planner assigns the token to the policy. The spec cannot also set values of that type. So no token record can silently detach the token from its policy. The connection and chain types have exceptions on single lanes. The planner derives them from the chain facts, and the plan lists each one.
- Connection exception: on each lane where the policy gives a remote token that is not the token address of the remote member, the planner writes an inline connection record on both ends. Examples: another address on one chain, and each lane to a non-EVM member. The token config and these records go in one batch.
- Chain exception: each lane whose remote pool is not an MTTP gets an inline chain record. Examples: a lane to Solana and a lane to a legacy pool. Such a lane accepts pool data without the source token, so a shared chain policy record would trust its remote pools for every token of the policy.
- A connection policy without a remote token address provider serves only a remote token at the same address (Section 9.4). A policy with a provider can serve other addresses. No event shows a change of the provider answer, so `TG-LANE` reads the remote token of each lane through `getLaneConnectionBatch` on each run.
- The source-token flags follow the active pool in the remote registry. `omitSourceTokenAddressOnSend` goes off only after the remote registry points the remote token to an MTTP, because a legacy pool rejects pool data with the source token. `allowSourceTokenAddressMissingOnReceive` goes off only after no message from a legacy pool is in flight on the lane. A move from a legacy pool to an MTTP (M5) follows the pool migration workflow of the MTTP design. Each chain record needs a `destBytesOverhead` of at least 192, also when the lane omits the source token. With `pool.identityProvider`, the planner adds the length of the metadata that the provider gives.
- A lane with a disabled fee record uses the FeeQuoter config of the token, and so does each 1.6 lane. A lane that sends the source token then needs a FeeQuoter byte limit of at least 192 bytes plus the metadata. Only Chainlink can set it, so `TG-GAS` makes the run wait (exit code 2).
- Threshold CCVs and `hooks.thresholdAmount` are errors on an MTTP member. A token allowlist needs hooks that serve only this token.
- Reads take the token as an argument. Pool getters without a token revert on an MTTP.
- PCM writes need PCM roles, not the pool owner. A token group file writes only the token config and inline records. These need `TOKEN_MANAGER_ROLE` or `CONFIG_ROLE`. The planner reads `hasRole` for the signer and for the resolved `owner`, and puts each PCM operation in the group of a holder. `TG-MTTP-ROLE` fails when no known actor holds the role. The planner never grants PCM roles.
- After a hand-off, the deployer keeps no PCM role. The last hand-off group of the member has a `renounceRole` by the deployer for each PCM role that it holds. `TG-OWN` reads each PCM role, `defaultAdmin()`, `pendingDefaultAdmin()`, the owners of the MTTP and both stores, and the authorized callers of both stores (`getAllAuthorizedCallers()`). Each holder must be the resolved `owner`, or an account that the file does not control. The planner never changes the default admin, these owners, or these callers. When the deployer holds one of them, `TG-OWN` fails and the run waits (exit code 2).
- Write order on each lane: the chain, rate limit, fee, and security records first, then the connection record. The PCM rejects an inline connection record while the token has no record of another type on that chain. `setPool` comes after the token config, because the registry accepts only a registered token.
- The PCM checks no lane after a policy assignment. `TG-MTTP-RECORDS` checks through `getLaneRecordLevelBatch` that each lane has a record of every type, before a write opens the lane and after a policy changes.
- A connection policy record with `onlySubsetTokens` off opens its chain for every token of the policy. So a token can get a lane to a chain that is not a selected remote. `TG-MTTP-LANES` fails in both strict modes for each such lane. The plan sets an inline rate limit stop on the lane, in both directions and both finality classes, and the stopped lane passes. The lanes of a token come from `getTokenConfigBatch().supportedChains`. To close the lane, change the policy or its subset tokens (open question 13).
- A rate limit policy has fixed decimals. `pool.policies.rateLimit` needs a policy with the decimals of the token.
- A subset token add needs a connection policy role. The planner adds a subset token only when a known actor holds that role. Otherwise the run waits (exit code 2).
- Member removal has three calls, in this order. First, `applyTokenConfigUpdates` sets all five policy names of the token to zero. Second, the `apply<Type>ConfigUpdates` calls remove the inline records. Third, a second `applyTokenConfigUpdates` call deregisters the token. In another order, an inline connection removal can revert with `PolicyRemoteTokenMismatch`. A token removal is a destructive operation (Section 9.6).
- The PCM write functions can still change. The MTTP adapter selects its ABI by the `typeAndVersion` of the PCM.

## 10. Observation

```ts
type Fact<T> =
  { status: 'known'; value: T } | { status: 'missing' } | { status: 'unknown'; error: string }

interface ObservedMember {
  network: NetworkName
  block: string
  token: Fact<TokenFacts> // address, name, symbol, decimals, owner, ccipAdmin, interface
  registry: Fact<RegistryFacts> // administrator, pendingAdministrator, tokenPool, lookupTable
  pool: Fact<PoolFacts> // type, version, owner, router, rmnProxy, decimals, admins, finality
  roles: Fact<RoleFacts> // isMinter, isBurner, lockbox callers, Solana mint authority
  hooks?: Fact<HooksFacts>
  lockbox?: Fact<LockboxFacts>
  lanes: Record<NetworkName, Fact<LaneFacts>> // remote token, remote pools, limits, fees, CCVs
  ccipLanes: Record<NetworkName, Fact<boolean>> // router support per direction
  supply: Fact<SupplyFacts> // total supply, cap, external mint limits
  probes: Record<NetworkName, Fact<ProbeFacts>> // simulation per lane direction: result, gas, destPoolData size
}
```

Rules:

- The SDK reads each member at one block when the RPC supports block tags.
- A failed read is `unknown`. The planner never treats `unknown` as `missing`.
- A plan with a required `unknown` fact is incomplete. The CLI shows it, but exits 1 and does not apply it. `--allow-unknown` applies the operations that do not depend on unknown facts.
- Simulation runs only on lanes that are complete on-chain. A converged group therefore always gets the simulation checks.

## 11. Planning

### 11.1 Reconcilers

| Resource               | Condition                                                         | SDK operations                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token (EVM)            | Missing                                                           | `deployToken` through CreateX; Safe `CreateCall` or direct deploy as fallback                                                                             |
| Token (Solana)         | Missing                                                           | `deployToken` with a seeded mint and Metaplex metadata                                                                                                    |
| Hooks                  | Desired and missing                                               | `deployAdvancedPoolHooks`, then `updateAdvancedPoolHooksAuthorizedCallers`                                                                                |
| Lockbox                | lock-release 2.0 and missing                                      | `deployLockbox`, then `updateLockboxAuthorizedCallers`                                                                                                    |
| Pool                   | Missing                                                           | `deployTokenPool` (EVM through CreateX, then `acceptPoolOwnership`); Solana `deployTokenPool` with pool signer ATA                                        |
| Mint and burn roles    | Burn pool lacks a role                                            | `grantMintAndBurnRoles` (EVM); `createTokenMultisig` and `setTokenAuthority` (Solana)                                                                     |
| Mint and burn roles    | Burn pool lacks a role, and the token has no known role interface | None. The run waits (exit code 2) and names the missing role. `TG-SIM` shows when the pool can mint and burn.                                             |
| Registry administrator | No administrator                                                  | `registerAdmin`, then `acceptAdmin`                                                                                                                       |
| Registry administrator | Pending administrator is the signer                               | `acceptAdmin`                                                                                                                                             |
| Lookup table (Solana)  | Missing                                                           | `createLookupTable`, then `appendToLookupTable`. External owner: one local transaction that also freezes the table                                        |
| Lookup-table authority | `freezeLookupTable` and the table is not frozen                   | Freeze the table (new SDK operation)                                                                                                                      |
| Lane                   | Remote chain missing on the pool                                  | `applyChainUpdates` with all missing remotes in one call, including standard rate limits                                                                  |
| Remote pools           | Desired remote pool missing                                       | `addRemotePool` (1.5.1+), `setRemotePool` (1.5.0), `appendRemotePoolAddresses` (Solana)                                                                   |
| Remote token           | Different from the desired token                                  | `applyChainUpdates` with remove and add (destructive)                                                                                                     |
| Rate limits            | Different                                                         | `setChainRateLimiterConfigs` (EVM, batched), `setChainRateLimit` (Solana)                                                                                 |
| Drain                  | `drain: true` and a lane into the member is open                  | Pause the buckets: `setChainRateLimiterConfigs` (EVM), `setChainRateLimit` (Solana)                                                                       |
| Fast rate limits       | Different                                                         | `setChainRateLimiterConfigs` with `fastFinality`                                                                                                          |
| Fast finality          | Different                                                         | `setAllowedFinalityConfig`                                                                                                                                |
| Fees                   | Different                                                         | `applyTokenTransferFeeConfigUpdates`                                                                                                                      |
| CCVs                   | Different                                                         | `applyCCVConfigUpdates`                                                                                                                                   |
| Router and admins      | Different                                                         | `setDynamicConfig` (2.0), `setRateLimitAdmin` (1.5 and 1.6)                                                                                               |
| Allowlist              | Different                                                         | `applyAllowlistUpdates` (EVM), `configureAllowlist` and `removeFromAllowlist` (Solana)                                                                    |
| Siloed lockboxes       | Different                                                         | `configureSiloedLockboxes`                                                                                                                                |
| Active pool            | Registry pool is not the pool                                     | `setPool`                                                                                                                                                 |
| Liquidity              | Below `liquidity.minimum` of the pool or of a silo                | `depositToLockbox` or `provideLiquidity` (optional; the plan asks first)                                                                                  |
| Ownership and powers   | A holder is not the resolved actor                                | Section 11.8                                                                                                                                              |
| Member removal         | Member is `false`                                                 | `applyChainUpdates` removals on the other pools; `setPool` to zero on the member if it is reachable (destructive)                                         |
| Token in an MTTP       | Not registered, or a record or policy differs                     | `applyTokenConfigUpdates`, then `apply<Type>ConfigUpdates` per record type, with the connection type last (Section 9.7). A set replaces the whole record. |

### 11.2 Step order

The planner builds a graph. Each operation lists its dependencies. The order below follows the token issuer guide:

1. Deploy hooks and the lockbox, if needed.
2. Deploy the token.
3. Deploy the pool. It depends on the token, the lockbox, and the hooks.
4. Register the administrator. Then accept the administrator role. On Solana, the owner path needs the mint authority as signer, so this step comes before the authority moves.
5. Authorize the pool: mint and burn roles, lockbox callers, hooks callers, or the Solana mint authority.
6. Solana: create and fill the lookup table.
7. Add all desired remote chains in one `applyChainUpdates` call per pool.
8. Apply optional settings: fast limits, finality, fees, CCVs, dynamic config, and allowlist.
9. Call `setPool`. This step depends on steps 4 to 8, and on the lane links of every remote pool to this member.
10. Fund liquidity, if requested.
11. Hand off ownership and the other powers (Section 11.8).

Step 9 has cross-chain dependencies. The artifact records them in `dependsOn`.

On an MTTP member, step 3 becomes the token config, and steps 7 and 8 become PCM record writes in the order of Section 9.7. Step 5 still gives the mint and burn roles to the MTTP.

### 11.3 Encoding paths

| Path      | When                                                                  | How                                                                                             |
| --------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Live      | The target contract exists                                            | Call the SDK `generateUnsigned<Op>`. It checks version, owner, and state on-chain.              |
| Predicted | The plan deploys the target through CreateX or a Solana seed          | Call a pure encoder with the known type, version 2.0.0, and the predicted address.              |
| Deferred  | The plan deploys the target directly (fallback) and cannot predict it | Emit `payload: null` with a `Binding` (`$from`, `output: 'contractAddress'`). Plan again later. |

The predicted path lets one artifact hold a full new group. The deferred path needs one more plan after the deploy confirms.

### 11.4 Projected-state validation

1. The planner applies the effect of each operation to the observation.
2. The planner runs the validity contract (Section 12) on the projected state.
3. If a required check fails, the plan stops. The output gives the check code and a fix.
4. Pairing checks run on the projected state. Simulation checks run on the observed state (Section 10).

Example: an existing token has no `owner()`, no `getCCIPAdmin()`, and no default admin. No account can register it. The plan stops with `TG-REG-MANUAL` and asks for assisted registration.

### 11.5 Artifact mapping

| Artifact field               | Value                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `version`, `artifactType`    | `"1.0"`, `"reviewable-tx-batch"`                                                                                            |
| `meta.name`                  | The home token symbol, for example `ACME`                                                                                   |
| `meta.description`           | Spec hash, observed blocks, and tool versions, as text until the schema has fields for them                                 |
| `accounts[]`                 | One per network and actor. `type` is the account kind (Section 11.7): `eoa`, `safe`, `squads`, or `timelock`.               |
| `groups[]`                   | One per network, account, and dependency wave. `executionMode` is `atomic` for a Safe and `sequential` for an EOA.          |
| `operations[].id`            | Stable: `<network>/<resource>/<operation>[/<remote>]`                                                                       |
| `operations[].summary`       | Authored text, for example "Add lane to solana-devnet on pool 0xab…; inbound 1,100 ACME; outbound 1,000 ACME"               |
| `operations[].source`        | `operation`: SDK operation name. `operationVersion`: SDK version. `inputs`: the operation parameters (big numbers as text). |
| `operations[].payload`       | EVM `{to, value, data}`; Solana instruction; `null` for the deferred path                                                   |
| `operations[].dependsOn`     | Graph edges from Section 11.2, across chains when needed                                                                    |
| `operations[].callerAccount` | The account that must call                                                                                                  |

Example (shortened):

```json
{
  "version": "1.0",
  "artifactType": "reviewable-tx-batch",
  "meta": { "name": "ACME", "createdBy": "ccip-cli 1.17.0 / ccip-sdk 1.17.0" },
  "accounts": [
    {
      "id": "sepolia:0x5c1f…",
      "chainFamily": "evm",
      "chainId": "11155111",
      "address": "0x5c1f…",
      "type": "eoa"
    }
  ],
  "groups": [
    {
      "id": "sepolia:0x5c1f…:1",
      "label": "ethereum-testnet-sepolia: deploy and register",
      "executionMode": "sequential",
      "account": "sepolia:0x5c1f…",
      "operations": [
        {
          "id": "ethereum-testnet-sepolia/pool/applyChainUpdates",
          "summary": "Add lanes to base-sepolia and arbitrum-sepolia; rate limits disabled",
          "dependsOn": ["ethereum-testnet-sepolia/pool/deployTokenPool"],
          "chainFamily": "evm",
          "source": {
            "operation": "applyChainUpdates",
            "operationVersion": "1.17.0",
            "inputs": { "poolAddress": "0x7e…", "chainsToAdd": [] }
          },
          "payload": { "chainFamily": "evm", "to": "0x7e…", "value": "0", "data": "0x…" }
        }
      ]
    }
  ]
}
```

### 11.6 Staleness and idempotency

- Each plan starts from fresh reads. A rerun after an interruption resumes from the chain state.
- An artifact input (`ccip-cli cct plan.json`) runs each operation again and compares payloads. Any difference marks the operation as stale. The CLI then refuses it (DAPP-11608 Req 6.2).
- A later Safe nonce does not make a plan stale.
- After convergence, the plan has no operations, and the CLI exits with code 0.

### 11.7 Accounts and signing

- Each operation has a required actor: owner, registry administrator, rate-limit administrator, fee administrator, or mint authority.
- The planner reads the actor from the projected state. For a new resource, the actor is the resolved `owner`.
- Signer rule: the CLI signs an operation locally only when its actor is the local signer. Every other operation goes to the group of its actor, and the CLI exports that group.
- `owner` therefore selects the mode:

| `owner` in the file             | Deployer of new resources | Local signatures                                                          | Artifacts                                 |
| ------------------------------- | ------------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| Omitted, or equal to the signer | The signer                | All operations                                                            | Only remote pools that other accounts own |
| Another account                 | The owner                 | Only one-step changes and transfers of powers that the signer still holds | All other operations                      |

- An external owner needs no wallet. For a new group with an external owner, the run gives artifacts only and exits with code 2.
- One exception exists. A Solana lookup table needs a recent slot, so a proposal cannot create it. A local Solana key pays for the table, fills it, and freezes it in one transaction. The key gets no power. Without a local Solana key, the plan defers the Solana `setPool` and names the missing key.
- The account kind selects the export format. Default: Safe on EVM, Squads on Solana. `kind: timelock` gives timelock proposals, in the MCMS format for pools that MCMS owns. `kind: eoa` gives unsigned transactions for a key on another machine. Review mode on that machine sends them.
- The planner warns when it cannot confirm the kind on a member chain, for example when no Safe code exists at the owner address. A Safe batch cannot execute on that chain until the Safe exists.
- This rule also covers remote pools that other teams own. Their lane links appear as exportable groups. The status board shows the one-way lanes until those owners act.

### 11.8 Ownership and hand-off

Two patterns are common. Each needs one field.

Owner from the start: `owner: 0xSafe…` is in the file before the first deploy. The Safe deploys and configures the group through artifacts. The plan has no hand-off. The CLI needs no wallet, except a Solana key that pays for the lookup table (Section 11.7).

Hand-off: an EOA (for example a Ledger) deploys and configures the group. Then a multisig takes over:

| Step     | File                                                                      | Plan                                                                                                                          | Exit |
| -------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---- |
| Run 1    | No `owner`                                                                | The signer deploys and configures. The signer holds all powers.                                                               | 0    |
| Edit     | `owner: 0xSafe…` at the root. `owner: SquadsVault…` on the Solana member. |                                                                                                                               |      |
| Run 2    | Same file                                                                 | The signer group makes the one-step changes, then sends the transfers. The Safe and Squads groups hold the accept operations. | 2    |
| Multisig |                                                                           | The Safe and Squads signers execute the exported batches.                                                                     |      |
| Run 3    | Same file                                                                 | Nothing to do. `TG-OWN` passes: the deployer holds no power.                                                                  | 0    |

Rules:

- The signer default applies only to new resources. An omitted actor never moves an existing power, in both strict modes. A run with another key therefore never takes the powers back.
- The planner compares each power holder with its resolved actor on every plan: at session open, after each file change, and in CI. A changed `owner` gives the hand-off operations at once.
- When the resolved `owner` is not the deployer (`deployers.<family>`), an omitted power that the deployer holds resolves to its built-in default. This applies also with `strict: false`. The default is none, or `owner` when the contract needs a holder.
- One-step changes come first, because they need the current holder.
- The two-step transfers come last, in the group of the current holder.
- The accept operations go in the group of the new holder. They depend on the transfers.
- A token with a default-admin delay gets an accept operation with a "not before" time. The plan shows the time.
- The same rules move powers from one multisig to another. The transfers then go in an exported group of the old multisig.
- Keep `owner` in the file after the hand-off. The owner then deploys each new member through artifacts. Lane links on pools that the owner holds also go to its artifacts.

The observed holder of each power selects the plan, on each run:

| On-chain holder                              | `owner` in the file    | Plan                                                                                                     |
| -------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| None: new resource                           | Omitted, or the signer | The signer deploys and signs locally.                                                                    |
| None: new resource                           | External               | The owner deploys and signs through artifacts. The local signer is not used.                             |
| The signer                                   | External               | Hand-off. The signer sends the one-step changes and the transfers. The owner accepts through artifacts.  |
| The signer; pending holder is the owner      | External               | Accept operations only, through artifacts. Exit 2 until they execute.                                    |
| The owner                                    | Any                    | Changes go to the owner: local when the owner is the signer, else artifacts.                             |
| A third account, for example an old multisig | External               | That account transfers through artifacts. The owner accepts. A transfer replaces a wrong pending holder. |

Powers:

| Power                                  | Spec field                                                          | EVM                                                                                                                                                                   | Solana                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Pool owner                             | `owner`                                                             | `transferPoolOwnership`, then `acceptPoolOwnership`                                                                                                                   | Same                                                                                                                        |
| Token owner or default admin           | `tokenOwner` (default `owner`)                                      | `transferTokenOwnership`, then `acceptTokenOwnership`; or `beginDefaultAdminTransfer`, then `acceptDefaultAdminTransfer`                                              | Not applicable                                                                                                              |
| CCIP admin, burn-mint role admin       | `ccipAdmin`, `burnMintRoleAdmin` (EVM; default `owner`)             | `setCCIPAdmin`; grant the role admin to the new holder, then revoke it from the deployer (one step)                                                                   | Not applicable                                                                                                              |
| Registry administrator                 | `registryAdmin` (default `owner`)                                   | `transferAdmin`, then `acceptAdmin`                                                                                                                                   | Same                                                                                                                        |
| Hooks and lockbox owners               | `owner`                                                             | Two-step transfer, then accept                                                                                                                                        | Not applicable                                                                                                              |
| Rate-limit, fee, and rebalancer admins | `pool.rateLimitAdmin`, `pool.feeAdmin`, `pool.liquidity.rebalancer` | `setDynamicConfig` (2.0), `setRateLimitAdmin` (1.5 and 1.6), `setRebalancer` (one step)                                                                               | `setRateLimitAdmin`, `setRebalancer` (one step)                                                                             |
| Mint authority                         | `mintAuthority`                                                     | No change: the pool holds the roles                                                                                                                                   | `createTokenMultisig` with the pool signer and the new owner, then `setTokenAuthority`. SPL multisig signers cannot change. |
| Metadata update authority              | `owner`                                                             | Not applicable                                                                                                                                                        | `updateMetadataAuthority` (one step)                                                                                        |
| Lookup-table authority                 | `freezeLookupTable`                                                 | Not applicable                                                                                                                                                        | It cannot move. A warning shows while the deployer holds it. `freezeLookupTable: true` freezes the table.                   |
| Upgrade rights                         | `owner`                                                             | EIP-1967 proxy admin, or its `ProxyAdmin` owner, and the UUPS upgrade role. The planner moves them only when the deployer holds them.                                 | Upgrade authority of a self-deployed pool program. The planner moves it only when the deployer holds it.                    |
| Other token roles                      | None (read only)                                                    | AccessControl holders. When the token cannot list them, the planner reads `RoleGranted` and `RoleRevoked` logs. `TG-OWN` reports each holder.                         | Token-2022 authorities: permanent delegate, transfer fee, close, and freeze. `TG-OWN` reports each holder.                  |
| PCM roles                              | None (read only)                                                    | The deployer renounces each PCM role that it holds (`renounceRole`). The default admin, the MTTP and store owners, and the store callers are read only (Section 9.7). | Not applicable                                                                                                              |

## 12. Validity contract

`checkTokenGroup` is pure. The planner runs it on the projected state of each plan. When the plan is empty, the projected state equals the observed state. A clean run is therefore the verification, and the CLI needs no separate verify step. Each check gives `pass`, `fail`, `warn`, or `unknown`. The group is valid only when all required checks pass.

| Code               | Check                                                                                                                                                                                                                                                                                                                 | Scope  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `TG-TOKEN`         | The token exists. Its decimals match the resolved spec. Name and symbol match (warning only).                                                                                                                                                                                                                         | Member |
| `TG-POOL`          | The pool exists and supports the token. Pool decimals equal token decimals. Router and RMN proxy match the chain facts.                                                                                                                                                                                               | Member |
| `TG-REG`           | The registry administrator is the desired actor. No unexpected pending administrator exists. The active pool is the pool.                                                                                                                                                                                             | Member |
| `TG-REG-MANUAL`    | A registration path exists for some account.                                                                                                                                                                                                                                                                          | Member |
| `TG-ROLES`         | Burn pools: the pool is minter and burner. Lock-release 2.0: the pool is a lockbox caller and the lockbox token matches. Solana: the pool signer meets the mint-authority threshold. A token without a known role interface passes through `TG-SIM`.                                                                  | Member |
| `TG-ALT`           | Solana: the lookup table exists, holds the 10 expected entries in order, and is in the registry.                                                                                                                                                                                                                      | Member |
| `TG-T22`           | Solana: the mint has no transfer hook. Other Token-2022 extensions give a warning.                                                                                                                                                                                                                                    | Member |
| `TG-HOOKS`         | The pool is an authorized hooks caller. The allowlist flag matches the spec.                                                                                                                                                                                                                                          | Member |
| `TG-LANE`          | For each selected pair, each pool lists the other member. The remote token is correct. The remote pools include the active remote pool. For each excluded pair, neither pool lists the other, in both strict modes.                                                                                                   | Lane   |
| `TG-LANE-CCIP`     | The router supports the lane in both directions.                                                                                                                                                                                                                                                                      | Lane   |
| `TG-LANE-CONFLICT` | No pair is included explicitly on one end and excluded on the other end. The parser checks it before any read.                                                                                                                                                                                                        | Lane   |
| `TG-DEC`           | Mixed decimals need pools of 1.5.1 or later on both ends. Solana remote decimals equal the remote token decimals.                                                                                                                                                                                                     | Lane   |
| `TG-DEC-RANGE`     | On a member with `u64` amounts (Solana, Aptos, Sui), the maximum supply in base units fits in `u64`. The bound is `maxSupply`, else the home supply.                                                                                                                                                                  | Member |
| `TG-RL`            | Limits equal the desired limits and respect the version bounds.                                                                                                                                                                                                                                                       | Lane   |
| `TG-RL-CAP`        | The inbound capacity on one end is not less than the outbound capacity on the other end. A disabled bucket counts as no limit. Fast buckets too.                                                                                                                                                                      | Lane   |
| `TG-RL-ASYM`       | The inbound rate and margin on one end follow the outbound values on the other end (warning).                                                                                                                                                                                                                         | Lane   |
| `TG-RL-NONE`       | A mainnet lane has limits (warning).                                                                                                                                                                                                                                                                                  | Lane   |
| `TG-RL-IDLE`       | Solana 1.6 pools: the refill product of rate and idle time stays below the `u64` limit. The report gives the date of the overflow (warning).                                                                                                                                                                          | Lane   |
| `TG-FTF`           | Fast-finality config and fast limits match.                                                                                                                                                                                                                                                                           | Lane   |
| `TG-FTF-PAIR`      | If one end allows fast finality toward the other end, the other end accepts it.                                                                                                                                                                                                                                       | Lane   |
| `TG-FEE`           | Fee config matches.                                                                                                                                                                                                                                                                                                   | Lane   |
| `TG-CCV`           | CCV lists match. A threshold list has a base list. No address repeats. The pool is 2.0.                                                                                                                                                                                                                               | Lane   |
| `TG-CCV-PAIR`      | The inbound CCVs on one end are in the outbound CCVs of the other end, or in the lane-mandated CCVs. The two threshold amounts agree after decimal scaling.                                                                                                                                                           | Lane   |
| `TG-SIM`           | For each lane direction that is complete on-chain, a call of `lockOrBurn` on the source pool and of `releaseOrMint` on the destination pool succeeds. A pool that needs an attestation gives `unknown`.                                                                                                               | Lane   |
| `TG-GAS`           | The simulated `releaseOrMint` gas fits the `destGasOverhead` in effect, and the `destPoolData` size fits `destBytesOverhead`. The values come from the 2.0 pool fee config, else the FeeQuoter token config, else the lane default. A value that only Chainlink can change makes the run wait (exit code 2).          | Lane   |
| `TG-OWN`           | Each power holder is its resolved actor (Section 11.8). The deployer holds no power that the spec does not give it. This includes upgrade rights, roles that only logs show, and the PCM roles, owners, and store callers of an MTTP (Section 9.7). A lookup-table authority that the deployer holds gives a warning. | Member |
| `TG-LIQ`           | The lockbox, pool, or silo balance is at least `liquidity.minimum`. On a lock/release lane, the release balance also covers the inbound rate-limit capacity (warning).                                                                                                                                                | Member |
| `TG-BACKING`       | Each pot covers the supply minted on its claimant members. Pots that back the same member are added together. Each silo is judged alone. A deficit that the plan makes or increases fails. An existing deficit gives a warning.                                                                                       | Group  |
| `TG-STRANDED`      | No member sends to a lock-release member that has no lane back.                                                                                                                                                                                                                                                       | Group  |
| `TG-SPLIT`         | The lanes connect all members. A group with more than one connected part gives a warning.                                                                                                                                                                                                                             | Group  |
| `TG-HUBS`          | More than one member locks toward members that mint (shared hubs). The report shows it as information, so a reviewer confirms the shape.                                                                                                                                                                              | Group  |
| `TG-CHAINED`       | No member that mints from a hub also locks toward a member that mints (warning). It applies when lane `mechanism` becomes writable.                                                                                                                                                                                   | Group  |
| `TG-MINT-AUTH`     | No account other than the pool can mint, where the token can list its minters (warning).                                                                                                                                                                                                                              | Member |
| `TG-CAP`           | A member that mints has a supply cap that is not less than the supply that can flow into it. An existing token gives a warning.                                                                                                                                                                                       | Member |
| `TG-MINT-LIMIT`    | External mint limits, for example a minter allowance or XERC20 bridge limits, are not less than the inbound capacity (warning).                                                                                                                                                                                       | Member |
| `TG-DRAIN`         | A member set to `false` holds no minted supply and no locked tokens. `--allow-destructive` overrides it (Section 9.6).                                                                                                                                                                                                | Member |
| `TG-OLD-POT`       | No former pool of the member holds locked tokens (warning).                                                                                                                                                                                                                                                           | Member |
| `TG-PAUSED`        | A token, chain, or global pause blocks a lane (information). The planner never unpauses.                                                                                                                                                                                                                              | Lane   |
| `TG-MTTP-RECORDS`  | MTTP members: each lane has a record of every type (`getLaneRecordLevelBatch`). The rate limit policy has the decimals of the token. Each chain record allows at least 192 bytes plus the token identity metadata. A lane whose remote pool is not an MTTP uses an inline chain record.                               | Lane   |
| `TG-MTTP-ROLE`     | MTTP members: a known actor holds each PCM role that the plan needs.                                                                                                                                                                                                                                                  | Member |
| `TG-MTTP-LANES`    | MTTP members: the token has no open lane to a chain that is not a selected remote (`getTokenConfigBatch().supportedChains`). An inline rate limit stop in both directions closes such a lane. Both strict modes.                                                                                                      | Member |
| `TG-INFLIGHT`      | No message is in flight on a lane that a destructive operation changes. The run waits (exit code 2).                                                                                                                                                                                                                  | Lane   |
| `TG-EXTRA`         | Lanes, remote pools, or members exist that no rule selects or excludes (information; failure in strict mode).                                                                                                                                                                                                         | Group  |

## 13. CLI

### 13.1 One command

```text
ccip-cli cct <file> [options]
```

Rules:

- The command has one entry point. The input decides the mode: a missing file, a spec, or an artifact.
- The command reads the chains as soon as it opens a spec. The status and the plan are always current.
- There is no validate step and no verify step. A clean run ("nothing to do") is the verification. A plan that leads to an invalid state is an error.
- The command sends nothing without consent: a confirmation on a terminal (TTY), or `--apply` without one.
- Each interactive action has a flag. The session and the flags call the same step functions.

### 13.2 Modes

| Input                  | With a TTY (session)                                                                                                                                   | Without a TTY (flags)                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No file argument       | List the `*.cct.yaml` files in the folder. The user selects one, or starts the wizard with a new name.                                                 | Exit 1 with usage help.                                                                                                                                           |
| Missing file           | Confirm the path. Then a wizard asks: create a new token, or import an existing group. The wizard writes the file and opens the session.               | Create from `--symbol`, `--name`, `--home`, and `--network`. Or import with `--from <network>:<token>`. Without these flags, exit 1. Then continue as for a spec. |
| Spec (`.yaml`, `.yml`) | Open the session (Section 13.3).                                                                                                                       | Apply flag edits. Plan. Print status and plan. `--apply` sends. Exit code per Section 13.6.                                                                       |
| Artifact (`.json`)     | Review mode: decode each operation, check it against the chain, and mark stale operations. Offer to send local-signer groups, or to export the others. | Check the artifact. Exit 0 if it is current, 1 if it is stale or invalid. `--apply` sends the local-signer groups.                                                |

Review mode serves a multisig signer on another machine. The signer needs only the artifact and RPC endpoints, not the spec. The CLI runs each `source` (operation and inputs) through the SDK again. It then compares the payloads byte for byte.

The deployer address is necessary for address predictions. The CLI takes it from an external `owner`, from `deployers` in the spec, from `--wallet`, or from `--sender`. In a session, the CLI asks for it when none of these supplies it.

### 13.3 Session

When the session opens a spec, it does these steps:

1. Parse the file. Show schema errors with field paths and line numbers. The session stays open, so the user can correct the file.
2. Resolve and observe all members in parallel. Update one status row per member as its reads complete.
3. Plan, and check the projected state.
4. Show the status board, the plan summary, and the menu.

```text
ACME (Acme Token) · 4 members · mesh · strict: off · shape: burn/mint mesh
  owner  signer 0x5c1f… → Safe 0xSafe… (EVM) · Squads SqVa… (Solana) · accepts waiting
  ethereum-testnet-sepolia             ✔ token  ✔ pool  ✔ registry   lanes 3/3
  ethereum-testnet-sepolia-base-1      ✔ token  ✔ pool  ◐ registry   lanes 2/3   pending admin
  ethereum-testnet-sepolia-arbitrum-1  ○ not deployed
  solana-devnet                        ✔ token  ✔ pool  ✔ registry   lanes 1/3
Plan: 14 operations in 6 groups · 2 groups need Safe 0xSafe… · 2 warnings
? Next
❯ Apply           review each group, then send or export it
  Show plan       operations, decoded arguments, and field diffs
  Edit            add or remove a network, remotes, rate limits, owner, pool type, open in $EDITOR
  Export          artifact JSON and Safe or Squads files for waiting groups
  Refresh         read the chains again
  Quit
```

Session rules:

- Each edit writes the file at once and keeps comments. The session then plans again.
- The Edit menu can make a star: the user selects the hubs, and the session writes `remotes: [<hubs>]` on each other member.
- The session watches the file. A save from an editor causes a new parse and a new plan.
- Before each write, the session reads the file again and checks its hash. An external change is never lost.
- The session loads wallets only when the first local send for a family occurs. With an external `owner`, Apply exports, and the session needs no wallet.
- A destructive operation needs a typed confirmation: the user types the network name.
- After each group, the session reads the chains again. A converged group shows "Nothing to do" and the validity result.
- When the session closes, the exit code tells the final state (Section 13.6).

### 13.4 Flags

| Flag                                              | Effect                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--apply`                                         | Run the apply loop (Section 13.7). With a TTY, start it at once.                                                 |
| `--yes`                                           | Skip the confirmation for each group. Destructive operations still need `--allow-destructive`.                   |
| `--out <plan.json>`                               | Write the artifact.                                                                                              |
| `--export-dir <dir>`                              | Folder for Safe and Squads files. Default: the spec file name without extensions, for example `./acme.exports/`. |
| `--set <path>=<yaml>`, `--unset <path>`           | Edit the spec before the plan. Repeatable.                                                                       |
| `--add-network <net>`, `--remove-network <net>`   | Add a member, or set a member to `false`. Repeatable.                                                            |
| `--symbol`, `--name`, `--home`, `--network <net>` | Create the spec when the file is missing.                                                                        |
| `--from <network>:<token>`                        | Import an existing group when the file is missing.                                                               |
| `--full`                                          | With `--from`: write all observed values as explicit fields.                                                     |
| `--wallet <family>=<spec>`                        | Signer per family, for example `evm=ledger` or `solana=~/.config/solana/id.json`. Repeatable.                    |
| `--sender <family>=<address>`                     | Signer address without a wallet (prepare only). Not necessary with an external `owner`.                          |
| `--allow-destructive`                             | Permit destructive operations, also the removal of a member with supply (`TG-DRAIN`).                            |
| `--allow-unknown`                                 | Plan and apply when some facts are unknown. Operations that depend on them stay out of the plan.                 |
| `--offline`                                       | Parse and check the schema only. No RPC. For CI lint and pre-commit hooks.                                       |
| `--no-write`                                      | Do not write edits or anchors. Print them.                                                                       |
| `--watch`                                         | Plan again on each file change. Without a TTY, print each new status.                                            |
| `--format pretty \| json \| log`                  | Output format (global option).                                                                                   |

A `--wallet` value without a family prefix applies to each family that can parse it.

### 13.5 Workflows

On a terminal, `ccip-cli cct acme.cct.yaml` does all of the steps below through the menu. The flag forms are for scripts, CI, and agents.

```sh
# Create and deploy a new group
ccip-cli cct acme.cct.yaml --symbol ACME --name "Acme Token" \
  --home ethereum-testnet-sepolia \
  --network ethereum-testnet-sepolia-base-1 --network solana-devnet \
  --wallet evm=$EVM_KEY --wallet solana=~/.config/solana/id.json --apply

# Create a group that a Safe and a Squads vault own from the start. No EVM wallet: the run exports artifacts.
# The Solana key only pays for the lookup table. Exit 2 until the multisigs execute.
ccip-cli cct acme.cct.yaml --symbol ACME --name "Acme Token" --home ethereum-mainnet \
  --network ethereum-mainnet-base-1 --network solana-mainnet \
  --set owner=0xSafe… --set networks.solana-mainnet.owner=SqVa… \
  --wallet solana=~/.config/solana/id.json --out acme.plan.json --export-dir safe/

# Check for drift in CI (read only). Exit 0, 1, 2, or 3.
ccip-cli cct acme.cct.yaml --format json

# Add a network and apply. Each existing pool gets one lane link.
ccip-cli cct acme.cct.yaml --add-network ethereum-testnet-sepolia-arbitrum-1 \
  --wallet evm=$EVM_KEY --apply

# Set limits on one member
ccip-cli cct acme.cct.yaml --set 'networks.solana-devnet.rateLimits={capacity: "1000", rate: "1"}'

# Hand off to a Safe and a Squads vault. The signer sends the transfers.
# safe/ gets one Safe batch per EVM chain and one Squads file. Exit 2 until they execute.
ccip-cli cct acme.cct.yaml --set owner=0xSafe… --set networks.solana-devnet.owner=SqVa… \
  --wallet evm=$EVM_KEY --wallet solana=~/.config/solana/id.json --apply --export-dir safe/

# Prepare for a Ledger on another machine, then review and send there
ccip-cli cct acme.cct.yaml --sender evm=0xLedger… --out acme.plan.json
ccip-cli cct acme.plan.json --wallet evm=ledger

# Disconnect a member
ccip-cli cct acme.cct.yaml --remove-network ethereum-testnet-sepolia-arbitrum-1 \
  --wallet evm=$EVM_KEY --apply --allow-destructive

# Adopt an existing group
ccip-cli cct wxyz.cct.yaml --from ethereum-mainnet:0x…
```

### 13.6 Exit codes and output

| Code | Meaning                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Converged: nothing to do, and the validity contract passes. Warnings can exist.                                                                                      |
| 1    | Error: parse error, invalid projected state, unknown facts, stale artifact, or failed transaction.                                                                   |
| 2    | Waiting: only groups for external accounts, links on unmanaged members, requests to Chainlink, messages in flight, or an unpause remain. The CLI exports the groups. |
| 3    | Pending: operations exist, and the run did not apply them.                                                                                                           |

- `--format pretty` (default) prints the status board and a diff per changed field.
- `--format json` prints one envelope. It holds the status per member, the resolved spec, the report, the plan summary, the artifact path, the exported files, and the anchors. The anchors name every address that the run created (DAPP-11608 Req 8.2).

### 13.7 Apply loop

```text
repeat
  plan ← planTokenGroup(spec)                       # fresh reads; no saved progress
  if plan has no operations: show the validity result; exit 0
  ready ← groups whose dependencies are on-chain
  for each group in ready:
    if its account is a local signer: confirm; send operations in order; wait for confirmations; write anchors
    else: export the group; record it as waiting
  if no group ran: show the waiting exports; exit 2
```

Before each send, the CLI shows the chain, account, target, operation, and summary.

### 13.8 Fit with constraints

| Constraint                                     | How the single command meets it                                                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI, scripts, and agents                        | Each action has a flag. The CLI never prompts without a TTY (existing `--no-interactive` rule). Exit codes and JSON are stable.                       |
| Prepare and broadcast modes (DAPP-11608 Req 2) | A run without `--apply` prepares. `--apply` broadcasts.                                                                                               |
| Byte-identical payloads (Req 3)                | `--apply` sends the payloads of the current plan. Review mode compares payloads byte for byte.                                                        |
| Artifact contents (Req 4)                      | Chain, account, operation, arguments, and tool versions are in the artifact.                                                                          |
| Offline validation, stale refusal (Req 6)      | An artifact input opens review mode. It needs only the artifact and RPC endpoints. A stale artifact gives exit 1.                                     |
| `check` and `roles` (Req 7)                    | The status board and the JSON report give both, with the fix as a planned operation.                                                                  |
| Workflows (Req 10)                             | `enable-token`, `add-lane`, and `hand-over` are edits, then `--apply`. A rerun resumes from the chain state.                                          |
| No state                                       | The session keeps state only in memory. The file and the chains stay the source of truth.                                                             |
| Safety                                         | No send without consent. Destructive operations need a typed confirmation or `--allow-destructive`.                                                   |
| File-name typos                                | A missing file needs a confirmation, or explicit create or import flags.                                                                              |
| Large groups                                   | Reads run in parallel. The board shows each member as it completes. A member without an RPC shows `unknown`.                                          |
| Schema lint without RPC                        | `--offline`.                                                                                                                                          |
| Imperative commands of DAPP-11608              | They stay named subcommands, for example `ccip-cli cct set-pool`. yargs matches a subcommand name first. A spec with such a name needs a `./` prefix. |

Pushback that this design keeps:

- An interactive-only command would break CI, agents, and the multisig signer flow. The flags stay, with the same semantics as the session.
- Review of an artifact is a separate job. A signer can have the artifact and no spec. The artifact input mode covers it.
- A clean run proves only what the chain shows now. It cannot prove that a transfer completes. `ccip-cli send` stays the end-to-end test.

## 14. SDK API

```ts
// Pure
export function parseTokenGroupSpec(input: unknown): TokenGroupSpec // throws CCTSpecInvalidError with field paths
export function tokenGroupJsonSchema(): object
export function checkTokenGroup(resolved: ResolvedTokenGroup, state: GroupState): ValidityReport

// Chain access
export async function resolveTokenGroup(
  spec: TokenGroupSpec,
  ctx: GroupContext,
): Promise<ResolvedTokenGroup>
export async function observeTokenGroup(
  resolved: ResolvedTokenGroup,
  ctx: GroupContext,
): Promise<ObservedTokenGroup>
export async function discoverTokenGroup(
  anchor: { network: string; token: string },
  ctx: GroupContext,
): Promise<TokenGroupSpec>
export async function planTokenGroup(
  spec: TokenGroupSpec,
  ctx: GroupContext,
  opts?: PlanOptions,
): Promise<TokenGroupPlan>
export async function verifyTokenGroup(
  spec: TokenGroupSpec,
  ctx: GroupContext,
): Promise<ValidityReport>

interface GroupContext {
  getChain(network: string): Promise<Chain>
  directory?: ChainDirectory
  signers?: Partial<Record<Family, string>>
  logger?: Logger
}

interface PlanOptions {
  allowDestructive?: boolean
  allowUnknown?: boolean
}

interface TokenGroupPlan {
  artifact: Artifact // reviewable-tx-batch v1.0
  resolved: ResolvedTokenGroup // the full materialized desired state
  report: ValidityReport // checks on the projected state
  anchors: AnchorUpdate[] // values that the caller can write back
  observedAt: Record<string, { block: string }>
}
```

## 15. Required work

SDK:

1. Merge the CreateX deploy and the Safe batch writer from the DAPP-11565 spike. Use CREATE3 deploys.
2. Export pure encoders for each planned operation on known 2.0.0 contracts.
3. Add reads: router RMN proxy, lane support (EVM on-ramp, Solana destination account), registry modules, EVM pending owner (storage slot or `OwnershipTransferRequested` logs), hooks and lockbox owners on the facade, Solana remote token decimals, and Solana lookup tables by authority.
4. Add token interface detection (ERC-165 and selector scan).
5. Add account kind detection (Safe, timelock, Squads).
6. Add a chain directory client to `CCIPAPIClient`.
7. Solana: add fast-finality writes and single remote-pool removal. Handle the first rate-limit set on 1.6 pools.
8. Canton: add registry, ownership, and rate-limiter writes.
9. Add one amount parser for whole tokens to base units. The CLI and the SDK both use it.
10. Hand-off support (Section 11.8): reads of Solana mint multisig signers, metadata update authority, and lookup-table authority; a lookup-table freeze operation; a move of the EVM burn-mint role admin; and two-step transfer and accept for hooks and lockbox owners, where the SDK lacks them.
11. Detect the `hybrid`, `usdc-proxy`, and `custom` pool types, and the lane mechanism of hybrid pools. Read silo balances and silo rebalancers.
12. Add a common-interface path for pools with an unknown type or version. Read through the common functions, and write only where the function exists.
13. Add lane simulation for the planner. Reuse `simulateLockOrBurn` and `simulateReleaseOrMint`, add gas estimates and the `destPoolData` size, and read the FeeQuoter `getTokenTransferFeeConfig`.
14. Add reads: total supply and supply cap, minter allowances and XERC20 limits, the EIP-1967 admin and `ProxyAdmin` owner, AccessControl holders from logs, the Solana program upgrade authority, and Token-2022 extensions.
15. Add an in-flight message check per lane through the CCIP API.
16. Confirm the unit of the inbound bucket for each pool version, and add tests.
17. Add an MTTP adapter: detection, token-aware reads through the pool and the PCM batch views, the long pool data format in transfer checks, and PCM token config and record writes. Several core SDK reads assume one token per pool: `getTokenPoolConfig`, `getTokenPoolRemotes`, `getTokenForTokenPool`, the fee estimate, and the pool data decoder.

Artifact schema (`reviewable-artifacts`, proposals for v1.1):

1. A Solana operation with many instructions and lookup tables.
2. An EVM contract creation, or a rule that deploys go through a factory.
3. Plan origin fields in `meta`: spec hash, observed blocks, and tool versions.
4. A shared package for the schema, so the SDK does not copy the types.

CLI:

1. A YAML document writer that keeps comments. Publish the JSON Schema.
2. `--wallet` with family prefixes.
3. Safe Transaction Builder and Squads exporters.
4. The session: status board, menu, create-or-import wizard, file watch, and artifact review mode.
5. Register `cct [file]` with named subcommands. A test with yargs 18.2.0 confirmed this: `cct acme.cct.yaml` runs the file mode, `cct set-pool` runs the subcommand, `cct ./set-pool` runs the file mode, and `.strict()` still rejects unknown flags.

## 16. Delivery plan

| Milestone | Scope                                                                                                                                                                                                                         | Acceptance                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| M1        | Spec types, parser, inheritance, defaults, JSON Schema. `ccip-cli cct <file>`: create wizard and flags, edit flags, `--offline`.                                                                                              | Round trip keeps comments. Inheritance tests pass for all levels.                                                           |
| M2        | EVM resolve, discovery, observation, and validity contract, with pairing and simulation checks. Import (`--from`), status board, exit codes, JSON envelope.                                                                   | The board gives correct results for known testnet groups. Discovery matches CCIP API membership.                            |
| M3        | EVM planner for 2.0.0 deploys: CreateX and fallback, registration, lanes, rate limits, admins, ownership, drain, and the in-flight check. Session menu and apply loop, `--apply`, `--out`, artifact review mode, Safe export. | A new 3-member group converges on forks. The second run exits 0. An interrupted apply resumes. Safe files import unchanged. |
| M4        | Solana adapter and Squads export.                                                                                                                                                                                             | An EVM and Solana group converges on devnet.                                                                                |
| M5        | 2.0 settings (hooks, CCVs, fees, fast finality, siloed lockboxes). Reconcile existing 1.5 and 1.6 pools. Pool replacement with a reviewed old-pool removal.                                                                   | Golden tests per pool version. Replacement keeps old remote pools until removal is explicit.                                |
| M6        | Canton observation and verification. TMEM integration of discovery and planning.                                                                                                                                              | TMEM imports a plan artifact without changes.                                                                               |
| M7        | MTTP members (Section 9.7): detection, PCM records, and policy references. A portfolio spec for MTTP infrastructure and policies. Plans over many token group files.                                                          | A token joins an MTTP with policy references and converges. A plan of many files gives one batch per chain and account.     |

## 17. Test plan

- Unit tests: parser, inheritance, defaults, amount scaling, and bound checks per version.
- Golden tests: fixed observations in, artifact JSON out, for each reconciler.
- Fork tests (`*.fork.test.ts`): two EVM forks with CreateX. Run with `--apply`, then run again and expect exit code 0.
- Parity tests: a scripted session (mocked prompts) and the equivalent flags give the same file and the same artifact.
- Solana tests: a local validator or surfpool. Note that surfpool does not enforce Solana v1 transaction limits.
- Conformance test: validate SDK artifacts with the `reviewable-artifacts` zod schema.
- Owner-from-start fork test: a Safe owns the group from the first run. The run loads no EVM wallet and exports Safe batches. Execute them on the fork. The next run gives exit 0.
- Hand-off fork test: an EOA deploys. Then set `owner` to a Safe, apply, and execute the Safe batch. The next run gives exit 0, and the deployer holds no power.
- Failure tests: wrong remote pool, missing role, wrong decimals, stale plan, unknown facts, and an actor without authority.
- Pairing tests: CCV sets, fast finality, capacities, decimals, and supply caps across the two ends of a lane.
- Simulation tests: a token that keeps its roles outside the token passes `TG-SIM`. A pool that needs more gas than the overhead in effect fails `TG-GAS`.
- Lifecycle tests: drain, then removal. A removal with supply fails `TG-DRAIN`. A destructive operation waits for in-flight messages.

## 18. Risks

| Risk                                                                                            | Mitigation                                                                                                                                               |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CreateX is absent or differs on a chain                                                         | Check the CreateX code hash. Use the direct-deploy fallback with anchors.                                                                                |
| A spec edit changes a deployed contract                                                         | A CREATE3 address does not change. A contract that differs from the spec fails `TG-TOKEN` or `TG-POOL`.                                                  |
| Two groups of one deployer have the same symbol                                                 | The planner adopts a contract at the predicted address only when it matches the spec. Set `salt` on the second group.                                    |
| RPC log-range limits slow discovery                                                             | Use the directory first. Read logs in bounded ranges.                                                                                                    |
| A mesh costs N² lane links                                                                      | Use `remotes` lists (for example a star) and exclusions. Show operation counts per chain in the plan.                                                    |
| Large Safe batches are hard to review                                                           | One group per chain and account. Authored summaries. `--max-batch` splits groups.                                                                        |
| Other teams own remote pools                                                                    | Export their groups. The status board shows one-way lanes.                                                                                               |
| The owner Safe does not exist on a member chain                                                 | The planner warns. Deploy the Safe on that chain before execution, at the same address where possible.                                                   |
| One command with many modes becomes complex                                                     | The session is a thin UI over the same step functions as the flags. Parity tests compare both paths.                                                     |
| The artifact schema lives in another repo                                                       | Conformance tests. Move the schema to a shared package.                                                                                                  |
| "Group" names collide with other designs                                                        | Use "token group" only in the CCIP API meaning. Section 19 asks for a final name.                                                                        |
| New SDK code is not audited                                                                     | Add `cct/group` to the SDK and CLI audit scope (DAPP-11609).                                                                                             |
| Simulation needs state overrides on the RPC                                                     | Without them, the `lockOrBurn` simulation gives `unknown`. The `releaseOrMint` simulation needs no override.                                             |
| A Solana multisig mint authority can increase heap use on the offramp (reported, not confirmed) | `TG-SIM` covers Solana lanes where it can. `mintAuthority: pool-signer` stays available.                                                                 |
| A custom pool function does more than its usual effect                                          | The planner trusts `typeAndVersion` and the common interface (Section 6). `TG-SIM` checks that transfers execute.                                        |
| A remote token address provider gives a wrong answer                                            | `TG-LANE` reads the resolved remote token on each run. `TG-SIM` sends and receives through the provider. A wrong remote token loses the funds of a send. |
| A connection policy opens a lane to a chain where the token does not exist                      | `TG-MTTP-LANES` fails, and the plan stops the lane with an inline rate limit stop.                                                                       |

## 19. Open questions

1. Mainnet rate limits. Option A: keep `null` as default and warn. Option B: require an explicit `rateLimits` value (`null` allowed) on mainnet members. Recommendation: B. The contracts team agreed that "unlimited" must be explicit.
2. Spec validation library. Option A: zod v4 (`zod/mini`). Option B: hand-written checks, as in `cct/*/validate.ts`. Recommendation: A. TMEM uses zod v4, and `z.toJSONSchema` gives the JSON Schema.
3. Artifact schema home and v1.1 fields (Section 15, artifact schema items 1 to 4). This needs agreement with the dApp team.
4. Chain directory source and trust (Section 9.1). Recommendation: the CCIP REST API, with on-chain checks and a `router` override.
5. Solana default mint authority. Recommendation: a multisig of the pool signer and the owner, threshold 1. A hand-off replaces the multisig (Section 11.8).
6. Pool replacement scope, and the in-flight message check before old-pool removal.
7. Final name of the concept and the file (`*.cct.yaml`). "Token group" matches the CCIP API, but the multi-token-pool design also uses "group".
8. Product ownership. No PRD covers declarative workflows yet. This document can seed one.
9. Hybrid pools and per-lane mechanisms. Recommendation: keep lane `mechanism` reserved and verify-only until the SDK supports the 2.0 siloed pool with burn-mint handler lanes.
10. Shape classifier. Option A: reuse the rules of the survey classifier in the SDK. Option B: show only lane styles. Recommendation: A, so plan summaries and the survey reports use the same names.
11. Solana lookup table with an external owner. Option A: a local key creates, fills, and freezes the table; the key gets no power. Option B: a local key creates the table with the vault as authority; the vault fills it through a proposal. Option B depends on the relaxed authority check of the lookup-table program. Recommendation: A.
12. Custom pool settings, for example fast-transfer fillers. Option A: getter and setter pairs with an expected value in the spec. Option B: keep them out of the spec; `TG-SIM` still checks the transfers. Decide after M5, with real custom pools.
13. Multi-token pool portfolios. Option A: a second file kind holds the MTTPs, PCMs, stores, hooks, PCM roles, and policy records of an issuer, and token group files name its policies. Option B: one file holds many tokens. Recommendation: A, plus one CLI run over many token group files that merges the batches per chain and account. The MTTP interfaces are final. Token group files find their PCM actor through role detection (Section 9.7). The portfolio file holds the policy records, the subset tokens, and the PCM roles.

## Appendix A. Knob catalog

| Knob                | Spec path                   | EVM 1.5 and 1.6                                  | EVM 2.0                                           | Solana                                                       | Canton                       |
| ------------------- | --------------------------- | ------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------ | ---------------------------- |
| Token deploy        | `networks.X.token`          | Read only                                        | `deployToken` (`CrossChainToken`)                 | `deployToken` (SPL or Token-2022, Metaplex)                  | Not supported                |
| Max supply          | `token.maxSupply`           | Read only                                        | Constructor                                       | Not enforced                                                 | Not supported                |
| Pre-mint            | `token.preMint`             | Not applicable                                   | Constructor                                       | `deployToken`                                                | Not supported                |
| CCIP admin          | `ccipAdmin`                 | `setCCIPAdmin`                                   | `setCCIPAdmin`                                    | Not applicable                                               | Not applicable               |
| Mint and burn roles | Derived                     | `grantMintAndBurnRoles`                          | `grantMintAndBurnRoles`                           | `createTokenMultisig`, `setTokenAuthority`                   | Not applicable               |
| Registration        | `registration`              | `registerAdmin`                                  | `registerAdmin`                                   | `registerAdmin`                                              | At pool deploy               |
| Registry admin      | `registryAdmin`             | `transferAdmin`, `acceptAdmin`                   | Same                                              | Same                                                         | Not supported                |
| Active pool         | Derived                     | `setPool`                                        | `setPool`                                         | `setPool` with lookup table                                  | At pool deploy               |
| Pool deploy         | `pool.type`, `pool.version` | Not supported                                    | `deployTokenPool`                                 | `deployTokenPool` (canonical programs)                       | `deployTokenPool` with lanes |
| Router              | `router`                    | Not in the SDK                                   | `setDynamicConfig`                                | Not applicable                                               | Deploy dependency            |
| RMN proxy           | Discovered                  | Immutable                                        | Immutable                                         | Router configuration                                         | Deploy dependency            |
| Lanes               | `remotes`                   | `applyChainUpdates`                              | `applyChainUpdates`                               | `applyChainUpdates`, edit and delete remote config           | `applyChainUpdates`          |
| Remote pools        | Discovered                  | `setRemotePool` (1.5.0), add and remove (1.5.1+) | `addRemotePool`, `removeRemotePool`               | `appendRemotePoolAddresses`                                  | At lane addition             |
| Rate limits         | `rateLimits`                | `setChainRateLimiterConfigs`                     | `setChainRateLimiterConfigs`                      | `setChainRateLimit`                                          | At deploy only               |
| Fast rate limits    | `fastRateLimits`            | Not applicable                                   | `setChainRateLimiterConfigs` with `fastFinality`  | Read only                                                    | At deploy only               |
| Rate-limit admin    | `pool.rateLimitAdmin`       | `setRateLimitAdmin`                              | `setDynamicConfig`                                | `setRateLimitAdmin`                                          | Deploy parameter             |
| Fee admin           | `pool.feeAdmin`             | Not applicable                                   | `setDynamicConfig`                                | Not applicable                                               | Not applicable               |
| Fast finality       | `pool.fastFinality`         | Not applicable                                   | `setAllowedFinalityConfig`                        | Not supported                                                | At lane addition             |
| Transfer fees       | `fees`                      | Request to Chainlink                             | `applyTokenTransferFeeConfigUpdates`              | Not supported                                                | Not supported                |
| Allowlist           | `pool.allowlist`            | `applyAllowlistUpdates`                          | Through hooks; enable flag fixed at hooks deploy  | `configureAllowlist`, `removeFromAllowlist`                  | Not supported                |
| Hooks               | `pool.hooks`                | Not applicable                                   | Deploy, update, policy engine, threshold, callers | Not supported                                                | Not supported                |
| CCVs                | `ccvs`                      | Not applicable                                   | `applyCCVConfigUpdates`                           | Not supported                                                | At lane addition             |
| Lockbox             | `pool.lockbox`              | Liquidity is in the pool                         | `deployLockbox`, `updateLockboxAuthorizedCallers` | Not applicable                                               | Not applicable               |
| Siloed lockboxes    | `remotes.X.lockbox`         | `updateSiloDesignations` (1.6)                   | `configureSiloedLockboxes`                        | Not applicable                                               | Not applicable               |
| Liquidity           | `pool.liquidity`            | `provideLiquidity`, `setRebalancer`              | `depositToLockbox`                                | `provideLiquidity`, `setRebalancer`, `setCanAcceptLiquidity` | Not supported                |
| Pool owner          | `owner`                     | `transferPoolOwnership`, `acceptPoolOwnership`   | Same                                              | Same                                                         | Not supported                |
| Token owner         | `tokenOwner` (Section 11.8) | `transferTokenOwnership`, default admin transfer | Same                                              | `setTokenAuthority`, `updateMetadataAuthority`               | Not applicable               |
| Drain               | `drain`                     | `setChainRateLimiterConfigs` (pause)             | Same                                              | `setChainRateLimit` (pause)                                  | Not supported                |

## Appendix B. Sources

- [Token issuer guide](https://docs.chain.link/ccip/concepts/cross-chain-token/token-issuer-guide)
- [Rate limits (v2)](https://docs.chain.link/ccip/evm/concepts/cross-chain-token/rate-limits/overview)
- [Advanced pool hooks](https://docs.chain.link/ccip/concepts/cross-chain-token/advanced-pool-hooks)
- [FTF for token issuers](https://docs.chain.link/ccip/concepts/execution-latency/ftf-token-issuers)
- [SVM integration guide](https://docs.chain.link/ccip/v1/svm/concepts/cross-chain-token/integration-guide)
- [TokenPoolFactory 2.0.0](https://docs.chain.link/ccip/evm/api-reference/v2.0.0/token-pool-factory)
- [CCIP API TokenGroup](https://docs.chain.link/ccip/tools/api/schemas/tokengroup)
- [CLD token changesets](https://github.com/smartcontractkit/chainlink-ccip/tree/main/deployment/tokens)
- [docs-cct-foundry config schema](https://github.com/smartcontractkit/docs-cct-foundry/blob/main/docs/config-schema.md)
- [CCIP 2.0 invariants](https://github.com/smartcontractkit/chainlink-ccip/tree/main/chains/evm/contracts/invariants)
