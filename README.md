# ccip-tools-ts
Typescript CLI and library to interact with CCIP

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
same as with `show` command above. `--gas-limit` allows to override the exec limit for this message
(in the OffRamp, not transaction, which is always estimated). `gas-limit=0` default re-uses limit
specified in original request.

### `manualExecSenderQueue`

```sh
$cli manualExec <source_transaction_hash> [--gas-limit num] [--[no-]exec-failed]
```

Scans the source network for every request from sender of CCIP messages in given transaction hash,
then scans for their execution state on destination, then try to manually execute every pending
message for that sender.

If `--exec-failed` toggle is provided, also pick any message in failed state.

If more than one sender request is included in each commit, this command can batch them together and
generate proofs to manually execute them in the same transaction.

This command can be slower on low quality RPCs or old messages, since it has to scan source up to
head to discover sender's requests, and dest up to latest successful execution or head, to know all
requests' latest execution state.

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

If `--fee-token` is omitted, CCIP fee will be paid in native token.

`--transfer-tokens` can receive multiple pairs of `0xTokenAddr=amount` (separated by spaces, terminated
with `--` if needed). `amount` will be converted using token decimals (e.g. 0.1 = 10^5 of the
smallest unit for USDC, which is 6 decimals).

`--allow-out-of-order-exec` is only available on v1.5+ lanes, and opt-out of *sender* `nonce` order
enforcement. It's useful for destinations where execution can't be guaranteed (e.g. zkOverflow).

### parseData

```sh
$cli parseData 0xbf16aab6000000000000000000000000779877a7b0d9e8603169ddbd7836e478b4624789

Error: EVM2EVMOnRamp_1.2.0.UnsupportedToken(address)
Args: { token: '0x779877A7B0D9E8603169DdbD7836e478b4624789' }
```

Attempts to parse hex-encoded function call data, error and revert reasons, for our known contracts.
