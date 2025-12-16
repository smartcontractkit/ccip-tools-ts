# @chainlink/ccip-sdk

## Typescript SDK to interact with CCIP.

This tool can be used to query and interact with [CCIP](https://ccip.chain.link) contracts deployed
in supported blockchains, through its publicly accessible data and methods, requiring only
compatible RPCs for each involved network.

> [!IMPORTANT]
> This tool is provided under an MIT license and is for convenience and illustration purposes only.

## Installation

To install it from latest NpmJS release, do:

```sh
npm install @smartcontractkit/ccip-sdk
```

> [!NOTE]
> NodeJS version v20+ is required, with v23+ recommended.

## Chain

The [Chain](./src/chain.ts) abstract class provides the specification of an interface which must be
implemented to provide support for a given chain family. Static methods are required by the
`ChainStatic` interface, and are used for functions that don't require an instance or provider.

Currently, there are implementations for:
- [EVM](./src/evm/index.ts): uses [ethers.js](https://docs.ethers.org/v6/)
- [Solana](./src/solana/index.ts): uses [solana-web3.js](https://github.com/solana-foundation/solana-web3.js) and [Anchor](https://github.com/solana-foundation/anchor)
- [Aptos](./src/aptos/index.ts): uses [aptos-ts-sdk](https://github.com/aptos-labs/aptos-ts-sdk)

We try to not expose or require users to comply with these libraries, returning generic values and
errors, but some factories may receive specific providers types.

The Chain class defines some methods, which can be overriden by specific families to offer optimized
implementations. One can extend any of the subclasses and get them registered in the
[supportedChains](./src/supported-chains.ts) mapping, or even construct directly.

```ts
import { SolanaChain, supportedChains, ChainFamily } from '@chainlink/ccip-sdk'
class MySolanaChain extends SolanaChain {
  // ...custom implementation
}
supportedChains[ChainFamily.Solana] = MySolanaChain
```

## Async constructors

Each chain family class has an static async constructor, which can be used to create a new instance
of the chain class with a provider. The only common/required signature is
`fromUrl(url: string): Promise<Chain>`, but each chain family class usually also provides a
constructor from the specific library provider (e.g. `EVMChain.fromProvider(provider: ethers.JsonRpcApiProvider)`)

## Wallet

Transaction-sending high-level methods, namely `Chain.sendMessage` and `Chain.executeReport`,
require a `wallet` property in last `opts` parameter. This is marked as `unknown` in generic Chain
abstract class, but required to be an asynchronous signer wallet respective to each chain family:

- `EVMChain` requires an `ethers` `Signer`
- `SolanaChain` requires an `anchor` `Wallet`
- `AptosChain` requires an `aptos-ts-sdk` `Account`

These signers are used in the simplest way possible (i.e. using address accessors where needed,
and `async signTransaction`-like methods), so developers may be able to easily inject their own
implementations, to get called or intercept signature requests by these methods.

Optionally, `sendMessage` and `executeReport` also have companion `generateUnsignedSendMessage` and
`generateUnsignedExecuteReport` methods, returning chain-family-specific unsigned data, which one
can use to sign and send the transactions manually.

Notice that these are lower-level methods, and require the developer to handle the signing and
sending of the transactions themselves, skipping niceties from the higher-level methods, like
retries, gas estimation and transactions batching.

> [!TIP]
> For EVMChain on Browsers, one can use `chain.provider.getSigner(numberOrAddress)` to fetch a
provider-backed signer from compatible wallets, like Metamask.

## Tree-shakers

If you're using a tree-shaking bundler, make sure to `import { allSupportedChains } from '@chainlink/ccip-sdk'`,
or only the chains you want to support, e.g. `import { EVMChain, SolanaChain } from '@chainlink/ccip-sdk'`.
This should ensure those chain family implementations are registered and used by utility functions.

## Recipes

### Fetching details of a CCIP message
```ts
import { AptosChain } from '@chainlink/ccip-sdk'
const source = await AptosChain.fromUrl('mainnet')
const requests = await source.fetchRequestsInTx('0xTransactionHash')
console.log(requests[0])
```

### Sending a message
```ts
import { type AnyMessage, SolanaChain, networkInfo } from '@chainlink/ccip-sdk'
const source = await SolanaChain.fromUrl('https://api.mainnet-beta.solana.com')
const router = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C' // https://docs.chain.link/ccip/directory/mainnet
const dest = networkInfo('ethereum-mainnet').chainSelector
const message: AnyMessage = {
  receiver: '0xReceiverAddress',
  data: '0xbeef',
  extraArgs: { gasLimit: 250000, allowOutOfOrderExecution: true },
}
const fee = await source.getFee(router, dest, message)
const request = await source.sendMessage(
  router,
  dest,
  { ...message, fee },
  { wallet: process.env['SOLANA_PRIVATE_KEY'] },
)
const messageId = request.message.messageId
const txHash = request.tx.hash
```
