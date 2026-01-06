---
id: ccip-tools-cli
title: CCIP CLI
sidebar_label: CCIP CLI Overview
sidebar_position: 0
edit_url: https://github.com/smartcontractkit/ccip-tools-ts/edit/main/docs/cli/index.md
---

# CCIP CLI

Command-line interface for interacting with CCIP contracts.

## Installation

**From npm (recommended):**

```bash
npm install -g @chainlink/ccip-cli
ccip-cli --help
```

**Using npx (no install):**

```bash
npx @chainlink/ccip-cli --help
```

**From source (for development):**

```bash
git clone https://github.com/smartcontractkit/ccip-tools-ts
cd ccip-tools-ts
npm install
./ccip-cli/ccip-cli --help
```

:::note Requirements
Node.js v20+ required. v23+ recommended for native TypeScript execution.
:::

## Quick Start

Track the status of a CCIP message:

```bash
# Using public RPCs
ccip-cli show 0xYOUR_TX_HASH \
  -r https://ethereum-sepolia-rpc.publicnode.com \
  -r https://sepolia-rollup.arbitrum.io/rpc
```

## Configuration

### RPC Endpoints

All commands need RPC endpoints for the networks involved. Provide them via:

**Command line** (`-r` or `--rpcs`):
```bash
ccip-cli show 0x... -r https://rpc1.example.com -r https://rpc2.example.com
```

**Environment file** (default: `.env`):
```env
# .env file - any format works, URLs are auto-detected
https://ethereum-sepolia-rpc.publicnode.com
ARB_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc
RPC_AVALANCHE=https://api.avax-test.network/ext/bc/C/rpc
```

**Environment variables:**
```bash
# RPC URLs are auto-detected from any variable containing valid URLs
export RPC_SEPOLIA=https://ethereum-sepolia-rpc.publicnode.com
export ARB_RPC=https://sepolia-rollup.arbitrum.io/rpc
ccip-cli show 0x...
```

The CLI tests all RPCs in parallel and uses the fastest responding endpoint for each network.

### API Configuration

By default, the CLI uses the CCIP API (api.ccip.chain.link) for enhanced functionality like lane latency queries.

**Disable API access (full decentralization mode):**
```bash
ccip-cli show 0x... --no-api
```

**Environment variable:**
```bash
# CCIP_ prefix maps to CLI options
export CCIP_NO_API=true         # Same as --no-api
export CCIP_VERBOSE=true        # Same as --verbose
export CCIP_FORMAT=json         # Same as --format=json
ccip-cli show 0x...
```

### Wallet Configuration

For commands that send transactions:

**Environment variable:**
```bash
export PRIVATE_KEY=0xYourPrivateKey  # Recommended
ccip-cli send ...
```

**Command line:**
```bash
ccip-cli send ... --wallet 0xYourPrivateKey
ccip-cli send ... --wallet /path/to/keystore.json  # EVM encrypted keystore (uses USER_KEY_PASSWORD env or prompts)
ccip-cli send ... --wallet ~/.config/solana/id.json  # Solana keypair file
```

**Hardware wallet:**
```bash
ccip-cli send ... --wallet ledger        # Default derivation path
ccip-cli send ... --wallet ledger:0      # First account
ccip-cli send ... --wallet ledger:1      # Second account
```

### Chain Identifiers

Reference chains by name or selector:

| Chain Family | Format | Example |
|--------------|--------|---------|
| EVM | Chain ID or name | `11155111` or `ethereum-testnet-sepolia` |
| Solana | Genesis hash or name | `solana-devnet` |
| Aptos | `aptos:` prefix | `aptos:2` for testnet |
| Sui | `sui:` prefix | `sui:1` for mainnet |
| TON | Chain ID or name | `ton-mainnet` or `ton-testnet` |

---

## Commands

### show (default)

Track a CCIP message status.

```bash
ccip-cli show <tx_hash> [options]
```

**What it does:**
1. Finds the CCIP message in the source transaction
2. Shows message details (sender, receiver, data, tokens)
3. Checks if the message has been committed (included in a Merkle root) on destination chain
4. Shows execution status (pending, success, or failed) on destination chain

**Options:**
| Option | Description |
|--------|-------------|
| `--log-index <n>` | Select specific message if tx contains multiple |
| `--id-from-source <network>` | Search by messageId instead of txHash (format: `[onRamp@]sourceNetwork`) |
| `--wait` | Wait for message execution on destination chain before returning |

**Example:**
```bash
ccip-cli show 0x1234...abcd

# Wait for execution
ccip-cli show 0x1234...abcd --wait

# Search by messageId
ccip-cli show 0xMessageId --id-from-source ethereum-testnet-sepolia
```

---

### send

Send a cross-chain message.

```bash
ccip-cli send <source> <router> <dest> [options]
```

**Arguments:**
- `source` - Source chain (ID or name)
- `router` - CCIP Router address on source
- `dest` - Destination chain (ID or name)

