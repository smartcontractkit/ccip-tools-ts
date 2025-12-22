import { JsonRpcProvider } from 'ethers'
import type { Chain, PublicClient, Transport } from 'viem'

import type { ChainContext } from '../../chain.ts'
import { CCIPViemAdapterError } from '../../errors/index.ts'
import { EVMChain } from '../index.ts'

/**
 * Extract RPC URL from viem transport.
 * Handles http, webSocket, and fallback transports.
 */
function extractRpcUrl(client: PublicClient<Transport, Chain>): string {
  const transport = client.transport

  // Direct URL on transport
  if ('url' in transport && typeof transport.url === 'string') {
    return transport.url
  }

  // URL in transport value (common pattern)
  if ('value' in transport && transport.value && typeof transport.value === 'object') {
    const value = transport.value as Record<string, unknown>
    if ('url' in value && typeof value.url === 'string') {
      return value.url
    }
  }

  throw new CCIPViemAdapterError('Could not extract RPC URL from viem transport', {
    context: { transportType: transport.type },
    recovery: 'Ensure your PublicClient uses http() or webSocket() transport with a URL',
  })
}

/**
 * Create EVMChain from a viem PublicClient.
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
 */
export async function fromViemClient(
  client: PublicClient<Transport, Chain>,
  ctx?: ChainContext,
): Promise<EVMChain> {
  // Validate chain is defined
  if (!client.chain) {
    throw new CCIPViemAdapterError('PublicClient must have a chain defined', {
      recovery: 'Pass a chain to createPublicClient: createPublicClient({ chain: mainnet, ... })',
    })
  }

  // Extract RPC URL from transport
  const rpcUrl = extractRpcUrl(client)

  // Create ethers provider with chain ID
  const provider = new JsonRpcProvider(rpcUrl, client.chain.id)

  // Use existing EVMChain.fromProvider
  return EVMChain.fromProvider(provider, ctx)
}
