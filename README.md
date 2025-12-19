# ccip-tools-ts

TypeScript SDK and CLI for [CCIP](https://chain.link/cross-chain) (Cross-Chain Interoperability Protocol).

> [!IMPORTANT]
> This tool is provided under an MIT license and is for convenience and illustration purposes only.

## Packages

| Package                           | Description                         | Install                              |
| --------------------------------- | ----------------------------------- | ------------------------------------ |
| [@chainlink/ccip-sdk](./ccip-sdk) | TypeScript SDK for CCIP integration | `npm install @chainlink/ccip-sdk`    |
| [@chainlink/ccip-cli](./ccip-cli) | Command-line interface              | `npm install -g @chainlink/ccip-cli` |

## Quick Start

### Track a CCIP Message (CLI)

```bash
ccip-cli show 0xYOUR_TX_HASH \
  -r https://ethereum-sepolia-rpc.publicnode.com \
  -r https://sepolia-rollup.arbitrum.io/rpc
```

### Integrate in Your App (SDK)

```ts
import { EVMChain, networkInfo } from '@chainlink/ccip-sdk'

const source = await EVMChain.fromUrl('https://ethereum-sepolia-rpc.publicnode.com')
const router = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const dest = networkInfo('ethereum-testnet-sepolia-arbitrum-1').chainSelector

const fee = await source.getFee(router, dest, {
  receiver: '0xYourAddress',
  data: '0x48656c6c6f',
  extraArgs: { gasLimit: 200_000 },
})
```

## Supported Chains

| Chain Family | Networks                                                     | Status         |
| ------------ | ------------------------------------------------------------ | -------------- |
| EVM          | Ethereum, Arbitrum, Optimism, Polygon, Avalanche, Base, etc. | Supported      |
| Solana       | Mainnet, Devnet                                              | Supported      |
| Aptos        | Mainnet, Testnet                                             | Supported      |
| Sui          | Mainnet, Testnet                                             | In Development |
| TON          | Mainnet, Testnet                                             | In Development |

## Documentation

📖 **[Full Documentation](./docs/)**

| Guide                                          | Description                  |
| ---------------------------------------------- | ---------------------------- |
| [Overview](./docs/index.md)                    | Introduction and quick start |
| [SDK Guide](./docs/sdk/index.md)               | SDK usage and patterns       |
| [CLI Reference](./docs/cli/index.md)           | All commands and options     |
| [Contributing](./CONTRIBUTING.md)              | Development setup            |
| [Adding New Chain](./docs/adding-new-chain.md) | Implement a new blockchain   |

## Development

> [!NOTE]
> NodeJS version v20+ is required. For development of the packages, v24+ is required.
> `npm test` will only work with v24+

```bash
git clone https://github.com/smartcontractkit/ccip-tools-ts
cd ccip-tools-ts
npm ci
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## Resources

- [CCIP Official Documentation](https://docs.chain.link/ccip)
- [CCIP Directory](https://docs.chain.link/ccip/directory) - Router addresses by network
- [Changelog](./CHANGELOG.md)

## License

MIT