**Common Options:**
| Option | Alias | Description |
|--------|-------|-------------|
| `--receiver <addr>` | `-R` | Destination address (defaults to sender if same chain family) |
| `--data <hex\|string>` | `-d` | Message payload (auto-encoded if not hex) |
| `--gas-limit <n>` | `-L`, `--compute-units` | Gas limit for receiver's `ccipReceive` callback on destination (default: 0 = ramp default) |
| `--fee-token <addr>` | | Pay fee in ERC20 (default: native token) |
| `--wallet <key\|path>` | `-w` | Wallet private key or keystore path |
| `--wait` | | After sending, wait for message execution on destination chain |

**Token Transfer Options:**
| Option | Alias | Description |
|--------|-------|-------------|
| `--transfer-tokens <token>=<amount>` | `-t` | Transfer tokens (repeatable) |
| `--approve-max` | | Approve max allowance instead of exact amount |

**Estimation Options:**
| Option | Description |
|--------|-------------|
| `--only-get-fee` | Calculate and print the CCIP message fee, then exit without sending |
| `--only-estimate` | Estimate destination chain gas for receiver callback, then exit without sending |
| `--estimate-gas-limit <margin%>` | Auto-estimate with margin (conflicts with `--gas-limit`) |

**Advanced Options:**
| Option | Alias | Description |
|--------|-------|-------------|
| `--allow-out-of-order-exec` | `--ooo` | Allow message to be executed without waiting for prior messages from same sender (v1.5+ lanes, required for some destinations) |

**Solana Destination Options:**
| Option | Description |
|--------|-------------|
| `--token-receiver <addr>` | Solana token receiver address (if different from program receiver) |
| `--account <addr>[=rw]` | Additional accounts for Solana receiver program (repeatable, append `=rw` for writable) |

**Examples:**

```bash
# Simple message from Sepolia to Arbitrum Sepolia
ccip-cli send ethereum-testnet-sepolia \
  0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  ethereum-testnet-sepolia-arbitrum-1 \
  --receiver 0xYourAddress \
  --data "Hello CCIP"

# Transfer tokens
ccip-cli send 11155111 \
  0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
  ethereum-testnet-sepolia-arbitrum-1 \
  --transfer-tokens 0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05=0.1

# Just get the fee
ccip-cli send 11155111 0x0BF3... arbitrum-sepolia --only-get-fee
```

---

### manualExec

Manually execute a stuck message on the destination chain.

```bash
ccip-cli manualExec <tx_hash> [options]
```

**When to use:**
- Message is committed but not executed
- Automatic execution failed
- Need to retry with different gas settings

**Common Options:**
| Option | Alias | Description |
|--------|-------|-------------|
| `--log-index <n>` | | Select specific message if source tx contains multiple CCIP messages |
| `--gas-limit <n>` | `-L`, `--compute-units` | Override gas limit for receiver's `ccipReceive` callback (0 = use original from source tx) |
| `--tokens-gas-limit <n>` | | Override gas limit for token pool `releaseOrMint` calls |
| `--estimate-gas-limit <margin%>` | | Auto-estimate receiver callback gas with % safety margin (conflicts with `--gas-limit`) |
| `--wallet <key\|path>` | `-w` | Wallet private key or keystore path |

**Batch Execution:**
| Option | Description |
|--------|-------------|
| `--sender-queue` | Execute all messages from same sender that are pending on destination chain (default: false) |
| `--exec-failed` | Also re-execute previously failed messages, not just pending ones (requires `--sender-queue`) |

**Solana-Specific:**
| Option | Description |
|--------|-------------|
| `--force-buffer` | Split large message into chunks sent to a buffer account before execution |
| `--force-lookup-table` | Create an address lookup table to fit more accounts in transaction |
| `--clear-leftover-accounts` | Clean up buffer accounts or lookup tables from previous aborted attempts |

**Example:**

```bash
# Retry with higher gas
ccip-cli manualExec 0x1234...abcd --gas-limit 500000

# Execute all pending messages from a sender
ccip-cli manualExec 0x1234...abcd --sender-queue

# Solana message that's too large
ccip-cli manualExec <tx_hash> --force-buffer --clear-leftover-accounts
```

---

### parse

Decode CCIP-related data, errors, and revert reasons.

```bash
ccip-cli parse <hex_data>
```

**Example:**
```bash
ccip-cli parse 0xbf16aab6000000000000000000000000779877a7b0d9e8603169ddbd7836e478b4624789

# Output:
# Error: EVM2EVMOnRamp_1.2.0.UnsupportedToken(address)
# Args: { token: '0x779877A7B0D9E8603169DdbD7836e478b4624789' }
```

---

### getSupportedTokens

List tokens supported for transfer on a lane.

```bash
ccip-cli getSupportedTokens <source> <address> [token]
```

