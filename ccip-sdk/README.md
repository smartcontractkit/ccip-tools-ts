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

Most chain families classes have a *cached* `getWallet` method, which handles creating a signer or
wallet from raw private keys. They receive a generic `{ wallet?: unknown }` object, which may be
passed from other methods, or CLI's `argv` options, to aid in wallet creation.

If they can't, users may override the *static* `getWallet` function (with parameters depending on
chain family implementation), which is called to try to construct a wallet or signer instead.
This can be used to extend the library to create signers according to each environment, without
requiring a full class inheritance.

Example:
```ts
import { EVMChain } from '@chainlink/ccip-sdk'

EVMChain.getWallet = async function(opts?: { provider?: Provider, wallet?: unknown }): Promise<Signer> {
  // instantiate Signer
}
```

> [!TIP]
> For EVMChain on Browsers, there's no need to override like the above, since providing a `{ wallet: number | address }` option object will make it create a signer from `provider.getSigner(number)`, which should load the account from the browser's wallet extension.

## Recipes

### Fetching details of a custom message, per transaction
```ts
import { AptosChain, fetchCCIPMessagesInTx } from '@chainlink/ccip-sdk'
const source = await AptosChain.fromUrl('mainnet')
const tx = await source.getTransaction('0xTransactionHash')
const messages = await fetchCCIPMessagesInTx(tx)
console.log(messages[0])
```

### Sending a message
```ts
import { SolanaChain, AnyMessage, fetchCCIPMessagesInTx, networkInfo } from '@chainlink/ccip-sdk'
const source = await SolanaChain.fromUrl('https://api.mainnet-beta.solana.com')
const router = 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C' // https://docs.chain.link/ccip/directory/mainnet
const dest = networkInfo('ethereum-mainnet')
const message: AnyMessage = {
  receiver: '0xReceiverAddress',
  data: '0xbeef',
  extraArgs: { gasLimit: 250000, allowOutOfOrderExecution: true },
}
const fee = await source.getFee(router, dest.chainSelector, message)
const tx = await source.sendMessage(
  router,
  dest.chainSelector,
  { ...message, fee },
  { wallet: process.env['SOLANA_PRIVATE_KEY'] },
)
const messageId = (await fetchCCIPMessagesInTx(tx))[0].message.header.messageId
```
