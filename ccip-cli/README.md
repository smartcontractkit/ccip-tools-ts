# @chainlink/ccip-cli

## TypeScript CLI to interact with CCIP

This tool can be used to query and interact with [CCIP](https://ccip.chain.link) contracts deployed
in supported blockchains, through its publicly accessible data and methods, requiring only
compatible RPCs for each involved network.

> [!IMPORTANT]
> This tool is provided under an MIT license and is for convenience and illustration purposes only.

📖 **[Full Documentation](https://docs.chain.link/ccip/tools/cli/)** - Complete command reference, all options, and troubleshooting guide.

## Installation

To install it from latest NpmJS release, do:

```sh
npm install -g @chainlink/ccip-cli
ccip-cli --help
```

To run it directly with NPX, do:
```
npx @chainlink/ccip-cli --help
```

Or run it directly from github or a local clone of the repo (useful for local development):

```sh
git clone https://github.com/smartcontractkit/ccip-tools-ts
cd ccip-tools-ts
npm install  # install dependencies
./ccip-cli/ccip-cli --help  # shell script to run `./ccip-cli/src/index.ts`
alias ccip-cli="$PWD/ccip-cli/ccip-cli"  # optional, to run from local repo directly from anywhere
```

> [!NOTE]
> In dev context below, we'll assume you are on `ccip-cli` folder.


## RPCs

All commands require a list of RPCs endpoints for the networks of interest (source and destination).
Both `http[s]` and `ws[s]` (websocket) URLs are supported.

This list can be passed in the command line, through the `--rpc/--rpcs` option; it may be passed
multiple times, e.g. `--rpc <source_rpc> --rpc <dest_rpc>`, and are merged with those fetched from the
rpcs file (`--rpcs-file`, default=`./.env`), which may contain multiple endpoints, one per line,
with any prefix or suffix (only URLs are parsed).

The default filename is just for compatibility with previous tools, and isn't required to be an
actual env file. `.txt`, `.csv` or `.json` arrays should work out of the box.


> [!IMPORTANT]
> We recommend .env files.  Do not upload RPCs with your API secrets in the URL to source countrol like github.

Example `.env` file:

```
https://ethereum-sepolia-rpc.publicnode.com
ARB_SEPOLIA_RPC: https://arbitrum-sepolia.drpc.org
RPC_AVALANCHE_TESTNET=https://avalanche-fuji-c-chain-rpc.publicnode.com
https://api.devnet.solana.com  # solana devnet public rpc
https://api.testnet.aptoslabs.com/v1  // `testnet` only would also work
```

Environment variables starting with `RPC_` are also ingested. Suffix is not relevant.

Once the list is gathered, CLI connects to all RPCs in parallel on startup and uses the fastest
to reply for each network.

## Wallet

Commands which need to send transactions try to get a private key from a `PRIVATE_KEY` environment
variable. Alternative names `USER_KEY` and `OWNER_KEY` are also supported (checked in that order).

Wallet options can also be passed as `--wallet`, where each chain family may interpret it however it
can:
- EVM can receive a 0x-hex private key, or the path to an encrypted json file (e.g. from geth,
decrypted using the `USER_KEY_PASSWORD` environment variable or prompted password).
- Solana can receive base58 private key, or the path to an `id.json` file
(default=`~/.config/solana/id.json`) containing a private key encoded as a json array of numbers.
- Aptos can receive 0x-hex private key string, or the path of a text file containing it.

Additionally, `--wallet ledger` (or `--wallet "ledger:<derivationPath>"`) can be used to connect to
a Ledger USB device. The derivation path defaults to Ledger Live derivations on each supported
network, and passing an index selects an account of this derivation:
E.g. `--wallet ledger:1` uses derivation `m/44'/60'/1'/0/0` for EVM accounts

## Chain names and selectors

Where required, networks can be referred by ChainID, name or selector from [chain-selectors](https://github.com/smartcontractkit/chain-selectors).
ChainIDs depend on the chain family and must be passed using this pattern:

- `EVM`: numeric chain id; e.g. `1` for `ethereum-mainnet`.
- `Solana`: genesis hash; e.g. `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` for `solana-mainnet`
- `Aptos`, `Sui`: numeric chain id, prefixed with chain family and colon: e.g `aptos:1` for `aptos-mainnet`

## Quick command reference:

### Common options

- `-v`: Verbose/debug output
- `--format=pretty` (default): Human-readable tabular output
- `--format=log`: Basic console logging, may show some more details (e.g. token addresses)
- `--format=json`: Machine-readable JSON
- `--page=10000`: limits `eth_getLogs` (and others) pagination/scanning ranges (e.g. for RPCs which
don't support large ranges)
- `--no-api`: Disable CCIP API integration (fully decentralized mode, RPC-only)
- `--api=<url>`: Use a custom CCIP API URL instead of the default `api.ccip.chain.link`

**Environment variable prefix:** All CLI options can be set via environment variables using the
`CCIP_` prefix. For example:
- `CCIP_API=false` → same as `--no-api`
- `CCIP_API=https://custom-api.example.com` → same as `--api=https://custom-api.example.com`
- `CCIP_VERBOSE=true` → same as `--verbose`
- `CCIP_FORMAT=json` → same as `--format=json`

### `send`

```sh
ccip-cli send \
    --source ethereum-testnet-sepolia \
    --dest ethereum-testnet-sepolia-arbitrum-1 \
    --router 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 \
    --receiver 0xAB4f961939BFE6A93567cC57C59eEd7084CE2131 \
    --data 'hello world' \
    --gas-limit 300000 \
    --fee-token 0x779877A7B0D9E8603169DdbD7836e478b4624789 \
    --transfer-tokens 0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05=0.1
```

Sends a CCIP message from source to destination chain.

**Required options:**

| Option | Alias | Description |
|--------|-------|-------------|
| `--source` | `-s` | Source chain (chainId, selector, or name) |
| `--dest` | `-d` | Destination chain (chainId, selector, or name) |
| `--router` | `-r` | Router contract address on source |

**Message options:**

| Option | Alias | Description |
|--------|-------|-------------|
| `--receiver` | `--to` | Receiver address; defaults to sender if same chain family |
| `--data` | | Data payload (non-hex = UTF-8 encoded) |
| `--gas-limit` | `-L` | Gas limit for receiver callback (default: ramp config) |
| `--estimate-gas-limit` | | Auto-estimate with % margin; conflicts with `--gas-limit` |
| `--allow-out-of-order-exec` | `--ooo` | Skip sender nonce enforcement (v1.5+ lanes) |

**Token options:**

| Option | Alias | Description |
|--------|-------|-------------|
| `--fee-token` | | Pay fee in ERC20 (default: native token) |
| `--transfer-tokens` | `-t` | Token transfers as `token=amount` (e.g., `0xToken=0.1`) |
| `--approve-max` | | Approve max allowance instead of exact |

**Utility options:**

| Option | Alias | Description |
|--------|-------|-------------|
| `--only-get-fee` | | Print fee and exit |
| `--only-estimate` | | Print gas estimate and exit (requires `--estimate-gas-limit`) |
| `--wait` | | Wait for execution on destination |
| `--wallet` | `-w` | Wallet (ledger[:index] or private key) |

**Solana/Sui options:**

| Option | Description |
|--------|-------------|
| `--token-receiver` | Solana token receiver if different from program |
| `--account` | Solana accounts (append `=rw` for writable) or Sui object IDs |

### `show` (default command)

```sh
ccip-cli [show] <tx_hash_or_message_id> [--log-index num] [--wait]
```

Accepts a transaction hash or CCIP message ID (both are 32-byte hex strings). When given a tx hash,
it looks for `CCIPSendRequested` (<=v1.5) or `CCIPMessageSent` (>=1.6) events in the transaction,
trying every available RPC and using the first network to respond. When the CCIP API is enabled
(default), it also tries to look up the input as a message ID via the API; whichever resolves first
wins.

If more than one CCIP message request is present in a transaction, the user is prompted to select
one from a list, with some basic info on the screen.
The `--log-index` option allows to pre-select a request non-interactively.

`--wait` watches for execution on the destination chain instead of exiting after showing current state.

If an RPC for dest is also available, scans for the CommitReport for this request, and Execution
Receipts until a `success` receipt or latest block is hit.

### `manual-exec`

```sh
ccip-cli manual-exec <request_transaction_hash> [--log-index num] [--gas-limit num] [--tokens-gas-limit num] [--wallet wallet]
```

Try to manually execute the message in source transaction. If more than one found, user is prompted
same as with `show` command above. `--log-index` allows pre-selecting a message non-interactively.

`--gas-limit` (aliases `-L`, `--compute-units`) allows to override the exec limit for this message
(in the OffRamp, not transaction, which is always estimated). `--gas-limit=0` default re-uses limit
specified in original request.

`--tokens-gas-limit` allows to override the gas limit for the token pool operations, if any.

`--estimate-gas-limit` option will try to estimate automatically the gas limit override for the
message execution, based on the current state of the network. That's only for main `ccipReceive`
exec callback. Tokens gas limit override estimation is not supported for estimation.

`--sender-queue` opts into collecting all following messages from the same sender, starting from
the provided message, and executing all of the eligible ones. By default, only pending
(non-executed) messages are included. `--exec-failed` includes failed messages as well. This option
can take some time, specially for older messages, as it needs to scan the source and dest networks
since request, to find messages and their execution state.

#### Solana Special Cases

`--force-buffer` to force using a buffer for messages too large to fit in a single transaction

`--force-lookup-table` creates a lookup table for all the accounts used in the message, to fit in
the transaction.

If a solana message fails serialization, it's recommended to try with buffer first, then with lookup
table. The former gets auto-cleared upon successful execution, while the latter needs a grace period
to be cleared.
`--clear-leftover-accounts` can be used to scan and wait for the accounts to be cleared, after exec.

#### Sui Special Cases

`--receiver-object-ids` specifies receiver object IDs required for Sui execution (e.g., `--receiver-object-ids 0xabc... 0xdef...`).

#### Example
```sh
ccip-cli manual-exec 0xafd36a0b99d5457e403c918194cb69cd070d991dcbadc99576acfce5020c0b6b \
  --wallet ledger \
  --compute-units 500000 \
  --force-buffer \
  --clear-leftover-accounts
```


### `parse`

```sh
ccip-cli parse 0xbf16aab6000000000000000000000000779877a7b0d9e8603169ddbd7836e478b4624789

Error: EVM2EVMOnRamp_1.2.0.UnsupportedToken(address)
Args: { token: '0x779877A7B0D9E8603169DdbD7836e478b4624789' }
```

Attempts to parse function call data, error and revert reasons for CCIP contracts. Supports hex (EVM), base64 (Solana), and other chain-specific formats.

It'll recursively try to decode `returnData` and `error` arguments.

### `get-supported-tokens`

```sh
ccip-cli get-supported-tokens --network <network> --address <address> [--token <token>]
```

List supported tokens in a given Router/OnRamp/TokenAdminRegistry, or show info about a specific token/pool.

**Required options:**

| Option | Alias | Description |
|--------|-------|-------------|
| `--network` | `-n` | Source network: chainId or name |
| `--address` | `-a` | Router/OnRamp/TokenAdminRegistry/TokenPool contract address |

**Optional:**

| Option | Alias | Description |
|--------|-------|-------------|
| `--token` | `-t` | Token address to query (pre-selects from list if address is a registry) |
| `--fee-tokens` | | List fee tokens instead of transferable tokens |

#### Examples

```sh
# List all supported tokens from a router
ccip-cli get-supported-tokens -n ethereum-mainnet -a 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D

# Get details for a specific token
ccip-cli get-supported-tokens -n ethereum-mainnet -a 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D -t 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

# Query a token pool directly
ccip-cli get-supported-tokens -n ethereum-mainnet -a 0xTokenPoolAddress
```

#### Output Format Options

- `--format pretty` (default): Human-readable output
- `--format log`: Basic console logging
- `--format json`: Machine-readable JSON

### `token`

```sh
ccip-cli token --network <network> --holder <address> [--token <token>]
```

Query native or token balance for an address.

**Required options:**

| Option | Alias | Description |
|--------|-------|-------------|
| `--network` | `-n` | Network: chainId or name (e.g., ethereum-mainnet, solana-devnet) |
| `--holder` | `-H` | Wallet address to query balance for |

**Optional:**

| Option | Alias | Description |
|--------|-------|-------------|
| `--token` | `-t` | Token address (omit for native token balance) |

#### Examples

```sh
# Native ETH balance
ccip-cli token -n ethereum-mainnet -H 0x1234...abcd

# ERC-20 token balance
ccip-cli token -n ethereum-mainnet -H 0x1234...abcd -t 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

# Solana native SOL balance
ccip-cli token -n solana-devnet -H EPUjBP3Xf76K1VKsDSc6GupBWE8uykNksCLJgXZn87CB
```

### `lane-latency`

```sh
ccip-cli lane-latency <source> <dest> [--api=<url>]
```

Query real-time lane latency between source and destination chains using the CCIP API.

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<source>` | Source network (chainId, selector, or name) |
| `<dest>` | Destination network (chainId, selector, or name) |

**Options:**

| Option | Description |
|--------|-------------|
| `--api` | Custom CCIP API URL (default: https://api.ccip.chain.link) |

> **Note:** This command requires CCIP API access and respects the `--no-api` flag.

#### Example

```sh
ccip-cli lane-latency ethereum-mainnet arbitrum-mainnet
```

## Supported Chains

| Chain Family | Status | Notes |
|--------------|--------|-------|
| EVM | Supported | Full functionality |
| Solana | Supported | Full functionality |
| Aptos | Supported | Full functionality |
| Sui | Partial | Manual execution only |
| TON | Partial | No token pool/registry queries |

## Related

- [CLI Documentation](https://docs.chain.link/ccip/tools/cli/) - Full CLI documentation
- [@chainlink/ccip-sdk](https://www.npmjs.com/package/@chainlink/ccip-sdk) - TypeScript SDK
- [CCIP Official Docs](https://docs.chain.link/ccip) - Protocol documentation
- [CCIP Directory](https://docs.chain.link/ccip/directory) - Router addresses
