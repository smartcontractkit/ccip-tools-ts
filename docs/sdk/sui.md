# Sui providers

`SuiChain` supports gRPC-Web and JSON-RPC, both over HTTP.
The gRPC adapter uses the existing `@mysten/sui` dependency.
The SDK does not depend on `@grpc/grpc-js`.

## Select a transport

`SuiChain.fromUrl` detects the transport.
It tries gRPC-Web first, then JSON-RPC.
Sui public fullnodes serve only gRPC-Web, so use their HTTPS URL:

```typescript
import { SuiChain } from '@chainlink/ccip-sdk'

const chain = await SuiChain.fromUrl('https://fullnode.testnet.sui.io:443')
```

A JSON-RPC gateway URL also works:

```typescript
const chain = await SuiChain.fromUrl('https://your-sui-json-rpc-gateway')
```

The CLI accepts the same URLs through `--rpc`, RPC files, and `RPC_*` environment variables.

## Inject a client

`SuiClientLike` defines the methods that the SDK uses.
The JSON-RPC client and `SuiGrpcChainClient` implement this interface.
Use `SuiChain.fromClient(client, url, context)` to inject either client.

`SuiGrpcChainClient.from({ transport })` accepts a caller-provided `RpcTransport`.
An application can supply a native gRPC transport through this option.
The application must install any dependencies that its transport needs.
The SDK does not install those dependencies.

```typescript
import { SuiChain, SuiGrpcChainClient } from '@chainlink/ccip-sdk'

const client = SuiGrpcChainClient.fromBaseUrl('https://fullnode.testnet.sui.io:443')
const chain = await SuiChain.fromClient(client)
```

The adapter provides the JSON-RPC response fields that the SDK uses.
It does not provide full JSON-RPC compatibility.
Its class documentation lists unsupported filters and response differences.
Unsupported filters raise an error instead of returning unfiltered data.
