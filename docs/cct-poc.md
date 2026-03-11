# CCT PoC Guide: Cross-Chain Token Deployment & Transfer Testing

This guide walks through the complete flow for deploying cross-chain tokens and pools using `ccip-cli`, configuring a 3-chain mesh (EVM, Solana, Aptos), and testing cross-chain transfers. Based on real testnet results (Sepolia, Solana Devnet, Aptos Testnet).

**Token/Pool stack used in this guide:**

| Chain | Token Type | Pool Type | Decimals |
|-------|-----------|-----------|----------|
| EVM (Sepolia) | FactoryBurnMintERC20 | BurnMint | 18 |
| Solana (Devnet) | Token-2022 (SPL) | BurnMint | 9 |
| Aptos (Testnet) | Managed Token | Managed Token Pool | 8 |

> **Prerequisite**: Run all commands from the `ccip-cli/` directory.

---

## Table of Contents

1. [Prerequisites & Wallet Setup](#1-prerequisites--wallet-setup)
2. [Phase 1: Deploy Tokens](#2-phase-1-deploy-tokens)
3. [Phase 2: Mint Tokens](#3-phase-2-mint-tokens)
4. [Phase 3: Deploy Pools](#4-phase-3-deploy-pools)
5. [Phase 4: Register as Token Admin](#5-phase-4-register-as-token-admin)
6. [Phase 5: Grant Mint/Burn Access to Pool](#6-phase-5-grant-mintburn-access-to-pool)
7. [Phase 6: Create Token ALT (Solana only)](#7-phase-6-create-token-alt-solana-only)
8. [Phase 7: Apply Chain Updates (Mesh Configuration)](#8-phase-7-apply-chain-updates-mesh-configuration)
9. [Phase 8: Set Pool in TokenAdminRegistry](#9-phase-8-set-pool-in-tokenadminregistry)
10. [Phase 9: Cross-Chain Transfers](#10-phase-9-cross-chain-transfers)
11. [Additional Operations](#11-additional-operations)
12. [Known Issues & Gotchas](#12-known-issues--gotchas)

---

## 1. Prerequisites & Wallet Setup

### Tools Required

- Node.js 20+
- `spl-token` CLI — for Solana token minting
- `cast` (from [Foundry](https://book.getfoundry.sh/)) — for EVM direct contract calls (minting)
- `aptos` CLI — for Aptos token minting and (optionally) contract deployment

### Build the Project

Clone the repo and build both the SDK and CLI before running any commands:

```bash
git clone <repo-url> && cd ccip-tools-ts

# Install dependencies
npm install

# Build SDK + CLI (must be done from the repo root)
npm run build
```

After building, the CLI is available at `ccip-cli/dist/index.js`. All commands in this guide should be run from the `ccip-cli/` directory:

```bash
cd ccip-cli
node dist/index.js --help
```

### Accounts & Funding

You need accounts on all 3 chains with enough native tokens to cover transaction fees:

| Chain | Account | How to fund | Estimated cost |
|-------|---------|-------------|----------------|
| EVM (Sepolia) | Generate with any Ethereum wallet (MetaMask, etc.) | [Sepolia faucet](https://faucets.chain.link/sepolia) | ~0.1 ETH |
| Solana (Devnet) | `solana-keygen new -o ~/.config/solana/id.json` | `solana airdrop 5 --url devnet` | ~5 SOL |
| Aptos (Testnet) | Derive from same private key (Ed25519) | [Aptos faucet](https://aptos.dev/en/network/faucet) | ~2 APT |

> The same 32-byte hex private key can be used for both EVM and Aptos (they derive different addresses from it). Solana requires a separate keypair file (`~/.config/solana/id.json`).

### `.env` File Setup

Create a `.env` file in the `ccip-cli/` directory with your RPC endpoints and private key. The CLI reads this by default (`--rpcs-file ./.env`):

```bash
# RPC endpoints (one per chain)
RPC_ETHEREUM_SEPOLIA=https://1rpc.io/sepolia
RPC_SOLANA_DEVNET=https://api.devnet.solana.com
RPC_APTOS_TESTNET=https://fullnode.testnet.aptoslabs.com/v1

# EVM/Aptos private key (32-byte hex, no 0x prefix)
# Used automatically when --wallet is omitted for EVM/Aptos commands
PRIVATE_KEY=<your-hex-private-key>
```

### Wallet Configuration

| Chain  | How to pass wallet | Wallet location | Notes |
|--------|-------------------|-----------------|-------|
| EVM    | `-w <hex-private-key>` or `PRIVATE_KEY` in `.env` | `.env` file | 32-byte hex, auto-loaded from `.env` if `--wallet` omitted |
| Solana | `-w ~/.config/solana/id.json` | `~/.config/solana/id.json` | JSON keypair file (64-byte array). Must always pass `-w` explicitly — `PRIVATE_KEY` from `.env` won't work for Solana |
| Aptos  | `-w <hex-private-key>` or `PRIVATE_KEY` in `.env` | `.env` file | Same 32-byte hex as EVM (Ed25519 seed), derives a different address |

### CCIP Contract Addresses (Testnet)

Fetch from: `https://docs.chain.link/api/ccip/v1/chains?environment=testnet`

| Chain | Router | Registry Module (EVM) |
|-------|--------|-----------------------|
| EVM (Sepolia) | `0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59` | `0xa3c796d480638d7476792230da1E2ADa86e031b0` |
| Solana (Devnet) | `Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C` | — |
| Aptos (Testnet) | `0xc748085bd02022a9696dfa2058774f92a07401208bbd34cfd0c6d0ac0287ee45` | — |

**Solana Pool Program IDs:**
- BurnMint: `41FGToCmdaWa1dgZLKFAjvmx6e6AjVTX7SVRibvsMGVB`
- LockRelease: `8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC`

**Aptos MCMS Address:** `0xbdf1b9aacb4e21bf6f255105831df0172e911d4748e488196fde10d2e2a4e32d`

---

## 2. Phase 1: Deploy Tokens

Deploy a token on each chain. All chains use the same token name/symbol for consistency.

### EVM (Sepolia) — FactoryBurnMintERC20, 18 decimals

FactoryBurnMintERC20 uses dedicated `grantMintRole`/`grantBurnRole` functions (simpler than BurnMintERC20's AccessControl). The deployer is the owner but does **not** have the mint role by default — you must call `grantMintRole` before any subsequent minting (see Phase 2).

> `--initial-supply` mints tokens in the constructor (bypasses the role check). For additional minting later, you need `grantMintRole` first.

```bash
ccip-cli token deploy \
  -n ethereum-testnet-sepolia \
  --name "CCT Test Token" \
  --symbol CCTEST \
  --decimals 18 \
  --initial-supply 1000000 \
  --token-type factoryBurnMintERC20 \
  -f json
```

Output: `tokenAddress` and `txHash`.

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

> **WARNING**: The Aptos `token deploy` command will likely be removed from the SDK. It requires the Aptos CLI installed locally to compile Move contracts, which makes it impractical to bundle in the SDK. **Recommendation**: Deploy Aptos tokens directly from the [`chainlink-aptos`](https://github.com/smartcontractkit/chainlink-aptos) repo using `aptos move deploy-object`. See the [Aptos CLI docs](https://aptos.dev/tools/aptos-cli/) for installation.

Managed tokens use allowlist-based access control. The deployer is the owner and can add/remove minters and burners.

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

### Record Your Addresses

Save the token addresses from each chain. You'll need them throughout the remaining steps.

```bash
EVM_TOKEN=0x...
SOLANA_TOKEN=<base58>
APTOS_TOKEN=0x...
# Also save the Aptos code object address for minting later
APTOS_CODE_OBJECT=0x...
```

---

## 3. Phase 2: Mint Tokens

Mint tokens to your wallet for transfer testing.

### EVM (Sepolia) — FactoryBurnMintERC20

The FactoryBurnMintERC20 deployer is the **owner** but does NOT have the mint role by default. Grant it first (one-time), then mint:

```bash
# Step 1 (one-time): Grant mint role to deployer
cast send $EVM_TOKEN \
  "grantMintRole(address)" \
  <YOUR_EVM_ADDRESS> \
  --private-key <PRIVATE_KEY> \
  --rpc-url https://1rpc.io/sepolia

# Step 2: Mint 1,000,000 tokens (1000000 * 10^18)
cast send $EVM_TOKEN \
  "mint(address,uint256)" \
  <YOUR_EVM_ADDRESS> \
  1000000000000000000000000 \
  --private-key <PRIVATE_KEY> \
  --rpc-url https://1rpc.io/sepolia
```

> FactoryBurnMintERC20 uses `grantMintRole(address)` instead of BurnMintERC20's `grantRole(bytes32, address)`.

### Solana (Devnet) — Token-2022

Deployer is the mint authority. No extra permission needed:

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

> The `u64` amount is in raw units (1,000,000 tokens * 10^8 decimals = 100000000000000).

---

## 4. Phase 3: Deploy Pools

Deploy a BurnMint token pool on each chain.

### EVM (Sepolia) — BurnMint Pool

```bash
ccip-cli pool deploy \
  -n ethereum-testnet-sepolia \
  --pool-type burn-mint \
  --token-address $EVM_TOKEN \
  --local-token-decimals 18 \
  --router-address 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  -f json
```

### Solana (Devnet) — BurnMint Pool

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

### Aptos (Testnet) — Managed Token Pool

> **WARNING**: The Aptos `pool deploy` command will likely be removed from the SDK. It requires the Aptos CLI installed locally to compile Move contracts, which makes it impractical to bundle in the SDK. **Recommendation**: Deploy Aptos pools directly from the [`chainlink-aptos`](https://github.com/smartcontractkit/chainlink-aptos) repo using `aptos move deploy-object`. See the [Aptos CLI docs](https://aptos.dev/tools/aptos-cli/) for installation.

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

The Aptos pool deploy is a 2-step process internally: (1) publish CCIPTokenPool shared dependency, (2) publish the managed_token_pool module. The SDK handles both steps automatically.

### Record Pool Addresses

```bash
EVM_POOL=0x...
SOLANA_POOL=<base58>
APTOS_POOL=0x...
```

---

## 5. Phase 4: Register as Token Admin

This is a 2-step process: **propose** then **accept**. You must be the token owner/admin to propose.

### Step 1: Propose Admin

#### EVM (Sepolia)

FactoryBurnMintERC20 tokens implement `getCCIPAdmin()`, so use `--registration-method get-ccip-admin`:

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

After proposing, verify that `pendingAdministrator` is set:

```bash
ccip-cli token-admin get-config \
  -n ethereum-testnet-sepolia \
  --token-address $EVM_TOKEN \
  --router-address 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  -f json
```

Expected: `pendingAdministrator` = your wallet address, `administrator` = zero address.

### Step 2: Accept Admin

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

After accepting, `get-config` should show `administrator` = your wallet, `pendingAdministrator` = zero.

---

## 6. Phase 5: Grant Mint/Burn Access to Pool

The pool needs mint and burn permissions on the token to process cross-chain transfers.

### EVM (Sepolia) — FactoryBurnMintERC20

For FactoryBurnMintERC20, pass `--token-type factoryBurnMintERC20`. This uses dedicated `grantMintRole`/`grantBurnRole` functions instead of AccessControl's `grantRole`:

```bash
ccip-cli token grant-mint-burn-access \
  -n ethereum-testnet-sepolia \
  -w <hex-private-key> \
  --token-address $EVM_TOKEN \
  --authority $EVM_POOL \
  --token-type factoryBurnMintERC20 \
  --rpc https://1rpc.io/sepolia \
  -f json
```

Default `--role mintAndBurn` grants both mint and burn. Use `--role mint` or `--role burn` for granular control.

### Solana (Devnet)

Solana uses SPL Token mint authority. This **transfers** mint authority to the specified address — your wallet loses direct minting ability.

For CCIP, the recommended flow is:
1. Create an SPL Multisig (with `create-multisig`) containing the pool's signer PDA + your wallet
2. Transfer mint authority to the multisig

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

For Managed tokens, this calls `apply_allowed_minter_updates` + `apply_allowed_burner_updates` (2 txs). The owner retains minting ability — this is additive, not a transfer.

Pass the **pool address** as `--authority`. The SDK automatically resolves the pool's store address (resource signer PDA) internally via `get_store_address` and grants mint/burn to that address.

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

> **Performance note**: `get-mint-burn-info` on FactoryBurnMintERC20 is ~3.5x faster than BurnMintERC20 (direct `getMinters()`/`getBurners()` view functions vs AccessControl role enumeration).

---

## 7. Phase 6: Create Token ALT (Solana only)

Solana requires an Address Lookup Table (ALT) containing 10 base CCIP addresses for the token's pool. This is a prerequisite for `set-pool`.

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

> Include the SPL Multisig via `--additional-addresses` so the router can reference it in `releaseOrMintTokens` transactions. The ALT will contain 11 entries (10 base CCIP + 1 multisig).

Save the ALT address:

```bash
SOLANA_ALT=<base58>
```

---

## 8. Phase 7: Apply Chain Updates (Mesh Configuration)

Configure each pool to know about the remote chains, their tokens, pools, and rate limiters. This creates a mesh where each pool knows how to reach every other pool.

### Configuration File Format

Create a JSON config file for each chain. Each file lists the other 2 chains as remotes.

> **Rate limiter values are in the LOCAL token's smallest unit.** `capacity` is the max tokens in the bucket, `rate` is tokens per second refill. You must scale these values by the local token's decimals:
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

### Apply on Each Chain

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

Check each pool to confirm remote chains, pool addresses, token addresses, and rate limiters are set correctly:

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

Each should show `remotePools`, `remoteToken`, and `outboundRateLimiterState`/`inboundRateLimiterState` with the values from your config files.

### Note: Solana Pool Token ATA (Existing Pools Only)

If you are configuring an **existing** pool (not deployed via this tutorial), the Pool Signer PDA's Associated Token Account (ATA) must exist before inbound transfers. For pools deployed via `ccip-cli pool deploy`, this is created automatically.

```bash
# Only needed for existing pools, NOT for fresh deploys from this tutorial
spl-token create-account $SOLANA_TOKEN \
  --owner <POOL_SIGNER_PDA> \
  --fee-payer ~/.config/solana/id.json \
  --url devnet
```

---

## 9. Phase 8: Set Pool in TokenAdminRegistry

Register the pool in the TokenAdminRegistry, linking token to pool so the CCIP router can route cross-chain messages through it.

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

The `tokenPool` field should now match your pool address. On Solana, also shows `poolLookupTable` and `poolLookupTableEntries`.

---

## 10. Phase 9: Cross-Chain Transfers

With the mesh fully configured, send tokens between chains.

### EVM → Solana

```bash
ccip-cli send \
  -s ethereum-testnet-sepolia \
  -d solana-devnet \
  -r 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  --to <SOLANA_RECIPIENT_ADDRESS> \
  -t $EVM_TOKEN=1.0 \
  --ooo -L 0 -f log
```

### EVM → Aptos

```bash
ccip-cli send \
  -s ethereum-testnet-sepolia \
  -d aptos-testnet \
  -r 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  --to <APTOS_RECIPIENT_ADDRESS> \
  -t $EVM_TOKEN=1.0 \
  --ooo -L 0 -f log
```

### Solana → EVM

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

### Aptos → EVM

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

### Track Message Status

```bash
ccip-cli show <SOURCE_TX_HASH> \
  --rpcs <SOURCE_RPC> \
  --rpcs <DEST_RPC> \
  -f json
```

You can also track on the CCIP Explorer: `https://ccip.chain.link/msg/<MESSAGE_ID>`

### Transfer Flags

| Flag | Description |
|------|-------------|
| `-s` | Source chain name |
| `-d` | Destination chain name |
| `-r` | Router address on source chain |
| `--to` | Recipient address on destination chain |
| `-t` | Token and amount (`<TOKEN_ADDRESS>=<AMOUNT>`) |
| `--ooo` | Out-of-order execution (recommended for testing) |
| `-L 0` | Gas limit 0 (no receiver contract execution) |

### Aptos ↔ Solana

Direct Aptos ↔ Solana lanes may not be configured at the router level on testnet. This is a Chainlink infrastructure limitation, not a code issue. If you get `E_UNSUPPORTED_DESTINATION_CHAIN`, the lane doesn't exist yet. Use EVM as a hub.

---

## 11. Additional Operations

### Append Remote Pool Addresses

Add additional remote pool addresses to an existing chain config (e.g., when a new pool is deployed on a remote chain):

```bash
ccip-cli pool append-remote-pool-addresses \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --remote-chain solana-devnet \
  --remote-pool-addresses <NEW_SOLANA_POOL> \
  -f json
```

### Remove Remote Pool Addresses

```bash
ccip-cli pool remove-remote-pool-addresses \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --remote-chain solana-devnet \
  --remote-pool-addresses <OLD_SOLANA_POOL> \
  -f json
```

### Delete Chain Config

Remove an entire remote chain configuration from a pool:

```bash
ccip-cli pool delete-chain-config \
  -n ethereum-testnet-sepolia \
  --pool-address $EVM_POOL \
  --remote-chain solana-devnet \
  -f json
```

### Set Rate Limiter Config

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

### Revoke Mint/Burn Access

Revoke mint or burn permissions individually:

```bash
ccip-cli token revoke-mint-burn-access \
  -n ethereum-testnet-sepolia \
  -w <hex-private-key> \
  --token-address $EVM_TOKEN \
  --authority $EVM_POOL \
  --role mint \
  --token-type factoryBurnMintERC20 \
  --rpc https://1rpc.io/sepolia \
  -f json
```

### Transfer Admin

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

### Pool Transfer Ownership

**EVM/Solana** — 2-step process:
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

**Aptos** — 3-step process:
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

## 12. Known Issues & Gotchas

### Pool Address Encoding (Fixed)

Remote pool addresses in `applyChainUpdates` must preserve their original byte length:
- **Token addresses**: left-padded to 32 bytes (correct for all chains)
- **Pool addresses**: raw bytes at original length (20 bytes for EVM addresses)

The Solana on-chain program compares incoming `sourcePoolAddress` (20 raw bytes for EVM) against stored pool addresses. If stored as 32 bytes (left-padded), the comparison fails with `InvalidSourcePoolAddress`.

### Solana Mint Authority Transfer

`grant-mint-burn-access` on Solana **transfers** mint authority — your wallet loses direct minting ability. Always create a multisig first (via `create-multisig`) to retain access alongside the pool.

### Aptos 3-Step Ownership Transfer

Unlike EVM/Solana (2-step: propose → accept), Aptos requires 3 steps: propose → accept → execute. The current owner must call `execute-ownership-transfer` after the new owner accepts.

### FactoryBurnMintERC20 vs BurnMintERC20

- **FactoryBurnMintERC20** (used in this guide): Dedicated functions `grantMintRole`/`grantBurnRole`/`revokeMintRole`/`revokeBurnRole`/`getMinters`/`getBurners`. Simpler and ~3.5x faster for `get-mint-burn-info`.
- **BurnMintERC20**: Uses OpenZeppelin `AccessControl` with `bytes32` role hashes. Requires `grantRole`/`revokeRole` with role constants.

Always pass `--token-type factoryBurnMintERC20` for grant/revoke commands when using FactoryBurnMintERC20 tokens.

### Aptos ↔ Solana Direct Lanes

Direct lanes between Aptos Testnet and Solana Devnet may not exist at the router level. This is a Chainlink infrastructure limitation. Use EVM as a hub for Aptos ↔ Solana transfers.

### `show` Command Crash on SVM Destinations

The `show` command crashes when viewing SVM-destination messages because `looksUsdcData()` expects hex `BytesLike` but the CCIP API returns `extraData` as base64 for SVM destinations.

---

## Quick Reference: Complete Flow Checklist

```
For each chain:
  [ ] 1. Deploy token (EVM: FactoryBurnMintERC20, Solana: Token-2022, Aptos: Managed)
  [ ] 2. Mint tokens to wallet
  [ ] 3. Deploy pool (EVM/Solana: BurnMint, Aptos: Managed)
  [ ] 4. Propose admin (token-admin propose-admin)
  [ ] 5. Accept admin (token-admin accept-admin)
  [ ] 6. Grant mint/burn access to pool
       - EVM: --token-type factoryBurnMintERC20
       - Solana: create-multisig first, then grant to multisig
       - Aptos: pass pool address as --authority (SDK auto-resolves store address; additive, owner keeps access)
  [ ] 7. (Solana only) Create Token ALT (include multisig in --additional-addresses)

Cross-chain mesh:
  [ ] 8. Apply chain updates on EACH pool (pointing to all remote chains)
  [ ] 9. Set pool on EACH chain (token-admin set-pool)

Testing:
  [ ] 10. Send cross-chain transfer (EVM↔Solana, EVM↔Aptos)
  [ ] 11. Track message with `show` or CCIP Explorer
```
