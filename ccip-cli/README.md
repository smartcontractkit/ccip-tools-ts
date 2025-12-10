# @chainlink/ccip-cli

## Typescript CLI to interact with CCIP.

This tool can be used to query and interact with [CCIP](https://ccip.chain.link) contracts deployed
in supported blockchains, through its publicly accessible data and methods, requiring only
compatible RPCs for each involved network.

> [!IMPORTANT]
> This tool is provided under an MIT license and is for convenience and illustration purposes only.

## Installation

To install it from latest NpmJS release, do:

```sh
npm install -g @chainlink/ccip-cli
ccip-cli --help
# or
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

> [!NOTE]
> NodeJS version v20+ is required, with v23+ recommended.
> When running from local folder, it'll try to execute the [src](./src/index.ts) script directly,
> without an explicit transpilation step. NodeJS v23+ can run `.ts` files directly, while older
> versions are run with [tsx](https://tsx.is/).

## RPCs

All commands require a list of RPCs endpoints for the networks of interest (source and destination).
Both `http[s]` and `ws[s]` (websocket) URLs are supported.

This list can be passed in the command line, through the `-r/--rpcs` option; it may be passed
multiple times, e.g. `-r <source_rpc> -r <dest_rpc>`, and are merged with those fetched from the
rpcs file (`--rpcs-file`, default=`./.env`), which may contain multiple endpoints, one per line,
with any prefix or suffix (only URLs are parsed).

The default filename is just for compatibility with previous tools, and isn't required to be an
actual env file. `.txt`, `.csv` or `.json` arrays should work out of the box.

Example `.env` file:

```
https://eth-sepolia.g.alchemy.com/v2/demo
ARB_SEPOLIA_RPC: https://arbitrum-sepolia.drpc.org
RPC_AVALANCHE_TESTNET=https://avalanche-fuji-c-chain-rpc.publicnode.com
https://api.devnet.solana.com  # solana devnet public rpc
https://api.testnet.aptoslabs.com/v1  // `testnet` only would also work
```

Environment variables starting with `RPC_` are also ingested. Suffix is not relevant.

Once the list is gathered, CLI connects to all RPCs in parallel on startup and uses the fastest
to reply for each network.

## Wallet

Commands which need to send transactions try to get a private key from a `USER_KEY` environment
variable.

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

Where required, networks can be referred by name or selector from [chain-selectors](https://github.com/smartcontractkit/chain-selectors).
ChainIDs follow this pattern:

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

### `show` (default command)

```sh
ccip-cli [show] <request_transaction_hash> [--log-index num]
```

Receives a transaction containing a `CCIPSendRequested` (<=v1.5) or `CCIPMessageSent` (>=1.6) event.
Try every available RPC and uses first network to respond with this transaction.

If more than one CCIP  messagerequest is present in this transaction, the user is prompted to select
one form a list, with some basic info on the screen.
The `--log-index` option allows to pre-select a request non-interactively.

If an RPC for dest is also available, scans for the CommitReport for this request, and Execution
Receipts until a `success` receipt or latest block is hit.

### `manualExec`

```sh
ccip-cli manualExec <request_transaction_hash> [--gas-limit num] [--tokens-gas-limit num]
```

Try to manually execute the message in source transaction. If more than one found, user is prompted
same as with `show` command above.

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

#### Example
```sh
ccip-cli manualExec 0xafd36a0b99d5457e403c918194cb69cd070d991dcbadc99576acfce5020c0b6b \
  --wallet ledger \
  --compute-units 500000 \
  --force-buffer \
  --clear-leftover-accounts
```

### `send`

```sh
ccip-cli send 11155111 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 ethereum-testnet-sepolia-arbitrum-1 \
    --receiver 0xAB4f961939BFE6A93567cC57C59eEd7084CE2131 \
    --data 'hello world' \
    --gas-limit 300000 \
    --fee-token 0x779877A7B0D9E8603169DdbD7836e478b4624789 \
    --transfer-tokens 0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05=0.1
```

Sends a message from router on source network, to dest; positional parameters are:

1. `source`: chainId or name
2. `router`: address on source
3. `dest`: chainId or name

If `--receiver` is omitted, sends to self (sender, see [Wallet](#wallet) section above) address on
dest, if to same chain family (e.g. EVM-to-EVM). If not same chain family, it is mandatory.

If `--data` is not a hex-string, it will be UTF-8 encoded.

If `--gas-limit` is omitted, ramp default config (usually 200k) is used.
It can be `0` to disable execution on receiver.
`--estimate-gas-limit` can be provided instead, to estimate the gas limit for the message execution.
It receives a percentage margin (e.g. `--estimate-gas-limit=10` for +10% margin), which is added to
the estimation before sending the message.
`--only-estimate` prints gas estimation then exits.

If `--fee-token` is not provided, CCIP fee will be paid in native token.
`--only-get-fee` prints CCIP fee then exits.

`--transfer-tokens` can receive multiple pairs of `0xTokenAddr=amount` (source token addresses,
separated by spaces, terminated with `--` if needed). `amount` will be converted using token
decimals (e.g. 0.1 = 10^5 of the smallest unit for USDC, which is 6 decimals).

`--allow-out-of-order-exec` (`--ooo`) is only available on v1.5+ lanes, and opt-out of _sender_
`nonce` order enforcement. It's useful for destinations where execution can't be guaranteed
(e.g. zkOverflow), and required for many destinations.

`--approve-max` will approve the maximum possible amount of tokens, if approval is needed for
either transfer or fee tokens. Default behavior is to approve the strictly needed allowance.

### `parse`

```sh
ccip-cli parse 0xbf16aab6000000000000000000000000779877a7b0d9e8603169ddbd7836e478b4624789

Error: EVM2EVMOnRamp_1.2.0.UnsupportedToken(address)
Args: { token: '0x779877A7B0D9E8603169DdbD7836e478b4624789' }
```

Attempts to parse hex-encoded function call data, error and revert reasons, for our known contracts.

It'll recursively try to decode `returnData` and `error` arguments.

### `getSupportedTokens`

```sh
ccip-cli getSupportedTokens <source> <router>  # lists supported tokens
ccip-cli getSupportedTokens <source> <router> [token]  # show token and pool details for this token
ccip-cli getSupportedTokens <source> <tokenPool>  # same as above, for the pool directly
```

Source is the network to be queried, as chainID or name.
If a CCIP `router` address is provided as second parameter, lists all the tokens and its information
supported in that lane. Type to filter the list.  

If `token` address is supported as 3rd parameter, pre-selects the token in the list.

If `tokenPool` address is provided as 2nd parameter, uses it the same as if having provided
router + token addresses.

In any case, details of the TokenPool and Token will be printed, including all connected remote
chains and its rate limits state.

#### Example

```sh
# Check tokens supported for transfer from Ethereum to Polygon
ccip-cli getSupportedTokens ethereum-mainnet 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D
```

#### Output Format Options

- `--format pretty` (default): Human-readable output
- `--format log`: Basic console logging
- `--format json`: Machine-readable JSON