**Arguments:**
- `source` - Source chain (ID or name)
- `address` - Router, OnRamp, TokenAdminRegistry, or TokenPool address
- `token` - (Optional) Pre-select a specific token from the list

**Examples:**

```bash
# List all supported tokens from a router
ccip-cli getSupportedTokens ethereum-mainnet 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D

# Get details for a specific token
ccip-cli getSupportedTokens ethereum-mainnet 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

# Query token pool directly
ccip-cli getSupportedTokens ethereum-mainnet 0xTokenPoolAddress
```

---

### laneLatency

Query estimated lane latency between source and destination chains.

```bash
ccip-cli lane-latency <source> <dest> [options]
```

**Arguments:**
- `source` - Source chain (chainId, selector, or name)
- `dest` - Destination chain (chainId, selector, or name)

**Options:**
| Option | Description |
|--------|-------------|
| `--api-url <url>` | Custom CCIP API URL (defaults to api.ccip.chain.link) |

**Example:**
```bash
# Check latency between Ethereum and Arbitrum
ccip-cli lane-latency ethereum-mainnet arbitrum-mainnet

# Using chain selectors
ccip-cli lane-latency 5009297550715157269 4949039107694359620

# With custom API endpoint
ccip-cli lane-latency ethereum-mainnet polygon-mainnet --api-url https://custom-api.example.com
```

**Note:** This command requires CCIP API access. It will fail if `--no-api` flag is used.

---

### chains

List and lookup CCIP chain configuration including router addresses.

```bash
ccip-cli chains [identifier] [options]
```

**Arguments:**
- `identifier` - (Optional) Chain name, chainId, or selector to lookup

**Options:**
| Option | Alias | Description |
|--------|-------|-------------|
| `--family <type>` | | Filter by chain family: `evm`, `solana`, `aptos`, `sui`, `ton` |
| `--mainnet` | | Show only mainnets |
| `--testnet` | | Show only testnets |
| `--ccip-only` | | Show only CCIP-enabled chains (with router addresses) |
| `--search <term>` | `-s` | Fuzzy search chains by name |
| `--interactive` | `-i` | Interactive mode with type-ahead filtering |
| `--json` | | Output as JSON for scripting |
| `--field <name>` | | Output only a specific field value |
| `--count` | | Show count summary only |

**Examples:**

```bash
# List all chains
ccip-cli chains

# List EVM mainnets with CCIP routers
ccip-cli chains --family evm --mainnet --ccip-only

# Lookup a specific chain
ccip-cli chains ethereum-mainnet
ccip-cli chains 1                    # by EVM chainId
ccip-cli chains 5009297550715157269  # by selector

# Fuzzy search (typo-tolerant)
ccip-cli chains --search "arbtrum"   # finds "arbitrum"

# Interactive mode - browse and select
ccip-cli chains -i

# Get just the router address for scripting
ROUTER=$(ccip-cli chains ethereum-mainnet --field router)

# JSON output for processing
ccip-cli chains --json --family evm --mainnet | jq '.[].router'

# Count CCIP-enabled chains
ccip-cli chains --count --ccip-only
```

---

## Output Formats

| Format | Use Case |
|--------|----------|
| `--format=pretty` | Human-readable tables (default) |
| `--format=log` | Detailed console logging |
| `--format=json` | Machine-readable JSON |

```bash
# Get JSON output for scripting
ccip-cli show 0x... --format=json | jq '.messageId'
```

---

## Troubleshooting

### "Transaction not found"

**Cause:** RPC doesn't have the transaction or it's still pending.

**Solutions:**
- Wait for transaction confirmation
- Verify you're using an RPC for the correct network
- Try a different RPC endpoint

### "No RPC available for network"

**Cause:** Missing RPC for source or destination chain.

**Solutions:**
- Add the missing RPC via `-r` flag or `.env` file
- Check the network name/selector is correct

### "Execution reverted"

**Cause:** The receiver contract reverted during `ccipReceive`.

**Solutions:**
- Use `ccip-cli parse <error_data>` to decode the error
- Check receiver contract has sufficient gas limit
- Verify receiver contract logic

### "Message not committed"

**Cause:** Message hasn't been included in a commit report yet.

**Solutions:**
- Wait for the commit (typically 5-20 minutes)
- Verify destination chain RPC is working
- Check if there are network delays

### Solana: "Transaction too large"

**Cause:** Message payload or accounts exceed transaction size limits.

**Solutions:**
```bash
# Use a buffer account for large payloads
ccip-cli manualExec <tx> --force-buffer

# Use lookup table for many accounts
ccip-cli manualExec <tx> --force-lookup-table
```

---

## Next Steps

- [SDK Documentation](../sdk/) - Integrate CCIP in your code
- [CCIP Directory](https://docs.chain.link/ccip/directory) - Find router addresses
- [Contributing](../contributing/) - Help improve the tools
