# ccip-tools-ts
Typescript CLI and library to interact with CCIP

## Development
In order to run commands/test from this repo, do the following:

```sh
git clone https://github.com/smartcontractkit/ccip-tools-ts
cd ccip-tools-ts
npm install
npx tsx src --help
```

> [!NOTE]
> In dev context below, we'll call `$cli="npx tsx src"`

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

Soon, we'll include a `--wallet` option receiving an encrypted JSON path and prompt user
for its password (or read from an `USER_KEY_PASSWORD` environment variable).

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
$cli manualExec <source_transaction_hash> [--gas-limit num]
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
