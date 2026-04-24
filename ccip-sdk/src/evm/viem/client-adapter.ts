import {
  type JsonRpcError,
  type JsonRpcPayload,
  type JsonRpcResult,
  JsonRpcApiProvider,
  Network,
} from 'ethers'
import { type Chain, type PublicClient, type Transport, BaseError } from 'viem'

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
          return { id: p.id, result }
        } catch (error) {
          // Preserve revert data through the viem→ethers bridge. viem throws a `BaseError`
          // tree where one of the nodes carries the revert payload (`ContractFunctionRevertedError.raw`,
          // `RpcRequestError.data`, `CallExecutionError.cause.data`). Stringifying via
          // `String(error)` discards it; ethers' downstream `getErrorData`/`parseData` then
          // can't decode the custom error. We walk the chain for the first node with a
          // `data` field (same pattern viem's own `getContractError` uses) and forward its
          // hex payload in the JSON-RPC error envelope.
          let data: `0x${string}` | undefined
          let message = String(error)

          if (error instanceof BaseError) {
            const node = error.walk((e) => e !== null && typeof e === 'object' && 'data' in e) as {
              raw?: unknown
              data?: unknown
            } | null

            // Prefer `.raw` (ContractFunctionRevertedError's raw revert bytes) over `.data`,
            // because `.data` on that class is structured (decoded) while on RpcRequestError
            // it's the raw hex we want.
            const candidate = typeof node?.raw === 'string' ? node.raw : node?.data
            if (
              typeof candidate === 'string' &&
              candidate.startsWith('0x') &&
              candidate.length > 2
            ) {
              data = candidate as `0x${string}`
            }

            message = error.shortMessage
          }

          return {
            id: p.id,
            error: {
              // Use EIP-1474 execution-reverted code when we successfully extracted revert
              // bytes — matches viem's own `EXECUTION_REVERTED_ERROR_CODE = 3` convention
              // and satisfies ethers' `spelunkData` heuristic for `/revert/i`-containing
              // messages paired with hex data.
              code: data ? 3 : -32000,
              message,
              ...(data ? { data } : {}),
            },
          }
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
