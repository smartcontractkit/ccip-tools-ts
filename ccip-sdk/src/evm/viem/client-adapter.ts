import {
  type JsonRpcError,
  type JsonRpcPayload,
  type JsonRpcResult,
  JsonRpcApiProvider,
  Network,
} from 'ethers'
import type { Chain, PublicClient, Transport } from 'viem'

import type { ChainContext } from '../../chain.ts'
import { CCIPViemAdapterError } from '../../errors/index.ts'
import { EVMChain } from '../index.ts'

/**
 * Custom ethers provider that forwards RPC calls through viem's transport.
 * Works with ALL viem transports: http, webSocket, custom (injected), fallback.
 *
 * This approach is superior to extracting URLs because it supports:
 * - MetaMask and other injected providers (window.ethereum)
 * - WalletConnect
 * - Coinbase Wallet
 * - Any custom() transport
 */
export class ViemTransportProvider extends JsonRpcApiProvider {
  readonly #client: PublicClient<Transport, Chain>

  /** Creates a new ViemTransportProvider wrapping the given viem client. */
  constructor(client: PublicClient<Transport, Chain>) {
    const network = Network.from({
      chainId: client.chain.id,
      name: client.chain.name,
    })
    super(network, { staticNetwork: network })
    this.#client = client
  }

  /**
   * Forward RPC calls to viem's transport.
   * Handles both single and batched requests.
   */
  async _send(
    payload: JsonRpcPayload | Array<JsonRpcPayload>,
  ): Promise<Array<JsonRpcResult | JsonRpcError>> {
    const payloads = Array.isArray(payload) ? payload : [payload]
    const results = await Promise.all(
      payloads.map(async (p) => {
        try {
          const params = Array.isArray(p.params) ? p.params : []
          const result = await this.#client.request({
            method: p.method as Parameters<PublicClient['request']>[0]['method'],
            params: params as Parameters<PublicClient['request']>[0]['params'],
          })
          return { id: p.id, result } as JsonRpcResult
        } catch (error) {
          return {
            id: p.id,
            error: { code: -32000, message: String(error) },
          } as JsonRpcError
        }
      }),
    )
    return results
  }
}

/**
 * Create EVMChain from a viem PublicClient.
 *
 * Supports ALL viem transport types including:
 * - http() - Standard HTTP transport
 * - webSocket() - WebSocket transport
 * - custom() - Injected providers (MetaMask, WalletConnect, etc.)
 * - fallback() - Fallback transport with multiple providers
 *
 * @param client - viem PublicClient instance with chain defined
 * @param ctx - Optional chain context (logger, etc.)
 * @returns EVMChain instance
 *
 * @example
 * ```typescript
 * import { createPublicClient, http } from 'viem'
 * import { mainnet } from 'viem/chains'
 * import { fromViemClient } from '@chainlink/ccip-sdk/viem'
 *
 * const publicClient = createPublicClient({
 *   chain: mainnet,
 *   transport: http('https://eth.llamarpc.com'),
 * })
 *
 * const chain = await fromViemClient(publicClient)
 * const messages = await chain.getMessagesInTx(tx)
 * ```
 *
 * @example Browser wallet (MetaMask)
 * ```typescript
 * import { createPublicClient, custom } from 'viem'
 * import { mainnet } from 'viem/chains'
 * import { fromViemClient } from '@chainlink/ccip-sdk/viem'
 *
 * const publicClient = createPublicClient({
 *   chain: mainnet,
 *   transport: custom(window.ethereum),
 * })
 *
 * const chain = await fromViemClient(publicClient)
 * ```
 */
export async function fromViemClient(
  client: PublicClient<Transport, Chain>,
  ctx?: ChainContext,
): Promise<EVMChain> {
  // Validate chain is defined
  if (!(client as Partial<typeof client>).chain) {
    throw new CCIPViemAdapterError('PublicClient must have a chain defined', {
      recovery: 'Pass a chain to createPublicClient: createPublicClient({ chain: mainnet, ... })',
    })
  }

  // Use custom provider that wraps viem transport (works for ALL transport types)
  const provider = new ViemTransportProvider(client)

  // Use existing EVMChain.fromProvider
  return EVMChain.fromProvider(provider, ctx)
}
