# ccip-tools-ts

## Typescript CLI and library to interact with CCIP.

This tool can be used to query and interact with [CCIP](https://ccip.chain.link) contracts deployed
in supported blockchains, through its publicly accessible data and methods.

> [!IMPORTANT]
> This tool is provided under an MIT license and is for convenience and illustration purposes only.

## Development
In order to run commands/test from this repo, do the following:

```sh
git clone https://github.com/smartcontractkit/ccip-tools-ts
cd ccip-tools-ts
npm install
./src/index.ts --help  # tsx shebang available
# or
npm run build
./dist/ccip-tools-ts --help  # node shebang script
npx path/to/repo/ccip-tools-ts --help  # or pointing to folder directly
```

> [!NOTE]
> In dev context below, we'll call `$cli="./src/index.ts"`

## RPCs
All commands require a list of RPCs endpoints for the networks of interest (source and destination).
Both `http[s]` and `ws[s]` (websocket) URLs are supported.

This list can be passed in the command line, through the `-r/--rpcs` option, and are merged with
those fetched from the rpcs file (`--rpcs-file`, default=`./.env`), which may contain multiple
endpoints, one per line, with any prefix or suffix (i.e. environment files from other tools work,
but environment variable names are ignored and only the URLs are used); .txt, .csv or even .json
arrays should work out of the box.

Once the list is gathered, we connect to all RPCs and use the fastest to reply for each network.

## Wallet
Commands which need to send transactions try to get its private key from a `USER_KEY` environment
variable.

An encrypted wallet json can also be passed to `--wallet` option. It'll be decrypted with password
from `USER_KEY_PASSWORD` environment variable, or interactively prompted if not set.

## Quick command reference:

### `show` (default command)

```sh
$cli [show] <source_transaction_hash> [--log-index num]
```

No need to specify the source (network, chainId, chainSelector). This command try every available
RPC and uses any network which respond for this transaction hash.

If more than one CCIP message is present on this transaction, the user is asked for which they want
to know more, with some basic info in the screen. The `--log-index` option allows to specify that
log index non-interactively.

If an RPC for dest is also available, we scan for the CommitReport for this request, and Execution
Receipts until a `success` receipt or head is hit.

### `manualExec`

```sh
$cli manualExec <source_transaction_hash> [--gas-limit num] [--tokens-gas-limit num]
```

Try to manually execute the message in source transaction. If more than one found, user is prompted
same as with `show` command above.

`--gas-limit` allows to override the exec limit for this message (in the OffRamp, not transaction,
which is always estimated). `--gas-limit=0` default re-uses limit specified in original request.

`--tokens-gas-limit` allows to override the gas limit for the token pool operations, if any.

`--estimate-gas-limit` option will try to estimate automatically the gas limit moverride for the
message execution, based on the current state of the network. That's only for main `ccipReceive`
exec callback. Tokens gas limit override estimation is not supported.

`--sender-queue` opts into collecting all following messages from the same sender, starting from
the provided message, and executing all of the eligible ones. By default, only pending
(non-executed) messages are included. `--exec-failed` includes failed messages as well. This option
can take some time, specially for older messages, as it needs to scan the source and dest networks
since request, to find messages and their execution state.

### `send`

```sh
$cli send 11155111 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 ethereum-testnet-sepolia-arbitrum-1 \
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

If `--receiver` is omitted, sends to self (sender) address on dest (see [Wallet](#wallet) section
above).

If `--data` is not a hex-string, it will be UTF-8 encoded.

If `--gas-limit` is omitted, ramp default config (usually 200k) is used. It can be `0`.
`--estimate-gas-limit` can be provided instead, to estimate the gas limit for the message execution.
It receives a percentage margin (e.g. `--estimate-gas-limit 10` for 10% margin), which is added to
the estimation before sending the message.

If `--fee-token` is omitted, CCIP fee will be paid in native token.

`--transfer-tokens` can receive multiple pairs of `0xTokenAddr=amount` (source token addresses,
separated by spaces, terminated with `--` if needed). `amount` will be converted using token
decimals (e.g. 0.1 = 10^5 of the smallest unit for USDC, which is 6 decimals).

`--allow-out-of-order-exec` is only available on v1.5+ lanes, and opt-out of *sender* `nonce` order
enforcement. It's useful for destinations where execution can't be guaranteed (e.g. zkOverflow).

### `estimateGas`

```sh
$cli estimateGas 11155111 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59 ethereum-testnet-sepolia-arbitrum-1 \
    --receiver 0xAB4f961939BFE6A93567cC57C59eEd7084CE2131 \
    --sender 0xEC1062cbDf4fBf31B3A6Aac62B6F6F123bb70E12 \
    --transfer-tokens 0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05=0.1
```

Estimates gas for a message, same as `send` command, but doesn't send it, and just prints the
minimum CCIP `gasLimit` required for the execution to be successful.

### parseBytes

```sh
$cli parseBytes 0xbf16aab6000000000000000000000000779877a7b0d9e8603169ddbd7836e478b4624789

Error: EVM2EVMOnRamp_1.2.0.UnsupportedToken(address)
Args: { token: '0x779877A7B0D9E8603169DdbD7836e478b4624789' }
```

Attempts to parse hex-encoded function call data, error and revert reasons, for our known contracts.

If `--selector <sel>` is provided, which receives Error, Function or Event names, 4-bytes for
Error or Function selectors, or 32-bytes for Events topic0/topicHash, it'll try to decode as that
specific fragment. To decode events, this is required, and `data` is parsed as the non-indexed
event arguments only.

If `--selector` is not provided, the first 4-bytes will be used as Error or Function selector, and
the rest as `data`.

It'll recursively try to decode `returnData` and `error` arguments.

### `lane`

```sh
$cli lane lane ethereum-mainnet 0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D avalanche-mainnet
```

Prints lane, OnRamp and OffRamp configurations for the specified lane.

If 3rd argument is omitted, 2nd argument (address) should be an OnRamp address.

Also, performs some validations and warns in case of some mistmatches, e.g. OnRamp is not
registered in Router.
