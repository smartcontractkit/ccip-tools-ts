# Cross-chain token (CCT) proof of concept: deploy and transfer across EVM, Solana, and Aptos

> Audience: a developer deploying a cross-chain token (CCT) with `ccip-cli` across EVM, Solana, and
> Aptos testnets. Assumes you can run a shell, fund testnet wallets, and read a block explorer; does
> not assume prior CCIP contract knowledge.

> Owner: ccip-tools-ts maintainers. Last reviewed: 2026-06-26. Applies to: `ccip-cli` and
> `@chainlink/ccip-sdk` 1.7.1, CCT v2.0 on EVM, testnets Sepolia / Base Sepolia / Solana Devnet /
> Aptos Testnet.

This guide deploys cross-chain tokens and pools with `ccip-cli`, wires a 3-chain mesh (EVM, Solana,
Aptos), and sends cross-chain transfers across it. The commands are taken from real testnet runs on
Sepolia, Solana Devnet, and Aptos Testnet.

> EVM deploys now produce the canonical CCT v2.0 contracts: `CrossChainToken 2.0.0`,
> `BurnMintTokenPool 2.0.0`, `LockReleaseTokenPool 2.0.0` (which auto-deploys an `ERC20LockBox 2.0.0`),
> and the combined `CrossChainPoolToken 2.0.0`, a single contract that is both token and pool, via
> `ccip-cli pool deploy-combined`. The legacy `BurnMintERC20` / `FactoryBurnMintERC20` and v1.6.1
> pools are no longer deployed. EVM CLI changes: `token deploy` drops `--token-type` and adds
> `--ccip-admin`, `--burn-mint-role-admin`, and `--pre-mint-recipient`; `pool deploy` drops
> `--allowlist` and adds `--advanced-pool-hooks` and `--lock-box`. Verified live on Sepolia v2-staging.

Token and pool stack used in this guide:

| Chain           | Token type            | Pool type                                                                                  | Decimals |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------ | -------- |
| EVM (Sepolia)   | CrossChainToken 2.0.0 | BurnMintTokenPool / LockReleaseTokenPool 2.0.0 (lock-release auto-deploys an ERC20LockBox) | 18       |
| Solana (Devnet) | Token-2022 (SPL)      | BurnMint                                                                                   | 9        |
| Aptos (Testnet) | Managed Token         | Managed Token Pool                                                                         | 8        |

> EVM deploy alternatives. The separate token-then-pool path below is the default. On EVM you can also
> deploy a single `CrossChainPoolToken 2.0.0` that is both token and pool with
> `ccip-cli pool deploy-combined`, or deploy token + pool (or a pool for an existing token) through a
> `TokenPoolFactory 2.0.0` with `ccip-cli pool deploy-via-factory` (CREATE2). Every EVM deploy command
> takes `--verify` to verify the contracts it created on the source-chain explorer. See
> [Verify the EVM contracts on Etherscan](#5-verify-the-evm-contracts-on-etherscan).

> Prerequisite: run all commands from the `ccip-cli/` directory.

---

## Table of contents

1. [Prerequisites and wallet setup](#1-prerequisites-and-wallet-setup)
2. [Phase 1: deploy tokens](#2-phase-1-deploy-tokens)
3. [Phase 2: mint tokens](#3-phase-2-mint-tokens)
4. [Phase 3: deploy pools](#4-phase-3-deploy-pools)
5. [Verify the EVM contracts on Etherscan](#5-verify-the-evm-contracts-on-etherscan)
6. [Phase 4: register as token admin](#6-phase-4-register-as-token-admin)
7. [Phase 5: grant mint/burn access to the pool](#7-phase-5-grant-mintburn-access-to-the-pool)
8. [Phase 6: create the token ALT (Solana only)](#8-phase-6-create-the-token-alt-solana-only)
9. [Phase 7: apply chain updates (mesh configuration)](#9-phase-7-apply-chain-updates-mesh-configuration)
10. [Phase 8: set the pool in the TokenAdminRegistry](#10-phase-8-set-the-pool-in-the-tokenadminregistry)
11. [Phase 9: cross-chain transfers](#11-phase-9-cross-chain-transfers)
12. [Manage EVM CCT v2 pools: liquidity and config](#12-manage-evm-cct-v2-pools-liquidity-and-config)
13. [Additional operations](#13-additional-operations)
14. [Known issues and gotchas](#14-known-issues-and-gotchas)

---

## 1. Prerequisites and wallet setup

### Tools required

- Node.js 20+
- `spl-token` CLI, for Solana token minting
- `cast` (from [Foundry](https://book.getfoundry.sh/)), for EVM direct contract calls (minting)
- `aptos` CLI, for Aptos token minting and (optionally) contract deployment

### Build the project

Clone the repo and build both the SDK and CLI before running any commands:

```bash
git clone <repo-url> && cd ccip-tools-ts

# Install dependencies
npm install

# Build SDK + CLI (must be done from the repo root)
npm run build
```

After building, the CLI is available at `ccip-cli/dist/index.js`. Run every command in this guide from
the `ccip-cli/` directory:

```bash
cd ccip-cli
node dist/index.js --help
```

### Accounts and funding

You need accounts on all 3 chains with enough native tokens to cover transaction fees:

| Chain           | Account                                            | How to fund                                          | Estimated cost |
| --------------- | -------------------------------------------------- | ---------------------------------------------------- | -------------- |
| EVM (Sepolia)   | Generate with any Ethereum wallet (MetaMask, etc.) | [Sepolia faucet](https://faucets.chain.link/sepolia) | ~0.1 ETH       |
| Solana (Devnet) | `solana-keygen new -o ~/.config/solana/id.json`    | `solana airdrop 5 --url devnet`                      | ~5 SOL         |
| Aptos (Testnet) | Derive from same private key (Ed25519)             | [Aptos faucet](https://aptos.dev/en/network/faucet)  | ~2 APT         |

> The same 32-byte hex private key works for both EVM and Aptos; they derive different addresses from
> it. Solana needs a separate keypair file (`~/.config/solana/id.json`).

### `.env` file setup

Create a `.env` file in the `ccip-cli/` directory with your RPC endpoints and private key. The CLI
reads it by default (`--rpcs-file ./.env`):

```bash
# RPC endpoints (one per chain)
RPC_ETHEREUM_SEPOLIA=https://1rpc.io/sepolia
RPC_SOLANA_DEVNET=https://api.devnet.solana.com
RPC_APTOS_TESTNET=https://fullnode.testnet.aptoslabs.com/v1

# EVM/Aptos private key (32-byte hex, no 0x prefix)
# Used automatically when --wallet is omitted for EVM/Aptos commands
PRIVATE_KEY=<your-hex-private-key>

# Optional: Etherscan V2 multichain API key, for contract verification
# Used by --verify on EVM deploy commands and by `ccip-cli verify`
ETHERSCAN_API_KEY=<your-etherscan-api-key>
```

### Wallet configuration

| Chain  | How to pass wallet                                | Wallet location            | Notes                                                                                                              |
| ------ | ------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| EVM    | `-w <hex-private-key>` or `PRIVATE_KEY` in `.env` | `.env` file                | 32-byte hex, auto-loaded from `.env` if `--wallet` omitted                                                         |
| Solana | `-w ~/.config/solana/id.json`                     | `~/.config/solana/id.json` | JSON keypair file (64-byte array). Always pass `-w` explicitly; `PRIVATE_KEY` from `.env` does not work for Solana |
| Aptos  | `-w <hex-private-key>` or `PRIVATE_KEY` in `.env` | `.env` file                | Same 32-byte hex as EVM (Ed25519 seed), derives a different address                                                |

### CCIP contract addresses (testnet)

Fetch from `https://docs.chain.link/api/ccip/v1/chains?environment=testnet`.

| Chain           | Router                                                               | Registry module (EVM)                        |
| --------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| EVM (Sepolia)   | `0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59`                         | `0xa3c796d480638d7476792230da1E2ADa86e031b0` |
| Solana (Devnet) | `Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C`                       | —                                            |
| Aptos (Testnet) | `0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45` | —                                            |

Solana pool program IDs:

- BurnMint: `41FGToCmdaWa1dgZLKFAjvmx6e6AjVTX7SVRibvsMGVB`
- LockRelease: `8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC`

Aptos MCMS address: `0xbdf1b9aacb4e21bf6f255105831df0172e911d4748e488196fde10d2e2a4e32d`

---

## 2. Phase 1: deploy tokens

Deploy a token on each chain. All chains use the same token name and symbol for consistency.

### EVM (Sepolia) — CrossChainToken 2.0.0, 18 decimals

`token deploy` on an EVM network deploys a canonical CrossChainToken 2.0.0 (no `--token-type`).
CrossChainToken uses OpenZeppelin AccessControl roles (`MINTER_ROLE` / `BURNER_ROLE`). The deployer
becomes owner, CCIP admin, and burn-mint-role admin by default, but is not a minter unless you
pre-mint or grant the role explicitly (see Phase 2).

EVM-only flags (verified against `token/deploy.ts`):

| Flag                               | Meaning                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `--max-supply`                     | Cap in whole units (omit for unlimited)                                         |
| `--initial-supply`                 | Pre-mint amount in whole units (minted in the constructor)                      |
| `--pre-mint-recipient`             | Who receives the pre-mint (defaults to owner)                                   |
| `--ccip-admin`                     | Address returned by `getCCIPAdmin()` (defaults to owner/signer)                 |
| `--burn-mint-role-admin`           | Address allowed to grant/revoke `MINTER_ROLE`/`BURNER_ROLE` (defaults to owner) |
| `--owner`                          | Owner for 2-step admin (defaults to signer)                                     |
| `--verify` / `--etherscan-api-key` | Verify the deployed token on the explorer                                       |

```bash
ccip-cli token deploy \
  -n ethereum-testnet-sepolia \
  --name "CCT Test Token" \
  --symbol CCTEST \
  --decimals 18 \
  --initial-supply 1000000 \
  -f json
```

Output: `tokenAddress` and `txHash`.

To verify the contract on Etherscan in the same step, add `--verify` (needs `ETHERSCAN_API_KEY` in the
env or `--etherscan-api-key`):

```bash
ccip-cli token deploy \
  -n ethereum-testnet-sepolia \
  --name "CCT Test Token" \
  --symbol CCTEST \
  --decimals 18 \
  --initial-supply 1000000 \
  --verify \
  -f json
```

Verification is covered in full in
[Verify the EVM contracts on Etherscan](#5-verify-the-evm-contracts-on-etherscan), including the
standalone `ccip-cli verify` command for contracts you already deployed.

#### EVM alternative A — combined token + pool (`pool deploy-combined`)

Deploys a single CrossChainPoolToken 2.0.0, one contract that is both the ERC20 token and its own CCIP
token pool, so you skip the separate Phase 3 pool deploy. Flags from `pool/deploy-combined.ts`:
`--name` / `--symbol` / `--decimals` / `--router-address` (required), plus optional `--max-supply`,
`--initial-supply` (pre-mint), `--advanced-pool-hooks`, `--ccip-admin`, `--pre-mint-recipient`, and
`--verify` / `--etherscan-api-key`.

```bash
ccip-cli pool deploy-combined \
  -n ethereum-testnet-sepolia \
  --name "CCT Test Token" \
  --symbol CCTEST \
  --decimals 18 \
  --router-address 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  --initial-supply 1000000 \
  -f json
```

Output: `address` (the contract; both `tokenAddress` and `poolAddress` equal it) and `txHash`.

#### EVM alternative B — deploy via TokenPoolFactory (`pool deploy-via-factory`)

Deploys token + pool (or just a pool for an existing token via `--token-address`) through a
TokenPoolFactory 2.0.0 using CREATE2, for either `--pool-type burn-mint` or `--pool-type lock-release`
(lock-release auto-deploys an ERC20LockBox 2.0.0, returned as `lockBoxAddress`). Flags from
`pool/deploy-via-factory.ts`: `--factory` and `--pool-type` (required), plus `--decimals` (default
18), `--token-address` (existing-token mode), `--name` / `--symbol` / `--max-supply` / `--pre-mint` /
`--pre-mint-recipient` (new-token mode, smallest units), `--lock-box`, `--salt`, `--future-owner`, and
`--verify` / `--etherscan-api-key`. With `--verify`, every contract the factory created (token, pool,
and the auto-deployed lockbox) is verified.

Testnet factory addresses (live-verified 2026-06-26):

| Chain            | TokenPoolFactory 2.0.0                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Ethereum Sepolia | [`0x93c57146d11a6Ca73fc53e5902aCB6900E553858`](https://sepolia.etherscan.io/address/0x93c57146d11a6Ca73fc53e5902aCB6900E553858#code) |
| Base Sepolia     | [`0x90e449aE080F480B1FaDA508E7B85FD85D0c1E1F`](https://sepolia.basescan.org/address/0x90e449aE080F480B1FaDA508E7B85FD85D0c1E1F#code) |

```bash
# New token + burn-mint pool, both verified
ccip-cli pool deploy-via-factory \
  -n ethereum-testnet-sepolia \
  --factory 0x93c57146d11a6Ca73fc53e5902aCB6900E553858 \
  --pool-type burn-mint \
  --name "CCT Test Token" \
  --symbol CCTEST \
  --decimals 18 \
  --verify \
  -f json
```

Output: `tokenAddress`, `poolAddress`, `txHash` (and `lockBoxAddress` for lock-release).

### Solana (Devnet) — Token-2022, 9 decimals

Token-2022 (SPL Token Extensions) with Metaplex metadata:

```bash
ccip-cli token deploy \
  -n solana-devnet \
  --wallet ~/.config/solana/id.json \
  --name "CCT Test Token" \
  --symbol CCTEST \
  --decimals 9 \
  --token-program token-2022 \
  --metadata-uri "https://cyan-pleasant-anteater-613.mypinata.cloud/ipfs/bafkreieirlwjqbtzniqsgcjebzexlcspcmvd4woh3ajvf2p4fuivkenw6i" \
  --initial-supply 1000000 \
  -f json
```

Output: `tokenAddress`, `txHash`, `metadataAddress`.

### Aptos (Testnet) — Managed Token, 8 decimals

> Warning: the Aptos `token deploy` command will likely be removed from the SDK. It requires the Aptos
> CLI installed locally to compile Move contracts, which makes it impractical to bundle in the SDK.
> Recommendation: deploy Aptos tokens directly from the
> [`chainlink-aptos`](https://github.com/smartcontractkit/chainlink-aptos) repo using
> `aptos move deploy-object`. See the [Aptos CLI docs](https://aptos.dev/tools/aptos-cli/) for
> installation.

Managed tokens use allowlist-based access control. The deployer is the owner and can add or remove
minters and burners.

```bash
ccip-cli token deploy \
  -n aptos-testnet \
  -w <hex-private-key> \
  --name "CCT Test Token" \
  --symbol CCTEST \
  --decimals 8 \
  --initial-supply 1000000 \
  -f json
```

Output: `tokenAddress`, `txHash`, `codeObjectAddress`.

### Record your addresses

Save the token addresses from each chain. You need them throughout the remaining steps.

```bash
EVM_TOKEN=0x...
SOLANA_TOKEN=<base58>
APTOS_TOKEN=0x...
# Also save the Aptos code object address for minting later
APTOS_CODE_OBJECT=0x...
```

---

## 3. Phase 2: mint tokens

Mint tokens to your wallet for transfer testing.

### EVM (Sepolia) — CrossChainToken

CrossChainToken uses OpenZeppelin AccessControl roles, not dedicated `grantMintRole`/`mint` helpers.
The simplest path is to pre-mint at deploy time via `--initial-supply` (Phase 1): the constructor
mints to `--pre-mint-recipient` (default: owner) without needing any role. If you did that, your
wallet already holds the tokens and you can skip the rest of this step.

To mint more later, the caller must hold `MINTER_ROLE`. The deployer (owner / burn-mint-role admin)
can grant it. The convenient way is the CLI, which grants both roles at once and auto-detects the v2
token (no `--token-type`):

```bash
# Grant MINTER_ROLE + BURNER_ROLE to your wallet (or to the pool — see Phase 5)
ccip-cli token grant-mint-burn-access \
  -n ethereum-testnet-sepolia \
  --token-address $EVM_TOKEN \
  --authority <YOUR_EVM_ADDRESS> \
  -f json
```

Then mint with `cast`:

```bash
# Mint 1,000,000 tokens (1000000 * 10^18)
cast send $EVM_TOKEN \
  "mint(address,uint256)" \
  <YOUR_EVM_ADDRESS> \
  1000000000000000000000000 \
  --private-key <PRIVATE_KEY> \
  --rpc-url https://1rpc.io/sepolia
```

> For raw `cast`, the role grant is `grantRole(MINTER_ROLE, addr)` where
> `MINTER_ROLE = keccak256("MINTER_ROLE")`. The CLI's `grant-mint-burn-access` (or the token's
> `grantMintAndBurnRoles(addr)` convenience setter) is simpler.

### Solana (Devnet) — Token-2022

The deployer is the mint authority. No extra permission needed:

```bash
spl-token mint $SOLANA_TOKEN 1000000 --url devnet
```

### Aptos (Testnet)

Uses the code object address from the token deploy output:

```bash
aptos move run \
  --function-id "$APTOS_CODE_OBJECT::managed_token::mint" \
  --args "address:<YOUR_APTOS_ADDRESS>" "u64:100000000000000" \
  --url https://fullnode.testnet.aptoslabs.com/v1 \
  --private-key <PRIVATE_KEY> \
  --assume-yes
```

> The `u64` amount is in raw units (1,000,000 tokens \* 10^8 decimals = 100000000000000).

---

## 4. Phase 3: deploy pools

Deploy a burn-mint token pool on each chain.

### EVM (Sepolia) — burn-mint pool

Deploys a BurnMintTokenPool 2.0.0. `pool deploy` no longer takes `--allowlist`; the EVM-only options
are `--advanced-pool-hooks` (optional, defaults to the zero address) and `--lock-box` (lock-release
only: supply an existing `ERC20LockBox`, otherwise one is auto-deployed). Add `--verify` (with
`ETHERSCAN_API_KEY` / `--etherscan-api-key`) to verify the pool, and the auto-deployed lockbox for
lock-release, on the explorer.

```bash
ccip-cli pool deploy \
  -n ethereum-testnet-sepolia \
  --pool-type burn-mint \
  --token-address $EVM_TOKEN \
  --local-token-decimals 18 \
  --router-address 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  -f json
```

> Lock-release. With `--pool-type lock-release`, the signed deploy deploys a LockReleaseTokenPool
> 2.0.0 and auto-deploys an ERC20LockBox 2.0.0, returning both `poolAddress` and `lockBoxAddress` in
> the output. Pass `--lock-box <addr>` to reuse an existing lockbox instead. Lock-release pools need
> liquidity before they can release on the destination; see
> [Manage EVM CCT v2 pools: liquidity and config](#12-manage-evm-cct-v2-pools-liquidity-and-config).

### Solana (Devnet) — burn-mint pool

```bash
ccip-cli pool deploy \
  -n solana-devnet \
  --wallet ~/.config/solana/id.json \
  --pool-type burn-mint \
  --token-address $SOLANA_TOKEN \
  --local-token-decimals 9 \
  --pool-program-id 41FGToCmdaWa1dgZLKFAjvmx6e6AjVTX7SVRibvsMGVB \
  -f json
```

### Aptos (Testnet) — managed token pool

> Warning: the Aptos `pool deploy` command will likely be removed from the SDK. It requires the Aptos
> CLI installed locally to compile Move contracts, which makes it impractical to bundle in the SDK.
> Recommendation: deploy Aptos pools directly from the
> [`chainlink-aptos`](https://github.com/smartcontractkit/chainlink-aptos) repo using
> `aptos move deploy-object`. See the [Aptos CLI docs](https://aptos.dev/tools/aptos-cli/) for
> installation.

```bash
ccip-cli pool deploy \
  -n aptos-testnet \
  -w <hex-private-key> \
  --pool-type burn-mint \
  --token-address $APTOS_TOKEN \
  --local-token-decimals 8 \
  --router-address 0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45 \
  --mcms-address 0xbdf1b9aacb4e21bf6f255105831df0172e911d4748e488196fde10d2e2a4e32d \
  -f json
```

The Aptos pool deploy runs as two internal steps: publish the CCIPTokenPool shared dependency, then
publish the managed_token_pool module. The SDK handles both automatically.

### Record pool addresses

```bash
EVM_POOL=0x...
SOLANA_POOL=<base58>
APTOS_POOL=0x...
```

---

## 5. Verify the EVM contracts on Etherscan

This section is EVM-only and optional. Skip ahead to [Phase 4](#6-phase-4-register-as-token-admin) if
you are not on EVM, or come back here later.

Every CCT v2 contract you deploy on EVM can be verified on the source-chain explorer, including
contracts the `TokenPoolFactory` created with CREATE2. Verification uses the Etherscan V2 multichain
API. Provide the key with `ETHERSCAN_API_KEY` in the environment, or `--etherscan-api-key` on the
command. There are two paths: the `--verify` flag on a deploy command, and the standalone
`ccip-cli verify` command for a contract you already deployed.

### Verify at deploy time with `--verify`

Add `--verify` to any EVM deploy command and it verifies what it just deployed:

- `ccip-cli token deploy --verify` verifies the `CrossChainToken`.
- `ccip-cli pool deploy --verify` verifies the pool, and the auto-deployed `ERC20LockBox` for
  lock-release.
- `ccip-cli pool deploy-combined --verify` verifies the `CrossChainPoolToken`.
- `ccip-cli pool deploy-via-factory --verify` verifies every contract the factory created (token,
  pool, and the auto-deployed lockbox). The factory contracts are born in internal CREATE2 calls, so
  the constructor args are carried through from the deploy rather than recovered later.

### Verify an existing contract with `ccip-cli verify`

`ccip-cli verify` verifies a contract you already deployed. Given just `--contract` and `--address`,
it derives the constructor args from the contract's on-chain creation code (stripping the known SDK
bytecode), including factory CREATE2 deploys via transaction tracing. `--contract` accepts
`CrossChainToken`, `BurnMintTokenPool`, `LockReleaseTokenPool`, `CrossChainPoolToken`, `ERC20LockBox`,
or `AdvancedPoolHooks`.

```bash
# Constructor args auto-derived from on-chain creation code
ccip-cli verify \
  -n ethereum-testnet-sepolia \
  --contract CrossChainToken \
  --address $EVM_TOKEN
```

Auto-derivation needs an API key (to fetch the creation code). Two escape hatches let you skip it:
pass `--constructor-args 0x...` (ABI-encoded) to skip derivation entirely, or `--creation-tx <hash>`
to derive from a known creation transaction without an explorer lookup.

### Live-verified examples (2026-06-26)

These Sepolia contracts were deployed with `ccip-cli` and verified live on 2026-06-26. Open each link
to see the verified source on Etherscan; this is what a successful verify looks like.

| Contract                           | How it was deployed                    | Address (Sepolia, verified)                                                                                                          |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| TokenPoolFactory 2.0.0             | bundled fixture                        | [`0x93c57146d11a6Ca73fc53e5902aCB6900E553858`](https://sepolia.etherscan.io/address/0x93c57146d11a6Ca73fc53e5902aCB6900E553858#code) |
| CrossChainToken (factory)          | `pool deploy-via-factory` lock-release | [`0x94b968AFeDf10015eE676B6b87c64EC6B60EbcF2`](https://sepolia.etherscan.io/address/0x94b968AFeDf10015eE676B6b87c64EC6B60EbcF2#code) |
| LockReleaseTokenPool (factory)     | `pool deploy-via-factory` lock-release | [`0x85eea37C663354B1141b08239d1fBCfdF8aD1594`](https://sepolia.etherscan.io/address/0x85eea37C663354B1141b08239d1fBCfdF8aD1594#code) |
| ERC20LockBox (factory auto-deploy) | `pool deploy-via-factory` lock-release | [`0x8851E5c07fB48ad33affEf86E30476771B51f143`](https://sepolia.etherscan.io/address/0x8851E5c07fB48ad33affEf86E30476771B51f143#code) |
| CrossChainToken (direct)           | `token deploy`                         | [`0x099D317FdF4DEd2BeAD645196A6385690D4a1dF6`](https://sepolia.etherscan.io/address/0x099D317FdF4DEd2BeAD645196A6385690D4a1dF6#code) |

The factory lock-release row is one `pool deploy-via-factory --pool-type lock-release --verify` run:
the token, the pool, and the auto-deployed lockbox were all verified from a single CREATE2 deploy. The
direct row is a plain `token deploy` whose `CrossChainToken` was verified afterward with
`ccip-cli verify`.

---

## 6. Phase 4: register as token admin

This is a 2-step process: propose, then accept. You must be the token owner/admin to propose.

### Step 1: propose admin

#### EVM (Sepolia)

CrossChainToken implements `getCCIPAdmin()` (set via `--ccip-admin` at deploy, defaults to the
owner/signer), so use `--registration-method get-ccip-admin`:

```bash
ccip-cli token-admin propose-admin \
  -n ethereum-testnet-sepolia \
  --token-address $EVM_TOKEN \
  --registry-module-address 0xa3c796d480638d7476792230da1E2ADa86e031b0 \
  --registration-method get-ccip-admin \
  -f json
```

#### Solana (Devnet)

```bash
ccip-cli token-admin propose-admin \
  -n solana-devnet \
  --wallet ~/.config/solana/id.json \
  --token-address $SOLANA_TOKEN \
  --administrator <YOUR_SOLANA_ADDRESS> \
  --router-address Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C \
  -f json
```

#### Aptos (Testnet)

```bash
ccip-cli token-admin propose-admin \
  -n aptos-testnet \
  -w <hex-private-key> \
  --token-address $APTOS_TOKEN \
  --administrator <YOUR_APTOS_ADDRESS> \
  --router-address 0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45 \
  -f json
```

### Verify with `get-config`

After proposing, confirm that `pendingAdministrator` is set:

```bash
ccip-cli token-admin get-config \
  -n ethereum-testnet-sepolia \
  --token-address $EVM_TOKEN \
  --router-address 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  -f json
```

Expected: `pendingAdministrator` = your wallet address, `administrator` = zero address.

### Step 2: accept admin

#### EVM

```bash
ccip-cli token-admin accept-admin \
  -n ethereum-testnet-sepolia \
  --token-address $EVM_TOKEN \
  --router-address 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  -f json
```

#### Solana

```bash
ccip-cli token-admin accept-admin \
  -n solana-devnet \
  --wallet ~/.config/solana/id.json \
  --token-address $SOLANA_TOKEN \
  --router-address Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C \
  -f json
```

#### Aptos

```bash
ccip-cli token-admin accept-admin \
  -n aptos-testnet \
  -w <hex-private-key> \
  --token-address $APTOS_TOKEN \
  --router-address 0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45 \
  -f json
```

After accepting, `get-config` shows `administrator` = your wallet, `pendingAdministrator` = zero.

---

## 7. Phase 5: grant mint/burn access to the pool

The pool needs mint and burn permissions on the token to process cross-chain transfers.

### EVM (Sepolia) — CrossChainToken

The SDK auto-detects the v2 CrossChainToken; no `--token-type` needed. This grants the pool the
AccessControl `MINTER_ROLE`/`BURNER_ROLE` (via the token's `grantMintAndBurnRoles` convenience
setter):

```bash
ccip-cli token grant-mint-burn-access \
  -n ethereum-testnet-sepolia \
  -w <hex-private-key> \
  --token-address $EVM_TOKEN \
  --authority $EVM_POOL \
  --rpc https://1rpc.io/sepolia \
  -f json
```

The default `--role mintAndBurn` grants both. Use `--role mint` or `--role burn` for granular control.

### Solana (Devnet)

Solana uses the SPL Token mint authority. This transfers mint authority to the specified address; your
wallet loses direct minting ability.

For CCIP, the recommended flow is:

1. Create an SPL Multisig (with `create-multisig`) containing the pool's signer PDA plus your wallet.
2. Transfer mint authority to the multisig.

```bash
# Step 1: Create multisig (1-of-2: pool signer PDA + your wallet)
# --token-address is an alias for --mint (standard Solana terminology)
ccip-cli token create-multisig \
  -n solana-devnet \
  --wallet ~/.config/solana/id.json \
  --token-address $SOLANA_TOKEN \
  --pool-program-id 41FGToCmdaWa1dgZLKFAjvmx6e6AjVTX7SVRibvsMGVB \
  --additional-signers <YOUR_SOLANA_ADDRESS> \
  --threshold 1 \
  --rpcs https://api.devnet.solana.com \
  -f json
```

Save the `multisigAddress` from the output:

```bash
SOLANA_MULTISIG=<base58>
```

```bash
# Step 2: Transfer mint authority to multisig
ccip-cli token grant-mint-burn-access \
  -n solana-devnet \
  -w ~/.config/solana/id.json \
  --token-address $SOLANA_TOKEN \
  --authority $SOLANA_MULTISIG \
  --rpc https://api.devnet.solana.com \
  -f json
```

### Aptos (Testnet)

For Managed tokens, this calls `apply_allowed_minter_updates` plus `apply_allowed_burner_updates` (2
txs). The owner keeps minting ability; this is additive, not a transfer.

Pass the pool address as `--authority`. The SDK resolves the pool's store address (resource signer
PDA) internally via `get_store_address` and grants mint/burn to that address.

```bash
ccip-cli token grant-mint-burn-access \
  -n aptos-testnet \
  -w <hex-private-key> \
  --token-address $APTOS_TOKEN \
  --authority $APTOS_POOL \
  --rpc https://fullnode.testnet.aptoslabs.com/v1 \
  -f json
```

### Verify with `get-mint-burn-info`

```bash
# EVM — shows minters[] and burners[] arrays
ccip-cli token get-mint-burn-info \
  -n ethereum-testnet-sepolia \
  --token-address $EVM_TOKEN \
  --rpc https://1rpc.io/sepolia \
  -f json

# Solana — shows mintAuthority, isMultisig, multisigThreshold, multisigMembers
ccip-cli token get-mint-burn-info \
  -n solana-devnet \
  --token-address $SOLANA_TOKEN \
  --rpc https://api.devnet.solana.com \
  -f json

# Aptos — shows owner, allowedMinters[], allowedBurners[]
ccip-cli token get-mint-burn-info \
  -n aptos-testnet \
  --token-address $APTOS_TOKEN \
  --rpc https://fullnode.testnet.aptoslabs.com/v1 \
  -f json
```

> On EVM, `get-mint-burn-info` lists the `MINTER_ROLE`/`BURNER_ROLE` holders of the CrossChainToken
> (via `AccessControlEnumerable`, falling back to scanning `RoleGranted` events for non-enumerable
> tokens).

---

## 8. Phase 6: create the token ALT (Solana only)

Solana needs an Address Lookup Table (ALT) holding 10 base CCIP addresses for the token's pool. This
is a prerequisite for `set-pool`.

```bash
ccip-cli token-admin create-token-alt \
  -n solana-devnet \
  --wallet ~/.config/solana/id.json \
  --token-address $SOLANA_TOKEN \
  --pool-address $SOLANA_POOL \
  --router-address Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C \
  --additional-addresses $SOLANA_MULTISIG \
  --rpcs https://api.devnet.solana.com
```

> Include the SPL Multisig via `--additional-addresses` so the router can reference it in
> `releaseOrMintTokens` transactions. The ALT then holds 11 entries (10 base CCIP + 1 multisig).

Save the ALT address:

```bash
SOLANA_ALT=<base58>
```

---

## 9. Phase 7: apply chain updates (mesh configuration)

Configure each pool to know about the remote chains, their tokens, pools, and rate limiters. This
builds a mesh where each pool knows how to reach every other pool.

### Configuration file format

Create a JSON config file for each chain. Each file lists the other 2 chains as remotes.

> Rate limiter values are in the local token's smallest unit. `capacity` is the maximum tokens in the
> bucket; `rate` is tokens per second refill. Scale these values by the local token's decimals:
>
> - EVM (18 decimals): 10,000 tokens = `10000 × 10^18` = `10000000000000000000000`
> - Solana (9 decimals): 10,000 tokens = `10000 × 10^9` = `10000000000000`
> - Aptos (8 decimals): 10,000 tokens = `10000 × 10^8` = `1000000000000`

#### EVM config (evm-config.json)

```json
{
  "chainsToRemove": [],
  "chainsToAdd": [
    {
      "remoteChainSelector": "solana-devnet",
      "remotePoolAddresses": ["<SOLANA_POOL>"],
      "remoteTokenAddress": "<SOLANA_TOKEN>",
      "remoteTokenDecimals": 9,
      "outboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "10000000000000000000000",
        "rate": "1000000000000000000000"
      },
      "inboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "10000000000000000000000",
        "rate": "1000000000000000000000"
      }
    },
    {
      "remoteChainSelector": "aptos-testnet",
      "remotePoolAddresses": ["<APTOS_POOL>"],
      "remoteTokenAddress": "<APTOS_TOKEN>",
      "remoteTokenDecimals": 8,
      "outboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "10000000000000000000000",
        "rate": "1000000000000000000000"
      },
      "inboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "10000000000000000000000",
        "rate": "1000000000000000000000"
      }
    }
  ]
}
```

#### Solana config (solana-config.json)

```json
{
  "chainsToRemove": [],
  "chainsToAdd": [
    {
      "remoteChainSelector": "ethereum-testnet-sepolia",
      "remotePoolAddresses": ["<EVM_POOL>"],
      "remoteTokenAddress": "<EVM_TOKEN>",
      "remoteTokenDecimals": 18,
      "outboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "10000000000000",
        "rate": "1000000000000"
      },
      "inboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "10000000000000",
        "rate": "1000000000000"
      }
    },
    {
      "remoteChainSelector": "aptos-testnet",
      "remotePoolAddresses": ["<APTOS_POOL>"],
      "remoteTokenAddress": "<APTOS_TOKEN>",
      "remoteTokenDecimals": 8,
      "outboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "10000000000000",
        "rate": "1000000000000"
      },
      "inboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "10000000000000",
        "rate": "1000000000000"
      }
    }
  ]
}
```

#### Aptos config (aptos-config.json)

```json
{
  "chainsToRemove": [],
  "chainsToAdd": [
    {
      "remoteChainSelector": "ethereum-testnet-sepolia",
      "remotePoolAddresses": ["<EVM_POOL>"],
      "remoteTokenAddress": "<EVM_TOKEN>",
      "remoteTokenDecimals": 18,
      "outboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "1000000000000",
        "rate": "100000000000"
      },
      "inboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "1000000000000",
        "rate": "100000000000"
      }
    },
    {
      "remoteChainSelector": "solana-devnet",
      "remotePoolAddresses": ["<SOLANA_POOL>"],
      "remoteTokenAddress": "<SOLANA_TOKEN>",
      "remoteTokenDecimals": 9,
      "outboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "1000000000000",
        "rate": "100000000000"
      },
      "inboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "1000000000000",
        "rate": "100000000000"
      }
    }
  ]
}
```

### Apply on each chain

#### EVM

```bash
ccip-cli pool apply-chain-updates \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --config /path/to/evm-config.json \
  -f json
```

#### Solana

```bash
ccip-cli pool apply-chain-updates \
  -n solana-devnet \
  --wallet ~/.config/solana/id.json \
  --pool-address $SOLANA_POOL \
  --config /path/to/solana-config.json \
  --rpcs https://api.devnet.solana.com \
  -f json
```

#### Aptos

```bash
ccip-cli pool apply-chain-updates \
  -n aptos-testnet \
  -w <hex-private-key> \
  --pool-address $APTOS_POOL \
  --config /path/to/aptos-config.json \
  --rpc https://fullnode.testnet.aptoslabs.com/v1 \
  -f json
```

### Verify with `pool get-config`

Check each pool to confirm remote chains, pool addresses, token addresses, and rate limiters are set
correctly:

```bash
# EVM — check Solana remote
ccip-cli pool get-config \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --remote-chain solana-devnet \
  -f json

# Solana — check EVM remote
ccip-cli pool get-config \
  -n solana-devnet \
  --pool-address $SOLANA_POOL \
  --remote-chain ethereum-testnet-sepolia \
  -f json

# Aptos — check EVM remote
ccip-cli pool get-config \
  -n aptos-testnet \
  --pool-address $APTOS_POOL \
  --remote-chain ethereum-testnet-sepolia \
  -f json
```

Each should show `remotePools`, `remoteToken`, and
`outboundRateLimiterState`/`inboundRateLimiterState` with the values from your config files.

### Solana pool token ATA (existing pools only)

If you are configuring an existing pool (not deployed via this tutorial), the Pool Signer PDA's
Associated Token Account (ATA) must exist before inbound transfers. For pools deployed via
`ccip-cli pool deploy`, this is created automatically.

```bash
# Only needed for existing pools, NOT for fresh deploys from this tutorial
spl-token create-account $SOLANA_TOKEN \
  --owner <POOL_SIGNER_PDA> \
  --fee-payer ~/.config/solana/id.json \
  --url devnet
```

---

## 10. Phase 8: set the pool in the TokenAdminRegistry

Register the pool in the TokenAdminRegistry, linking token to pool so the CCIP Router can route
cross-chain messages through it.

### EVM (Sepolia)

```bash
ccip-cli token-admin set-pool \
  -n ethereum-testnet-sepolia \
  --token-address $EVM_TOKEN \
  --pool-address $EVM_POOL \
  --router-address 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59
```

### Solana (Devnet)

Requires `--pool-lookup-table` (the ALT from Phase 6):

```bash
ccip-cli token-admin set-pool \
  -n solana-devnet \
  --wallet ~/.config/solana/id.json \
  --token-address $SOLANA_TOKEN \
  --pool-address $SOLANA_POOL \
  --router-address Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C \
  --pool-lookup-table $SOLANA_ALT \
  --rpcs https://api.devnet.solana.com
```

### Aptos (Testnet)

```bash
ccip-cli token-admin set-pool \
  -n aptos-testnet \
  --token-address $APTOS_TOKEN \
  --pool-address $APTOS_POOL \
  --router-address 0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45
```

### Verify with `get-config`

```bash
ccip-cli token-admin get-config \
  -n ethereum-testnet-sepolia \
  --token-address $EVM_TOKEN \
  --router-address 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  -f json
```

The `tokenPool` field should now match your pool address. On Solana, the output also shows
`poolLookupTable` and `poolLookupTableEntries`.

---

## 11. Phase 9: cross-chain transfers

With the mesh configured, send tokens between chains.

### EVM to Solana

```bash
ccip-cli send \
  -s ethereum-testnet-sepolia \
  -d solana-devnet \
  -r 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  --to <SOLANA_RECIPIENT_ADDRESS> \
  -t $EVM_TOKEN=1.0 \
  --ooo -L 0 -f log
```

### EVM to Aptos

```bash
ccip-cli send \
  -s ethereum-testnet-sepolia \
  -d aptos-testnet \
  -r 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  --to <APTOS_RECIPIENT_ADDRESS> \
  -t $EVM_TOKEN=1.0 \
  --ooo -L 0 -f log
```

### Solana to EVM

```bash
ccip-cli send \
  -s solana-devnet \
  -d ethereum-testnet-sepolia \
  -r Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C \
  --to <EVM_RECIPIENT_ADDRESS> \
  --wallet ~/.config/solana/id.json \
  -t $SOLANA_TOKEN=0.5 \
  --rpcs https://api.devnet.solana.com \
  --ooo -L 0 -f log
```

### Aptos to EVM

```bash
ccip-cli send \
  -s aptos-testnet \
  -d ethereum-testnet-sepolia \
  -r 0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45 \
  --to <EVM_RECIPIENT_ADDRESS> \
  -w <hex-private-key> \
  -t $APTOS_TOKEN=1.0 \
  --rpc https://fullnode.testnet.aptoslabs.com/v1 \
  --ooo -L 0 -f log
```

### Track message status

```bash
ccip-cli show <SOURCE_TX_HASH> \
  --rpcs <SOURCE_RPC> \
  --rpcs <DEST_RPC> \
  -f json
```

You can also track on the CCIP Explorer: `https://ccip.chain.link/msg/<MESSAGE_ID>`.

### Transfer flags

| Flag    | Description                                      |
| ------- | ------------------------------------------------ |
| `-s`    | Source chain name                                |
| `-d`    | Destination chain name                           |
| `-r`    | Router address on source chain                   |
| `--to`  | Recipient address on destination chain           |
| `-t`    | Token and amount (`<TOKEN_ADDRESS>=<AMOUNT>`)    |
| `--ooo` | Out-of-order execution (recommended for testing) |
| `-L 0`  | Gas limit 0 (no receiver contract execution)     |

### Aptos and Solana direct lanes

Direct Aptos-to-Solana lanes may not be configured at the router level on testnet. This is a Chainlink
infrastructure limitation, not a code issue. If you get `E_UNSUPPORTED_DESTINATION_CHAIN`, the lane
does not exist yet. Use EVM as a hub.

---

## 12. Manage EVM CCT v2 pools: liquidity and config

These operations are EVM-only and apply to the CCT v2.0 stack (`CrossChainToken`, `BurnMintTokenPool`,
`LockReleaseTokenPool`, `CrossChainPoolToken`, `ERC20LockBox`). To verify any of these contracts on
the explorer, see [Verify the EVM contracts on Etherscan](#5-verify-the-evm-contracts-on-etherscan).

### Provide liquidity (lock-release only)

A lock-release pool can only release tokens on the destination if it holds liquidity. Fund it with
`pool provide-liquidity` (version-aware: works for both v2.0 and v1.x lock-release pools). `--amount`
is in whole token units; the CLI resolves the pool's token decimals and scales it for you.

```bash
ccip-cli pool provide-liquidity \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --amount 1000 \
  -f json
```

### v2 pool config setters

CCT v2.0 pools expose on-chain fee and finality configuration. These require the pool owner (or fee
admin where noted).

Token-transfer fee config sets per-destination bps and flat fees. Generate a template, edit it, then
apply (you can also pipe the JSON via stdin):

```bash
# Generate a template
ccip-cli pool set-fee-config --generate-config > fee-config.json

# Apply (must be pool owner or fee admin)
ccip-cli pool set-fee-config \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --config fee-config.json \
  -f json
```

Each entry in `feeConfigs[]` carries `remoteChainSelector` (name or numeric selector),
`destGasOverhead`, `destBytesOverhead`, `finalityFeeUSDCents`, `fastFinalityFeeUSDCents`,
`finalityTransferFeeBps`, `fastFinalityTransferFeeBps`, and `isEnabled`. List selectors under
`disable[]` to turn a destination's config off.

Allowed-finality config sets `--finality` to `finalized`, `safe`, or a block-depth integer (`0`–`65535`)
for Faster-Than-Finality:

```bash
ccip-cli pool set-finality-config \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --finality finalized \
  -f json
```

The fee admin setter delegates fee-config rights to another address:

```bash
ccip-cli pool set-fee-admin \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --fee-admin <NEW_FEE_ADMIN> \
  -f json
```

---

## 13. Additional operations

### Append remote pool addresses

Add remote pool addresses to an existing chain config (for example, when a new pool is deployed on a
remote chain):

```bash
ccip-cli pool append-remote-pool-addresses \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --remote-chain solana-devnet \
  --remote-pool-addresses <NEW_SOLANA_POOL> \
  -f json
```

### Remove remote pool addresses

```bash
ccip-cli pool remove-remote-pool-addresses \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --remote-chain solana-devnet \
  --remote-pool-addresses <OLD_SOLANA_POOL> \
  -f json
```

### Delete chain config

Remove an entire remote chain configuration from a pool:

```bash
ccip-cli pool delete-chain-config \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --remote-chain solana-devnet \
  -f json
```

### Set rate limiter config

Uses a JSON config file (generate a template with `--generate-config`):

```bash
# Generate template
ccip-cli pool set-rate-limiter-config --generate-config > rate-limiter-config.json

# Apply (edit the template first with your values)
ccip-cli pool set-rate-limiter-config \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --config rate-limiter-config.json \
  -f json
```

Example `rate-limiter-config.json` (values in local token's smallest unit):

```json
{
  "chainConfigs": [
    {
      "remoteChainSelector": "solana-devnet",
      "outboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "10000000000000000000000",
        "rate": "1000000000000000000000"
      },
      "inboundRateLimiterConfig": {
        "isEnabled": true,
        "capacity": "10000000000000000000000",
        "rate": "1000000000000000000000"
      }
    }
  ]
}
```

### Revoke mint/burn access

Revoke mint or burn permissions individually:

```bash
ccip-cli token revoke-mint-burn-access \
  -n ethereum-testnet-sepolia \
  -w <hex-private-key> \
  --token-address $EVM_TOKEN \
  --authority $EVM_POOL \
  --role mint \
  --rpc https://1rpc.io/sepolia \
  -f json
```

### Transfer admin

Transfer the TokenAdminRegistry admin role to another address (2-step: transfer then accept):

```bash
# Current admin initiates transfer
ccip-cli token-admin transfer-admin \
  -n ethereum-testnet-sepolia \
  --token-address $EVM_TOKEN \
  --new-admin <NEW_ADMIN_ADDRESS> \
  --router-address 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  -f json

# New admin accepts
ccip-cli token-admin accept-admin \
  -n ethereum-testnet-sepolia \
  -w <NEW_ADMIN_PRIVATE_KEY> \
  --token-address $EVM_TOKEN \
  --router-address 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  -f json
```

### Pool transfer ownership

EVM and Solana use a 2-step process:

```bash
# Owner proposes new owner
ccip-cli pool transfer-ownership \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --new-owner <NEW_OWNER>

# New owner accepts
ccip-cli pool accept-ownership \
  -n ethereum-testnet-sepolia \
  -w <NEW_OWNER_KEY> \
  --pool-address $EVM_POOL
```

Aptos uses a 3-step process:

```bash
# Step 1: Current owner proposes
ccip-cli pool transfer-ownership \
  -n aptos-testnet \
  --pool-address $APTOS_POOL \
  --new-owner <NEW_OWNER>

# Step 2: New owner signals acceptance
ccip-cli pool accept-ownership \
  -n aptos-testnet \
  -w <NEW_OWNER_KEY> \
  --pool-address $APTOS_POOL

# Step 3: Current owner finalizes (AptosFramework object::transfer)
ccip-cli pool execute-ownership-transfer \
  -n aptos-testnet \
  -w <CURRENT_OWNER_KEY> \
  --pool-address $APTOS_POOL \
  --new-owner <NEW_OWNER>
```

---

## 14. Known issues and gotchas

### CrossChainToken uses AccessControl roles

The EVM CrossChainToken uses OpenZeppelin AccessControl (`MINTER_ROLE` / `BURNER_ROLE`), not dedicated
`grantMintRole`/`grantBurnRole` helpers. Use `grant-mint-burn-access` (no `--token-type`) or the
token's `grantMintAndBurnRoles(addr)` convenience setter; raw `cast` needs
`grantRole(MINTER_ROLE, addr)`. The deployer is owner, CCIP admin, and burn-mint-role admin by
default, but is not a minter unless pre-minting or granting the role.

### Pool address encoding (fixed)

Remote pool addresses in `applyChainUpdates` must preserve their original byte length:

- Token addresses: left-padded to 32 bytes (correct for all chains).
- Pool addresses: raw bytes at original length (20 bytes for EVM addresses).

The Solana on-chain program compares incoming `sourcePoolAddress` (20 raw bytes for EVM) against
stored pool addresses. If stored as 32 bytes (left-padded), the comparison fails with
`InvalidSourcePoolAddress`.

### Solana mint authority transfer

`grant-mint-burn-access` on Solana transfers mint authority; your wallet loses direct minting ability.
Create a multisig first (via `create-multisig`) to retain access alongside the pool.

### Aptos 3-step ownership transfer

EVM and Solana use 2 steps (propose, accept). Aptos uses 3: propose, accept, execute. The current
owner must call `execute-ownership-transfer` after the new owner accepts.

### Aptos and Solana direct lanes

Direct lanes between Aptos Testnet and Solana Devnet may not exist at the router level. This is a
Chainlink infrastructure limitation. Use EVM as a hub for Aptos-to-Solana transfers.

### `show` command crash on SVM destinations

The `show` command crashes when viewing SVM-destination messages because `looksUsdcData()` expects hex
`BytesLike`, but the CCIP API returns `extraData` as base64 for SVM destinations.

---

## Quick reference: complete flow checklist

```
For each chain:
  [ ] 1. Deploy token (EVM: CrossChainToken 2.0.0, Solana: Token-2022, Aptos: Managed)
       - EVM alternatives: pool deploy-combined (CrossChainPoolToken = token+pool, skip step 3)
                           or pool deploy-via-factory (TokenPoolFactory 2.0.0, CREATE2)
       - EVM: add --verify (+ ETHERSCAN_API_KEY) to verify on the explorer
  [ ] 2. Mint tokens to wallet (EVM: pre-mint via --initial-supply, or grant MINTER_ROLE then cast mint)
  [ ] 3. Deploy pool (EVM: BurnMintTokenPool / LockReleaseTokenPool 2.0.0 — lock-release auto-deploys ERC20LockBox;
                      Solana: BurnMint; Aptos: Managed). EVM: optional --verify
  [ ] -. Verify the EVM contracts (--verify at deploy, or ccip-cli verify afterward)
  [ ] 4. Propose admin (token-admin propose-admin)
  [ ] 5. Accept admin (token-admin accept-admin)
  [ ] 6. Grant mint/burn access to pool
       - EVM: grant-mint-burn-access (auto-detects v2 CrossChainToken; no --token-type)
       - Solana: create-multisig first, then grant to multisig
       - Aptos: pass pool address as --authority (SDK auto-resolves store address; additive, owner keeps access)
  [ ] 7. (Solana only) Create Token ALT (include multisig in --additional-addresses)

Cross-chain mesh:
  [ ] 8. Apply chain updates on EACH pool (pointing to all remote chains)
  [ ] 9. Set pool on EACH chain (token-admin set-pool)

EVM CCT v2 extras (optional):
  [ ] provide liquidity (lock-release pools), set fee / finality / fee-admin config
      (pool set-fee-config / set-finality-config / set-fee-admin)

Testing:
  [ ] 10. Send cross-chain transfer (EVM<->Solana, EVM<->Aptos)
  [ ] 11. Track message with `show` or CCIP Explorer
```
